/**
 * The engage and exit commands every manager registers.
 *
 * Its own file because the argument handling and the delivery decision are the
 * easiest part of a manager extension to get subtly wrong, and getting them
 * wrong looks like nothing at all: a command that ran the build itself would
 * put the manager's first turn outside the manager prompt's own gate, and a
 * mis-delivered task either interleaves ahead of queued work or disappears.
 */

/**
 * Register an application's engage command.
 *
 * One shape for all of them, because the arguments are the user's prompt and
 * the delivery is the part that is easy to get subtly wrong. The task is sent
 * as a user message, not executed: a command that ran the build itself would
 * put the manager's first turn outside the manager prompt's own gate.
 *
 * `steer` when the session is busy, undefined when idle. That distinction is the
 * whole of `deliverAs`: a steer message interrupts the current turn, so sending
 * one to an idle session can interleave it ahead of work already queued, while
 * sending nothing to a busy session silently drops the task.
 */
export function registerEngageCommand(pi, { name, description, usage, engagedMessage, onEngage, fallbackTask, getArgumentCompletions }) {
	pi.registerCommand(name, {
		description: description ?? `Send a task — everything after /${name} is the prompt`,
		// Forwarded, not reimplemented: pi's autocomplete hook takes the raw
		// prefix and returns null to mean "no suggestions", so the core cannot
		// improve on it and must not wrap it, or a `null` would become `[]` and
		// pi would render an empty suggestion list where it renders none.
		...(getArgumentCompletions ? { getArgumentCompletions } : {}),
		async handler(args, ctx) {
			const task = String(args ?? "").trim();
			if (!task && !fallbackTask) {
				ctx.ui.notify(`Usage: /${name} ${usage ?? "<what to build or change>"}`, "info");
				return;
			}
			if (onEngage) onEngage();
			ctx.ui.notify(engagedMessage ?? `Engaged — this session is the manager.`, "info");
			pi.sendUserMessage(task || fallbackTask, { deliverAs: ctx.isIdle() ? undefined : "steer" });
		},
	});
}

/**
 * Register the matching exit command: lift the gate, keep everything else.
 *
 * `onExit` DEFAULTS TO `() => false`, not to success. With no `onExit` there is
 * no gate to lift, so the honest report is "there was nothing to exit" -- and
 * reporting a successful exit for a session that was never engaged is a
 * notification the model then goes on to act on, believing it has left a role
 * it was never in. The default is the refusing one because every consumer
 * passes a real `onExit` (a `clearGate()` returning whether it had anything to
 * clear), so the default only fires on a caller bug -- and a bug should read as a
 * refusal the caller notices, not as a success nobody does.
 */
export function registerExitCommand(pi, { name, description, notEngagedMessage, exitedMessage, onExit = () => false }) {
	pi.registerCommand(name, {
		description: description ?? `Leave manager mode — lift the write/edit/image gate`,
		async handler(_args, ctx) {
			const cleared = typeof onExit === "function" ? onExit() : false;
			if (!cleared) {
				ctx.ui.notify(notEngagedMessage ?? "Not in manager mode — nothing to exit.", "info");
				return;
			}
			ctx.ui.notify(exitedMessage ?? "Left manager mode. The session and the tools are still available.", "info");
		},
	});
}
