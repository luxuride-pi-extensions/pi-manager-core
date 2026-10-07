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
 * The package is split by CONCERN, not by size:
 *
 *   paths.js             the environment: $HOME, PI_AGENT_DIR, install dirs
 *   prompts.js           reading, degrading and composing manager prompts
 *   session.js           telling a child subagent from a manager session
 *   manager-mode.js      the gate: the only stateful part
 *   context-injection.js the constant section plus the per-turn snapshot
 *   commands.js          the engage and exit commands
 *
 * This module is the barrel they are re-exported through, and it is the ONLY
 * entry point a consumer should import: the split is a source-layout decision,
 * and `core.js` importing it keeps the path a consumer resolves stable while the
 * files behind it move. The surface-equality check in test/resolver-copies.mjs
 * compares this module's export list against the local fallback's, so adding an
 * export here without adding it there fails the suite.
 */

export { xdgCacheHome, expandUserPath, getPiAgentDir, getInstalledExtensionDir } from "./paths.js";
export { stripFrontmatter, readPromptFile, isDegradedPrompt, composeManagerPrompt } from "./prompts.js";
export { CHILD_AGENT_PROMPT_PATTERN, readActiveAgentName } from "./session.js";
export { createManagerMode } from "./manager-mode.js";
export { createLazyToolGate } from "./lazy-tools.js";
export { createContextInjection } from "./context-injection.js";
export { registerEngageCommand, registerExitCommand } from "./commands.js";
