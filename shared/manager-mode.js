/**
 * Manager mode: the gate that makes the manager role structural rather than
 * advisory.
 *
 * Its own file because the gate is the core's only piece of STATE, and because
 * it is the part with a policy/mechanism seam: the mechanism (engaged flag,
 * child exemption, deny-by-default fallthrough) is identical everywhere, while
 * the refusals are each application's alone.
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
export function createManagerMode({ allowedTools, onGateMessage } = {}) {
	const allowed = new Set(allowedTools ?? []);
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
		// The application's refusals are consulted BEFORE the allowlist, because
		// the allowlist is coarse (a manager is allowed to `read` files) while a
		// refusal is specific (a manager is not allowed to `read` an image, even
		// though `read` is allowed). Checking the allowlist first lets it
		// short-circuit the refusals, which is a silent loss of policy: nothing
		// reports the refusal as unreachable, it just stops firing.
		//
		// `onGateMessage` returning null means "not mine", so an application that
		// has no opinion still falls through to the allowlist and then to the
		// default below. Order, not a flag, is what keeps both halves working.
		const extra = typeof onGateMessage === "function" ? onGateMessage(event) : null;
		if (extra) return extra;
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
	 * Blender manager's three (write/edit, a subagent outside the roster, and
	 * reading an image) are all application-specific and none of them belong
	 * in a shared core. A core that encoded them would carry every
	 * application's policy and answer to none of them.
	 */
	function install(pi) {
		pi.on("tool_call", (event, ctx) => checkToolCall(event, ctx.getSystemPrompt()));
	}

	return { markEngaged, clearGate, isEngaged, isManagerSession, reset, checkToolCall, install };
}

function defaultGateReason(toolName) {
	return (
		`Manager role: \`${toolName}\` is not available to this session. The manager plans, briefs and ` +
		"integrates; the subagents it spawns author and judge. Delegate with the subagent tool, and say " +
		"so in your report if no agent covers a capability you need."
	);
}
