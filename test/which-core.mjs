/**
 * Which core does each consumer actually load?
 *
 * There is no fallback any more, so this is now a simpler question than it was:
 * a missing core throws, and the throw names every path that was tried. What it
 * still catches is the case a throwing resolver cannot: a core that resolves to
 * some OTHER checkout, so a consumer is silently running against a version that
 * is not the one installed. It prints which directory each consumer resolved
 * from, and fails if two consumers resolved from different places.
 *
 * Exits non-zero if any consumer failed to resolve, or if they disagree about
 * where the core lives, so this can gate an install check.
 */

import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createJiti } from "/home/lux/.pi/agent/install/releases/0.87.1/node_modules/jiti/lib/jiti.mjs";

const jiti = createJiti(import.meta.url, { isolated: true, interopDefault: true });

const REPO_ROOT = join(import.meta.dirname, "..");
const PI_AGENT_DIR = join(process.env.PI_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"));
const installedCore = join(PI_AGENT_DIR, "extensions", "manager-core", "shared", "core.js");
console.log(`shared core installed: ${existsSync(installedCore) ? "yes" : "NO"}  (${installedCore})\n`);

let failed = false;
const resolvedFrom = new Map();

for (const name of ["pi-blender", "pi-unity", "pi-unity-blender"]) {
	const dir = join(REPO_ROOT, "..", name);
	if (!existsSync(dir)) {
		console.log(`${name.padEnd(16)} SKIP (checkout not present)`);
		continue;
	}
	const resolver = await jiti.import(join(dir, "manager-core.ts"));
	try {
		resolver.loadManagerCore();
	} catch (error) {
		failed = true;
		console.log(`${name.padEnd(16)} FAILED`);
		console.log(`                 ${String(error.message).split(". ")[0]}.`);
		continue;
	}
	// Ask the resolver which directory it settled on, so two consumers resolving
	// from different checkouts is visible rather than merely working.
	const source = resolver.describeResolvedCoreSource?.() ?? "(unknown)";
	resolvedFrom.set(name, source);
	console.log(`${name.padEnd(16)} shared core  <- ${source}`);
}

const distinct = new Set(resolvedFrom.values());
if (distinct.size > 1) {
	failed = true;
	console.log(`\nFAIL: the consumers resolved the core from ${distinct.size} different places:`);
	for (const [name, source] of resolvedFrom) console.log(`  ${name}: ${source}`);
}

console.log(
	`\n${failed ? "FAIL" : "OK"}: ${
		failed
			? "at least one consumer has no core, or the consumers disagree about which one"
			: `every consumer loads the shared core${distinct.size === 1 ? ` (${[...distinct][0]})` : ""}`
	}`,
);
process.exit(failed ? 1 : 0);
