/**
 * pi extension: manager-core, the shared core of the manager-mode extensions.
 *
 * This extension registers NO tools and NO commands, and it is hidden. It exists
 * so the other extensions have a single installed directory to resolve the
 * shared core from, and so there is exactly one place where that core's
 * location, version and presence are checked.
 *
 * Why a shared core at all. Three extensions — pi-vibe-blender, pi-vibe-unity
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

import { composeManagerPrompt, createManagerMode, isDegradedPrompt, readPromptFile } from "./shared/core.js";

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

const CONSUMERS = ["vibe-blender", "vibe-unity", "unity-blender"];

/** Report whether the core is usable and who is using it. Read-only. */
export function getCoreHealth(piAgentDir: string): CoreHealth {
	const path = getCoreModulePath();
	const problems: string[] = [];
	if (!existsSync(path)) problems.push(`the core module is missing at ${path}`);

	const consumers = CONSUMERS.map((name) => {
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
		const health = getCoreHealth(join(process.env.HOME ?? "", ".pi", "agent"));
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
