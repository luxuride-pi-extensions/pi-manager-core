/**
 * jiti, resolved rather than hardcoded.
 *
 * The harness loads TypeScript through jiti, because `node --strip-types`
 * cannot resolve this project's NodeNext ".js" specifiers (a `.ts` file's
 * relative imports). jiti used to be imported by absolute path here, pinned to
 * the release directory of the machine that wrote the file -- which meant the
 * suite ran on exactly one machine, and a moved or upgraded install failed as
 * an unresolved module rather than as a test failure.
 *
 * Resolution order:
 *   1. PI_JITI_PATH -- an explicit override, which must exist.
 *   2. This repo's own node_modules (jiti 2.7.0 is a transitive dependency of
 *      @earendil-works/pi-coding-agent). This is what a CI checkout resolves
 *      to, so a clean clone needs nothing outside itself.
 *   3. pi's installed release directory, newest first, because a machine that
 *      installed the extension rather than cloning it has no node_modules here.
 *
 * Every candidate that fails is NAMED in the error, because "cannot find jiti"
 * with no path list sends the reader looking in the wrong place.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PI_AGENT_DIR = process.env.PI_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");

/**
 * jiti's ESM entry, as a path. Resolved through the package's OWN exports map
 * rather than by string concatenation: `jiti/lib/jiti.mjs` is not an exported
 * subpath, so `require.resolve("jiti/lib/jiti.mjs")` fails with ERR_PACKAGE_PATH_
 * NOT_EXPORTED even when jiti is installed right there. `./package.json` IS
 * exported, which makes it the one reliable way in.
 */
function repoJiti() {
	const require = createRequire(join(REPO_ROOT, "package.json"));
	const pkg = require.resolve("jiti/package.json");
	return join(dirname(pkg), "lib", "jiti.mjs");
}

/** Every pi release directory, newest version first. */
function piReleases() {
	const releases = join(PI_AGENT_DIR, "install", "releases");
	if (!existsSync(releases)) return [];
	const names = readdirSync(releases)
		.filter((name) => existsSync(join(releases, name, "node_modules")))
		.sort();
	return names
		.reverse()
		.map((name) => join(releases, name, "node_modules", "jiti", "lib", "jiti.mjs"));
}

function resolveJitiPath() {
	const explicit = process.env.PI_JITI_PATH?.trim();
	if (explicit) {
		if (!existsSync(explicit)) {
			throw new Error(`PI_JITI_PATH is set to ${explicit}, which does not exist.`);
		}
		return explicit;
	}
	const local = repoJiti();
	if (existsSync(local)) return local;
	const fromPi = piReleases().find((path) => existsSync(path));
	if (fromPi) return fromPi;
	throw new Error(
		`Could not find jiti. Looked in:\n  ${local}\n  ${join(PI_AGENT_DIR, "install", "releases", "*", "node_modules", "jiti", "lib", "jiti.mjs")}\n` +
			`Run \`npm install\`, or set PI_JITI_PATH to jiti's lib/jiti.mjs. The harnesses ` +
			`cannot load TypeScript without it -- node --strip-types cannot resolve this ` +
			`project's NodeNext ".js" specifiers.`,
	);
}

const { createJiti } = await import(pathToFileURL(resolveJitiPath()).href);

export { createJiti };
