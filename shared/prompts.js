/**
 * Manager prompts: reading them, degrading loudly, and composing one out of a
 * connector plus any number of sides.
 *
 * The concern here is that a manager prompt is the one piece of text whose
 * absence changes behaviour without looking broken. A manager whose prompt
 * failed to load still spawns workers and still briefs them — it just briefs
 * them from generic guidance, and the user pays for that in iterations rather
 * than in an error message. So every read here is loud, and every composition
 * says which extension each half came from.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getInstalledExtensionDir } from "./paths.js";
import { clampText, fenceUntrusted } from "./untrusted.js";

/**
 * Strip an agent template's frontmatter.
 *
 * `tools:` and `extensions:` are a SPAWNABLE child's contract. A manager
 * command session is not a child: it gets its tools from the extensions already
 * running in it, so a stray `tools:` line in a system prompt is inert at best
 * and actively misleading at worst — it advertises a capability the session
 * does not have and names a file the user cannot see.
 *
 * CRLF is accepted because a file edited on Windows, or checked out with
 * core.autocrlf, ends its closing delimiter `---\r\n` — and the old pattern's
 * `\n---` did not match that. The consequence was not a cosmetic miss: the
 * WHOLE file passed through, frontmatter included, so readPromptFile saw
 * non-empty content, judged the read a success, and did NOT degrade. The
 * system prompt then began with `---`, `tools: read, write`, and a line naming
 * a file the user cannot see — the precise failure this function exists to
 * prevent, reached by checking out the repository on the wrong platform.
 */
export function stripFrontmatter(source) {
	return String(source ?? "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
}

/**
 * The outcome of ONE prompt read, filled in by {@link readPromptFile}.
 *
 * A plain object; the shape is this typedef because shared/*.js is
 * hand-written JavaScript with a hand-written .d.ts beside it (shared/core.js
 * header), not TypeScript. Typed here AND in shared/prompts.d.ts.
 *
 * Passed BY THE CALLER, and the return type of `readPromptFile` stays `string`.
 * That is the constraint, and it is the consumer's: pi-blender's and pi-unity's
 * `getManagerPrompt(): string` interpolate the result straight into a string
 * return, so changing `readPromptFile` to return an object would inject one
 * where a string is declared -- a live runtime break in a repository released
 * independently of this one.
 *
 * So attribution is opt-in through an out-param. The caller that needs to know
 * WHICH half degraded passes an object and gets it filled in; a caller that does
 * not care pays nothing. KNOWN LIMIT, and the honest statement of what this
 * choice costs: a caller who ignores the out-param still cannot attribute
 * anything, and `isDegradedPrompt` on a composed string remains best-effort.
 * That is the compatibility trade, not an oversight.
 *
 * @typedef {object} PromptReadReport
 * @property {boolean} degraded False when the file read, true when it did not.
 * @property {string} path The path that was read, or would have been. Set on
 *   EVERY call, on both the success and the failure path.
 * @property {string} [role] The role that was passed, so a report says which
 *   prompt this entry is.
 */

/**
 * How a composition's halves turned out.
 *
 * @typedef {object} ManagerPromptReport
 * @property {boolean} degraded True when ANY half failed to read.
 * @property {PromptReadReport[]} halves One entry per file that was read, in
 *   composition order, so a caller can name WHICH connector or side degraded
 *   rather than only that something did.
 */

/**
 * Read a prompt file, or return a sentence naming the failure.
 *
 * Loud degradation is the contract, because every silent alternative is worse.
 * A manager whose prompt failed to load still spawns workers, still briefs
 * them, and briefs them from generic guidance — the user learns about the
 * missing prompt by paying for iterations, not by being told.
 *
 * This string is not only a log line: `composeManagerPrompt` pastes it into the
 * manager's SYSTEM PROMPT. So both interpolated values are treated as untrusted
 * and bounded. The PATH is the application's own and is clamped only for length;
 * the ERROR MESSAGE can be anything the filesystem layer produced, including a
 * filename an attacker chose, and it is fenced as data. The notice as a whole is
 * bounded too — see DEGRADATION_BUDGET — because a diagnostic that does not fit
 * is still a diagnostic, and a 40 KB ENOENT is not.
 *
 * `report` is filled in on BOTH paths, deliberately. A report whose entries
 * exist only on failure cannot tell "read it, it was fine" from "never looked",
 * and that is the same silent-skip shape as a gate that reports green having
 * checked nothing.
 */
export function readPromptFile(path, role, report) {
	const outcome = { degraded: false, path, role };
	if (report && typeof report === "object") Object.assign(report, outcome);
	try {
		const body = stripFrontmatter(readFileSync(path, "utf8"));
		if (!body) throw new Error("the file is empty after its frontmatter was stripped");
		return body;
	} catch (error) {
		if (report && typeof report === "object") report.degraded = true;
		const cause = error instanceof Error ? error.message : String(error);
		return clampText(
			`The ${role} prompt could not be read from ${clampText(String(path), PATH_BUDGET)}, so this ` +
				`session is missing that half of its instructions. It reported:\n\n${fenceUntrusted(cause)}.\n` +
				"Say so plainly when the task touches that side; do not fall back to guessing at its " +
				"loops, its agents, or its acceptance rules.",
			DEGRADATION_BUDGET,
		);
	}
}

/**
 * How long a degradation notice may be, in total.
 *
 * 1.2 KB. It has to carry a role, a path, an error and the recovery instruction,
 * which is roughly what the above produces for a real failure; the budget leaves
 * room for a long path and a multi-line error without leaving room for a payload.
 *
 * Module-local on purpose: it is not part of the core's public surface, and
 * adding an export here would mean declaring it in manager-core.ts and recopying
 * three consumers to say what this file already says.
 */
const DEGRADATION_BUDGET = 1_200;

/**
 * The phrase every degradation notice contains.
 *
 * Named, because `isDegradedPrompt` matches on it and a rename of the wording
 * above would otherwise silently turn the string form into "never degraded". A
 * marker that is part of the notice is also part of the contract.
 */
const DEGRADATION_MARKER = "prompt could not be read from";

/** How much of the path is kept. A path is the application's own, not the bridge's. */
const PATH_BUDGET = 300;

/**
 * True when a prompt read degraded.
 *
 * A THIN COMPATIBILITY WRAPPER over two shapes, and neither is exact for a
 * COMPOSED string:
 *
 *   - a `PromptReadReport` (or the structured form callers may hold): the flag is
 *     read, which is exact;
 *   - a plain string, which is the composed-prompt case and can only be a
 *     substring test. A healthy prompt that happens to contain the phrase is a
 *     false positive, and from a concatenation there is no way to know WHICH
 *     half degraded.
 *
 * A caller that needs the attribution must keep the report it passed to
 * `readPromptFile` — or to `composeManagerPrompt`, which fills one per half —
 * and read `degraded` from it. That is what the composition path below does.
 */
export function isDegradedPrompt(text) {
	if (typeof text === "object" && text !== null) return text.degraded === true;
	return typeof text === "string" && text.includes(DEGRADATION_MARKER);
}

/**
 * Compose one manager prompt out of a connector prompt and any number of side
 * prompts, each under a provenance header.
 *
 * `report` is filled on every read, so a caller gets WHICH half degraded rather
 * than only that the composed string contains a phrase. It is optional, and a
 * caller that passes nothing is unaffected.
 *
 * The header is load-bearing, not decoration. Every side prompt opens by
 * declaring the reader to be that side's MANAGER and then defines its own loop,
 * agent roster and nesting rules. Appended verbatim into a third manager, that
 * reads as several competing managers, and which one wins depends on which
 * section the model attends to last. Each header therefore states three things:
 * this is the SIDE's procedure rather than a second manager, this session is
 * the manager of all of them, and the connector above wins wherever the two
 * disagree — because it is the only part written knowing about the other sides
 * exist.
 *
 * Sections are included WHOLE rather than summarized. A constant system-prompt
 * section is the cached prefix, so its size is billed roughly once per session
 * and near-free on every turn after, while a lossy paraphrase of a side's loop
 * is exactly the stale procedure the header above warns against.
 *
 * Sides are read from the INSTALLED extension at runtime, never copied in. A
 * copy in the composing extension goes stale silently and looks authoritative
 * while doing it, which is the one failure a shared core exists to prevent.
 */
export function composeManagerPrompt({ connectorPath, connectorRole, sides = [] }, report) {
	/** Record one read's outcome, when the caller asked for attribution. */
	const note = (path, role) => {
		if (!report || typeof report !== "object") return null;
		if (!Array.isArray(report.halves)) {
			report.halves = [];
			report.degraded = false;
		}
		const entry = { degraded: false, path, role };
		report.halves.push(entry);
		return entry;
	};

	const connectorReport = note(connectorPath, connectorRole);
	const parts = [readPromptFile(connectorPath, connectorRole, connectorReport ?? undefined)];
	for (const side of sides) {
		const dir = side.extensionDir ?? getInstalledExtensionDir(side.extension);
		const primaryPath = join(dir, side.primary);
		const primaryReport = note(primaryPath, `${side.label} manager`);
		const sections = [readPromptFile(primaryPath, `${side.label} manager`, primaryReport ?? undefined)];
		if (side.extra) {
			const extraPath = join(dir, side.extra);
			sections.push(
				readPromptFile(extraPath, `${side.label} exchange contract`, note(extraPath, `${side.label} exchange contract`) ?? undefined),
			);
		}
		parts.push(
			[
				`# ---- ${side.label} manager prompt (from the ${side.extension} extension) ----`,
				"",
				"Everything below this line is the procedure that side's own manager uses, read from the",
				`installed ${side.extension} extension at runtime so it cannot drift from it. Read it as that`,
				"SIDE's procedure, not as a second manager: this session is the manager of every side,",
				"and the connector prompt above — which is the only part written knowing about the",
				"other applications — wins wherever the two disagree. The side prompt names agents you",
				"may spawn, tools you may call, and the acceptance rules for work on that side; all of",
				"those apply here unchanged.",
				"",
				sections.join("\n\n"),
			].join("\n"),
		);
	}
	if (report && typeof report === "object") report.degraded = (report.halves ?? []).some((half) => half.degraded);
	return parts.join("\n\n");
}
