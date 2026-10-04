#!/usr/bin/env node
/**
 * Does each package's `files` allowlist still describe what the package needs?
 *
 * The reason this is a test and not a convention: a `files` list is a DENY
 * list written in the affirmative, so it is silent when it goes stale. Nothing
 * in npm complains about a file that is no longer shipped, and nothing in pi
 * complains either -- pi loads the package from a git clone of the repository,
 * where every file is present regardless, so the allowlist only ever takes
 * effect on the tarball a release publishes. A test that runs in CI on master
 * is the only place the difference is visible before it ships.
 *
 * Two directions, and the second is the one that actually catches bugs:
 *
 *   1. Nothing pi loads may be EXCLUDED. pi resolves a package's extension by
 *      falling back to a root index.ts (resolveExtensionEntries), reads its
 *      `pi` manifest when it has one, and every skill dir here is published by
 *      a resources_discover hook that returns an ABSOLUTE path into the repo.
 *      So a skill directory missing from `files` yields a package whose
 *      /blender skill list points at files that are not in the tarball, with
 *      no error at install time.
 *
 *   2. Nothing that only CI needs may be INCLUDED. test/ and .github/ are the
 *      two directories that grew by themselves: a suite needs its fixtures and a
 *      workflow needs its sibling checkouts, and both are added without anyone
 *      deciding the tarball should carry them. Before this allowlist existed,
 *      pi-blender shipped 111 files of which 40 were tests and one was a
 *      workflow.
 *
 * `npm pack --dry-run --json` is the ground truth for both: it is npm's own
 * answer to "what would ship", not our reimplementation of it. The package name
 * is the JSON key, so the payload is read off the package name rather than
 * assumed to be an array.
 *
 * Skips, and says so, when npm or a checkout is unavailable -- the core has to
 * be testable on its own.
 *
 *   node test/package-contents.mjs
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = resolve(REPO_ROOT, "..");

/** The core, plus the three consumers. Each needs pi to be able to load it. */
const PACKAGES = [
	{ repo: "pi-manager-core", entry: "index.ts" },
	{ repo: "pi-blender", entry: "index.ts" },
	{ repo: "pi-unity", entry: "index.ts" },
	{ repo: "pi-unity-blender", entry: "index.ts" },
];

/**
 * Directories that are CI-only and must not ship.
 *
 * `test/` is where suites and their fixtures live; `.github/` is where the
 * workflows that check out sibling repositories live. Neither is loaded by pi.
 * A directory is checked as a PREFIX so a new test file cannot quietly start
 * shipping just because nobody remembered to add it to the list.
 */
const NEVER_SHIP = ["test/", ".github/"];

/** Directories that must ship if the repo has them at all. */
const ALWAYS_SHIP = ["core/", "scripts/", "agents/", "skills/"];

/** Resource dirs a consumer publishes through a resources_discover hook. */
const SKILL_DIRS = {
	"pi-blender": ["blender/skills"],
	"pi-unity": ["unity/skills"],
	"pi-unity-blender": ["skills"],
};

let checked = 0;
let problems = 0;
const skipped = [];

const ok = (message) => console.log(`ok ${message}`);
const fail = (message) => {
	problems += 1;
	console.error(`FAIL ${message}`);
};

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		return { __error: error.message };
	}
}

/**
 * The file list npm would actually put in the tarball.
 *
 * Returns null when npm cannot be run here, which is the only reason to skip:
 * the allowlist is npm's input, so without npm there is nothing to check.
 */
function packContents(dir, name) {
	const probe = spawnSync("npm", ["pack", "--dry-run", "--json"], {
		cwd: dir,
		encoding: "utf8",
		timeout: 120_000,
	});
	if (probe.status !== 0) return { error: (probe.stderr || "").trim().split("\n").pop() };
	// npm wraps the payload in an object keyed by the package name, and older
	// npm returns a bare array. Accept both rather than crash on the shape.
	const parsed = JSON.parse(probe.stdout);
	const payload = Array.isArray(parsed) ? parsed[0] : parsed[name];
	if (!payload) return { error: `npm pack --json returned no entry for ${name}` };
	return { paths: payload.files.map((f) => f.path), count: payload.entryCount };
}

for (const { repo, entry } of PACKAGES) {
	const dir = join(PROJECTS, repo);
	if (!existsSync(dir)) {
		skipped.push(`${repo} (not checked out)`);
		continue;
	}

	const pkg = readJson(join(dir, "package.json"));
	if (pkg.__error) {
		fail(`${repo}: package.json is not readable as JSON (${pkg.__error})`);
		continue;
	}
	checked += 1;

	if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
		fail(
			`${repo}: package.json has no \`files\` allowlist, so a release tarball ships ` +
				"everything in the repository -- tests and workflows included. Add the paths pi " +
				"loads at runtime; this test is the one that says when one goes missing.",
		);
		continue;
	}
	ok(`${repo} declares a files allowlist (${pkg.files.length} entries)`);

	const packed = packContents(dir, repo);
	if (packed.error) {
		skipped.push(`${repo} (npm pack failed: ${packed.error})`);
		continue;
	}

	// --- 1. the entry point pi loads -----------------------------------------
	//
	// pi resolves a package's extensions through its `pi` manifest when there is
	// one and otherwise falls back to a root index.ts/index.js. Both shapes end
	// up naming a file, and neither file can be missing from the tarball, so
	// this asserts against whatever the manifest actually declares and not
	// against a hardcoded list that could go stale.
	const declared = pkg.pi?.extensions;
	const entries = Array.isArray(declared) && declared.length > 0 ? declared : [entry];
	for (const e of entries) {
		const rel = e.replace(/^\.\//, "");
		if (packed.paths.includes(rel)) ok(`${repo} ships its extension entry ${rel}`);
		else fail(`${repo}: pi loads ${rel}, but the tarball does not contain it`);
	}

	// --- 2. skills the extension publishes ----------------------------------
	for (const d of SKILL_DIRS[repo] ?? []) {
		if (!existsSync(join(dir, d))) continue;
		const shipped = packed.paths.some((p) => p.startsWith(`${d}/`));
		if (shipped) ok(`${repo} ships its skill directory ${d}/`);
		else fail(`${repo}: ${d}/ exists and resources_discover publishes it, but the tarball omits it`);
	}

	// --- 3. the CI-only directories -----------------------------------------
	for (const d of NEVER_SHIP) {
		const shipped = packed.paths.filter((p) => p.startsWith(d));
		if (shipped.length === 0) ok(`${repo} keeps ${d} out of the tarball`);
		else fail(`${repo}: the tarball ships ${shipped.length} file(s) under ${d}, e.g. ${shipped[0]}`);
	}

	// --- 4. an allowlist that is empty of the big dirs -----------------------
	//
	// A list of the handful of root .ts files is the shape a `files` field takes
	// when someone adds it to silence a warning, and it is missing every module
	// directory the extension imports. Checked structurally rather than by
	// filename so a rename does not have to update this list.
	for (const d of ALWAYS_SHIP) {
		const prefix = `${d.replace(/\/+$/, "")}/`;
		if (!existsSync(join(dir, prefix))) continue;
		const shipped = packed.paths.some((p) => p.startsWith(prefix));
		if (shipped) ok(`${repo} ships ${prefix}`);
		else fail(`${repo}: ${prefix} exists on disk but nothing from it ships, so the extension cannot import it`);
	}
}

for (const s of skipped) console.log(`skipped ${s}`);
console.log(`\n${checked - problems} of ${checked} package(s) clean, ${problems} problem(s)`);
if (problems > 0) process.exitCode = 1;