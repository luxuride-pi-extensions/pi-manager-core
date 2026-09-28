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
import { readFileSync } from "node:fs";
import { createJiti } from "/home/lux/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });
const REPO_ROOT = join(import.meta.dirname, "..");
const MANAGER_PROMPT = "You are the manager.";

const EXTENSIONS = [
	{
		dir: "pi-vibe-blender",
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
		dir: "pi-vibe-unity",
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
function check(label, ok, detail) {
	if (ok) pass++;
	else failures.push(`${label}${detail ? `\n    ${detail}` : ""}`);
}

for (const ext of EXTENSIONS) {
	const promptPath = join(REPO_ROOT, "..", ext.dir, ext.prompt);
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

	const blocked = expected.filter((tool) => gate(tool)?.block === true);
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
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);
