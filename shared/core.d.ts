/**
 * Type declarations for the shared core, hand-written.
 *
 * The core ships as plain ESM JavaScript so a bare `import()` of it works in a
 * bare checkout, a symlinked development install, and a production session
 * without a build step. TypeScript consumers still want types, and a `.d.ts`
 * beside the `.js` is the only way to give them without a compile step.
 *
 * These declarations describe the real behaviour and no more. Nothing here is
 * inferred or optimistic: `block` is a literal, the refusal reason is required,
 * and the nulls are the nulls.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/* ------------------------------------------------------------------ paths -- */

export function xdgCacheHome(): string;
export function expandUserPath(raw: unknown, cwd?: string): string;
export function getPiAgentDir(): string;
export function getInstalledExtensionDir(name: string): string;

/* ---------------------------------------------------------------- prompts -- */

export function stripFrontmatter(source: unknown): string;
export function readPromptFile(path: string, role: string): string;
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

/* ---------------------------------------------------------- manager mode -- */

export const CHILD_AGENT_PROMPT_PATTERN: RegExp;
export function readActiveAgentName(systemPrompt: string | null | undefined): string | null;

/** pi's tool_call refusal: block, and the reason the model reads. */
export interface ToolCallRefusal {
	block: true;
	reason: string;
}

export type ToolCallEvent = {
	toolName: string;
	input: Record<string, unknown>;
};

export interface ManagerModeOptions {
	/** Tool names the manager keeps, e.g. text reads, bash, todo, supervisor. */
	allowedTools?: readonly string[];
	/**
	 * Application-specific refusals, consulted only for a call the allowlist
	 * has not already cleared. Return null to fall through to the default.
	 */
	onGateMessage?: (event: ToolCallEvent) => ToolCallRefusal | null;
}

export interface ManagerMode {
	/** Enter manager mode: the engage command's job, and nothing else's. */
	markEngaged(): void;
	/** Lift the gate, keeping the session and the tools. True if it was set. */
	clearGate(): boolean;
	isEngaged(): boolean;
	/** Engaged, and not a subagent running inside that session. */
	isManagerSession(systemPrompt: string | null | undefined): boolean;
	/** A fresh session inherits nothing. */
	reset(): void;
	/** null to allow, or the refusal that blocks the call. */
	checkToolCall(event: ToolCallEvent, systemPrompt: string | null | undefined): ToolCallRefusal | null;
	install(pi: unknown): void;
}

export function createManagerMode(options?: ManagerModeOptions): ManagerMode;

/* ------------------------------------------------------ context injection -- */

export interface SystemPromptEventLike {
	systemPrompt: string;
	systemPromptOptions?: { sections?: Record<string, string> };
}

export interface ContextInjectionOptions {
	/** System-prompt section the constant manager prompt lives in. */
	section: string;
	/** customType for the per-turn snapshot message. */
	customType: string;
	timeoutMs?: number;
	/** Whether this session is engaged at all. */
	shouldInject?: () => boolean;
	/** The constant prompt, usually a call to the extension's getManagerPrompt(). */
	getPrompt: () => string;
	/**
	 * Fixed text injected as the per-turn message, with no fetch at all.
	 *
	 * For the manager that drives two applications at once: its live state
	 * arrives from ONE tool call reporting both sides, so there is nothing to
	 * prefetch. Supplying both this and `fetchState` throws, because honouring
	 * either silently is how a caller that passed both survives.
	 */
	staticContent?: string | null;
	/** Fetch the live state. Throwing means "unavailable", not "empty". Required unless `staticContent` is set. */
	fetchState?: (ctx: unknown) => Promise<unknown>;
	/** Render the live state, or return "" for nothing worth injecting. Required unless `staticContent` is set. */
	formatState?: (state: unknown, options: { timeoutMs: number; extraGuidance: () => string[] }) => string;
	/** Application-specific lines appended to a healthy snapshot. */
	extraGuidance?: () => string[];
	/**
	 * The recovery sentence for a failed fetch. Each side has a differently
	 * named session-context tool, so a core-written name would be wrong in two
	 * of three managers; the "do not assume" half stays in the core, because
	 * that is the half that stops the wrong mutation.
	 */
	failureGuidance?: (error: unknown) => string;
	/**
	 * What the failed-turn notice forbids assuming, as a noun list. Unity names
	 * its open scene, which is not one of the core's four defaults, so the list
	 * is per-app rather than fixed.
	 */
	assumeNothingAbout?: string;
}

export type ContextInjectionHandler = (
	event: SystemPromptEventLike,
	ctx: { cwd?: string },
) => Promise<{ message: { customType: string; content: string; display: boolean } } | undefined>;

/**
 * The before_agent_start handler that injects the constant manager prompt and
 * the per-turn live snapshot. See shared/core.js for the three rules it
 * enforces and why each is load-bearing.
 */
export function createContextInjection(options: ContextInjectionOptions): ContextInjectionHandler;

/* -------------------------------------------------------------- commands -- */

export interface CommandContextLike {
	ui: { notify(message: string, level?: string): void };
	isIdle(): boolean;
}

export interface EngageCommandOptions {
	name: string;
	description?: string;
	/** Shown in the usage notice when the command is called bare. */
	usage?: string;
	engagedMessage?: string;
	/** Force-launch the application, clear stale state, etc. */
	onEngage?: () => void;
	/**
	 * Task to send when the command is called with no argument. Present only
	 * where a bare command is meaningful (the transfer binder opens by asking
	 * for status); absent means a bare call is a usage error.
	 */
	fallbackTask?: string;
	/**
	 * Forwarded to pi unchanged, including its `null` return meaning "no
	 * suggestions". Never wrapped: wrapping null into an empty list makes pi
	 * render an empty suggestion menu where it renders none.
	 */
	getArgumentCompletions?: (argumentPrefix: string) => unknown[] | null | Promise<unknown[] | null>;
}

export function registerEngageCommand(
	pi: Pick<ExtensionAPI, "registerCommand" | "sendUserMessage">,
	options: EngageCommandOptions,
): void;

export interface ExitCommandOptions {
	name: string;
	description?: string;
	notEngagedMessage?: string;
	exitedMessage?: string;
	/** Return false when there was nothing to exit. */
	onExit?: () => boolean;
}

export function registerExitCommand(
	pi: Pick<ExtensionAPI, "registerCommand">,
	options: ExitCommandOptions,
): void;
