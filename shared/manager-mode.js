/**
 * Manager mode: the gate that makes the manager role structural rather than
 * advisory.
 *
 * Its own file because the gate is the core's only piece of STATE, and because
 * it is the part with a policy/mechanism seam: the mechanism (engaged flag,
 * child exemption, deny-by-default fallthrough, roster) is identical
 * everywhere, while the refusals are each application's alone.
 *
 * The roster is here rather than in a consumer because the SAME rule was
 * implemented in one extension and missing from two, and the two that missed it
 * shipped a manager that could spawn a writer and walk straight past the very
 * write refusal it advertises in its own exit command. The list of names is the
 * application's; the rule that only those names may be spawned is not, and a
 * rule that lives next to its only implementation cannot drift from it.
 */

import { readActiveAgentName } from "./session.js";

/**
 * The manager gate.
 *
 * The role exists because the manager's context is the most expensive context
 * in the system. Authoring module code, reading renders, and iterating a mesh
 * are exactly the turns that fill a window with material a worker could have
 * carried and then discarded. The gate does not enforce good judgement; it
 * makes drifting into doing the work yourself require a deliberate act.
 *
 * `allowedTools` is the manager's own read-only kit: text reads (a manager must
 * read agent definitions to write a brief), planning, and the supervisor
 * channel. Everything else — writes, edits, and above all reading images,
 * which are the single most context-expensive thing in the loop — is refused in
 * the manager and permitted everywhere else.
 */
export function createManagerMode({ allowedTools, agentRoster, onGateMessage } = {}) {
	const allowed = new Set(allowedTools ?? []);
	// Only a NON-EMPTY roster constrains spawning. An empty or absent one leaves
	// spawning alone, which is the correct default for a session that is not a
	// manager at all.
	const roster = new Set(agentRoster ?? []);
	const hasRoster = roster.size > 0;
	let engaged = false;
	let gated = false;

	/** Enter manager mode. Called by the engage command and nothing else. */
	function markEngaged() {
		engaged = true;
		gated = true;
	}

	/**
	 * Record that an application tool ran, without gating the session.
	 *
	 * Engagement drives two independent things: the per-turn guidance
	 * injection, and the tool_call gate. They are not the same decision, and
	 * conflating them is what made a `unity_bridge_status` probe cost the
	 * session its `write` and `edit`.
	 *
	 * The guidance is unconditional: a turn that calls a blender_* tool is
	 * working on Blender whatever the session was doing before, and the live
	 * state block is what stops it from acting on a stale selection. The gate is
	 * not: it refuses a manager's writes because a manager's context is the most
	 * expensive in the system and authoring is a worker's job. A session that
	 * never ran `/unity` was handed no task, so it was never a manager and
	 * removing its ability to write is a punishment for making one tool call.
	 *
	 * The split matters most on the read-only tools, which is where it was
	 * actually hit: probing whether the bridge is alive is a question, not a
	 * delegation, and it cost `write`, `edit` and every image read for the rest
	 * of the session — with no way back but a slash command that tells the
	 * model to stop managing.
	 */
	function markUsed() {
		engaged = true;
	}

	/**
	 * Leave the gate, keeping the session and the tools.
	 *
	 * Separate from `engaged` on purpose: the gate otherwise lasts until
	 * /new, which strands a session that interleaves an application with other
	 * work needing a write.
	 */
	function clearGate() {
		if (!gated) return false;
		gated = false;
		return true;
	}

	function isEngaged() {
		return engaged;
	}

	/** Is this a manager SESSION: engaged, and not a subagent inside one. */
	function isManagerSession(systemPrompt) {
		return gated && readActiveAgentName(systemPrompt) === null;
	}

	/**
	 * A fresh session must not inherit the previous one's engagement.
	 *
	 * `reason` is the session_start reason, and "reload" is EXEMPT. A reload
	 * is not a new session: it re-runs the extension's setup against the same
	 * conversation, and the manager prompt the user is still working under is
	 * the cached system prefix that reload does not remove. Clearing the gate
	 * there left a session still behaving as the manager with none of the
	 * enforcement — the allowlist, the write/edit refusal, the image refusal all
	 * silently off, while a blender_execute_python or unity_execute_csharp call
	 * went straight through. A guard that a slash command can switch off is not
	 * a guard, and nothing about the reload told the user it had.
	 *
	 * Every other reason is a genuinely different session (`new`, `fork`,
	 * `resume`), where inheriting would be the bug: the user is no longer
	 * working under the manager prompt that gate was entered for.
	 */
	function reset(reason) {
		if (reason === "reload") return;
		engaged = false;
		gated = false;
	}

	/**
	 * Decide whether a tool call is blocked, or return null to allow it.
	 *
	 * pi's tool_call handler returns `{block: true, reason}` to refuse and
	 * undefined to allow (see ToolCallEvent in pi's
	 * dist/core/extensions/types.d.ts). Returning the refusal OBJECT rather
	 * than a string keeps the reason next to the decision, which is where the
	 * model reads it: a refusal that states the rule but not the way out
	 * produces a manager that stalls rather than one that delegates.
	 */
	function checkToolCall(event, systemPrompt) {
		if (!isManagerSession(systemPrompt)) return null;
		// Order matters here, and it was got wrong first, twice.
		//
		// `onGateMessage` is consulted BEFORE the allowlist, because the
		// allowlist is coarse (a manager is allowed to `read` files) while a
		// refusal is specific (a manager is not allowed to `read` an image, even
		// though `read` is allowed). Checking the allowlist first lets it
		// short-circuit the refusals, which is a silent loss of policy: nothing
		// reports the refusal as unreachable, it just stops firing.
		//
		// The roster is checked in the same place, for the same reason and then
		// some: `subagent` IS on every manager's allowlist, because delegating is
		// the manager's job. Behind the allowlist the roster check is dead code
		// that reads as protection.
		//
		// `onGateMessage` returning null means "not mine", so an application that
		// has no opinion still falls through to the roster, the allowlist, and
		// then the default below. Order, not a flag, is what keeps all of it.
		const extra = typeof onGateMessage === "function" ? onGateMessage(event) : null;
		if (extra) return extra;
		const offRoster = checkRoster(event, roster, hasRoster);
		if (offRoster) return offRoster;
		if (allowed.has(event.toolName)) return null;
		return {
			block: true,
			reason: defaultGateReason(event.toolName),
		};
	}

	/**
	 * Install the gate on a pi instance.
	 *
	 * `onGateMessage` is where an application keeps its own refusals — the
	 * Blender manager's remaining two (write/edit and reading an image) are
	 * both application-specific and neither belongs in a shared core. A core
	 * that encoded them would carry every application's policy and answer to
	 * none of them. The roster is the counter-example: its RULE belongs here,
	 * its NAMES do not.
	 */
	function install(pi) {
		pi.on("tool_call", (event, ctx) => checkToolCall(event, ctx.getSystemPrompt()));
	}

	return { markEngaged, markUsed, clearGate, isEngaged, isManagerSession, reset, checkToolCall, install };
}

/**
 * Refuse a spawn of an agent outside the roster.
 *
 * `agent` is absent for management/control actions (status, list, stop, resume),
 * so only a one-child spawn is constrained. That is deliberate: refusing
 * `status` because it carries no agent name would make the manager unable to
 * find out what its own children are doing.
 *
 * WHICH SHAPE COUNTS is the subtle half. The rule this function exists to
 * enforce is "only these names may be spawned", and an earlier version read the
 * target as `typeof input.agent === "string" ? input.agent.trim() : ""` and
 * allowed anything that came out empty. That let through every `agent` field the
 * core cannot read: `{agent: undefined}`, `{agent: 42}`, `{agents: [...]}`
 * (plural — the field the model guessed), `{agent: {name: "x"}}`, and a call
 * naming neither field at all. Every one of them took the allow-branch, so a
 * caller that guessed the parameter wrong got an unconstrained spawn behind a
 * gate whose whole claim is that the roster cannot drift.
 *
 * So the decision is made on the FIELD, and a control action is identified by
 * `action` rather than by the absence of `agent` — which is what separates "go
 * and look at the children" from "spawn one, but I do not know what this
 * parameter is called".
 *
 * The refusal names the way out. "Not in the roster" alone reads as a dead end
 * and produces a manager that stalls or reaches for an unrelated agent, which is
 * the exact failure the roster exists to prevent.
 *
 * KNOWN LIMIT, deliberately not fixed here: this check runs inside one
 * extension's `tool_call` handler, and pi's ToolCallEvent.input is mutable and
 * "No re-validation is performed after mutation" (pi's
 * dist/core/extensions/types.d.ts). An extension registering AFTER this one can
 * therefore rewrite `input.agent` into an on-roster name after the check passed.
 * Only pi could close that, by validating after every handler has run; no
 * ordering inside this file can. Recorded rather than worked around, because the
 * workaround would be a check that reads as a guarantee it cannot be.
 */
function checkRoster(event, roster, hasRoster) {
	if (!hasRoster || event.toolName !== "subagent") return null;
	const input = event.input ?? {};
	const field = input.agent;
	// A control action carries no agent and says so with `action`: status, list,
	// stop, resume. Refusing `status` because it names no agent would make the
	// manager unable to find out what its own children are doing.
	if (Object.hasOwn(input, "action") && (field === undefined || field === null)) return null;
	// Everything else is a spawn. Including `{agent: undefined}` and
	// `{agent: null}` on their own: `null` is how a schema with
	// `agent: string | null` says "I am not naming one", and a call carrying no
	// `action` key is not managing anything, so the gate cannot tell which.
	if (typeof field !== "string") return unusableSpawn(field, roster);
	const target = field.trim();
	// Whitespace-only is still not an off-roster NAME, and refusing it would
	// break the "let pi choose" spawn a manager legitimately makes. That is the
	// one shape still allowed without being on the roster.
	if (target.length === 0) return null;
	if (roster.has(target)) return null;
	return {
		block: true,
		reason:
			`Manager role: you may only spawn ${[...roster].join(", ")}. "${target}" is not one of them, and ` +
			"each of those already owns a distinct job in this build, so spawning something else means " +
			"reassigning work that has an owner. If none of them covers a capability you need, say so in " +
			"your report rather than reaching for an unrelated agent.",
	};
}

/** Refusal for an `agent` field the core cannot read as a roster name. */
function unusableSpawn(field, roster) {
	const names = [...roster];
	const shown =
		field === null || field === undefined
			? `absent or null (${typeof field})`
			: typeof field === "string"
				? JSON.stringify(field)
				: `${typeof field} ${safeInspect(field)}`;
	return {
		block: true,
		reason:
			`Manager role: a spawn whose \`agent\` field is ${shown} was refused because this gate cannot ` +
			`tell which agent it names, and the manager may only spawn ${names.join(", ")}. Send the agent ` +
			`name as a plain string in \`agent\` — for example \`agent: "${names[0]}"\` — or, if you meant to ` +
			"manage the children rather than spawn one, use the control action (which carries no agent at all).",
	};
}

/** Best-effort short description of an unusable value, never unbounded. */
function safeInspect(value) {
	try {
		const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
		return text.length > 80 ? `${text.slice(0, 80)}…` : text;
	} catch {
		return "(unreadable value)";
	}
}

function defaultGateReason(toolName) {
	return (
		`Manager role: \`${toolName}\` is not available to this session. The manager plans, briefs and ` +
		"integrates; the subagents it spawns author and judge. Delegate with the subagent tool, and say " +
		"so in your report if no agent covers a capability you need."
	);
}
