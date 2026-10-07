/**
 * Types for shared/lazy-tools.js — lazy tool activation.
 */

/**
 * Options for {@link createLazyToolGate}.
 */
export interface LazyToolGateOptions {
	/** The family of tool names that activate together. */
	toolNames?: readonly string[];
	/**
	 * Called each turn boundary; when it returns true the family is
	 * re-armed before the run starts. Typically the manager gate's
	 * isEngaged, so an engaged session never runs a turn without its tools.
	 */
	isEngaged?: () => boolean;
}

/**
 * The lazy tool gate: one instance per extension.
 *
 * The gate owns no registration of its own — the extension registers its
 * tools with `defaultActive: false` and hands the gate the names; the gate
 * decides when the family becomes visible to the model.
 */
export interface LazyToolGate {
	/** Are the tools currently declared to the model? */
	isActive(): boolean;
	/**
	 * Declare the whole family, if not already declared. Idempotent and
	 * sticky: a later call is a no-op, not a re-declaration. Returns true
	 * when this call flipped the family on.
	 */
	activate(ctx: unknown): boolean;
	/** Should this tool_call event wake the family up? */
	shouldActivateOnCall(event: { toolName?: string } | null | undefined): boolean;
	/**
	 * Fresh-session handling, mirroring the manager gate's reset: a
	 * "reload" keeps everything, any other reason sends the family inert.
	 */
	reset(reason?: string): void;
	/**
	 * Install the session_start, tool_call and (when an isEngaged was
	 * supplied) before_agent_start halves of the contract on a pi instance.
	 */
	install(pi: unknown): void;
}

/**
 * Create the lazy tool gate for a tool family.
 */
export function createLazyToolGate(options?: LazyToolGateOptions): LazyToolGate;
