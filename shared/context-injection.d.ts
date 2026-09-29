/**
 * Types for shared/context-injection.js — the section plus the snapshot.
 *
 * The three ordering rules the implementation enforces are documented there.
 */

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
	/**
	 * Whether a CHILD session also receives the system-prompt section.
	 *
	 * Default true: the constant prompt is what tells a subagent which side of
	 * the bridge it is on. The two-application manager sets this false, because
	 * its workers already state their own side and its prompt is the connector's
	 * instructions rather than a side's procedure.
	 */
	sectionReachesChildren?: boolean;
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
 * the per-turn live snapshot. See shared/context-injection.js for the three
 * rules it enforces and why each is load-bearing.
 */
export function createContextInjection(options: ContextInjectionOptions): ContextInjectionHandler;
