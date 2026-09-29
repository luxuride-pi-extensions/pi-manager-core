/**
 * Types for shared/prompts.js — reading, degrading and composing prompts.
 */

/** Strip an agent template's frontmatter. */
export function stripFrontmatter(source: unknown): string;
/** Read a prompt file, or return a sentence naming the failure. */
export function readPromptFile(path: string, role: string): string;
/** True when `readPromptFile` degraded, so a caller can log it once. */
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

export function composeManagerPrompt(parts: ManagerPromptParts): string;
