/**
 * Can a manager actually do its job? A probe, not a suite.
 *
 * The registration test answered "does the gate fire". It did not answer the
 * question that matters: once engaged, can the manager still spawn the workers
 * its own prompt tells it to spawn? A gate that refuses everything is a
 * perfectly working gate and a completely broken manager.
 *
 * Prints what each manager's gate does with a representative call. Reading the
 * output beats asserting an allowlist here, because the correct allowlist is
 * per-extension policy and an invented one would be a guess.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { createJiti } from "/home/lux/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });
const REPO_ROOT = join(import.meta.dirname, "..");
const MANAGER_PROMPT = "You are the manager.";

for (const name of ["pi-blender", "pi-unity", "pi-unity-blender"]) {
	const mod = await jiti.import(join(REPO_ROOT, "..", name, "index.ts"));
	const extension = mod.default;

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
	extension(pi);

	// Engage by running the extension's own engage command, the way a user does.
	const engageName = [...events.keys()].find((k) => k.startsWith("cmd:") && !k.endsWith("-exit"));
	await events.get(engageName).handler("build a thing", { ui: { notify: () => {} }, isIdle: () => true });

	const gate = events.get("tool_call")?.[0];
	console.log(`\n=== ${name}  (gate installed: ${Boolean(gate)})`);
	if (!gate) {
		console.log("  no tool_call handler — the gate never runs");
		continue;
	}

	const calls = [
		{ label: "subagent -> blender-worker", toolName: "subagent", input: { agent: "blender-worker" } },
		{ label: "subagent -> unity-worker", toolName: "subagent", input: { agent: "unity-worker" } },
		{ label: "subagent -> some-unknown-agent", toolName: "subagent", input: { agent: "some-unknown-agent" } },
		{ label: "todo", toolName: "todo", input: {} },
		{ label: "read agent file (text)", toolName: "read", input: { path: "a.md" } },
		{ label: "read render.png (image)", toolName: "read", input: { path: "modules/x/render.png" } },
		{ label: "grep", toolName: "grep", input: { pattern: "x" } },
		{ label: "bash", toolName: "bash", input: { command: "ls" } },
		{ label: "ask_user_question", toolName: "ask_user_question", input: {} },
		{ label: "contact_supervisor", toolName: "contact_supervisor", input: {} },
		{ label: "write", toolName: "write", input: { path: "a.ts" } },
	];
	for (const call of calls) {
		const verdict = gate({ toolName: call.toolName, input: call.input, toolCallId: "probe" }, {
			getSystemPrompt: () => MANAGER_PROMPT,
		});
		const how = verdict?.block === true ? "BLOCKED" : "allowed";
		const why = verdict?.block === true ? (verdict.reason ?? "").split(".")[0].slice(0, 62) : "";
		console.log(`  ${how.padEnd(8)} ${call.label.padEnd(34)} ${why}`);
	}
}
