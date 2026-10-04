/**
 * Every manager's gate roster must equal the `allowedAgents:` line in its own
 * prompt, minus the manager itself.
 *
 * Two files state the same list: the prompt's frontmatter, which is what pi
 * actually offers the session, and the Set in index.ts, which is what the gate
 * enforces. They were the same list in exactly one of three managers, and where
 * they differed the failure was silent and structural — the manager could spawn
 * a writer that walked straight past the write/edit refusal the same session
 * advertises in its exit command.
 *
 * The rule is now the core's, but the NAMES are still declared twice, so this
 * is where that duplication is policed. A mismatch is a real defect in one of
 * two directions:
 *
 *   - a name in the prompt but not the Set: the gate refuses a delegation pi
 *     itself advertised, so the manager stalls on valid work;
 *   - a name in the Set but not the prompt: the gate permits a spawn that has
 *     no definition, which fails later and further from the cause.
 *
 *   node test/agent-rosters.mjs
 *   node test/agent-rosters.mjs --fix
 *
 * An absent consumer checkout cannot be read, so it is reported rather than
 * silently passed: the roster rule is the core's but the NAMES are declared
 * twice, and a green run that verified nothing is worse than a red one. The
 * skip is allowed locally (a one-repo clone is normal) and fatal under
 * PI_REQUIRE_CONSUMERS=1, which is what the `consumers` job in ci.yml sets.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const PROJECTS = resolve(REPO, "..");
const FIX = process.argv.includes("--fix");
const REQUIRED = process.env.PI_REQUIRE_CONSUMERS === "1";

/** Where each manager declares its roster, and the prompt that must agree. */
const CONSUMERS = [
	{ repo: "pi-blender", set: "BLENDER_MANAGER_ROSTER", prompt: "blender/agents/blender-manager.md" },
	{ repo: "pi-unity", set: "UNITY_MANAGER_ROSTER", prompt: "unity/agents/unity-manager.md" },
	{
		repo: "pi-unity-blender",
		set: "UNITY_BLENDER_MANAGER_ROSTER",
		prompt: "agents/unity-blender-manager.md",
	},
];

/**
 * The manager's own name, derived from the FILENAME.
 *
 * Not from frontmatter: these prompts deliberately declare no `name:`, because
 * a manager is not a spawnable agent. The file header says why — the command
 * session IS the manager, so a spawnable `blender-manager` would give you two
 * managers whose prompts drift apart, and the one you were watching would not
 * be the one running. Reading a `name:` that does not exist is therefore not a
 * missing feature to route around, and inventing one here would test a fiction.
 *
 * The check it enables still matters: the manager must appear in neither
 * `allowedAgents` nor the gate's roster, because spawning the manager from the
 * manager is a loop with no base case.
 */
function managerNameFromPrompt(promptPath) {
	return promptPath.split(/[\\/]/).pop().replace(/\.md$/, "");
}

let passed = 0;
let problems = 0;
const skipped = [];
const failures = [];

const check = (name, ok, detail = "") => {
	if (ok) {
		passed += 1;
		return;
	}
	problems += 1;
	failures.push(`${name}${detail ? `: ${detail}` : ""}`);
};

for (const { repo, set, prompt } of CONSUMERS) {
	const dir = join(PROJECTS, repo);
	if (!existsSync(dir)) {
		skipped.push(`${repo} (not checked out at ${dir})`);
		continue;
	}
	const label = repo;

	const promptPath = join(dir, prompt);
	check(`${label}: the prompt exists`, existsSync(promptPath), promptPath);
	if (!existsSync(promptPath)) continue;

	const promptSource = readFileSync(promptPath, "utf8");
	const managerName = managerNameFromPrompt(promptPath);
	check(
		`${label}: the prompt is not a spawnable agent`,
		!/^name:\s*\S+/m.test(promptSource),
		"a manager prompt declaring name: would let pi spawn a second manager",
	);

	// allowedAgents may be a list or a comma-separated string; pi accepts both
	// and the three prompts happen to differ, so both are read.
	const raw = /^allowedAgents:\s*(.*)$/m.exec(promptSource)?.[1] ?? "";
	const allowed = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	check(`${label}: the prompt declares allowedAgents`, allowed.length > 0, "the line is empty or absent");

	// The Set, read from source rather than imported: importing index.ts would
	// load the extension and need a pi instance, and the declaration's TEXT is
	// what this test is about.
	const indexPath = join(dir, "index.ts");
	check(`${label}: index.ts exists`, existsSync(indexPath), indexPath);
	if (!existsSync(indexPath)) continue;
	const indexSource = readFileSync(indexPath, "utf8");

	const block = new RegExp(`const\\s+${set}\\s*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(indexSource);
	check(`${label}: ${set} is declared`, block !== null, `no new Set([...]) found for ${set}`);
	if (!block) continue;

	const declared = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
	check(`${label}: the roster is not empty`, declared.length > 0);

	// The Set must be the one handed to the core, or the test is asserting on a
	// declaration nothing reads — the pi-blender case once already, where the
	// roster was enforced by a local copy and the Set was documentation.
	const wired = new RegExp(`agentRoster:\\s*\\[\\.\\.\\.${set}\\]`).test(indexSource);
	check(`${label}: the roster is wired into createManagerMode`, wired, `agentRoster: [...${set}] not found`);

	// A Set with a duplicate is a typo that reads as two agents.
	const dupes = declared.filter((n, i) => declared.indexOf(n) !== i);
	check(`${label}: the roster has no duplicates`, dupes.length === 0, [...new Set(dupes)].join(", "));

	const expected = allowed.filter((n) => n !== managerName);
	const missing = expected.filter((n) => !declared.includes(n));
	const extra = declared.filter((n) => !allowed.includes(n));

	check(
		`${label}: every advertised agent is spawnable`,
		missing.length === 0,
		`the gate would refuse ${missing.join(", ")} — pi offers them in allowedAgents`,
	);
	check(
		`${label}: the roster invents no agent`,
		extra.length === 0,
		`${extra.join(", ")} — in the Set but not in the prompt, so it has no definition`,
	);
	check(
		`${label}: the manager cannot spawn itself`,
		!declared.includes(managerName) && !allowed.includes(managerName),
		`${managerName} is the manager`,
	);

	if (missing.length > 0 && FIX) {
		const merged = [...new Set([...declared, ...missing])];
		const next = block[1].replace(/[\s\S]*/, `\n${merged.map((n) => `\t"${n}",`).join("\n")}\n`);
		const updated = indexSource.replace(block[0], `const ${set} = new Set([${next}])`);
		writeFileSync(indexPath, updated);
		console.log(`  added ${missing.join(", ")} to ${repo}/${set}`);
	}
}

for (const s of skipped) console.error(`SKIPPED ${s} — no roster was verified for this consumer`);
console.log(
	`${passed} passed, ${problems} problem(s)` +
		(skipped.length ? `, ${skipped.length} NOT VERIFIED` : ""),
);
if (problems > 0) {
	for (const f of failures) console.error(`FAIL ${f}`);
	process.exitCode = 1;
}
if (skipped.length > 0 && REQUIRED) {
	console.error(
		`\nPI_REQUIRE_CONSUMERS=1 and ${skipped.length} consumer checkout(s) are absent, so no roster was ` +
			"compared at all. A green run here means nothing.",
	);
	process.exitCode = 1;
}
