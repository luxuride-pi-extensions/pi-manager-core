/**
 * Does each manager's gate allow the toolkit its own prompt gives it?
 *
 * The gate is deny-by-default, so the allowlist in each extension's index.ts is
 * load-bearing: a tool the prompt puts in the manager's hands but the allowlist
 * omits is a tool the manager cannot use. That is not a hypothetical — the
 * Blender allowlist once held only `memory_*` and `scratchpad`, neither of which
 * any installed package provides, so every real manager tool was refused.
 *
 * The source of truth is the `tools:` line in the manager prompt, because that
 * is what pi actually hands the session. Reading the allowlist out of index.ts
 * by regex is fragile; asking the running extension is not, and it fails loudly
 * if a name is merely mentioned in a comment.
 *
 * The refusal side is asserted too, since an allowlist that accidentally
 * permits `write` or an image `read` would be just as broken.
 */

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createJiti } from "./jiti.mjs";

const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });
const REPO_ROOT = join(import.meta.dirname, "..");
const MANAGER_PROMPT = "You are the manager.";

// Whether an absent consumer checkout is a failure or a skip. The checks below
// read a sibling repository's manager prompt and load its index.ts, so they are
// cross-repository by construction and cannot run at all in a clone of this
// repository alone.
//
// It is a failure only where the siblings were deliberately checked out: the
// `consumers` job in .github/workflows/ci.yml checks out all three and sets
// PI_REQUIRE_CONSUMERS=1, so there is no way for one to be missing silently and
// the job reports "39 passed, 0 failed" either way. In this repository's own
// `core` job -- which checks out only this repository -- an absent checkout is
// reported as a skip instead, because a red check for "you cloned one repo when
// this suite needs four" trains everyone to ignore the check that is supposed
// to catch a tool quietly leaving a manager's allowlist.
const REQUIRED = process.env.PI_REQUIRE_CONSUMERS === "1";

const EXTENSIONS = [
	{
		dir: "pi-blender",
		prompt: "blender/agents/blender-manager.md",
		roster: ["blender-worker", "blender-critic"],
		// Blender and the binder both keep an IMAGE_READ_EXTENSIONS list and
		// refuse those reads by name. Unity declares neither: it has no
		// render-to-file step whose output a manager would be tempted to open, so
		// there is no refusal to assert and adding one would be writing
		// application policy the extension never asked for.
		refusesImageReads: true,
	},
	{
		dir: "pi-unity-vrchat",
		prompt: "unity/agents/unity-manager.md",
		roster: ["unity-worker", "unity-critic"],
		refusesImageReads: false,
	},
	{
		dir: "pi-unity-blender",
		prompt: "agents/unity-blender-manager.md",
		roster: ["blender-worker", "unity-worker"],
		refusesImageReads: true,
	},
];
/** The `tools:` line from a manager prompt's frontmatter. */
function promptTools(source) {
	const frontmatter = source.split("---")[1] ?? "";
	const line = frontmatter.split("\n").find((l) => l.startsWith("tools:"));
	if (!line) throw new Error("no tools: line in the manager prompt frontmatter");
	return line
		.slice("tools:".length)
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Load the extension and return its gate, with the extension genuinely engaged
 * so `isManagerSession` is true — a gate that is not engaged refuses nothing
 * and would make every assertion below pass for the wrong reason.
 */
async function engagedGate(dir) {
	const mod = await jiti.import(join(REPO_ROOT, "..", dir, "index.ts"));
	const events = new Map();
	const pi = {
		on: (event, handler) => {
			if (!events.has(event)) events.set(event, []);
			events.get(event).push(handler);
		},
		registerCommand: (name, options) => events.set(`cmd:${name}`, options),
		registerTool: () => {},
		sendUserMessage: () => {},
		notify: () => {},
	};
	mod.default(pi);
	const engage = [...events.keys()].find((k) => k.startsWith("cmd:") && !k.endsWith("-exit"));
	await events.get(engage).handler("build a thing", { ui: { notify: () => {} }, isIdle: () => true });
	const gate = events.get("tool_call")?.[0];
	if (!gate) throw new Error(`${dir}: no tool_call handler is registered`);
	return (toolName, input = {}) =>
		gate({ toolName, input, toolCallId: "probe" }, { getSystemPrompt: () => MANAGER_PROMPT });
}

let pass = 0;
const failures = [];
const skipped = [];
function check(label, ok, detail) {
	if (ok) pass++;
	else failures.push(`${label}${detail ? `\n    ${detail}` : ""}`);
}

for (const ext of EXTENSIONS) {
	const promptPath = join(REPO_ROOT, "..", ext.dir, ext.prompt);
	if (!existsSync(promptPath)) {
		const note = `${ext.dir}: checkout not present at ${join(REPO_ROOT, "..", ext.dir)}`;
		if (REQUIRED) failures.push(note);
		else skipped.push(`${ext.dir} (not checked out)`);
		continue;
	}
	let expected;
	try {
		expected = promptTools(readFileSync(promptPath, "utf8"));
	} catch (error) {
		failures.push(`${ext.dir}: cannot read the manager prompt — ${error.message}`);
		continue;
	}

	let gate;
	try {
		gate = await engagedGate(ext.dir);
	} catch (error) {
		failures.push(`${ext.dir}: ${error.message}`);
		continue;
	}

	// Each tool is probed with a REAL call shape, not with `{}`.
	//
	// `{}` is not a call pi makes, and for `subagent` it is now a refused one:
	// the roster check in shared/manager-mode.js refuses a spawn whose `agent`
	// field it cannot read, precisely so that `{agent: undefined}`, the plural
	// `{agents: [...]}` and a call naming nothing at all cannot slip past the
	// roster. A bare `{}` is that shape, so probing it here measures the ROSTER
	// policy instead of the allowlist this check is about, and reports the
	// allowlisted `subagent` as refused.
	//
	// A control action is the shape that isolates the question: it carries no
	// agent (so the roster check passes it through by design) and it is a call
	// the manager really makes to look at its children, so the only thing left
	// under test is whether `subagent` is in the allowlist at all. The named
	// roster-member spawns and the refusals below are still probed explicitly,
	// which is where the roster policy is actually asserted.
	const PROBE_INPUT = { subagent: { action: "status" } };
	const blocked = expected.filter(
		(tool) => gate(tool, PROBE_INPUT[tool] ?? {})?.block === true,
	);
	check(
		`${ext.dir}: every tool in the manager prompt is allowed`,
		blocked.length === 0,
		`refused: ${blocked.join(", ")}`,
	);

	// The refusals must still bite, or a permissive allowlist is the failure
	// mode and these assertions would pass while the gate does nothing.
	check(`${ext.dir}: write is refused`, gate("write", { path: "a.ts" })?.block === true);
	check(`${ext.dir}: edit is refused`, gate("edit", { path: "a.ts" })?.block === true);
	if (ext.refusesImageReads) {
		// This is the assertion that caught the allowlist short-circuiting the
		// refusals: `read` is allowed, so an allowlist-first gate made the image
		// refusal unreachable without reporting anything.
		check(
			`${ext.dir}: reading an image is refused even though read is allowed`,
			gate("read", { path: "modules/x/render.png" })?.block === true,
		);
	}
	check(
		`${ext.dir}: a text read is allowed`,
		gate("read", { path: "notes.md" })?.block !== true,
	);
	check(
		`${ext.dir}: bash is refused`,
		gate("bash", { command: "ls" })?.block === true,
		"a deny-by-default gate with no bash entry refuses it; say so here if that is intended",
	);

	// Delegation is the one capability the manager cannot work without, so a
	// refusal of a roster member is checked by name, not just of a stranger.
	for (const agent of ext.roster) {
		check(
			`${ext.dir}: spawning ${agent} is allowed`,
			gate("subagent", { agent })?.block !== true,
			`refused: ${gate("subagent", { agent })?.reason?.slice(0, 80) ?? ""}`,
		);
	}

	// The two halves of waiting, asserted by name because neither is
	// registered by any index.ts, so no other check here can see them dropped.
	for (const tool of ["bg_wait", "subagent_supervisor"]) {
		check(`${ext.dir}: ${tool} is allowed`, gate(tool, {})?.block !== true);
	}
}

console.log(`${pass} passed, ${failures.length} failed${skipped.length ? `, ${skipped.length} skipped` : ""}`);
for (const note of skipped) console.log(`ok ${note}`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
