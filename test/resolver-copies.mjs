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
 * A consumer that is not checked out cannot be diffed, and that has to be a
 * DECISION rather than a silent green. This file is the ONLY check verifying
 * that 2372 duplicated lines are byte-identical across the three consumers; a
 * skip here that prints like a pass means the whole anti-drift story can report
 * success having verified nothing. So an absent checkout is reported on stderr,
 * counted in the summary, and named in the exit path when PI_REQUIRE_CONSUMERS=1
 * — the same gate extension-registration.mjs and allowlists.mjs already use, set
 * by the `consumers` job in ci.yml, which checks all three out on purpose.
 * Locally, where a one-repo clone is the normal case, the skip is still allowed
 * but is never printed as `ok`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PROJECTS = resolve(REPO, "..");
const FIX = process.argv.includes("--fix");

/** See the header: an absent checkout is a failure where it was meant to be there. */
const REQUIRED = process.env.PI_REQUIRE_CONSUMERS === "1";

/** The consumers, and the two files each carries a copy of. */
const CONSUMERS = [
	{ repo: "pi-blender", shim: "manager-core.ts", checks: "scripts/agent-template-checks.mjs" },
	{ repo: "pi-unity", shim: "manager-core.ts", checks: "scripts/agent-template-checks.mjs" },
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
		skipped.push(`${repo} (not checked out at ${dir})`);
		continue;
	}

	for (const [name, expected] of [
		[shim, canonicalResolver],
		[checks, canonicalChecks],
	]) {
		const path = join(dir, name);
		checked += 1;
		if (!existsSync(path)) {
			// Counted only when NOT fixed, for the reason spelled out at the
			// DRIFT branch below: a --fix run that repaired the file exits 0, and
			// a --fix run that could not repair it has already exited non-zero
			// from the write failing. Incrementing here as well meant a
			// successfully repaired MISSING file still exited 1 while the DRIFT
			// case beside it exited 0 — the two branches disagreeing about the
			// same rationale, in a file whose comment says the rationale.
			console.error(`MISSING ${repo}/${name} — ${FIX ? "will be written" : "run with --fix"}`);
			if (FIX) {
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, expected);
				console.log(`  wrote ${path}`);
			} else {
				problems += 1;
			}
			continue;
		}
		const actual = readFileSync(path, "utf8");
		if (actual === expected) {
			console.log(`ok ${repo}/${name}`);
			continue;
		}
		if (FIX) {
			// Only a REAL problem counts once fixed. Counting it anyway made the
			// run that repairs the drift exit non-zero and report the same count
			// of problems, which reads as "the fix did not work" — so the exit
			// code was the opposite of what it says. `--fix` is run in a loop by
			// anyone changing the canonical file, so that ambiguity is expensive.
			writeFileSync(path, expected);
			console.log(`  rewrote ${path} (${diffLine(expected, actual)} lines differ)`);
		} else {
			problems += 1;
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

// stderr on purpose: a skip is not a pass, and a redirected stdout must not let
// it be read as one. The summary counts them so "6 in sync" is never mistaken
// for coverage of three consumers when it may be coverage of zero.
for (const s of skipped) console.error(`SKIPPED ${s} — nothing verified for this consumer`);
console.log(
	`\n${checked - problems} in sync, ${problems} problem(s)` +
		(skipped.length ? `, ${skipped.length} NOT VERIFIED` : ""),
);
if (problems > 0) process.exitCode = 1;
if (skipped.length > 0 && REQUIRED) {
	console.error(
		`\nPI_REQUIRE_CONSUMERS=1 and ${skipped.length} consumer checkout(s) are absent, so this run ` +
			"verified no copies at all. Every check above was skipped, and a green run here means nothing.",
	);
	process.exitCode = 1;
}
