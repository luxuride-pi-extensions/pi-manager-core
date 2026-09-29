/**
 * Where things live on disk.
 *
 * Separated from the rest of the core because it is the only part that is
 * really about the ENVIRONMENT rather than about manager behaviour: a sandbox
 * or a non-default pi home is the thing these four functions exist to absorb,
 * and none of the manager logic should have to know that.
 */

import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** The XDG cache root, so a sandboxed or immutable $HOME does not break IO. */
export function xdgCacheHome() {
	return process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
}

/** Expand a leading `~`; resolve a relative path against `cwd`. */
export function expandUserPath(raw, cwd = process.cwd()) {
	const value = String(raw).trim();
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return homedir() + value.slice(1);
	return isAbsolute(value) ? value : resolve(cwd, value);
}

/**
 * Where pi keeps its agent directory, which is where extensions are installed.
 *
 * Overridable for the same reason the install scripts take PI_AGENT_DIR: a test
 * harness and a non-default pi home both need to point somewhere else, and a
 * hardcoded ~/.pi would read a real installation's files instead.
 */
export function getPiAgentDir() {
	const override = process.env.PI_AGENT_DIR?.trim();
	if (override) return expandUserPath(override);
	return join(homedir(), ".pi", "agent");
}

/**
 * The directory of an installed extension, by the name pi installs it under.
 *
 * Keyed by install name rather than by checkout path, so a symlinked
 * development install resolves the same as a real one.
 */
export function getInstalledExtensionDir(name) {
	return join(getPiAgentDir(), "extensions", name);
}
