/**
 * Which core does each consumer actually load?
 *
 * Answers the question a test cannot: not "is the fallback present" but "is the
 * SHARED core the one in use". The resolver probes several locations in order,
 * so a working extension tells you nothing about which one it used — and the
 * failure this guards is exactly a silent fallback that works fine and so
 * reports nothing.
 *
 * Prints one line per consumer: the resolved source, and whether the stand-in
 * was used. Exits non-zero if any consumer is on its local copy, so this can
 * gate an install check.
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

let anyFallback = false;
for (const name of ["pi-vibe-blender", "pi-vibe-unity", "pi-unity-blender"]) {
	const dir = join(REPO_ROOT, "..", name);
	if (!existsSync(dir)) {
		console.log(`${name.padEnd(16)} SKIP (checkout not present)`);
		continue;
	}
	const resolver = await jiti.import(join(dir, "manager-core.ts"));
	// Probe the candidate list the same way the resolver does, by asking it for
	// the real core rather than the wrapped local.
	const core = resolver.loadManagerCore();
	const standIn = core.__managerCoreUnavailable === true;
	if (standIn) anyFallback = true;
	const marker = standIn ? "LOCAL FALLBACK" : "shared core";
	console.log(`${name.padEnd(16)} ${marker}`);
	if (standIn) console.log(`                 ${resolver.describeMissingCore()}`);
}

console.log(`\n${anyFallback ? "FAIL" : "OK"}: ${anyFallback ? "at least one consumer is on its local copy" : "every consumer loads the shared core"}`);
process.exit(anyFallback ? 1 : 0);
