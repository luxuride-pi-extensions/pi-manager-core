/**
 * Anti-drift: every consumer extension carries a copy of the canonical resolver
 * shim, and this fails when a copy differs from the canonical one.
 *
 * This is the whole anti-drift story for the shared core, and it is a test
 * rather than a convention on purpose. A convention is what already failed
 * three times: the engage command, the exit command, the child-session
 * detector, the prompt composer and the install stamping were each written
 * independently in three extensions, and the drift was invisible because each
 * copy was individually reasonable. A test that diffs the copies is the first
 * thing in this family that makes drift LOUD.
 *
 * What else is deliberately NOT unified by this test: nothing, and that is the
 * point. The per-consumer fallback copies are gone. They used to be compared
 * here too, which made the duplication look maintained — but a fallback that a
 * consumer installed alone never re-tests is a fork that ships, and a fork that
 * ships is the failure this repository exists to prevent. A missing core is now
 * a hard error, so there is no second copy that could drift.
 *
 * The shared agent-template checks are compared for a sharper reason: they were
 * written once, in the binder, and the other two installers had neither of
 * them. A check that only one of three installers runs is not a shared check.
 *
 *   node test/resolver-copies.mjs            # report
 *   node test/resolver-copies.mjs --fix      # rewrite the copies
 *
 * A consumer that is not checked out is skipped, not failed: this repo has to
 * be testable on its own.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PROJECTS = resolve(REPO, "..");
const FIX = process.argv.includes("--fix");

/** The consumers, and the two files each carries a copy of. */
const CONSUMERS = [
	{ repo: "pi-vibe-blender", shim: "manager-core.ts", checks: "scripts/agent-template-checks.mjs" },
	{ repo: "pi-vibe-unity", shim: "manager-core.ts", checks: "scripts/agent-template-checks.mjs" },
	{ repo: "pi-unity-blender", shim: "manager-core.ts", checks: "scripts/agent-template-checks.mjs" },
];

const canonicalResolver = readFileSync(join(REPO, "manager-core.ts"), "utf8");
const canonicalChecks = readFileSync(join(REPO, "shared", "agent-template-checks.mjs"), "utf8");

let checked = 0;
let problems = 0;
const skipped = [];

for (const { repo, shim, checks } of CONSUMERS) {
	const dir = join(PROJECTS, repo);
	if (!existsSync(dir)) {
		skipped.push(`${repo} (not checked out)`);
		continue;
	}

	for (const [name, expected] of [
		[shim, canonicalResolver],
		[checks, canonicalChecks],
	]) {
		const path = join(dir, name);
		checked += 1;
		if (!existsSync(path)) {
			console.error(`MISSING ${repo}/${name} — ${FIX ? "will be written" : "run with --fix"}`);
			problems += 1;
			if (FIX) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, expected);
				console.log(`  wrote ${path}`);
			}
			continue;
		}
		const actual = readFileSync(path, "utf8");
		if (actual === expected) {
			console.log(`ok ${repo}/${name}`);
			continue;
		}
		problems += 1;
		if (FIX) {
			writeFileSync(path, expected);
			console.log(`  rewrote ${path} (${diffLine(expected, actual)} lines differ)`);
		} else {
			console.error(`DRIFT ${repo}/${name} — ${diffLine(expected, actual)} lines differ; run --fix`);
		}
	}
}

/** How many lines actually differ, so the report is not just "different". */
function diffLine(expected, actual) {
	const a = expected.split("\n");
	const b = actual.split("\n");
	let n = 0;
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) if (a[i] !== b[i]) n += 1;
	return n;
}

for (const s of skipped) console.log(`skipped ${s}`);
console.log(`\n${checked - problems} in sync, ${problems} problem(s)`);
if (problems > 0) process.exitCode = 1;
