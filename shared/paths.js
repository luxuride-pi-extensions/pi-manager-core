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
 *
 * `cwd` exists only so a caller can ask "where would this resolve to?" about a
 * directory it is not going to use -- a test asserting on the health check's
 * view of an unrelated pi home. It is not a way to make one resolution read two
 * different directories.
 */
export function getPiAgentDir(cwd = process.cwd()) {
	const override = process.env.PI_AGENT_DIR?.trim();
	if (override) return expandUserPath(override, cwd);
	return join(homedir(), ".pi", "agent");
}

/**
 * The directory of an installed extension, by the name pi installs it under.
 *
 * Keyed by install name rather than by checkout path, so a symlinked
 * development install resolves the same as a real one.
 *
 * `name` is validated rather than trusted, for the same reason
 * pi-unity-blender/config.ts validates an instance id before using it as a path
 * segment: it becomes one here. Every current caller passes an extension
 * constant, so this is defence in depth -- but the rule the core advertises for
 * the manager's agent roster ("a name that is not on the list is refused") is
 * worthless if a resolver will happily join `../../..` into the path it hands
 * back. A trailing slash or a `.` is rejected too: both join to the same place
 * and both defeat any caller that compares the result against the install name
 * it asked for.
 */
export function getInstalledExtensionDir(name) {
	const segment = String(name ?? "").trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(segment) || segment.includes("..")) {
		throw new Error(
			`getInstalledExtensionDir: ${JSON.stringify(name)} is not an extension install name. ` +
				"It becomes a path segment, so it must be 1-64 characters of [A-Za-z0-9._-], start with " +
				"an alphanumeric, and contain no `..`.",
		);
	}
	return join(getPiAgentDir(), "extensions", segment);
}
