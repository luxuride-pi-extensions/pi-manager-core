/**
 * The per-turn live-state snapshot, injected as its own message.
 *
 * Its own file because it carries the core's three load-bearing ordering rules,
 * and each of them was re-derived separately in three extensions before being
 * shared. They are documented on the function below where the rules are, and
 * this file exists so the rules are read together rather than found by search.
 */

import { readActiveAgentName } from "./session.js";
import { STATIC_TEXT_BUDGET, clampText, fenceUntrusted } from "./untrusted.js";

/**
 * How an error is reported inside the UNAVAILABLE notice, bounded.
 *
 * UNTRUSTED INPUT. An `Error.message` here is whatever the bridge process put
 * there — a subprocess reading a socket can be answered with bytes an
 * attacker-influenced input produced — and it lands in a message injected into
 * the model's context every turn it fails. So it is truncated to
 * ERROR_TEXT_BUDGET and fenced with a label that says it is data, not
 * instructions. See shared/untrusted.js for why that is the honest subset and
 * not a sanitiser.
 */
function describeCause(error) {
	const cause = error instanceof Error ? error.message : String(error);
	return `; the bridge said:\n\n${fenceUntrusted(cause)}`;
}

/**
 * The per-turn live-state snapshot, injected as its own message.
 *
 * This is the one part of a manager's context that is NOT constant, and it is
 * the part that decides whether a manager edits the object the user is looking
 * at. Three rules are load-bearing and all three were re-derived in each
 * extension before they were shared:
 *
 *   1. The constant prompt is a SYSTEM SECTION, the snapshot is a MESSAGE. A
 *      constant system section is the cached prefix, so it is billed once and
 *      diffed by pi per run; appending it as a message would re-send it every
 *      turn. The snapshot cannot be a section because it changes every turn,
 *      and a changing section defeats the caching above.
 *   2. A CHILD gets the section but not the snapshot. The snapshot describes
 *      the PARENT's selection and viewport, and a worker's brief already names
 *      the objects it owns. Injecting it points the worker at its own empty
 *      selection — the deictic framing reads as truth and is wrong.
 *   3. A FAILED fetch injects a loud "state is unavailable, do not assume",
 *      never an empty string. An empty snapshot is indistinguishable from "no
 *      state to inject", and the manager then proceeds on stale assumptions
 *      about what is selected — the failure that costs a rebuild.
 *
 * An application supplies only what is genuinely its own: the section name, the
 * message's custom type, the fetch, and the timeout. The ordering, the child
 * rule, the timeout itself and the failure text are the same everywhere and are
 * not options. `timeoutMs` is enforced HERE rather than left to the caller, so a
 * consumer that passes a bare `fetchState` still gets the documented notice at
 * the documented time.
 */
export function createContextInjection({
	section,
	customType,
	timeoutMs = 30_000,
	shouldInject,
	getPrompt,
	fetchState,
	formatState,
	/**
	 * Fixed text injected as the per-turn message, with no fetch at all.
	 *
	 * For the manager that drives two applications at once: its live state
	 * arrives from ONE tool call that reports both sides, so there is nothing
	 * to prefetch, and prefetching a second time would spend a bridge round
	 * trip restating what a tool call the guidance already names will return.
	 * The guidance is constant, and a constant message is re-sent every turn,
	 * which is why it stays short here and the long form belongs in the system
	 * section.
	 *
	 * Mutually exclusive with fetchState, and the check is a throw rather than
	 * a silent branch: a caller passing both has a bug, and quietly honouring
	 * one of them is how it survives.
	 */
	staticContent = null,
	/**
	 * Whether a CHILD session also receives the system-prompt section.
	 *
	 * Default true, which is the core's rule: the constant prompt is what tells
	 * a subagent which side of the bridge it is on, and withholding it is how a
	 * worker ends up acting on the parent manager's instructions.
	 *
	 * The two-application manager sets this false, and the difference is not
	 * incidental. Its workers are spawned with their own agent definitions that
	 * already state the side they are on, and its manager prompt is the
	 * connector's own instructions rather than a side's procedure — so the
	 * argument for handing it to a child does not apply there. Recorded as an
	 * option because the honest version of "unify this" is a shared mechanism
	 * with the real differences named, not one behaviour applied to three
	 * managers until it breaks one.
	 */
	sectionReachesChildren = true,
	extraGuidance = () => [],
	failureGuidance,
	assumeNothingAbout = "selection, active object, viewport, or camera state",
}) {
	if (staticContent !== null && fetchState) {
		throw new Error(
			`createContextInjection("${section}"): pass staticContent or fetchState, not both. ` +
				"Static content is injected verbatim, so a fetch would be paid for and discarded.",
		);
	}
	return async function injectContext(event, ctx) {
		// Never inject into a session that has not engaged. A tool call is not
		// engagement: a plain session calling a blender_* tool is doing
		// worker-level work, and handing it the manager prompt would make it
		// believe it is a manager.
		if (shouldInject && !shouldInject()) return undefined;

		// The constant prompt first, unconditionally (including for children):
		// it is what teaches a subagent which side of the bridge it is on.
		if (sectionReachesChildren || readActiveAgentName(event.systemPrompt) === null) {
			if (event.systemPromptOptions?.sections) event.systemPromptOptions.sections[section] = getPrompt();
		}

		// Static path: no snapshot rule, no failure rule, nothing to fetch.
		//
		// Clamped because a CONSTANT message is re-sent every turn in every
		// session that loads this extension, so an unbounded one is the cheapest
		// possible context bloat: it is not noticed in any single turn and it is
		// paid for in every one. An 8 KB ceiling is far above what any consumer
		// sends today, so this is a bound and not a policy.
		if (staticContent !== null) {
			return {
				message: {
					customType,
					content: clampText(staticContent, STATIC_TEXT_BUDGET),
					display: true,
				},
			};
		}

		// Rule 2: the snapshot is the parent's, so a child never gets it.
		if (readActiveAgentName(event.systemPrompt) !== null) return undefined;

		let content;
		try {
			// The core races its OWN timer around the fetch, because
			// `timeoutMs` is documented as bounding "the fetch, and the timeout"
			// and previously did not: it was interpolated into the failure TEXT
			// and handed to formatState, and nothing ever enforced it. A consumer
			// whose fetchState had no timeout of its own therefore hung the whole
			// turn — no snapshot, no UNAVAILABLE notice, and a manager waiting on
			// a bridge that will never answer. That is latent today (pi-unity
			// wraps in withTimeout, pi-blender passes its own) precisely because
			// every current consumer happens to be careful, and a shared chokepoint
			// whose documented guarantee holds only because its callers are
			// correct is not a guarantee.
			//
			// The race does not cancel the underlying work — nothing here can, and
			// pretending otherwise would be a lie. It stops WAITING for it, which
			// is the half that matters: the turn completes with the loud notice.
			content = formatState(await withTimeout(fetchState(ctx), timeoutMs, section), { timeoutMs, extraGuidance });
		} catch (error) {
			// Rule 3: never swallow. The message names the timeout, refuses to
			// let the manager trust earlier turns, and names the tool to retry.
			//
			// The recovery sentence is the application's, not the core's: each
			// side has a DIFFERENT tool to call, and a notice naming
			// `blender_session_context` is useless in a Unity manager. Only the
			// recovery line is delegated — the "do not assume" half is the same
			// everywhere and is the half that stops the wrong mutation.
			const recover =
				typeof failureGuidance === "function"
					? failureGuidance(error)
					: "Call the session-context tool before mutating anything, and ask the user if it also fails.";
			content = [
				`Live ${section} state is UNAVAILABLE for this turn (the bridge did not answer within ` +
					`${timeoutMs} ms${describeCause(error)}).`,
				`Do NOT assume any ${assumeNothingAbout} from earlier turns.`,
				recover,
			].join("\n");
		}

		if (!content || content.trim().length === 0) return undefined;
		return { message: { customType, content, display: true } };
	};
}

/**
 * Reject with a named error once `promise` has not settled in `ms`.
 *
 * The timer is cleared once the race settles, so a fast success never leaves one
 * pending — which is the reason NOT to `unref()` it. An unref'd timer does not
 * keep the loop alive, and therefore does not FIRE when the fetch is the only
 * thing in flight: the guard would silently stop guarding, and the hang this
 * exists to prevent would come back, only on a turn quiet enough to expose it.
 * Clearing on settle is sufficient for the lifetime problem, and it does not
 * weaken the guard.
 *
 * The message reaches the model inside the UNAVAILABLE notice, which is why it
 * is written to be read there.
 *
 * `ms` of 0 or less disables the race. That is not a documented feature, it is
 * the escape hatch for a caller that genuinely wants no bound, and it is not
 * the default — the default is 30s.
 */
function withTimeout(promise, ms, section) {
	if (!Number.isFinite(ms) || ms <= 0) return promise;
	let timer;
	const guard = new Promise((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`the ${section} state fetch did not answer within ${ms} ms`)),
			ms,
		);
	});
	return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}
