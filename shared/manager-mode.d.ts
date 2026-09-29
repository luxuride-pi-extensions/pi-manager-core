/**
 * Types for shared/manager-mode.js — the gate.
 */

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
	/** Tool names the manager keeps, e.g. text reads, todo, supervisor. */
	allowedTools?: readonly string[];
	/**
	 * Application-specific refusals, consulted BEFORE the allowlist so a coarse
	 * allowlist cannot short-circuit a specific refusal. Return null when the
	 * application has no opinion, to fall through to the allowlist and then to
	 * the default refusal.
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
