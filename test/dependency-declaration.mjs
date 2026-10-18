/**
 * Do the consumers DECLARE that they depend on the core?
 *
 * `test/which-core.mjs` proves the shared core is the one in use right now. This
 * proves something else, and it is the thing that actually rots: that each
 * consumer's package.json says so, and that the core is a package pi can
 * install as a dependency rather than a directory someone symlinked by hand.
 *
 * Why this is not ceremony. The consumers are loaded as extensions from
 * `<agent-dir>/extensions/`, so pi never reads their package.json and npm never
 * installs anything for them. That means a `peerDependencies` entry is
 * documentation the toolchain does not enforce — and unenforced documentation is
 * exactly what rots. The fallback is what keeps that survivable: a consumer
 * with no core installed still runs from its own copy. So the dependency is a
 * *declared* relationship that the drift check and which-core enforce, and this
 * file makes the declaration part of the suite instead of a comment someone
 * remembers to update.
 *
 * Per docs/packages.md, a package's runtime dependencies go in
 * `dependencies` and imported Pi packages in `peerDependencies` with a "*"
 * range, unbundled. The core is a Pi package, so `*` is the right range here.
 *
 * An absent consumer checkout used to be printed as `ok <name> (checkout not
 * present, skipped)` — an `ok` line for a check that did not run, which is the
 * one thing this file must never emit. It is now a counted skip on stderr, and
 * fatal under PI_REQUIRE_CONSUMERS=1 (the `consumers` job in ci.yml), where the
 * whole point of the job is that all four repositories are present.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CORE_NAME = "@luxuride-pi/manager-core";
const CONSUMERS = ["pi-blender", "pi-unity-vrchat", "pi-unity-blender"];
const REQUIRED = process.env.PI_REQUIRE_CONSUMERS === "1";

const failures = [];
const skipped = [];
const fail = (message) => failures.push(message);
const ok = (message) => console.log(`ok ${message}`);

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`${path}: not readable as JSON (${error.message})`);
		return null;
	}
}

// --- the core is installable as a package ------------------------------------

const corePkg = readJson(join(REPO_ROOT, "package.json"));
if (corePkg) {
	if (corePkg.name === CORE_NAME) ok(`the core package is named ${CORE_NAME}`);
	else fail(`the core package is named ${JSON.stringify(corePkg.name)}, expected "${CORE_NAME}"`);

	// Without a `pi` manifest pi relies on conventional discovery. `index.ts` at
	// the root is not one of those, so the manifest is load-bearing here rather
	// than a narrowing: drop it and pi stops loading the extension entirely.
	const declared = corePkg.pi?.extensions;
	if (Array.isArray(declared) && declared.includes("./index.ts")) {
		ok("the core declares ./index.ts in its pi.extensions manifest");
	} else {
		fail(
			`the core does not declare ./index.ts in pi.extensions (got ${JSON.stringify(declared)}). ` +
				"index.ts sits at the package root, not under a conventional directory, so pi would " +
				"not load the extension at all and the core would never be installed.",
		);
	}

	if ((corePkg.keywords ?? []).includes("pi-package")) ok("the core is tagged as a pi-package");
	else fail("the core is not tagged with the pi-package keyword");
}

// --- each consumer declares the dependency -----------------------------------

for (const name of CONSUMERS) {
	const dir = join(REPO_ROOT, "..", name);
	if (!existsSync(dir)) {
		skipped.push(name);
		continue;
	}
	const pkg = readJson(join(dir, "package.json"));
	if (!pkg) continue;

	const range = pkg.peerDependencies?.[CORE_NAME];
	if (range === "*") {
		ok(`${name} declares peerDependencies["${CORE_NAME}"]: "*"`);
	} else {
		fail(
			`${name} does not declare peerDependencies["${CORE_NAME}"]: "*" (got ${JSON.stringify(range)}). ` +
				"pi does not enforce this for an extension loaded out of the extensions dir, so without " +
				"the entry nothing records that this consumer is not standalone.",
		);
	}

	// The dependency must not also be bundled: two copies of the core is the
	// drift this whole repository exists to prevent, and a local copy inside
	// node_modules would be invisible to the resolver, which never looks there.
	if (pkg.dependencies?.[CORE_NAME] !== undefined) {
		fail(
			`${name} lists ${CORE_NAME} under dependencies, which would install a second copy that the ` +
				"resolver never looks at. Declare it as a peer and do not bundle it.",
		);
	} else {
		ok(`${name} does not bundle a second copy of the core`);
	}
}

for (const name of skipped) console.error(`SKIPPED ${name} (checkout not present) — no declaration was verified`);
if (failures.length > 0) {
	console.error(`\n${failures.length} problem(s):`);
	for (const message of failures) console.error(`  - ${message}`);
	process.exit(1);
}
if (skipped.length > 0 && REQUIRED) {
	console.error(
		`\nPI_REQUIRE_CONSUMERS=1 and ${skipped.length} consumer checkout(s) are absent, so no dependency ` +
			"declaration was checked at all. A green run here means nothing.",
	);
	process.exit(1);
}
console.log(
	`\nall dependency declarations are consistent` + (skipped.length ? `, ${skipped.length} NOT VERIFIED` : ""),
);
