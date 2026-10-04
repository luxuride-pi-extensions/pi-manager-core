/**
 * pi extension: manager-core, the shared core of the manager-mode extensions.
 *
 * This extension registers NO tools and NO commands, and it is hidden. It exists
 * so the other extensions have a single installed directory to resolve the
 * shared core from, and so there is exactly one place where that core's
 * location, version and presence are checked.
 *
 * Why a shared core at all. Three extensions — pi-blender, pi-unity
 * and pi-unity-blender — each grew the same machinery independently: an engage
 * slash command that turns the session into a manager, an exit command that
 * lifts a write/edit/image gate, a child-session detector, a manager-prompt
 * composer, and an installer that stamps agent templates. Each is a small
 * amount of code, but each was written three times, and the third copy was
 * written by reading the first two — so every fix to the gate's refusal message
 * or the command's argument handling had to be made three times, and nothing
 * noticed when one of them was missed.
 *
 * What is shared here is deliberately the part that is the SAME. Nothing in this
 * file knows about Blender, Unity, geometry, bridge locks, or agents. The
 * application-specific policy — which tools a manager may use, what to say when
 * it reaches for a write, which image extensions count as an image — stays in
 * the application that owns it, because a core that encoded every application's
 * policy would carry all of them and answer to none.
 *
 * Resolution and drift: each consuming extension keeps a ~30 line
 * `manager-core.ts` that finds this directory and re-exports it, because a bare
 * `import` of a sibling extension's file cannot be written without a build step
 * or a package link. Those three copies are byte-identical by construction and
 * verified as such — `node test/resolver-copies.mjs` in this repo diffs them
 * against the canonical copy here and `--fix` rewrites them. That is the
 * anti-drift mechanism, and it is a test rather than a convention precisely
 * because a convention is what already failed three times.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { composeManagerPrompt, createManagerMode, getPiAgentDir, isDegradedPrompt, readPromptFile } from "./shared/core.js";

const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/** The directory name pi installs this extension under. */
export const APP_NAME = "manager-core";

/**
 * The shared core's own version.
 *
 * Consumers print this next to a resolution failure, so a report of "the shared
 * core is missing" can say which core was wanted. It is a hand-maintained
 * integer because the alternative — reading package.json — requires the
 * extension to be an installed copy rather than a checkout, which is exactly
 * the case where a failure is least welcome.
 */
export const CORE_VERSION = 1;

export function getCoreModulePath(): string {
	return join(EXTENSION_DIR, "shared", "core.js");
}

export interface CoreHealth {
	resolved: boolean;
	version: number;
	path: string;
	/** Which consumer extensions were found installed alongside this one. */
	consumers: { name: string; installed: boolean }[];
	problems: string[];
}

/**
 * The directory names pi installs the three consumers under, in the order they
 * are reported.
 *
 * READ THIS BEFORE "FIXING" unity-blender to pi-unity-blender.
 *
 * The binder's package.json says `"name": "pi-unity-blender"`, and pi installs
 * it as `unity-blender`. Both names are real and they are not the same string,
 * because the install name comes from the directory pi is given rather than
 * from the package's own `name`. Confirmed on disk: `<agent-dir>/extensions`
 * holds `pi-blender`, `pi-unity` and `unity-blender`. So the two names here are
 * deliberate and "correcting" the third to match its package name breaks the
 * install check AND composeManagerPrompt's side lookup in the same stroke --
 * which is why they are declared once, exported, and asserted against the real
 * extensions dir in test/core.test.mjs rather than left as literals twice.
 *
 * The SAME two names are needed by `shared/prompts.js`
 * `composeManagerPrompt({sides})`, where `side.extension` is this install name.
 * A consumer passes them explicitly there today, because importing this
 * extension's entry point from the shared core would invert the dependency:
 * the core is resolved BY consumers, so it cannot require one back. That is the
 * one place the list is still written twice, and the test above is what keeps
 * the two copies from drifting.
 */
export const CONSUMER_EXTENSION_DIRS: readonly string[] = ["pi-blender", "pi-unity", "unity-blender"];

/** Report whether the core is usable and who is using it. Read-only. */
export function getCoreHealth(piAgentDir: string): CoreHealth {
	const path = getCoreModulePath();
	const problems: string[] = [];
	if (!existsSync(path)) problems.push(`the core module is missing at ${path}`);

	const consumers = CONSUMER_EXTENSION_DIRS.map((name) => {
		const installed = existsSync(join(piAgentDir, "extensions", name));
		if (!installed) problems.push(`${name} is not installed, so nothing consumes this core`);
		return { name, installed };
	});

	return { resolved: problems.length === 0, version: CORE_VERSION, path, consumers, problems };
}

export default function managerCore(pi: {
	on(event: string, handler: (event: unknown, ctx: { ui?: { notify?(message: string, level?: string): void } }) => void): void;
}): void {
	pi.on("session_start", (_event, ctx) => {
		// getPiAgentDir(), not a hardcoded join(HOME, ".pi", "agent"). Two bugs,
		// both of which produced a FALSE "the shared behaviour has forked again":
		//
		//  1. It ignored PI_AGENT_DIR, which is exactly the non-default pi home
		//     this core already has a function to absorb (shared/paths.js) and
		//     which this repo's own harnesses set. A sandboxed or relocated pi
		//     home looks like a missing install, and the warning tells the user
		//     their core has drifted when nothing has.
		//  2. With HOME unset, join("", ".pi", "agent") is the RELATIVE path
		//     ".pi/agent", which existsSync resolves against process.cwd() --
		//     so the check read an unrelated directory of whatever the session
		//     happened to be started in.
		//
		// The names themselves are also not literals here: see CONSUMERS.
		const health = getCoreHealth(getPiAgentDir());
		if (health.resolved) return;
		// One notification, naming the problem, rather than three consumers each
		// failing to import and each reporting it.
		ctx.ui?.notify?.(
			`manager-core: ${health.problems.join("; ")}. The manager extensions fall back to their own ` +
				"built-in copies, so they still work — but the shared behaviour has forked again, which is the " +
				"drift this extension exists to prevent.",
			"warn",
		);
	});
}

// Re-exported so a consumer that has resolved this directory can import the
// whole core from one specifier.
export { composeManagerPrompt, createManagerMode, isDegradedPrompt, readPromptFile };
