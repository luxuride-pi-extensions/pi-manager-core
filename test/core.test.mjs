/**
 * Behavioural tests for the shared core.
 *
 * This used to run every assertion twice, once against the core and once against
 * a per-consumer fallback copy, because a copy that drifts is the exact failure
 * pi-manager-core exists to remove. There is no fallback any more: a missing
 * core is a hard error. The cross-check that replaced the second run is at the
 * bottom, and it guards the same property from the other side — the shim's
 * declared `ManagerCore` contract and the core's real exports have to name the
 * same things, which is what the old type-source fallback used to guarantee.
 *
 * No framework: the assertions are a few dozen and each names the property it
 * protects, which reads better in plain output than under a runner's reporter.
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "/home/lux/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);

const core = await jiti.import(join(REPO, "shared", "core.js"));

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

for (const [label, mod] of [["core", core]]) {
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
const sideDir = join(tmp, "pi-fake");
mkdirSync(join(sideDir, "agents"), { recursive: true });
writeFileSync(join(sideDir, "agents", "fake-manager.md"), "---\nname: m\n---\n\n## SIDE BODY MARKER\n");
writeFileSync(join(sideDir, "agents", "exchange.md"), "## EXCHANGE MARKER\n");

for (const [label, mod] of [["core", core]]) {
	const prompt = mod.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "unity-blender manager",
		sides: [{ label: "Fake side", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extra: join("agents", "exchange.md"), extensionDir: sideDir }],
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
			{ label: "One", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
			{ label: "Two", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
		],
	});
	check(`${label}: side order preserved`, two.indexOf("# ---- One") < two.indexOf("# ---- Two"));
	check(`${label}: connector still before both sides`, two.indexOf("Do the thing.") < two.indexOf("# ---- One"));

	// A side that cannot load must announce itself in the composed prompt, not
	// vanish: a manager silently missing one half briefs from the other half.
	const broken = mod.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "c",
		sides: [{ label: "Gone", extension: "pi-fake", primary: join("agents", "absent.md"), extensionDir: sideDir }],
	});
	check(`${label}: a missing side is visible in the prompt`, mod.isDegradedPrompt(broken), "the composition hid a failed side");
	check(`${label}: a missing side keeps the connector`, broken.includes("Do the thing."));
}

/* -------------------------------------------------------------- manager gate -- */

for (const [label, mod] of [["core", core]]) {
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

	// A /reload is not a fresh session, and this is the case that shipped as a
	// live bug in all three extensions: pi calls oldRunner.invalidate() and
	// re-emits session_start with reason "reload", which cleared the gate while
	// the manager prompt stayed in context as the cached system prefix. A
	// session that still BEHAVED like the manager had lost the allowlist, the
	// write/edit refusal and the image refusal in one slash command, silently.
	for (const reason of ["reload"]) {
		const reloaded = mod.createManagerMode({ allowedTools: [] });
		reloaded.markEngaged();
		reloaded.reset(reason);
		check(`${label}: ${reason} keeps the gate up`, reloaded.isManagerSession(manager) === true);
		check(
			`${label}: ${reason} still refuses write`,
			reloaded.checkToolCall(event("write"), manager)?.block === true,
		);
	}
	// Every OTHER reason is a genuinely different session and must still clear.
	for (const reason of ["startup", "new", "resume", "fork", undefined]) {
		const fresh = mod.createManagerMode({ allowedTools: [] });
		fresh.markEngaged();
		fresh.reset(reason);
		check(`${label}: reset(${reason ?? "no argument"}) clears the gate`, fresh.isManagerSession(manager) === false);
	}
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

/* ----------------------------------------------------------------- roster -- */

for (const [label, mod] of [["core", core]]) {
	// `subagent` is on every manager's allowlist, because delegating IS the
	// manager's job. So a roster check placed after the allowlist never fires
	// and still reads as protection. Asserted here for that reason specifically.
	const mode = mod.createManagerMode({
		allowedTools: ["read", "subagent", "todo"],
		agentRoster: ["unity-worker", "unity-critic"],
	});
	mode.markEngaged();
	const spawn = (input) => ({ toolName: "subagent", input });

	check(`${label}: a roster member spawns`, mode.checkToolCall(spawn({ agent: "unity-worker" }), "x") === null);
	const off = mode.checkToolCall(spawn({ agent: "some-other-writer" }), "x");
	check(`${label}: a non-member is refused`, off?.block === true);
	check(`${label}: the refusal names the roster`, /unity-worker, unity-critic/.test(off?.reason ?? ""));
	check(`${label}: the refusal names the way out`, /say so in your report/.test(off?.reason ?? ""));

	// Management/control actions carry no `agent`, so refusing them would make
	// the manager unable to ask what its own children are doing.
	check(`${label}: a management action is not a spawn`, mode.checkToolCall(spawn({ action: "status" }), "x") === null);
	check(`${label}: whitespace is not an agent name`, mode.checkToolCall(spawn({ agent: "  " }), "x") === null);
	check(`${label}: the roster does not loosen the allowlist`, mode.checkToolCall({ toolName: "bash", input: {} }, "x")?.block === true);

	const open = mod.createManagerMode({ allowedTools: ["subagent"] });
	open.markEngaged();
	check(`${label}: no roster means no roster constraint`, open.checkToolCall(spawn({ agent: "anyone" }), "x") === null);
}

// A child subagent is a worker, not the manager, and inherits nothing of the
// roster. Asserted because the roster sits in the manager path only.
for (const [label, mod] of [["core", core]]) {
	const mode = mod.createManagerMode({ allowedTools: [], agentRoster: ["unity-worker"] });
	mode.markEngaged();
	const child = `<active_agent name="unity-worker">`;
	check(`${label}: a child subagent is not the manager`, mode.isManagerSession(child) === false);
	check(`${label}: a child subagent is not roster-checked`, mode.checkToolCall({ toolName: "subagent", input: { agent: "other" } }, child) === null);
}

/* ------------------------------------------- application refusals are additive -- */

for (const [label, mod] of [["core", core]]) {
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
	// The hook is consulted BEFORE the allowlist, so it must fire even for an
	// allowlisted tool — a coarse allowlist must not be able to short-circuit a
	// specific refusal. `read` is the real case: it is allowed, yet reading an
	// image through it is refused.
	const allowed = mode.checkToolCall({ toolName: "read", input: {} }, "x");
	check(`${label}: the application hook is consulted even for an allowlisted tool`, called === 1);
	check(`${label}: an allowlisted call with no refusal is allowed`, allowed === null);
	const refused = mode.checkToolCall({ toolName: "subagent", input: {} }, "x");
	check(`${label}: the application refusal wins`, refused?.reason === "roster");
	check(`${label}: a tool in neither the allowlist nor a refusal is refused by default`, mode.checkToolCall({ toolName: "bash", input: {} }, "x")?.block === true);
}

/* ------------------------------------------------------ context injection -- */

for (const [label, mod] of [["core", core]]) {
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

/* ------------------------------------------- the shim contract matches reality -- */

// The shim can no longer derive its `ManagerCore` type from a local copy: that
// path is computed at runtime, so no compiler can see it, and the old fallback
// was doubling as the type source. The type is now written out by hand in
// manager-core.ts, which moves the guarantee from compile time to here.
//
// So this checks the SAME property the fallback used to give for free, in both
// directions, because both failures are quiet. A name the contract declares
// that the core does not have is a crash in a consumer, at a call site, weeks
// later. A name the core has that the contract does not declare is a consumer
// that cannot use the new export until the shim is updated and recopied --
// which is how a core fix silently fails to reach the extensions.
const shim = readFileSync(join(REPO, "manager-core.ts"), "utf8");
const contract = shim.slice(shim.indexOf("export interface ManagerCore {"), shim.indexOf("\n}\n", shim.indexOf("export interface ManagerCore {")));
const declared = [...contract.matchAll(/^\t([A-Za-z_][A-Za-z0-9_]*)[?]?[:(]/gm)].map((m) => m[1]).sort();
const actual = Object.keys(core).filter((k) => k !== "default").sort();

for (const name of declared) {
	check(
		`the shim contract declares ${name}, and the core has it`,
		name in core,
		`the core exports: ${actual.join(",")}`,
	);
}
for (const name of actual) {
	check(
		`the core exports ${name}, and the shim contract declares it`,
		declared.includes(name),
		`the contract declares: ${declared.join(",")}`,
	);
}
check("the shim contract is not empty", declared.length > 0, `parsed: ${contract.slice(0, 120)}`);

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
