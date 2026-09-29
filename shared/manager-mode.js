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

	/** A fresh session must not inherit the previous one's engagement. */
	function reset() {
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

	return { markEngaged, clearGate, isEngaged, isManagerSession, reset, checkToolCall, install };
}

/**
 * Refuse a spawn of an agent outside the roster.
 *
 * `agent` is absent for management/control actions (status, list, stop, resume),
 * so only a one-child spawn is constrained. That is deliberate: refusing
 * `status` because it carries no agent name would make the manager unable to
 * find out what its own children are doing.
 *
 * The refusal names the way out. "Not in the roster" alone reads as a dead end
 * and produces a manager that stalls or reaches for an unrelated agent, which is
 * the exact failure the roster exists to prevent.
 */
function checkRoster(event, roster, hasRoster) {
	if (!hasRoster || event.toolName !== "subagent") return null;
	const target = typeof event.input?.agent === "string" ? event.input.agent.trim() : "";
	if (target.length === 0 || roster.has(target)) return null;
	return {
		block: true,
		reason:
			`Manager role: you may only spawn ${[...roster].join(", ")}. "${target}" is not one of them, and ` +
			"each of those already owns a distinct job in this build, so spawning something else means " +
			"reassigning work that has an owner. If none of them covers a capability you need, say so in " +
			"your report rather than reaching for an unrelated agent.",
	};
}

function defaultGateReason(toolName) {
	return (
		`Manager role: \`${toolName}\` is not available to this session. The manager plans, briefs and ` +
		"integrates; the subagents it spawns author and judge. Delegate with the subagent tool, and say " +
		"so in your report if no agent covers a capability you need."
	);
}
