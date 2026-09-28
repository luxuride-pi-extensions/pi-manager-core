/**
 * The shared agent-template checks, and the reason they are shared.
 *
 * These guard failures that are silent by construction, so the only defence is
 * that every installer runs them. Each test below is a failure the first copy
 * would have caught and a retyped copy would not.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
	KNOWN_NON_TOOL_WORDS,
	checkTemplate,
	declaredTools,
	namesTool,
	toolsMissingFromAllowlist,
	unresolvedToolProviders,
	usesTodo,
} from "../shared/agent-template-checks.mjs";

/** A minimal but realistic template. */
const template = (frontmatter, body = "Body prose.") => `---\n${frontmatter}\n---\n\n${body}\n`;

test("declaredTools reads the tools: line only", () => {
	assert.deepEqual(
		[...declaredTools(template("tools: read, write"))],
		["read", "write"],
	);
	// The body may mention other words; none of them are declarations.
	assert.deepEqual([...declaredTools(template("tools: read", "Call `unity_scene_info` now."))], ["read"]);
});

test("declaredTools tolerates a template with no tools: line", () => {
	assert.deepEqual([...declaredTools("---\ndescription: x\n---\n")], []);
});

test("namesTool and usesTodo are exact, not prefix matches", () => {
	const source = template("tools: read, todo");
	assert.equal(usesTodo(source), true);
	assert.equal(namesTool(source, "read"), true);
	assert.equal(namesTool(source, "rea"), false);
	assert.equal(usesTodo(template("tools: read")), false);
});

test("a tool named in the body but absent from tools: is reported", () => {
	// The case that matters: `tools` is a strict allowlist, so the child is
	// handed a call it can never make and nothing errors.
	const source = template("tools: read", "Run `blender_scene_info` then report.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_scene_info"]);
});

test("a tool listed in tools: is not reported as missing", () => {
	const source = template("tools: read, blender_scene_info", "Run `blender_scene_info` then report.");
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("tool PARAMETERS are not mistaken for tool names", () => {
	// The narrow scan is the point: a loose rule fires on every camelCase
	// parameter in the prose and the warning becomes noise.
	const source = template("tools: read", "Pass `objectNames` and `saveAfter`, plus `mode`.");
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("the frontmatter's own tools: line is not scanned as body", () => {
	const source = template("tools: read", "text");
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("a plain-prose tool reference is a known, accepted gap", () => {
	// Documented in the source: only backticked names are checked, because a
	// looser rule produces more noise than signal.
	const source = template("tools: read", "Call unity_scene_info for details.");
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("a PROHIBITED tool is not reported as a missing one", () => {
	// The corpus is full of boundaries phrased as tool names, and reporting
	// them is how a check becomes noise: "no `blender_execute_python`" is the
	// critic stating what it may NOT do.
	const cases = [
		template("tools: read", "You never edit anything — no `write`, no `blender_execute_python`."),
		template("tools: read", "You have no `unity_execute_csharp`, and no way to read images."),
		template("tools: read", "Do not call `blender_module_run` under any circumstances."),
		template("tools: read", "Never run `blender_module_revert`."),
		template("tools: read", "there is no `unity_add_reference` tool in this session"),
	];
	for (const source of cases) {
		assert.deepEqual(toolsMissingFromAllowlist(source), [], source);
	}
});

test("an 'instead of' rename reports the REPLACEMENT, not the abandoned one", () => {
	// The prose names two tools and only one of them is wanted. Reading the cue
	// as a boundary for both would hide the tool the agent is actually told to
	// call, which is the finding that matters.
	const source = template("tools: read", "Use `unity_module_run` instead of `unity_execute_csharp`.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["unity_module_run"]);
});

test("a PROHIBITION does not suppress a real instruction on the same line", () => {
	// Clause-scoped, so the boundary earlier in the line cannot cover the
	// instruction after it. Getting this wrong the other way would hide a
	// template that ships broken.
	const source = template("tools: read", "Never use `write`; call `blender_module_run` here.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_module_run"]);
});

test("a real instruction is still reported next to unrelated prose", () => {
	const source = template("tools: read", "You are careful. Call `blender_scene_info` first.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_scene_info"]);
});

test("a prohibition does not erase a real instruction LATER in the prompt", () => {
	// The shape the shipped unity-worker prompt actually has: it says both
	// "you do not need to call `unity_execute_csharp`" and "use
	// `unity_module_run`". First-mention-wins reported the tool the agent is
	// actually told to use, so only an all-mentions-negated rule is right.
	const source = template(
		"tools: read",
		"You do not need to call `unity_module_run`.\nBut if the module fails, call `unity_module_run`.",
	);
	assert.deepEqual(toolsMissingFromAllowlist(source), ["unity_module_run"]);
});

test("a negation on the PREVIOUS line still covers a wrapped mention", () => {
	// Markdown wraps prose, so the shipped unity-worker prompt splits the
	// negation and the name across a line break. Line-scoped negation alone
	// reported the tool and trained the reader to ignore the check.
	const source = template(
		"tools: read",
		"You do not need to save, and you do not need to\ncall `unity_execute_csharp` for this.",
	);
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("a wrapped mention is NOT covered by a negation in a finished sentence", () => {
	// The previous line ends in a period, so that negation is a closed sentence
	// and cannot reach the next one.
	const source = template("tools: read", "You never edit anything.\nCall `blender_module_run`.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_module_run"]);
});

test("a wrapped mention after a clause of its own is still reported", () => {
	const source = template(
		"tools: read",
		"You do not need to save, and you do not need to know anything about the scene at all before you start\ncall `blender_module_run`.",
	);
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_module_run"]);
});

test("bpy API names are not pi tools", () => {
	// The Blender prompts are written against bpy as much as against the tool
	// surface, and the two share the snake_case shape.
	const source = template(
		"tools: read",
		"Set `rotation_euler`, then `bpy.ops.object.shade_auto_smooth` and `transform_apply`.",
	);
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("KNOWN_NON_TOOL_WORDS exempts a snake_case todo status", () => {
	assert.equal(KNOWN_NON_TOOL_WORDS.has("in_progress"), true);
	const source = template("tools: read", "Keep a task `in_progress` until it is done.");
	assert.deepEqual(toolsMissingFromAllowlist(source), []);
});

test("multiple missing tools are all reported", () => {
	const source = template("tools: read", "Call `blender_scene_info` and `unity_bones`.");
	assert.deepEqual(toolsMissingFromAllowlist(source), ["blender_scene_info", "unity_bones"]);
});

test("unresolvedToolProviders reports a prefix whose extension cannot be resolved", () => {
	const source = template("tools: read, blender_scene_info");
	const missing = unresolvedToolProviders(source, (ext) => ext !== "vibe-blender");
	assert.deepEqual(missing, [{ prefix: "blender_", extension: "vibe-blender" }]);
});

test("unresolvedToolProviders is quiet when every extension resolves", () => {
	const source = template("tools: read, blender_scene_info, unity_bones");
	assert.deepEqual(unresolvedToolProviders(source, () => true), []);
});

test("unresolvedToolProviders reads the template, not a hardcoded list", () => {
	// A template using no application tool needs no application extension.
	const seen = [];
	unresolvedToolProviders(template("tools: read, write"), (ext) => {
		seen.push(ext);
		return true;
	});
	// Nothing is resolved lazily for a tool the template does not use.
	assert.deepEqual(seen, []);
});

test("checkTemplate reports a missing allowlist entry", () => {
	const problems = checkTemplate(template("tools: read", "Call `unity_bones`."));
	assert.equal(problems.length, 1);
	assert.match(problems[0], /unity_bones/);
});

test("checkTemplate reports todo with no extensions: line", () => {
	const problems = checkTemplate(template("tools: read, todo"));
	assert.equal(problems.length, 1);
	assert.match(problems[0], /todo/);
});

test("checkTemplate does not report todo when an extensions: line exists", () => {
	assert.deepEqual(checkTemplate(template("tools: read, todo\nextensions: /somewhere")), []);
});

test("checkTemplate reports a surviving placeholder", () => {
	// More than one `extensions:` line means the stamp hit the wrong one, and
	// the installed file would still point at a placeholder path.
	const problems = checkTemplate(
		template("tools: read\nextensions: __PI_AGENT_EXTENSION_DIR__\nextensions: /b"),
	);
	assert.ok(problems.some((p) => /placeholder/.test(p)));
});

test("checkTemplate skips the provider check when no resolver is given", () => {
	const source = template("tools: read, blender_scene_info");
	assert.deepEqual(checkTemplate(source), []);
	assert.equal(checkTemplate(source, { isResolvable: () => false }).length, 1);
});

test("a well-formed template reports nothing", () => {
	const source = template(
		"tools: read, todo, blender_scene_info\nextensions: __PI_AGENT_EXTENSION_DIR__",
		"Call `blender_scene_info` and keep the todo `in_progress`.",
	);
	// The placeholder check is about the STAMPED result, so the raw template is
	// expected to trip it; everything else must be quiet.
	assert.deepEqual(checkTemplate(source).filter((p) => !/placeholder/.test(p)), []);
});
