/**
 * Do the prompts and the READMEs describe tools that exist?
 *
 * This exists because of a real defect it now guards in all three extensions,
 * not one. `unity_capture_view` was implemented, handled by the C# dispatch,
 * listed in the README, and named in the manager prompt -- and was never passed
 * to `pi.registerTool`. Nothing failed: tsc was clean, the tests were green, and
 * every document was correct about a tool that did not exist. The agent was
 * being told, authoritatively, to call a tool it could not reach.
 *
 * A count cannot catch that. The total was right by coincidence. The SETS have
 * to be compared, in both directions, and a number cannot do it:
 *
 *   - named but not registered: advice the agent cannot follow
 *   - registered but not named: a tool nobody knows to reach for
 *
 * The one thing this does NOT check is that a tool is worth having. It cannot:
 * a tool can be registered, documented and correct and still be the wrong
 * thing to have built. This only keeps prose and reality in step.
 *
 * The installed AGENT templates are not scanned here -- that is
 * `agent-template-checks.mjs`, which the three installers run over the very
 * text they write. It answers a different question (does a template's `tools:`
 * list admit what the template names) and this one is about what exists at all.
 *
 *   node test/doc-consistency.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { advisedToolNames, declaredTools } from "../shared/agent-template-checks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PROJECTS = resolve(REPO, "..");

import { createJiti } from "./jiti.mjs";
const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });

/** Which names are pi tools, and so must resolve to something registered. */
const TOOL_NAME = /^(?:blender|unity|unity_blender|vrchat)[a-z_]*_[a-z_]+$/;

/**
 * Tools that come from pi itself or from a package, not from an extension.
 *
 * The "every tool it declares is registered" check below is about the
 * extension's own inventory, and pi core's read/write/edit/grep/find/ls/bash
 * and the subagent suite's subagent/contact_supervisor are not in it -- they
 * are ambient, exactly as pi-vibe-unity's own template test already records in
 * its AMBIENT_TOOLS. The three provenances are listed separately on purpose:
 * pi core, an npm `packages:` entry, and the extension, and only the last is
 * something this file can see. Checking that a template does not name a tool
 * from the other two would be asserting that pi stopped shipping read().
 */
const AMBIENT_TOOLS = new Set([
	"subagent",
	"subagents_enable",
	"bg_wait",
	"subagent_supervisor",
	"contact_supervisor",
	"read",
	"write",
	"edit",
	"grep",
	"find",
	"ls",
	"bash",
]);

/**
 * Each extension, the prompt that is its manager's whole instruction set, and
 * how its README names tools.
 *
 * `managerPrompt` is the file, not its frontmatter: the manager prompt is
 * stripped and injected whole, so a tool named anywhere in the body reaches the
 * session.
 *
 * `readmeTools` differs per extension because there is no house style to copy:
 * pi-unity documents one tool per table row, pi-blender has a single prose
 * bullet listing all thirteen, and pi-unity-blender has no inventory at all, so
 * its scan runs over every backticked name. `readmeSkip` drops sections that
 * mention tools in passing (a worked example is prose about a flow, and its
 * names are the ones most likely to be abbreviated or partial).
 */
/**
 * The worker/critic templates, and what each one's frontmatter must resolve to.
 *
 * `managerPrompt` is a single file, but these are per-agent and each is a
 * complete instruction set for a child that has NO other source of truth: a
 * worker told to call a tool it cannot reach has no manager to notice, because
 * the manager is not in that context. The manager prompt gets a check because
 * it is the one prompt everybody reads; these get one for the opposite reason —
 * a mistake here is invisible from the outside, because the failing child
 * reports it as a tool error and the parent reads a report saying the work was
 * blocked.
 *
 * Every template is included, not just the ones that "matter". A template that
 * is never spawned is a template that will be spawned one day, and its tool list
 * is whatever it was the last time anybody edited it.
 */
const EXTENSIONS = [
	{
		repo: "pi-blender",
		managerPrompt: "blender/agents/blender-manager.md",
		// Everything except the manager, which is stripped and injected rather
		// than spawned, and exchange.md, which is not an agent at all.
		childPrompts: [
			"blender/agents/blender-camera-aligner.md",
			"blender/agents/blender-critic.md",
			"blender/agents/blender-diagnostician.md",
			"blender/agents/blender-finalizer.md",
			"blender/agents/blender-merger.md",
			"blender/agents/blender-reference-describer.md",
			"blender/agents/blender-script-runner.md",
			"blender/agents/blender-worker.md",
		],
		readmeTools: /`(blender_[a-z_]+)`/g,
		readmeSkip: ["A session in the wild"],
	},
	{
		repo: "pi-unity",
		managerPrompt: "unity/agents/unity-manager.md",
		childPrompts: [
			"unity/agents/unity-critic.md",
			"unity/agents/unity-diagnostician.md",
			"unity/agents/unity-finalizer.md",
			"unity/agents/unity-reference-describer.md",
			"unity/agents/unity-worker.md",
			"unity/agents/vrchat-unity-avatar.md",
			"unity/agents/vrchat-unity-world.md",
		],
		readmeTools: /^\| `((?:unity|vrchat)[a-z_]*)`/gm,
		readmeSkip: [],
	},
	{
		repo: "pi-unity-blender",
		// The binder's prompt is composed of its own connector plus the two side
		// manager prompts, so the connector is what this scans; the side prompts
		// live in the other two repos and are scanned there.
		managerPrompt: "agents/unity-blender-manager.md",
		childPrompts: ["agents/unity-blender-reference-describer.md"],
		readmeTools: /`((?:unity_blender|unity|blender|vrchat)[a-z_]*)`/g,
		readmeSkip: [],
		/**
		 * The binder registers only the `unity_blender_*` tools. Every other tool
		 * its prompt names belongs to one of the two SIDE extensions, which are
		 * separate extensions that have to be installed for the binder to work at
		 * all -- getManagerPrompt() reads their manager prompts from their
		 * install directories, so if they are missing the prompt is not merely
		 * wrong, it is degraded.
		 *
		 * So a name the binder does not register itself is resolved against the
		 * sides too. That is a fact about the DESIGN, not a loosening to get
		 * this green: the alternative is exempting the binder from the check
		 * entirely, and the check is the reason the `unity_capture_view` defect
		 * was ever caught.
		 */
		alsoProvidedBy: ["pi-blender", "pi-unity"],
	},
];

let passed = 0;
const failures = [];
const skipped = [];

function check(label, ok, detail = "") {
	if (ok) {
		passed += 1;
		return;
	}
	failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Load an extension and ask it to register into a throwaway pi.
 *
 * `isolated: true` because these three share a jiti instance otherwise, and a
 * cached module would report the FIRST extension's registrations for all three.
 */
async function registeredTools(repo) {
	const tools = new Set();
	const pi = {
		registerTool: (tool) => tools.add(typeof tool === "string" ? tool : tool.name),
		registerCommand: () => {},
		on: () => {},
		sendUserMessage: () => {},
	};
	const mod = await jiti.import(join(PROJECTS, repo, "index.ts"));
	await mod.default(pi);
	return tools;
}

/** Drop a README section by its heading, up to the next heading. */
function withoutSections(markdown, titles) {
	let out = markdown;
	for (const title of titles) {
		const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp(`^#+ ${escaped}\\b[\\s\\S]*?(?=\\n#+ |$)`, "gm"), "");
	}
	return out;
}

for (const {
	repo,
	managerPrompt,
	childPrompts = [],
	readmeTools,
	readmeSkip,
	alsoProvidedBy = [],
} of EXTENSIONS) {
	const dir = join(PROJECTS, repo);
	if (!existsSync(dir)) {
		skipped.push(`${repo} (not checked out)`);
		continue;
	}

	let registered;
	try {
		registered = await registeredTools(repo);
	} catch (error) {
		check(`${repo}: index.ts loads and registers`, false, error instanceof Error ? error.message : String(error));
		continue;
	}
	check(`${repo}: registers some tools`, registered.size > 0, `${registered.size} tools`);
	if (registered.size === 0) continue;

	// The names a neighbour provides, for the prompt and README scans. Read from
	// the neighbour's own registration rather than a hardcoded list, so a tool
	// renamed there is not silently unresolvable here.
	let alsoRegistered = new Set();
	for (const neighbour of alsoProvidedBy) {
		try {
			for (const name of await registeredTools(neighbour)) alsoRegistered.add(name);
		} catch (error) {
			check(`${repo}: ${neighbour} loads to resolve its tools`, false, String(error));
		}
	}
	const resolvable = new Set([...registered, ...alsoRegistered]);

	// --- the manager prompt vs what is actually registered ---------------
	const promptPath = join(dir, managerPrompt);
	check(`${repo}: ${managerPrompt} exists`, existsSync(promptPath), promptPath);
	if (!existsSync(promptPath)) continue;

	const promptSource = readFileSync(promptPath, "utf8");
	// The BODY, not the file: the frontmatter is stripped before injection, and
	// its `tools:` line is a legitimately unbackticked inventory.
	const body = promptSource.replace(/^---[\s\S]*?\n---\n/, "");
	const advised = advisedToolNames(promptSource).filter((name) => TOOL_NAME.test(name));
	// A tool named in the body but NOT in backticks is invisible to
	// `advisedToolNames`, so nothing below checks it. That is a known gap of the
	// scanner (a looser rule produces more noise than signal) and asserting it
	// is empty at least makes a new unbackticked name visible instead of silent.
	const unbackticked = [...body.matchAll(/(?<![\w`])(blender_[a-z_]+|unity_blender_[a-z_]+)/g)]
		.map((m) => m[1])
		.filter((name) => !advised.includes(name));

	const missingFromPrompt = advised.filter((name) => !resolvable.has(name));
	check(
		`${repo}: every tool the manager prompt names is registered`,
		missingFromPrompt.length === 0,
		`the prompt advises calling: ${missingFromPrompt.join(", ")}`,
	);
	check(`${repo}: the manager prompt names some tools`, advised.length > 0, `${advised.length} names`);
	check(
		`${repo}: the manager prompt names no tool outside backticks`,
		unbackticked.length === 0,
		`unscanned, so unchecked: ${[...new Set(unbackticked)].join(", ")}`,
	);

	// --- the spawned agent templates vs what is actually registered ------
	// A different question from the manager prompt's, and a stricter one in one
	// respect. A spawned agent's tool access comes from its own `tools:`
	// frontmatter, so a name in the body that is missing from that list is
	// unreachable even though the tool exists -- and the installed-template check
	// in agent-template-checks.mjs compares the body against the frontmatter
	// without ever asking whether the frontmatter itself is real.
	for (const childPrompt of childPrompts) {
		const childPath = join(dir, childPrompt);
		if (!existsSync(childPath)) {
			check(`${repo}: ${childPrompt} exists`, false, childPath);
			continue;
		}
		const source = readFileSync(childPath, "utf8");
		const label = `${repo}: ${childPrompt}`;

		const declared = [...declaredTools(source)];
		const named = advisedToolNames(source).filter((name) => TOOL_NAME.test(name));

		check(`${label} declares some tools`, declared.length > 0, `${declared.length} declared`);
		// Only the extension's OWN tools. read/write/grep are pi's, subagent and
		// contact_supervisor are the subagent package's, and neither is
		// registered by an index.ts.
		const ownDeclared = declared.filter((name) => !AMBIENT_TOOLS.has(name));
		check(
			`${label}: every tool it declares is registered`,
			ownDeclared.filter((name) => !resolvable.has(name)).length === 0,
			`declared but never registered: ${ownDeclared.filter((name) => !resolvable.has(name)).join(", ")}`,
		);
		check(
			`${label}: every tool it names is registered`,
			named.filter((name) => !resolvable.has(name)).length === 0,
			`advises calling: ${named.filter((name) => !resolvable.has(name)).join(", ")}`,
		);
		// The direction that actually breaks a child at runtime: pi hands the
		// agent its `tools:` list, so a body name outside it is a tool this agent
		// cannot reach however real the tool is. agent-template-checks.mjs asserts
		// this same invariant for the INSTALLED text; asserting it here as well
		// means a source that drifts is caught in the repo that owns it, before
		// anyone installs anything.
		const unreachable = named.filter((name) => !declared.includes(name));
		check(
			`${label}: every tool it names is in its own tools:`,
			unreachable.length === 0,
			`named in the body, absent from frontmatter: ${unreachable.join(", ")}`,
		);
	}
	const readmePath = join(dir, "README.md");
	check(`${repo}: README.md exists`, existsSync(readmePath), readmePath);
	if (!existsSync(readmePath)) continue;

	const readme = withoutSections(readFileSync(readmePath, "utf8"), readmeSkip);
	const documented = new Set([...readme.matchAll(readmeTools)].map((m) => m[1]));
	const documentedNotRegistered = [...documented].filter((name) => !resolvable.has(name));
	check(
		`${repo}: every tool the README names is registered`,
		documentedNotRegistered.length === 0,
		`documented but never registered: ${documentedNotRegistered.join(", ")}`,
	);
	check(`${repo}: the README actually names tools`, documented.size > 0, `${documented.size} names`);

	// The other direction, which the original pi-unity test also asserted: a
	// registered tool nobody has heard of. Only meaningful for the tools an
	// extension registers ITSELF, so the side extensions' tools are excluded for
	// the binder -- its README is not the place to document another extension's
	// tool, and the sides document their own.
	const ownRegistered = [...registered].filter((name) => !alsoRegistered.has(name));
	const documentedOwn = new Set([...documented].filter((name) => registered.has(name)));
	const undocumentedOwn = ownRegistered.filter((name) => !documentedOwn.has(name));
	check(
		`${repo}: every tool it registers is documented`,
		undocumentedOwn.length === 0,
		`registered but absent from the README: ${undocumentedOwn.join(", ")}`,
	);

	if (missingFromPrompt.length === 0 && documentedNotRegistered.length === 0) {
		const own = advised.filter((name) => registered.has(name)).length;
		const fromSides = advised.length - own;
		console.log(`  ${repo}: ${own} tools named, all registered here` + (fromSides ? `, ${fromSides} from the side extensions` : ""));
	}
}

for (const s of skipped) console.log(`skipped ${s}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
for (const f of failures) console.error(`FAIL ${f}`);
if (failures.length > 0) process.exitCode = 1;
