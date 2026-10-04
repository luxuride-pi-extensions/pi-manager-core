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

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "./jiti.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url);

const core = await jiti.import(join(REPO, "shared", "core.js"));

// index.ts is loaded through jiti too, because its `./shared/core.js`
// specifier is NodeNext and `--strip-types` cannot resolve it.
const extensionEntry = await jiti.import(join(REPO, "index.ts"));

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(detail ? `${name} -- ${detail}` : name);
}

/**
 * Every exported value, checked for the shape the hand-written `.d.ts` claims.
 *
 * This exists because `checkJs: false` in tsconfig.json means no compiler ever
 * looks at the `.js` bodies: a `.d.ts` that misstates a signature is invisible
 * to `npm run typecheck`, and the shim-contract check below compares NAMES only.
 * A consumer written in TypeScript would then fail to compile — or, worse,
 * compile against a promise the function does not keep.
 *
 * So this asserts `typeof` and arity for every export, and `instanceof RegExp`
 * for the one that declares a regex. Both are decidable at runtime and neither
 * can be satisfied by a misstatement. CHILD_AGENT_PROMPT_PATTERN is excluded
 * from the arity table only because a RegExp literal has no declared arity in
 * the contract — it is checked by type here and by capture behaviour in the
 * assertions below.
 */
const ARITY = {
	xdgCacheHome: 0,
	// 1, not the 2 the shim contract's `cwd?` suggests: the second parameter
	// has a default, and `Function.length` counts only parameters before the
	// first default. Stating it as 2 would have been a test that could never
	// pass, so the assertion documents the rule instead.
	expandUserPath: 1,
	getPiAgentDir: 0,
	getInstalledExtensionDir: 1,
	stripFrontmatter: 1,
	readPromptFile: 2,
	isDegradedPrompt: 1,
	composeManagerPrompt: 1,
	readActiveAgentName: 1,
	createManagerMode: 0,
	createContextInjection: 1,
	registerEngageCommand: 2,
	registerExitCommand: 2,
};

for (const [name, arity] of Object.entries(ARITY)) {
	check(`${name} is a function`, typeof core[name] === "function", `typeof is ${typeof core[name]}`);
	check(`${name} takes ${arity} declared argument(s)`, core[name]?.length === arity, `declared arity is ${core[name]?.length}`);
}
check(
	"CHILD_AGENT_PROMPT_PATTERN is a RegExp, as the shim contract declares",
	core.CHILD_AGENT_PROMPT_PATTERN instanceof RegExp,
	`typeof is ${typeof core.CHILD_AGENT_PROMPT_PATTERN}`,
);

// createManagerMode and createContextInjection both take ONE optional object, so
// their declared arity of 0 and 1 is what a default parameter yields. The two
// checks below pin that down behaviourally rather than by counting: a function
// that destructures its options and is called with none must not throw.
check(
	"createManagerMode() with no options at all still constructs",
	typeof core.createManagerMode().checkToolCall === "function",
);
check(
	"createContextInjection() rejects the both-at-once caller bug by throwing, not by signature",
	(() => {
		try {
			core.createContextInjection({ section: "s", customType: "c", getPrompt: () => "", staticContent: "x", fetchState: async () => ({}) });
			return false;
		} catch {
			return true;
		}
	})(),
);

const tmp = mkdtempSync(join(tmpdir(), "manager-core-test-"));

/* ---------------------------------------------------------- prompt loading -- */

const goodPrompt = join(tmp, "manager.md");
writeFileSync(
	goodPrompt,
	["---", "name: manager", "tools: read, write", "thinking: high", "---", "", "# Body", "", "Do the thing."].join("\n"),
);

/* Every assertion in this section runs ONCE, against the shared core. It used to run twice —
 * once against a per-consumer fallback copy that no longer exists — so the one-element loop
 * `for (const [label, mod] of [["core", core]])` was collapsed into a plain block. The braces it
 * already were (local scope, so the next section may declare `mode` too) are kept; what is
 * gone is the loop header, and with it the source reading as a paired comparison that runs
 * one arm. A reader counting coverage from the source was over-counting every assertion twice.
 *
 * That is also why assertion names below no longer start `core: `: the label existed only to
 * distinguish the two runs, and the section comment does that now.
 */
{
	check("frontmatter stripped", core.stripFrontmatter("---\ntools: x\n---\nBody") === "Body");
	check("a body without frontmatter is untouched", core.stripFrontmatter("Just text") === "Just text");
	check("empty input does not throw", core.stripFrontmatter(null) === "");

	// CRLF. The closing delimiter ends `---\r\n`, which the old `\n---` did not
	// match, so a file checked out on Windows or written by a CRLF editor passed
	// through WHOLE -- and because readPromptFile only degrades on empty content,
	// the `tools:` line reached the system prompt as if the read had succeeded.
	// That is the whole point of the function, so it is asserted from both ends:
	// the strip itself, and the read it feeds.
	check(
		`CRLF frontmatter is stripped`,
		core.stripFrontmatter("---\r\ntools: x\r\n---\r\nBody") === "Body",
		JSON.stringify(core.stripFrontmatter("---\r\ntools: x\r\n---\r\nBody")),
	);
	check(
		`CRLF frontmatter does not swallow the body`,
		!core.stripFrontmatter("---\r\ntools: read, write\r\n---\r\n# Body\r\n").includes("tools:"),
	);
	// Nothing here rewrites line endings inside the body: the trailing trim() only
	// touches the ends, and rewriting a prompt's interior line endings would be
	// a change nobody asked for. What matters is that the frontmatter is GONE
	// rather than re-emitted with its delimiters.
	check(
		`a CRLF body with no frontmatter keeps its text`,
		core.stripFrontmatter("Just text\r\nmore") === "Just text\r\nmore",
		JSON.stringify(core.stripFrontmatter("Just text\r\nmore")),
	);
	// A file that opens with a horizontal rule is not frontmatter, and neither
	// line ending may swallow it: the pattern needs a SECOND --- to close.
	check(
		`a leading --- with no closing delimiter is kept`,
		core.stripFrontmatter("---\nnot frontmatter") === "---\nnot frontmatter",
		JSON.stringify(core.stripFrontmatter("---\nnot frontmatter")),
	);
	check(
		`a CRLF --- with no closing delimiter is kept`,
		core.stripFrontmatter("---\r\nnot frontmatter") === "---\r\nnot frontmatter",
		JSON.stringify(core.stripFrontmatter("---\r\nnot frontmatter")),
	);

	const loaded = core.readPromptFile(goodPrompt, "test manager");
	check("prompt body loaded", loaded.includes("Do the thing."));
	check("tools: line removed", !loaded.includes("tools:"), loaded.slice(0, 40));
	check("a good load is not degraded", core.isDegradedPrompt(loaded) === false);

	const missing = core.readPromptFile(join(tmp, "nope.md"), "Blender manager");
	check("a missing prompt degrades loudly", core.isDegradedPrompt(missing));
	check("the degradation names the path", missing.includes(join(tmp, "nope.md")));
	check("the degradation names the role", missing.includes("Blender manager"));

	writeFileSync(join(tmp, "empty.md"), "---\nname: x\n---\n\n");
	check("an empty prompt is a failure, not an empty system prompt", core.isDegradedPrompt(core.readPromptFile(join(tmp, "empty.md"), "x")));

	// The same file, CRLF, read through the real path rather than the stripper.
	writeFileSync(join(tmp, "crlf.md"), ["---", "name: manager", "tools: read, write", "---", "", "# CRLF body"].join("\r\n"));
	const crlfLoaded = core.readPromptFile(join(tmp, "crlf.md"), "test manager");
	check("a CRLF prompt loads its body", crlfLoaded.includes("CRLF body"), JSON.stringify(crlfLoaded.slice(0, 60)));
	check("a CRLF prompt does not leak its tools: line", !crlfLoaded.includes("tools:"), JSON.stringify(crlfLoaded.slice(0, 80)));
	check("a CRLF prompt does not leak its frontmatter delimiters", !crlfLoaded.startsWith("---"), JSON.stringify(crlfLoaded.slice(0, 40)));
	check("a CRLF prompt is not reported as degraded", core.isDegradedPrompt(crlfLoaded) === false);

	// And the failure the old pattern actually caused: an empty-bodied CRLF file
	// whose frontmatter did not strip. It must be LOUD, not silently empty.
	writeFileSync(join(tmp, "crlf-empty.md"), ["---", "name: x", "---", ""].join("\r\n"));
	check(
		`a CRLF file that is empty once stripped is a failure, not a silent empty prompt`,
		core.isDegradedPrompt(core.readPromptFile(join(tmp, "crlf-empty.md"), "x")),
	);
}

/* -------------------------------------------------------- prompt composition -- */

// A side prompt with real content, and a degraded side, so the header ordering
// and the loud-failure path are both exercised without a pi install.
const sideDir = join(tmp, "pi-fake");
mkdirSync(join(sideDir, "agents"), { recursive: true });
writeFileSync(join(sideDir, "agents", "fake-manager.md"), "---\nname: m\n---\n\n## SIDE BODY MARKER\n");
writeFileSync(join(sideDir, "agents", "exchange.md"), "## EXCHANGE MARKER\n");

/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	const prompt = core.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "unity-blender manager",
		sides: [{ label: "Fake side", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extra: join("agents", "exchange.md"), extensionDir: sideDir }],
	});

	check("connector first", prompt.indexOf("Do the thing.") < prompt.indexOf("# ----"));
	check("side body included", prompt.includes("## SIDE BODY MARKER"));
	check("side extra file included", prompt.includes("## EXCHANGE MARKER"));
	check("header states the connector wins", prompt.includes("wins wherever the two disagree"));
	check("header says not a second manager", prompt.includes("not as a second manager"));
	check("no frontmatter from the side", !prompt.includes("name: m"));

	// Order matters when there are two sides: the last one read must not be
	// able to outrank the connector by being nearer the end of the prompt.
	const two = core.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "c",
		sides: [
			{ label: "One", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
			{ label: "Two", extension: "pi-fake", primary: join("agents", "fake-manager.md"), extensionDir: sideDir },
		],
	});
	check("side order preserved", two.indexOf("# ---- One") < two.indexOf("# ---- Two"));
	check("connector still before both sides", two.indexOf("Do the thing.") < two.indexOf("# ---- One"));

	// A side that cannot load must announce itself in the composed prompt, not
	// vanish: a manager silently missing one half briefs from the other half.
	const broken = core.composeManagerPrompt({
		connectorPath: goodPrompt,
		connectorRole: "c",
		sides: [{ label: "Gone", extension: "pi-fake", primary: join("agents", "absent.md"), extensionDir: sideDir }],
	});
	check("a missing side is visible in the prompt", core.isDegradedPrompt(broken), "the composition hid a failed side");
	check("a missing side keeps the connector", broken.includes("Do the thing."));
}

/* -------------------------------------------------------------- manager gate -- */

/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	const mode = core.createManagerMode({ allowedTools: ["read", "todo", "bash"] });
	const event = (toolName) => ({ toolName, input: {} });
	const manager = "You are the manager.";

	// Before engagement nothing is gated: a plain session that calls a
	// blender_* tool is doing worker-level work and must not be blocked.
	check("ungated before engagement", mode.checkToolCall(event("write"), manager) === null);

	mode.markEngaged();
	check("engaged reads the system prompt", mode.isManagerSession(manager));
	check("allowlisted tool passes", mode.checkToolCall(event("read"), manager) === null);
	check("write is blocked", mod_default_block(mode, event("write"), manager));
	check("edit is blocked", mod_default_block(mode, event("edit"), manager));
	check("an image read is the application's own refusal", mode.checkToolCall(event("read"), manager) === null);

	// The child exception: a subagent inside a manager session is a worker and
	// must be able to write. Only the <active_agent> tag distinguishes them.
	const child = `${manager}\n<active_agent name="blender-worker">`;
	check("a child subagent is not the manager", mode.isManagerSession(child) === false);
	check("a child subagent can write", mode.checkToolCall(event("write"), child) === null);

	// The exit command lifts the gate without ending the session.
	check("exit reports it had something to clear", mode.clearGate() === true);
	check("exit is idempotent", mode.clearGate() === false);
	check("after exit the session is unblocked", mode.checkToolCall(event("write"), manager) === null);

	// A fresh session must inherit nothing, or a /new that follows an engaged
	// session starts with the gate up and the manager prompt never injected.
	const next = core.createManagerMode({ allowedTools: [] });
	next.markEngaged();
	next.reset();
	check("reset clears the gate", next.isManagerSession(manager) === false);

	// A /reload is not a fresh session, and this is the case that shipped as a
	// live bug in all three extensions: pi calls oldRunner.invalidate() and
	// re-emits session_start with reason "reload", which cleared the gate while
	// the manager prompt stayed in context as the cached system prefix. A
	// session that still BEHAVED like the manager had lost the allowlist, the
	// write/edit refusal and the image refusal in one slash command, silently.
	for (const reason of ["reload"]) {
		const reloaded = core.createManagerMode({ allowedTools: [] });
		reloaded.markEngaged();
		reloaded.reset(reason);
		check(`${reason} keeps the gate up`, reloaded.isManagerSession(manager) === true);
		check(
			`${reason} still refuses write`,
			reloaded.checkToolCall(event("write"), manager)?.block === true,
		);
	}
	// Every OTHER reason is a genuinely different session and must still clear.
	for (const reason of ["startup", "new", "resume", "fork", undefined]) {
		const fresh = core.createManagerMode({ allowedTools: [] });
		fresh.markEngaged();
		fresh.reset(reason);
		check(`reset(${reason ?? "no argument"}) clears the gate`, fresh.isManagerSession(manager) === false);
	}

	// markUsed is the split that fixes the live bug: a session that called one
	// application tool has every reason to receive the guidance and none to lose
	// its writes. `isEngaged` is true either way -- that drives the injection --
	// so only the gate tells the two apart, and it must.
	const used = core.createManagerMode({ allowedTools: ["read"] });
	used.markUsed();
	check("markUsed counts as engaged", used.isEngaged() === true);
	check("markUsed leaves write alone", used.checkToolCall(event("write"), manager) === null);
	// And /unity on top of it still gates, because the flag is a union not a
	// latch that a later weaker call could unset.
	used.markEngaged();
	check("markEngaged after markUsed still gates", used.isManagerSession(manager) === true);
	check("markEngaged after markUsed refuses write", mod_default_block(used, event("write"), manager));
}

/** Assert a refusal came back with a reason, since a reasonless block stalls. */
function mod_default_block(mode, event, systemPrompt) {
	const refusal = mode.checkToolCall(event, systemPrompt);
	if (!refusal) {
		check(`${event.toolName} blocked`, false, "the call was allowed");
		return false;
	}
	check("refusal blocks", refusal.block === true);
	check("refusal has a reason", typeof refusal.reason === "string" && refusal.reason.length > 0);
	return true;
}

/* ----------------------------------------------------------------- roster -- */

/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	// `subagent` is on every manager's allowlist, because delegating IS the
	// manager's job. So a roster check placed after the allowlist never fires
	// and still reads as protection. Asserted here for that reason specifically.
	const mode = core.createManagerMode({
		allowedTools: ["read", "subagent", "todo"],
		agentRoster: ["unity-worker", "unity-critic"],
	});
	mode.markEngaged();
	const spawn = (input) => ({ toolName: "subagent", input });

	check("a roster member spawns", mode.checkToolCall(spawn({ agent: "unity-worker" }), "x") === null);
	const off = mode.checkToolCall(spawn({ agent: "some-other-writer" }), "x");
	check("a non-member is refused", off?.block === true);
	check("the refusal names the roster", /unity-worker, unity-critic/.test(off?.reason ?? ""));
	check("the refusal names the way out", /say so in your report/.test(off?.reason ?? ""));

	// Management/control actions carry no `agent`, so refusing them would make
	// the manager unable to ask what its own children are doing.
	check("a management action is not a spawn", mode.checkToolCall(spawn({ action: "status" }), "x") === null);
	// `agent: null` alone is NOT a control action: a schema declaring
	// `agent: string | null` sends it for those too, and treating bare null as
	// "no agent named" would leave the roster bypassable by sending null.
	check("a bare null agent names nothing and cannot be authorised", mode.checkToolCall(spawn({ agent: null }), "x")?.block === true);
	check("an action with a null agent is a control action", mode.checkToolCall(spawn({ action: "list", agent: null }), "x") === null);
	check("whitespace is not an agent name", mode.checkToolCall(spawn({ agent: "  " }), "x") === null);
	check("the roster does not loosen the allowlist", mode.checkToolCall({ toolName: "bash", input: {} }, "x")?.block === true);

	// Everything below is finding F: an `agent` field the core cannot read as a
	// roster name used to take the `target.length === 0` allow-branch, because
	// the target was coerced to "" before it was compared. Each of these is a
	// spawn the roster cannot authorise, so each must be REFUSED. Before, all
	// four were allowed, behind a gate whose stated rule is that only the roster
	// may be spawned.
	const unusable = [
		["agent: undefined", { agent: undefined }],
		["agent: 42", { agent: 42 }],
		["agent: false", { agent: false }],
		["agent: null alone names nothing", { agent: null }],
		["agents: [...] (the plural field, which a mis-shaped spawn sends)", { agents: ["unity-worker"] }],
		['agent: {name:"x"}', { agent: { name: "unity-worker" } }],
		["agent: []", { agent: [] }],
		["an input naming neither agent nor action", { prompt: "do the thing" }],
	];
	for (const [what, input] of unusable) {
		const refusal = mode.checkToolCall(spawn(input), "x");
		check(`${what} is refused`, refusal?.block === true, JSON.stringify(refusal));
		check(
			`the refusal for ${what} names the way out`,
			refusal?.reason?.includes("the manager may only spawn unity-worker, unity-critic") === true &&
				/as a plain string in `agent`/.test(refusal?.reason ?? ""),
			refusal?.reason,
		);
	}
	// And the three that must still be allowed, so the fix above is a tightening
	// of the same rule rather than a new one.
	check("a roster member with surrounding space still spawns", mode.checkToolCall(spawn({ agent: "  unity-worker  " }), "x") === null);
	check("a control action carrying an explicit null agent is allowed", mode.checkToolCall(spawn({ action: "status", agent: null }), "x") === null);

	const open = core.createManagerMode({ allowedTools: ["subagent"] });
	open.markEngaged();
	check("no roster means no roster constraint", open.checkToolCall(spawn({ agent: "anyone" }), "x") === null);
}

// A child subagent is a worker, not the manager, and inherits nothing of the
// roster. Asserted because the roster sits in the manager path only.
/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	const mode = core.createManagerMode({ allowedTools: [], agentRoster: ["unity-worker"] });
	mode.markEngaged();
	const child = `<active_agent name="unity-worker">`;
	check("a child subagent is not the manager", mode.isManagerSession(child) === false);
	check("a child subagent is not roster-checked", mode.checkToolCall({ toolName: "subagent", input: { agent: "other" } }, child) === null);
}

/* ------------------------------------------- application refusals are additive -- */

/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	let called = 0;
	const mode = core.createManagerMode({
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
	check("the application hook is consulted even for an allowlisted tool", called === 1);
	check("an allowlisted call with no refusal is allowed", allowed === null);
	const refused = mode.checkToolCall({ toolName: "subagent", input: {} }, "x");
	check("the application refusal wins", refused?.reason === "roster");
	check("a tool in neither the allowlist nor a refusal is refused by default", mode.checkToolCall({ toolName: "bash", input: {} }, "x")?.block === true);
}

/* ------------------------------------------------------ context injection -- */

/* Collapsed from the same vestigial `for (const [label, mod] of [["core", core]]]` loop; see
 * the note under the first section below.
 */
{
	const event = (systemPrompt, sections) => ({ systemPrompt, systemPromptOptions: { sections } });
	const child = "manager prompt\n<active_agent name=\"blender-worker\">";

	// The constant prompt is a SECTION, the snapshot is a MESSAGE. This is the
	// whole reason the two are not one thing, so it is asserted rather than
	// described.
	const inject = core.createContextInjection({
		section: "blender",
		customType: "blender_context",
		timeoutMs: 1234,
		getPrompt: () => "CONSTANT PROMPT",
		fetchState: async () => ({ line: "selection: Body" }),
		formatState: (state) => `live: ${state.line}`,
	});

	let out = await inject(event("You are the manager.", {}), {});
	check("constant prompt lands in the section", out.message.content === "live: selection: Body", out?.message?.content);
	// The section, not the message. The first call above asserts the MESSAGE;
	// this one asserts the SYSTEM-PROMPT SECTION, which is the property that
	// has to hold for the caching rule and which the discarded `inject(...)` on
	// the old second line never actually checked -- it called inject, threw the
	// result away, and then asserted `true`.
	const parentSectionsForSnapshot = {};
	out = await inject(event("You are the manager.", parentSectionsForSnapshot), {});
	check("the section was written", parentSectionsForSnapshot.blender === "CONSTANT PROMPT", JSON.stringify(parentSectionsForSnapshot));
	check("the snapshot is a message, not a second section", out.message.content === "live: selection: Body");

	// A child gets the constant prompt but never the snapshot: the snapshot
	// describes the PARENT's selection, and a worker's brief already names its
	// objects. Feeding it the parent's deictic framing points the worker at its
	// own empty selection and reads as truth.
	const sections = {};
	const childOut = await inject(event(child, sections), {});
	check("a child gets the section", sections.blender === "CONSTANT PROMPT", JSON.stringify(sections));
	check("a child gets no snapshot", childOut === undefined);

	// An unengaged session gets nothing at all. A tool call is not engagement.
	const idle = core.createContextInjection({
		section: "blender",
		customType: "blender_context",
		shouldInject: () => false,
		getPrompt: () => "CONSTANT PROMPT",
		fetchState: async () => ({ line: "x" }),
		formatState: (state) => `live: ${state.line}`,
	});
	const idleSections = {};
	check("an unengaged session gets nothing", (await idle(event("plain", idleSections), {})) === undefined);
	check("an unengaged session gets no section", idleSections.blender === undefined);

	// A FAILED fetch must inject the loud notice, never an empty message. An
	// empty snapshot is indistinguishable from "nothing to inject" and the
	// manager then mutates whatever it wrongly believes is selected.
	const failing = core.createContextInjection({
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
	check("a failed fetch injects a notice", (failed?.message?.content ?? "").includes("UNAVAILABLE"), failed?.message?.content);
	check("the notice names the timeout", failed.message.content.includes("999 ms"));
	check("the notice refuses stale assumptions", failed.message.content.includes("Do NOT assume"));
	check("the notice names the failure", failed.message.content.includes("bridge did not answer"));
	check("the notice tells the manager what to do", failed.message.content.includes("Call the session-context tool"));
	check("the failure path never formats state", failed.message.content !== "never reached");

	// A fetchState with NO timeout of its own must still be bounded by the
	// core, or `timeoutMs` is only a promise about the failure TEXT. This is the
	// finding: it used to be interpolated into the notice and passed to
	// formatState, and nothing enforced it, so a bare fetch hung the turn and
	// the UNAVAILABLE notice never fired. Latent only because both consumers wrap
	// their own.
	const hanging = core.createContextInjection({
		section: "blender",
		customType: "blender_context",
		timeoutMs: 40,
		getPrompt: () => "P",
		fetchState: () => new Promise(() => {}),
		formatState: () => "never reached",
	});
	const hung = await hanging(event("manager", {}), {});
	check("a fetch that never answers is bounded by the core's timeout", (hung?.message?.content ?? "").includes("UNAVAILABLE"), "the turn hung instead");
	check("the core's timeout is named in the notice", hung.message.content.includes("40 ms"));
	check("the core's timeout explains itself", /did not answer within 40 ms/.test(hung.message.content), hung.message.content);
	check("a timed-out fetch still injects the do-not-assume rule", hung.message.content.includes("Do NOT assume"));

	// The guard must not outlive the fetch it was guarding: a pending timer per
	// turn would hold a session open after every fast success.
	const slowButFinite = core.createContextInjection({
		section: "blender",
		customType: "blender_context",
		timeoutMs: 5000,
		getPrompt: () => "P",
		fetchState: async () => {
			await new Promise((r) => setTimeout(r, 5));
			return { line: "late" };
		},
		formatState: (state) => `live: ${state.line}`,
	});
	check("a fetch that answers inside the timeout is not raced", (await slowButFinite(event("manager", {}), {}))?.message?.content === "live: late");

	// An empty render is "nothing worth injecting", which is different from a
	// failure: no message at all, and not a misleading notice.
	const empty = core.createContextInjection({
		section: "blender",
		customType: "blender_context",
		getPrompt: () => "P",
		fetchState: async () => ({}),
		formatState: () => "   ",
	});
	check("an empty render injects no message", (await empty(event("manager", {}), {})) === undefined);

	// The two-application manager has no snapshot to prefetch: its live state
	// arrives from one tool call that reports both sides. It still needs the
	// section, and the guidance still goes out every turn.
	const staticInject = core.createContextInjection({
		section: "unity_blender",
		customType: "unity_blender_context",
		shouldInject: () => true,
		getPrompt: () => "BINDER PROMPT",
		staticContent: "call unity_blender_status first",
	});
	const staticSections = {};
	const staticOut = await staticInject(event("You are the manager.", staticSections), {});
	check("static content lands in the section", staticSections.unity_blender === "BINDER PROMPT");
	check("static content is injected verbatim", staticOut?.message?.content === "call unity_blender_status first");
	check("static content is displayable", staticOut?.message?.display === true);
	// A child DOES still get the static guidance, unlike the snapshot. The child
	// rule exists because a snapshot is the PARENT's and reads deictically
	// ("your selection"); procedural guidance has no such content to be wrong
	// about, and the hand-rolled handler this replaces sent it to children
	// unconditionally. Suppressing it would be a behaviour change dressed up as
	// a consistency fix.
	const staticChildSections = {};
	const staticChildOut = await staticInject(event(child, staticChildSections), {});
	check("static content reaches a child", staticChildOut?.message?.content === "call unity_blender_status first");
	check("a child still gets the section", staticChildSections.unity_blender === "BINDER PROMPT");

	// Passing both is a caller bug, and a throw beats honouring one of them
	// quietly -- a fetch paid for and discarded is a wasted bridge round trip.
	let threw = false;
	try {
		core.createContextInjection({
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
	check("passing both staticContent and fetchState throws", threw);

	// A manager whose workers already know their side sets
	// sectionReachesChildren: false, so the section stops at the parent. This is
	// the two-application manager's shape, and it is the option that keeps the
	// shared mechanism from quietly changing who sees the prompt.
	const parentOnly = core.createContextInjection({
		section: "unity_blender",
		customType: "unity_blender_context",
		shouldInject: () => true,
		getPrompt: () => "CONNECTOR PROMPT",
		staticContent: "GUIDANCE",
		sectionReachesChildren: false,
	});
	const childSections = {};
	await parentOnly(event(child, childSections), {});
	check("sectionReachesChildren:false withholds the section from a child", childSections.unity_blender === undefined, JSON.stringify(childSections));
	const parentSections = {};
	await parentOnly(event("You are the manager.", parentSections), {});
	check("sectionReachesChildren:false still gives the parent the section", parentSections.unity_blender === "CONNECTOR PROMPT");
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

/* -------------------------------------------------------------- commands -- */

/**
 * A pi stand-in for the two commands: records what was registered, what was
 * sent, and what the user was told.
 *
 * The commands module had NO test at all, which is the finding rather than an
 * aside: this package exists so that three extensions cannot drift on the
 * command's argument handling and delivery decision, and both of those were
 * untested in the place where they are shared.
 */
function makeCommandPi() {
	const commands = new Map();
	const sent = [];
	const notices = [];
	return {
		commands,
		sent,
		notices,
		registerCommand: (name, command) => commands.set(name, command),
		sendUserMessage: (message, options) => sent.push({ message, options }),
	};
}

/** A ctx in one of the two states `deliverAs` depends on, telling `pi` what it said. */
function commandCtx(pi, idle) {
	return { ui: { notify: (message) => pi.notices.push(message) }, isIdle: () => idle };
}

{
	const exitPi = makeCommandPi();
	core.registerExitCommand(exitPi, {
		name: "blender-exit",
		onExit: () => {
			exitPi.notices.push("cleared");
			return true;
		},
	});
	const exit = exitPi.commands.get("blender-exit");
	check("the exit command is registered under its own name", typeof exit?.handler === "function");
	check("the exit command has a description", typeof exit.description === "string" && exit.description.length > 0);
	await exit.handler("", commandCtx(exitPi, true));
	check("a successful exit reports that it left", exitPi.notices.at(-1)?.includes("Left manager mode") === true, exitPi.notices.join(" | "));
	check("a successful exit called the gate's clear exactly once", exitPi.notices.filter((n) => n === "cleared").length === 1);

	// onExit returning false is the "was never engaged" case, and it must NOT be
	// reported as a success: the model reads this notice and acts on it.
	const refusedPi = makeCommandPi();
	core.registerExitCommand(refusedPi, { name: "unity-exit", onExit: () => false });
	await refusedPi.commands.get("unity-exit").handler("", commandCtx(refusedPi, true));
	check("an exit with nothing to clear says so", refusedPi.notices.at(-1)?.includes("Not in manager mode") === true, refusedPi.notices.join(" | "));
	check("an exit with nothing to clear does not claim success", !/Left manager mode/.test(refusedPi.notices.join(" | ")));

	// The default. Previously `onExit ? onExit() : true`, so a command registered
	// with no onExit reported a successful exit on a session that was never
	// engaged -- and every notification is something the model reads and believes.
	const defaultPi = makeCommandPi();
	core.registerExitCommand(defaultPi, { name: "unity-blender-exit" });
	await defaultPi.commands.get("unity-blender-exit").handler("", commandCtx(defaultPi, true));
	check("an exit command with no onExit refuses rather than claiming success", defaultPi.notices.at(-1)?.includes("Not in manager mode") === true, defaultPi.notices.join(" | "));

	// A non-function onExit is the same bug arriving by another route.
	const junkPi = makeCommandPi();
	core.registerExitCommand(junkPi, { name: "junk-exit", onExit: "yes" });
	await junkPi.commands.get("junk-exit").handler("", commandCtx(junkPi, true));
	check("a non-function onExit is treated as no gate, not as success", junkPi.notices.at(-1)?.includes("Not in manager mode") === true, junkPi.notices.join(" | "));

	// Custom messages pass through, so an application can name its own side.
	const customPi = makeCommandPi();
	core.registerExitCommand(customPi, {
		name: "custom-exit",
		notEngagedMessage: "You are not the Blender manager.",
		exitedMessage: "Blender gate lifted.",
		onExit: () => true,
	});
	await customPi.commands.get("custom-exit").handler("", commandCtx(customPi, true));
	check("a custom exit message is used", customPi.notices.at(-1) === "Blender gate lifted.");

	// The engage command. The task is SENT, never executed: a command that ran
	// the build itself would put the manager's first turn outside the gate the
	// manager prompt describes.
	const engagePi = makeCommandPi();
	let engaged = 0;
	core.registerEngageCommand(engagePi, {
		name: "blender",
		usage: "<what to build>",
		onEngage: () => {
			engaged += 1;
		},
	});
	const engage = engagePi.commands.get("blender");
	check("the engage command is registered", typeof engage?.handler === "function");
	await engage.handler("   ", commandCtx(engagePi, true));
	check("a bare engage is a usage notice, not a task", /Usage: \/blender <what to build>/.test(engagePi.notices.at(-1) ?? ""), engagePi.notices.join(" | "));
	check("a bare engage does not engage", engaged === 0);
	check("a bare engage sends nothing", engagePi.sent.length === 0);

	await engage.handler("  make a chair  ", commandCtx(engagePi, true));
	check("the task is trimmed", engagePi.sent.at(-1)?.message === "make a chair");
	check("an idle session gets an ordinary message", engagePi.sent.at(-1)?.options?.deliverAs === undefined);
	check("engaging runs the hook once", engaged === 1);
	check("engaging reports that this session is the manager", /Engaged/.test(engagePi.notices.at(-1) ?? ""));

	// A steer interrupts the current turn. Sending one to an IDLE session can
	// interleave it ahead of work already queued, so the two states must differ.
	await engage.handler("second task", commandCtx(engagePi, false));
	check("a busy session gets a steer", engagePi.sent.at(-1)?.options?.deliverAs === "steer");

	// A fallbackTask makes a bare call meaningful (the binder opens by asking
	// for status), and must not be empty-string-coerced into a dropped message.
	const fallbackPi = makeCommandPi();
	core.registerEngageCommand(fallbackPi, { name: "unity-blender", fallbackTask: "Show me the status of both bridges." });
	await fallbackPi.commands.get("unity-blender").handler("", commandCtx(fallbackPi, true));
	check("a bare engage with a fallbackTask runs the fallback", fallbackPi.sent.at(-1)?.message === "Show me the status of both bridges.");

	// getArgumentCompletions is FORWARDED, never wrapped: pi's hook takes the raw
	// prefix and returns null to mean "no suggestions", so a wrapper turning null
	// into [] would render an empty menu where pi renders none.
	const completionsPi = makeCommandPi();
	const completions = (prefix) => (prefix === "" ? null : ["unity-worker"]);
	core.registerEngageCommand(completionsPi, { name: "completions", getArgumentCompletions: completions });
	check("getArgumentCompletions is the function it was given", completionsPi.commands.get("completions").getArgumentCompletions === completions);
	check("the forwarded hook still returns null for no suggestions", completionsPi.commands.get("completions").getArgumentCompletions("") === null);
	const plainPi = makeCommandPi();
	core.registerEngageCommand(plainPi, { name: "plain" });
	check("no completions hook means the key is absent, not an empty function", !("getArgumentCompletions" in plainPi.commands.get("plain")));
}

/* ------------------------------------------------- install dirs and health -- */

// The three consumer install-dir names, and the extension entry's own health
// check, which reads them out of a pi agent dir.
//
// CONSUMER_EXTENSION_DIRS is asserted against the REAL extensions dir, because
// the one thing no compiler and no diff can catch here is a wrong name: a typo
// makes a perfectly good install read as missing, and makes
// composeManagerPrompt's side lookup degrade both halves of a manager prompt
// while reporting nothing about the lookup itself.
const agentDir = core.getPiAgentDir();
for (const name of extensionEntry.CONSUMER_EXTENSION_DIRS) {
	check(
		`the install name ${name} exists under ${join(agentDir, "extensions")}`,
		existsSync(join(agentDir, "extensions", name)),
		"pi installs the binder as unity-blender while its package is pi-unity-blender; if this fails, that difference has been changed",
	);
}
// And the reverse trap, stated as an assertion so "fixing" it fails here.
check(
	"the binder's install name is unity-blender, not its package name pi-unity-blender",
	extensionEntry.CONSUMER_EXTENSION_DIRS.includes("unity-blender") &&
		!extensionEntry.CONSUMER_EXTENSION_DIRS.includes("pi-unity-blender"),
);

// getCoreHealth must look where pi actually keeps extensions. It used to build
// join(process.env.HOME, ".pi", "agent") itself, which reported a perfectly
// healthy install as missing under PI_AGENT_DIR, and -- with HOME unset --
// resolved the RELATIVE path ".pi/agent" against process.cwd().
const fakeAgentDir = mkdtempSync(join(tmpdir(), "manager-core-agentdir-"));
for (const name of extensionEntry.CONSUMER_EXTENSION_DIRS) {
	mkdirSync(join(fakeAgentDir, "extensions", name), { recursive: true });
}
const savedAgentDir = process.env.PI_AGENT_DIR;
process.env.PI_AGENT_DIR = fakeAgentDir;
try {
	const healthy = extensionEntry.getCoreHealth(core.getPiAgentDir());
	check("a pi agent dir with all three consumers installed is resolved", healthy.resolved === true, healthy.problems.join("; "));
	check("every consumer is reported installed", healthy.consumers.every((c) => c.installed));

	// The unhealthy half is asked with a path, not with the environment: this
	// machine has all three installed, so a check that leaned on the real
	// ~/.pi/agent would pass for the wrong reason.
	const emptyDir = mkdtempSync(join(tmpdir(), "manager-core-empty-"));
	const unhealthy = extensionEntry.getCoreHealth(emptyDir);
	check("a pi agent dir with none of them is NOT resolved", unhealthy.resolved === false);
	check(
		"each missing consumer is named in the problems",
		extensionEntry.CONSUMER_EXTENSION_DIRS.every((n) => unhealthy.problems.some((p) => p.startsWith(n))),
		unhealthy.problems.join("; "),
	);
	// getPiAgentDir is what D fixed: it has to follow PI_AGENT_DIR rather than
	// $HOME, which is the only reason the check above can be given a relocated
	// home at all.
	check("getPiAgentDir follows PI_AGENT_DIR", core.getPiAgentDir() === fakeAgentDir, core.getPiAgentDir());
} finally {
	if (savedAgentDir === undefined) delete process.env.PI_AGENT_DIR;
	else process.env.PI_AGENT_DIR = savedAgentDir;
}

// The warning is driven by the same agent dir, so this is the end-to-end shape:
// a relocated pi home produced a false "the shared behaviour has forked again"
// notification before, and none now.
const notified = [];
const fakePi = {
	on(event, handler) {
		fakePi.startSession = handler;
	},
};
extensionEntry.default(fakePi);
process.env.PI_AGENT_DIR = fakeAgentDir;
try {
	fakePi.startSession({}, { ui: { notify: (m) => notified.push(m) } });
	check("session_start stays silent when the relocated pi home has every consumer", notified.length === 0, notified.join("; "));
	process.env.PI_AGENT_DIR = mkdtempSync(join(tmpdir(), "manager-core-empty-"));
	fakePi.startSession({}, { ui: { notify: (m) => notified.push(m) } });
	check("session_start warns when a consumer really is missing", notified.length === 1, notified.join("; "));
	check("the warning names the missing consumer", /unity-blender is not installed/.test(notified[0] ?? ""), notified[0]);
} finally {
	if (savedAgentDir === undefined) delete process.env.PI_AGENT_DIR;
	else process.env.PI_AGENT_DIR = savedAgentDir;
}

rmSync(tmp, { recursive: true, force: true });

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
	for (const f of failures) console.error(`FAIL ${f}`);
	process.exit(1);
}
