/**
 * Lazy tool activation: register now, declare to the model only when used.
 *
 * Its own file because, like the gate, it is the one piece of per-session
 * STATE beside the gate, and because it is the second instance of the same
 * policy/mechanism seam: the mechanism (defaultActive:false plus a sticky
 * activation set) is identical in all three extensions, while the set of
 * tool names is each application's alone.
 *
 * The problem it answers: a blender_* tool description reaches the model in
 * every session the extension is installed in, engaged or not, and the three
 * extensions together describe roughly forty thousand characters of tooling
 * most sessions never touch. Declaring a tool costs context in EVERY turn
 * from registration on; running one costs context only once. Registering the
 * tools inert and activating the family at first use converts a constant
 * per-turn tax into a pay-per-use cost with no loss of capability: a session
 * that never engages never sees them, and a session that does loses nothing
 * but the turn in which it engages.
 *
 * Activation is sticky, not per-turn. Once a session has shown it needs the
 * family — by engaging through the command or by calling any one of the
 * tools — the whole family stays declared for the rest of the session. A
 * session is not asked to rediscover, one at a time, the tools an engaged
 * session needs; the manager prompt names the family, and the model reads
 * that prompt, so one activation turns all of it on.
 */

/**
 * The lazy tool gate.
 *
 * One instance per extension. `activate()` is idempotent and sticky: calling
 * it again is a no-op, not a re-declaration. `reset(reason)` mirrors the
 * manager gate's reset — a fresh session inherits nothing, but a "reload"
 * keeps what the session had, because pi's own transcript restore does the
 * same for active tools.
 */
export function createLazyToolGate({ toolNames, isEngaged } = {}) {
	const names = [...toolNames ?? []];
	const lazy = new Set(names);
	let active = false;

	/** Are the tools currently declared to the model? */
	function isActive() {
		return active;
	}

	/**
	 * Declare the whole family, if not already declared. Idempotent.
	 *
	 * Returns true when this call flipped the family on, so the caller can
	 * tell "activated now" from "was already active" — the engage command
	 * reports differently in each case.
	 */
	function activate(ctx) {
		if (active || !ctx || typeof ctx.setActiveTools !== "function") return false;
		const current = ctx.getActiveTools?.() ?? [];
		// Merge, never replace: the session may already carry tools the model
		// is using, and replacing the loadout with the family alone would
		// strip them mid-turn.
		const merged = [...new Set([...current, ...names])];
		ctx.setActiveTools(merged);
		active = true;
		return true;
	}

	/**
	 * Should this tool_call event wake the family up? Only when the family
	 * is inert and the call names one of its tools; install() further skips
	 * tools the session already declares, so a child scoped by an allowlist
	 * is not expanded.
	 */
	function shouldActivateOnCall(event) {
		return !active && lazy.has(event?.toolName);
	}

	/**
	 * Fresh-session handling, mirroring the manager gate's reset semantics.
	 *
	 * A "reload" is the same session re-reading its files; everything it had
	 * stays. Any other reason is a new session, which inherits nothing — the
	 * tools return to inert until this session again shows it needs them.
	 */
	function reset(reason) {
		if (reason === "reload") return;
		active = false;
	}

	/**
	 * The lifecycle half of the contract.
	 *
	 * session_start is deliberately NOT registered here: the extension's own
	 * session_start handler already calls reset alongside the manager gate's,
	 * in the same place and the same order for both gates, and a second
	 * registration would only split that decision across two files.
	 */
	function install(pi) {
		// A call reaching an inert tool means something bypassed declaration —
		// a child allowlist, a direct --tools invocation, or a transcript from
		// before the gate. Wake the family. But if the called tool is ALREADY
		// declared, the caller chose exactly what it wanted (that is how child
		// sessions are scoped), and expanding their loadout to the whole family
		// would undo the scoping their allowlist just did.
		pi.on("tool_call", (event, ctx) => {
			if (!active || !lazy.has(event?.toolName)) return;
			const current = ctx?.getActiveTools?.() ?? [];
			if (current.includes(event.toolName)) return;
			activate(ctx);
		});

		if (isEngaged) {
			// An engaged session (resumed, or engaged before the handler ran)
			// re-arms at the next turn boundary.
			pi.on("before_agent_start", (event, ctx) => {
				if (!active && isEngaged()) activate(ctx);
			});
		}
	}

	return { isActive, activate, shouldActivateOnCall, reset, install };
}
