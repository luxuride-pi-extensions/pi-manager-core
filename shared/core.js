/**
 * The shared core of the manager-mode extensions.
 *
 * Plain ESM JavaScript, deliberately, not TypeScript. Every consumer here is
 * loaded by pi's jiti runtime, but a consumer that reaches this core does so
 * with a bare `import()` of a resolved path, and Node cannot import a `.ts`
 * file without a transform it will not perform. Shipping `.js` with a
 * hand-written `.d.ts` beside it means the import works in a bare checkout, an
 * installed symlink, and a production session alike, with no build step and no
 * second jiti instance.
 *
 * What lives here is only what all three extensions genuinely do the same way.
 * Application-specific behaviour stays in the application: this package knows
 * about a manager GATE and a `/command`, not about Blender, Unity, or geometry.
 *
 * This file is the STABLE ENTRY POINT and nothing else. The implementation is
 * split by concern — paths, prompts, session, manager-mode, context-injection,
 * commands — and `index.js` is the barrel those are re-exported through.
 *
 * It stays a separate file from `index.js` on purpose: `shared/core.js` is the
 * path every consumer already resolves, and four copies of it plus a resolver
 * that names it are not something to churn for a source-layout decision. A
 * consumer that imports a deeper path instead couples itself to this layout,
 * and the layout is the thing most likely to move.
 *
 *   shared/paths.js              the environment: $HOME, PI_AGENT_DIR, dirs
 *   shared/prompts.js            reading, degrading and composing prompts
 *   shared/session.js            telling a child from a manager session
 *   shared/manager-mode.js       the gate: the only stateful part
 *   shared/context-injection.js  the constant section plus the snapshot
 *   shared/commands.js           the engage and exit commands
 *
 * The export list below is the core's whole public surface, and
 * test/resolver-copies.mjs compares it against the local fallback's — so
 * adding an export here without adding it there fails the suite rather than
 * producing a consumer that works with the shared core and not with its own.
 */

export {
	xdgCacheHome,
	expandUserPath,
	getPiAgentDir,
	getInstalledExtensionDir,
} from "./index.js";
export { stripFrontmatter, readPromptFile, isDegradedPrompt, composeManagerPrompt } from "./index.js";
export { CHILD_AGENT_PROMPT_PATTERN, readActiveAgentName } from "./index.js";
export { createManagerMode } from "./index.js";
export { createContextInjection } from "./index.js";
export { registerEngageCommand, registerExitCommand } from "./index.js";
