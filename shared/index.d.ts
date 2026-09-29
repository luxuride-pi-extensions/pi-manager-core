/**
 * Types for shared/index.js — the barrel the implementation is re-exported
 * through, and the module core.d.ts re-exports its types from.
 *
 * Every concern is declared in the .d.ts beside its own source file; this one
 * only gathers them, so adding a module to shared/ means adding one line here
 * and one to core.d.ts, and the resolver-copies surface check catches a core
 * export that the local fallback lacks.
 */

export {
	xdgCacheHome,
	expandUserPath,
	getPiAgentDir,
	getInstalledExtensionDir,
} from "./paths.js";
export {
	stripFrontmatter,
	readPromptFile,
	isDegradedPrompt,
	composeManagerPrompt,
	type ManagerPromptSide,
	type ManagerPromptParts,
} from "./prompts.js";
export { CHILD_AGENT_PROMPT_PATTERN, readActiveAgentName } from "./session.js";
export {
	createManagerMode,
	type ToolCallRefusal,
	type ToolCallEvent,
	type ManagerModeOptions,
	type ManagerMode,
} from "./manager-mode.js";
export {
	createContextInjection,
	type SystemPromptEventLike,
	type ContextInjectionOptions,
	type ContextInjectionHandler,
} from "./context-injection.js";
export {
	registerEngageCommand,
	registerExitCommand,
	type CommandContextLike,
	type EngageCommandOptions,
	type ExitCommandOptions,
} from "./commands.js";
