/**
 * Types for shared/prompts.js — reading, degrading and composing prompts.
 */

/** Strip an agent template's frontmatter. */
export function stripFrontmatter(source: unknown): string;

/**
 * The outcome of ONE prompt read, filled in by `readPromptFile` when the caller
 * passes it. See the typedef on the function itself.
 */
export interface PromptReadReport {
	/** False when the file read, true when it could not be read or was empty. */
	degraded: boolean;
	/** The path that was read, or would have been. Set on BOTH paths. */
	path: string;
	/** The role that was passed, so a report says which prompt this entry is. */
	role?: string;
}

/** How a composition's halves turned out. */
export interface ManagerPromptReport {
	degraded: boolean;
	/** One entry per file read, in composition order. */
	halves: PromptReadReport[];
}

/**
 * Read a prompt file, or return a sentence naming the failure.
 *
 * `report` is optional and filled on BOTH the success and the failure path, so a
 * caller can tell "read it, it was fine" from "never looked". The return type is
 * unchanged: it is a string, because two consumers interpolate it into a
 * `getManagerPrompt(): string`.
 */
export function readPromptFile(path: string, role: string, report?: PromptReadReport): string;

/**
 * True when a prompt read degraded.
 *
 * Exact for a `PromptReadReport`; a best-effort substring test for a composed
 * string, which is the compatibility path for callers that do not keep a report.
 */
export function isDegradedPrompt(text: unknown): boolean;

export interface ManagerPromptSide {
	/** How the side is named to the reader, e.g. "Blender side". */
	label: string;
	/** The directory name pi installs this side's extension under. */
	extension: string;
	/** Manager prompt, relative to the extension dir. */
	primary: string;
	/** Optional second file kept beside the manager prompt. */
	extra?: string | null;
	/** Overrides the install-name lookup, for tests and unusual layouts. */
	extensionDir?: string;
}

export interface ManagerPromptParts {
	connectorPath: string;
	connectorRole: string;
	sides?: readonly ManagerPromptSide[];
}

export function composeManagerPrompt(parts: ManagerPromptParts, report?: ManagerPromptReport): string;
