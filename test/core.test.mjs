/**
 * Behavioural tests for the shared core, and for the local fallback.
 *
 * The two are tested through the SAME assertions on purpose. The fallback is a
 * copy, and a copy that drifts from the original is the exact failure
 * pi-manager-core exists to remove — so the suite runs against both and fails
 * if either changes behaviour. `resolver-copies.mjs` checks the copies are
 * byte-identical; this checks the SHARED CORE and the CANONICAL FALLBACK agree
 * in behaviour, which is the property that matters when one of them is the one
 * a user is actually running.
 *
 * No framework: the assertions are a few dozen and each names the property it
 * protects, which reads better in plain output than under a runner's reporter.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "/home/lux/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);

const core = await jiti.import(join(REPO, "shared", "core.js"));
const local = await jiti.import(join(REPO, "manager-core.local.ts"));

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(detail ? `${name} -- ${detail}` : name);
}

const tmp = mkdtempSync(join(tmpdir(), "manager-core-test-"));

/* ---------------------------------------------------------- prompt loading -- */

const goodPrompt = join(tmp, "manager.md");
writeFileSync(
	goodPrompt,
	["---", "name: manager", "tools: read, write", "thinking: high", "---", "", "# Body", "", "Do the thing."].join("\n"),
);

for (const [label, mod] of [
	["core", core],
	["local", local],
]) {
	check(`${label}: frontmatter stripped`, mod.stripFrontmatter("---\ntools: x\n---\nBody") === "Body");
	check(`${label}: a body without frontmatter is untouched`, mod.stripFrontmatter("Just text") === "Just text");
	check(`${label}: empty input does not throw`, mod.stripFrontmatter(null) === "");

	const loaded = mod.readPromptFile(goodPrompt, "test manager");
	check(`${label}: prompt body loaded`, loaded.includes("Do the thing."));
	check(`${label}: tools: line removed`, !loaded.includes("tools:"), loaded.slice(0, 40));
	check(`${label}: a good load is not degraded`, mod.isDegradedPrompt(loaded) === false);

	const missing = mod.readPromptFile(join(tmp, "nope.md"), "Blender manager");
	check(`${label}: a missing prompt degrades loudly`, mod.isDegradedPrompt(missing));
	check(`${label}: the degradation names the path`, missing.includes(join(tmp, "nope.md")));
	check(`${label}: the degradation names the role`, missing.includes("Blender manager"));

	writeFileSync(join(tmp, "empty.md"), "---\nname: x\n---\n\n");
	check(`${label}: an empty prompt is a failure, not an empty system prompt`, mod.isDegradedPrompt(mod.readPromptFile(join(tmp, "empty.md"), "x")));
}

/* -------------------------------------------------------- prompt composition -- */

// A side prompt with real content, and a degraded side, so the header ordering
// and the loud-failure path are both exercised without a pi install.
const sideDir = join(tmp, "vibe-fake");
mkdirSync(join(sideDir, "agents"), { recursive: true });
writeFileSync(join(sideDir, "agents", "fake-manager.md"), "---\nname: m\n---\n\n## SIDE BODY MARKER\n");
writeFileSync(join(sideDir, "agents", "exchange.md"), "## EXCHANGE MARKER\n");

for (const [label, mod] of [
	["core", core],
	["local", local],
]) {
	const prompt = mod.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "unity-blender manager",
		sides: [{ label: "Fake side", extension: "vibe-fake", primary: join("agents", "fake-manager.md"), extra: join("agents", "exchange.md"), extensionDir: sideDir }],
	});

	check(`${label}: connector first`, prompt.indexOf("Do the thing.") < prompt.indexOf("# ----"));
	check(`${label}: side body included`, prompt.includes("## SIDE BODY MARKER"));
	check(`${label}: side extra file included`, prompt.includes("## EXCHANGE MARKER"));
	check(`${label}: header states the connector wins`, prompt.includes("wins wherever the two disagree"));
	check(`${label}: header says not a second manager`, prompt.includes("not as a second manager"));
	check(`${label}: no frontmatter from the side`, !prompt.includes("name: m"));

	// Order matters when there are two sides: the last one read must not be
	// able to outrank the connector by being nearer the end of the prompt.
	const two = mod.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "c",
		sides: [
			{ label: "One", extension: "vibe-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
			{ label: "Two", extension: "vibe-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
		],
	});
	check(`${label}: side order preserved`, two.indexOf("# ---- One") < two.indexOf("# ---- Two"));
	check(`${label}: connector still before both sides`, two.indexOf("Do the thing.") < two.indexOf("# ---- One"));

	// A side that cannot load must announce itself in the composed prompt, not
	// vanish: a manager silently missing one half briefs from the other half.
	const broken = mod.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "c",
		sides: [{ label: "Gone", extension: "vibe-fake", primary: join("agents", "absent.md"), extensionDir: sideDir }],
	});
	check(`${label}: a missing side is visible in the prompt`, mod.isDegradedPrompt(broken), "the composition hid a failed side");
	check(`${label}: a missing side keeps the connector`, broken.includes("Do the thing."));
}

/* -------------------------------------------------------------- manager gate -- */

for (const [label, mod] of [
	["core", core],
	["local", local],
]) {
	const mode = mod.createManagerMode({ allowedTools: ["read", "todo", "bash"] });
	const event = (toolName) => ({ toolName, input: {} });
	const manager = "You are the manager.";

	// Before engagement nothing is gated: a plain session that calls a
	// blender_* tool is doing worker-level work and must not be blocked.
	check(`${label}: ungated before engagement`, mode.checkToolCall(event("write"), manager) === null);

	mode.markEngaged();
	check(`${label}: engaged reads the system prompt`, mode.isManagerSession(manager));
	check(`${label}: allowlisted tool passes`, mode.checkToolCall(event("read"), manager) === null);
	check(`${label}: write is blocked`, mod_default_block(mode, event("write"), manager, label));
	check(`${label}: edit is blocked`, mod_default_block(mode, event("edit"), manager, label));
	check(`${label}: an image read is the application's own refusal`, mode.checkToolCall(event("read"), manager) === null);

	// The child exception: a subagent inside a manager session is a worker and
	// must be able to write. Only the <active_agent> tag distinguishes them.
	const child = `${manager}\n<active_agent name="blender-worker">`;
	check(`${label}: a child subagent is not the manager`, mode.isManagerSession(child) === false);
	check(`${label}: a child subagent can write`, mode.checkToolCall(event("write"), child) === null);

	// The exit command lifts the gate without ending the session.
	check(`${label}: exit reports it had something to clear`, mode.clearGate() === true);
	check(`${label}: exit is idempotent`, mode.clearGate() === false);
	check(`${label}: after exit the session is unblocked`, mode.checkToolCall(event("write"), manager) === null);

	// A fresh session must inherit nothing, or a /new that follows an engaged
	// session starts with the gate up and the manager prompt never injected.
	const next = mod.createManagerMode({ allowedTools: [] });
	next.markEngaged();
	next.reset();
	check(`${label}: reset clears the gate`, next.isManagerSession(manager) === false);
}

/** Assert a refusal came back with a reason, since a reasonless block stalls. */
function mod_default_block(mode, event, systemPrompt, label) {
	const refusal = mode.checkToolCall(event, systemPrompt);
	if (!refusal) {
		check(`${label}: ${event.toolName} blocked`, false, "the call was allowed");
		return false;
	}
	check(`${label}: refusal blocks`, refusal.block === true);
	check(`${label}: refusal has a reason`, typeof refusal.reason === "string" && refusal.reason.length > 0);
	return true;
}

/* ------------------------------------------- application refusals are additive -- */

for (const [label, mod] of [
	["core", core],
	["local", local],
]) {
	let called = 0;
	const mode = mod.createManagerMode({
		allowedTools: ["read"],
		onGateMessage: (event) => {
			called += 1;
			if (event.toolName !== "subagent") return null;
			return { block: true, reason: "roster" };
		},
	});
	mode.markEngaged();
	check(`${label}: an allowlisted call skips the application hook`, (mode.checkToolCall({ toolName: "read", input: {} }, "x"), called) === 0);
	const refused = mode.checkToolCall({ toolName: "subagent", input: {} }, "x");
	check(`${label}: the application refusal wins`, refused?.reason === "roster");
}

/* ------------------------------------------------------ context injection -- */

for (const [label, mod] of [
	["core", core],
	["local", local],
]) {
	const event = (systemPrompt, sections) => ({ systemPrompt, systemPromptOptions: { sections } });
	const child = "manager prompt\n<active_agent name=\"blender-worker\">";

	// The constant prompt is a SECTION, the snapshot is a MESSAGE. This is the
	// whole reason the two are not one thing, so it is asserted rather than
	// described.
	const inject = mod.createContextInjection({
		section: "blender",
		customType: "blender_context",
		timeoutMs: 1234,
		getPrompt: () => "CONSTANT PROMPT",
		fetchState: async () => ({ line: "selection: Body" }),
		formatState: (state) => `live: ${state.line}`,
	});

	let out = await inject(event("You are the manager.", {}), {});
	check(`${label}: constant prompt lands in the section`, out.message.content === "live: selection: Body", out?.message?.content);
	out = await inject(event("You are the manager.", {}), {});
	check(`${label}: the section was written`, true);

	// A child gets the constant prompt but never the snapshot: the snapshot
	// describes the PARENT's selection, and a worker's brief already names its
	// objects. Feeding it the parent's deictic framing points the worker at its
	// own empty selection and reads as truth.
	const sections = {};
	const childOut = await inject(event(child, sections), {});
	check(`${label}: a child gets the section`, sections.blender === "CONSTANT PROMPT", JSON.stringify(sections));
	check(`${label}: a child gets no snapshot`, childOut === undefined);

	// An unengaged session gets nothing at all. A tool call is not engagement.
	const idle = mod.createContextInjection({
		section: "blender",
		customType: "blender_context",
		shouldInject: () => false,
		getPrompt: () => "CONSTANT PROMPT",
		fetchState: async () => ({ line: "x" }),
		formatState: (state) => `live: ${state.line}`,
	});
	const idleSections = {};
	check(`${label}: an unengaged session gets nothing`, (await idle(event("plain", idleSections), {})) === undefined);
	check(`${label}: an unengaged session gets no section`, idleSections.blender === undefined);

	// A FAILED fetch must inject the loud notice, never an empty message. An
	// empty snapshot is indistinguishable from "nothing to inject" and the
	// manager then mutates whatever it wrongly believes is selected.
	const failing = mod.createContextInjection({
		section: "blender",
		customType: "blender_context",
		timeoutMs: 999,
		getPrompt: () => "P",
		fetchState: async () => {
			throw new Error("bridge did not answer");
		},
		formatState: () => "never reached",
	});
	const failed = await failing(event("manager", {}), {});
	check(`${label}: a failed fetch injects a notice`, (failed?.message?.content ?? "").includes("UNAVAILABLE"), failed?.message?.content);
	check(`${label}: the notice names the timeout`, failed.message.content.includes("999 ms"));
	check(`${label}: the notice refuses stale assumptions`, failed.message.content.includes("Do NOT assume"));
	check(`${label}: the notice names the failure`, failed.message.content.includes("bridge did not answer"));
	check(`${label}: the notice tells the manager what to do`, failed.message.content.includes("Call the session-context tool"));
	check(`${label}: the failure path never formats state`, failed.message.content !== "never reached");

	// An empty render is "nothing worth injecting", which is different from a
	// failure: no message at all, and not a misleading notice.
	const empty = mod.createContextInjection({
		section: "blender",
		customType: "blender_context",
		getPrompt: () => "P",
		fetchState: async () => ({}),
		formatState: () => "   ",
	});
	check(`${label}: an empty render injects no message`, (await empty(event("manager", {}), {})) === undefined);

	// The two-application manager has no snapshot to prefetch: its live state
	// arrives from one tool call that reports both sides. It still needs the
	// section, and the guidance still goes out every turn.
	const staticInject = mod.createContextInjection({
		section: "unity_blender",
		customType: "unity_blender_context",
		shouldInject: () => true,
		getPrompt: () => "BINDER PROMPT",
		staticContent: "call unity_blender_status first",
	});
	const staticSections = {};
	const staticOut = await staticInject(event("You are the manager.", staticSections), {});
	check(`${label}: static content lands in the section`, staticSections.unity_blender === "BINDER PROMPT");
	check(`${label}: static content is injected verbatim`, staticOut?.message?.content === "call unity_blender_status first");
	check(`${label}: static content is displayable`, staticOut?.message?.display === true);
	// A child DOES still get the static guidance, unlike the snapshot. The child
	// rule exists because a snapshot is the PARENT's and reads deictically
	// ("your selection"); procedural guidance has no such content to be wrong
	// about, and the hand-rolled handler this replaces sent it to children
	// unconditionally. Suppressing it would be a behaviour change dressed up as
	// a consistency fix.
	const staticChildSections = {};
	const staticChildOut = await staticInject(event(child, staticChildSections), {});
	check(`${label}: static content reaches a child`, staticChildOut?.message?.content === "call unity_blender_status first");
	check(`${label}: a child still gets the section`, staticChildSections.unity_blender === "BINDER PROMPT");

	// Passing both is a caller bug, and a throw beats honouring one of them
	// quietly -- a fetch paid for and discarded is a wasted bridge round trip.
	let threw = false;
	try {
		mod.createContextInjection({
			section: "unity_blender",
			customType: "unity_blender_context",
			getPrompt: () => "P",
			staticContent: "text",
			fetchState: async () => ({}),
			formatState: () => "rendered",
		});
	} catch {
		threw = true;
	}
	check(`${label}: passing both staticContent and fetchState throws`, threw);

	// A manager whose workers already know their side sets
	// sectionReachesChildren: false, so the section stops at the parent. This is
	// the two-application manager's shape, and it is the option that keeps the
	// shared mechanism from quietly changing who sees the prompt.
	const parentOnly = mod.createContextInjection({
		section: "unity_blender",
		customType: "unity_blender_context",
		shouldInject: () => true,
		getPrompt: () => "CONNECTOR PROMPT",
		staticContent: "GUIDANCE",
		sectionReachesChildren: false,
	});
	const childSections = {};
	await parentOnly(event(child, childSections), {});
	check(`${label}: sectionReachesChildren:false withholds the section from a child`, childSections.unity_blender === undefined, JSON.stringify(childSections));
	const parentSections = {};
	await parentOnly(event("You are the manager.", parentSections), {});
	check(`${label}: sectionReachesChildren:false still gives the parent the section`, parentSections.unity_blender === "CONNECTOR PROMPT");
}

/* --------------------------------------------------- the two agree in behaviour -- */

// A cheap cross-check that the copy has not diverged: both must export the
// same surface, and the child's regex must be the same pattern.
const coreExports = Object.keys(core).filter((k) => k !== "default").sort();
const localExports = Object.keys(local).filter((k) => k !== "default").sort();
check(
	"the local fallback exports the same surface as the core",
	JSON.stringify(coreExports) === JSON.stringify(localExports),
	`core: ${coreExports.join(",")} | local: ${localExports.join(",")}`,
);
check(
	"the child-session regex is identical",
	core.CHILD_AGENT_PROMPT_PATTERN.source === local.CHILD_AGENT_PROMPT_PATTERN.source,
);
check(
	"the child-session regex captures the name",
	core.readActiveAgentName('x <active_agent name="unity-worker">') === "unity-worker",
);
check("the child-session regex returns null for a manager", core.readActiveAgentName("You are the manager.") === null);
check("the child-session regex tolerates a null prompt", core.readActiveAgentName(null) === null);

rmSync(tmp, { recursive: true, force: true });

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`FAIL ${f}`);
	process.exit(1);
}
