/**
 * Types for shared/paths.js — the environment helpers.
 *
 * One declaration file per source module, mirroring the split. `core.d.ts` is
 * the barrel a consumer's TypeScript resolves; nothing imports these directly.
 */

/** The XDG cache root, so a sandboxed or immutable $HOME does not break IO. */
export function xdgCacheHome(): string;
/** Expand a leading `~`; resolve a relative path against `cwd`. */
export function expandUserPath(raw: unknown, cwd?: string): string;
/** Where pi keeps its agent directory, which is where extensions are installed. */
export function getPiAgentDir(cwd?: string): string;
/** The directory of an installed extension, by the name pi installs it under. */
export function getInstalledExtensionDir(name: string): string;
