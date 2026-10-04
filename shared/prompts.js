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
 * Read a prompt file, or return a sentence naming the failure.
 *
 * Loud degradation is the contract, because every silent alternative is worse.
 * A manager whose prompt failed to load still spawns workers, still briefs
 * them, and briefs them from generic guidance — the user learns about the
 * missing prompt by paying for iterations, not by being told.
 */
export function readPromptFile(path, role) {
	try {
		const body = stripFrontmatter(readFileSync(path, "utf8"));
		if (!body) throw new Error("the file is empty after its frontmatter was stripped");
		return body;
	} catch (error) {
		return (
			`The ${role} prompt could not be read from ${path}, so this session is missing that half of ` +
			`its instructions (${error instanceof Error ? error.message : String(error)}). ` +
			"Say so plainly when the task touches that side; do not fall back to guessing at its " +
			"loops, its agents, or its acceptance rules."
		);
	}
}

/** True when `readPromptFile` degraded, so a caller can log it once. */
export function isDegradedPrompt(text) {
	return typeof text === "string" && text.includes("could not be read from");
}

/**
 * Compose one manager prompt out of a connector prompt and any number of side
 * prompts, each under a provenance header.
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
export function composeManagerPrompt({ connectorPath, connectorRole, sides = [] }) {
	const parts = [readPromptFile(connectorPath, connectorRole)];
	for (const side of sides) {
		const dir = side.extensionDir ?? getInstalledExtensionDir(side.extension);
		const sections = [readPromptFile(join(dir, side.primary), `${side.label} manager`)];
		if (side.extra) sections.push(readPromptFile(join(dir, side.extra), `${side.label} exchange contract`));
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
	return parts.join("\n\n");
}
