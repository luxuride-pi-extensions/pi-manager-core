/**
 * What do the three extensions actually register at runtime?
 *
 * The per-repo suites test each extension in isolation, and `which-core` proves
 * they resolve the shared core. Neither says the extensions LOAD under pi, and a
 * broken registration fails at the moment a user types a slash command — with no
 * test having failed first.
 *
 * So this loads each extension's default export against a mock `pi`, the same way
 * pi would, and asks the question the user would: are the commands there, and
 * does engaging one actually engage?
 *
 * The mock is intentionally dumb. It records what was registered and lets a
 * test drive the handlers. A real ExtensionAPI is not available outside pi, and
 * a mock that tried to be faithful would be testing itself.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createJiti } from "./jiti.mjs";

const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });
const REPO_ROOT = join(import.meta.dirname, "..");

const MODULES = {
	"pi-blender": "index.ts",
	"pi-unity-vrchat": "index.ts",
	"pi-unity-blender": "index.ts",
};

/**
 * Whether a missing consumer checkout is an error.
 *
 * It depends on who is running, so it is an input rather than a constant.
 * resolver-copies and dependency-declaration both skip an absent checkout, and
 * this one used to fail instead — which meant `npm test` passed in a working
 * directory that happens to have all four repos and failed on a runner with
 * one. The skip is right for a local `npm test` and wrong for a job that
 * checked the consumers out on purpose, so PI_REQUIRE_CONSUMERS=1 turns the
 * absence into the error it really is there. The consumers matrix job in
 * ci.yml sets it, which is what makes that job's coverage real rather than
 * accidental.
 */
const REQUIRED = process.env.PI_REQUIRE_CONSUMERS === "1";

let pass = 0;
const failures = [];
const skipped = [];
function check(label, condition, detail) {
	if (condition) {
		pass++;
		return;
	}
	failures.push(`${label}${detail ? `  — ${detail}` : ""}`);
}

/** A pi stand-in that records registrations and can drive the handlers. */
function makeMockPi() {
	const commands = new Map();
	const events = new Map();
	const notifications = [];
	const tools = new Map();
	const sent = [];
	return {
		commands,
		events,
		notifications,
		tools,
		sent,
		registerCommand(name, options) {
			// The two-argument form is the only one pi supports. The object form
			// registers under `undefined` and the command becomes unreachable, so
			// a name check here is a real guard against that regression.
			if (name === undefined) throw new Error("registerCommand called with the object form");
			commands.set(name, options);
		},
		registerTool(name, options) {
			tools.set(name, options);
		},
		// An engage command hands the task back to the session as a user
		// message, optionally steered when the session is busy. Recording it
		// is also what lets the test confirm engaging actually did something.
		sendUserMessage(text, options) {
			sent.push({ text, options });
		},
		on(event, handler) {
			if (!events.has(event)) events.set(event, []);
			events.get(event).push(handler);
		},
		notify(message) {
			notifications.push(message);
		},
		async emit(event, ...args) {
			const results = [];
			for (const handler of events.get(event) ?? []) results.push(await handler(...args));
			return results;
		},
	};
}

/** A tool_call event plus the shape the gate reads. */
function toolCallEvent(toolName) {
	return { toolName, args: {}, toolCallId: "test-call" };
}

const MANAGER_PROMPT = "You are the manager.";

for (const [name, entry] of Object.entries(MODULES)) {
	const dir = join(REPO_ROOT, "..", name);
	if (!existsSync(dir)) {
		const note = `${name}: checkout not present at ${dir}`;
		if (REQUIRED) failures.push(note);
		else skipped.push(`${name} (not checked out)`);
		continue;
	}

	let extension;
	try {
		const mod = await jiti.import(join(dir, entry));
		extension = mod.default;
	} catch (error) {
		failures.push(`${name}: failed to load — ${error instanceof Error ? error.message : String(error)}`);
		continue;
	}
	check(`${name}: exports a default function`, typeof extension === "function");

	const pi = makeMockPi();
	try {
		extension(pi);
	} catch (error) {
		// The throw IS the assertion, and recording it here is what makes the
		// registration counts below meaningful. There used to also be
		// `check("... registered without throwing", true)` on the next line,
		// which could not fail: reaching it already meant nothing was thrown.
		failures.push(`${name}: threw while registering — ${error instanceof Error ? error.message : String(error)}`);
		continue;
	}

	// Every manager has an engage and an exit command. The names are the
	// extension's own, so this checks the pair exists rather than a fixed name.
	const names = [...pi.commands.keys()];
	check(`${name}: registers an engage command`, names.some((n) => /blender|unity/.test(n) && !n.endsWith("-exit")), names.join(","));
	check(`${name}: registers an exit command`, names.some((n) => n.endsWith("-exit")), names.join(","));
	check(`${name}: every command has a handler`, [...pi.commands.values()].every((c) => typeof c.handler === "function"));
	check(`${name}: every command has a description`, [...pi.commands.values()].every((c) => typeof c.description === "string" && c.description.length > 0));
	check(`${name}: registers a session_start hook`, (pi.events.get("session_start") ?? []).length > 0);
	check(`${name}: registers a before_agent_start hook`, (pi.events.get("before_agent_start") ?? []).length > 0);
	check(`${name}: installs the tool gate`, (pi.events.get("tool_call") ?? []).length > 0);

	// Engage, then confirm the session actually became a manager. Without this
	// the commands could all register and none of them work.
	const engageName = names.find((n) => /blender|unity/.test(n) && !n.endsWith("-exit"));
	const ctx = { ui: { notify: (m) => pi.notify(m) }, isIdle: () => true };
	await pi.commands.get(engageName).handler("a task", ctx);

	// The tool gate is the behaviour that matters most: after engaging, a tool
	// the manager may not use is refused, and its own transfer/inspect tool is
	// not. Which tools are gated is policy and differs per extension, so this
	// asserts the gate responds at all rather than a fixed allowlist.
	const refusals = await pi.emit("tool_call", toolCallEvent("definitely_not_a_real_tool"), {
		getSystemPrompt: () => MANAGER_PROMPT,
	});
	const blocked = refusals.filter((r) => r && r.block === true && typeof r.reason === "string");
	check(`${name}: the gate refuses a non-allowlisted tool`, blocked.length > 0, JSON.stringify(refusals).slice(0, 200));
	check(`${name}: the refusal explains itself`, blocked.every((r) => r.reason.length > 20));

	// The injection hook runs, and an unengaged session is not the subject here
	// — we are engaged, so it must produce something.
	const injected = await pi.emit(
		"before_agent_start",
		{ systemPrompt: MANAGER_PROMPT, systemPromptOptions: { sections: {} } },
		{ getSystemPrompt: () => MANAGER_PROMPT, cwd: process.cwd() },
	);
	check(
		`${name}: injection produces guidance for the manager`,
		injected.some((r) => r && r.message && typeof r.message.content === "string" && r.message.content.length > 0),
		JSON.stringify(injected).slice(0, 200),
	);

	// Exit, and confirm the gate is lifted — a session that exits must not stay
	// restricted, which is the failure that outlives the command.
	const exitName = names.find((n) => n.endsWith("-exit"));
	await pi.commands.get(exitName).handler("", ctx);
	const afterExit = await pi.emit("tool_call", toolCallEvent("definitely_not_a_real_tool"), {
		getSystemPrompt: () => MANAGER_PROMPT,
	});
	check(
		`${name}: the gate is lifted on exit`,
		!afterExit.some((r) => r && r.block === true),
		JSON.stringify(afterExit).slice(0, 200),
	);
}

// The skip is reported, never silent: a run that checked nothing out has to be
// distinguishable from a run that checked everything out and found it correct.
console.log(`${pass} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ""}`);
for (const note of skipped) console.log(`ok ${note}`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
