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
 *
 * This file is the BARREL, mirroring shared/index.js: one declaration file per
 * source module beside it, and this one re-exports them. It stays the single
 * declaration path a consumer resolves, so the source split does not become a
 * type-path change for anyone typed against the core.
 */

export {
	xdgCacheHome,
	expandUserPath,
	getPiAgentDir,
	getInstalledExtensionDir,
} from "./index.js";
export {
	stripFrontmatter,
	readPromptFile,
	isDegradedPrompt,
	composeManagerPrompt,
	type ManagerPromptSide,
	type ManagerPromptParts,
} from "./index.js";
export { CHILD_AGENT_PROMPT_PATTERN, readActiveAgentName } from "./index.js";
export {
	createManagerMode,
	type ToolCallRefusal,
	type ToolCallEvent,
	type ManagerModeOptions,
	type ManagerMode,
} from "./index.js";
export { createLazyToolGate, type LazyToolGate, type LazyToolGateOptions } from "./index.js";
export {
	createContextInjection,
	type SystemPromptEventLike,
	type ContextInjectionOptions,
	type ContextInjectionHandler,
} from "./index.js";
export {
	registerEngageCommand,
	registerExitCommand,
	type CommandContextLike,
	type EngageCommandOptions,
	type ExitCommandOptions,
} from "./index.js";
