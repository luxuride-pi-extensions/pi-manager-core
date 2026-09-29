/**
 * Types for shared/commands.js — the engage and exit commands.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
