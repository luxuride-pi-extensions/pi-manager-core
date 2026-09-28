/**
 * The shared core of the manager-mode extensions.
 *
 * Plain ESM JavaScript, deliberately, not TypeScript. Every consumer here is
 * loaded by pi's jiti runtime, but a consumer that reaches this core does so
 * with a bare `import()` of a resolved path, and Node cannot import a `.ts`
 * file without a transform it will not perform. Shipping `.js` with a
 * hand-written `.d.ts` next to it means the import works in a bare checkout, an
 * installed symlink, and a production session alike, with no build step and no
 * second jiti instance.
 *
 * What lives here is only what all three extensions genuinely do the same way.
 * Application-specific behaviour stays in the application: this file knows about
 * a manager GATE and a `/command`, not about Blender, Unity, or geometry.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/* ------------------------------------------------------------------ paths -- */

/** The XDG cache root, so a sandboxed or immutable $HOME does not break IO. */
export function xdgCacheHome() {
	return process.env.XDG_CACHE_HOME?.trim() || join(homedir(), ".cache");
}

/** Expand a leading `~`; resolve a relative path against `cwd`. */
export function expandUserPath(raw, cwd = process.cwd()) {
	const value = String(raw).trim();
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return homedir() + value.slice(1);
	return isAbsolute(value) ? value : resolve(cwd, value);
}

/**
 * Where pi keeps its agent directory, which is where extensions are installed.
 *
 * Overridable for the same reason the install scripts take PI_AGENT_DIR: a test
 * harness and a non-default pi home both need to point somewhere else, and a
 * hardcoded ~/.pi would read a real installation's files instead.
 */
export function getPiAgentDir() {
	const override = process.env.PI_AGENT_DIR?.trim();
	if (override) return expandUserPath(override);
	return join(homedir(), ".pi", "agent");
}

/**
 * The directory of an installed extension, by the name pi installs it under.
 *
 * Keyed by install name rather than by checkout path, so a symlinked
 * development install resolves the same as a real one.
 */
export function getInstalledExtensionDir(name) {
	return join(getPiAgentDir(), "extensions", name);
}

/* ---------------------------------------------------------------- prompts -- */

/**
 * Strip an agent template's frontmatter.
 *
 * `tools:` and `extensions:` are a SPAWNABLE child's contract. A manager
 * command session is not a child: it gets its tools from the extensions already
 * running in it, so a stray `tools:` line in a system prompt is inert at best
 * and actively misleading at worst — it advertises a capability the session
 * does not have and names a file the user cannot see.
 */
export function stripFrontmatter(source) {
	return String(source ?? "").replace(/^---[\s\S]*?\n---\n/, "").trim();
}

/**
 * Read a prompt file, or return a sentence naming the failure.
 *
 * Loud degradation is the contract, because every silent alternative is worse.
 * A manager whose prompt failed to load still spawns workers, still briefs
 * them, and briefs them from generic guidance — the user learns about the
 * missing prompt by paying for iterations, not by being told.
 */
export function readPromptFile(path, role) {
	try {
		const body = stripFrontmatter(readFileSync(path, "utf8"));
		if (!body) throw new Error("the file is empty after its frontmatter was stripped");
		return body;
	} catch (error) {
		return (
			`The ${role} prompt could not be read from ${path}, so this session is missing that half of ` +
			`its instructions (${error instanceof Error ? error.message : String(error)}). ` +
			"Say so plainly when the task touches that side; do not fall back to guessing at its " +
			"loops, its agents, or its acceptance rules."
		);
	}
}

/** True when `readPromptFile` degraded, so a caller can log it once. */
export function isDegradedPrompt(text) {
	return typeof text === "string" && text.includes("could not be read from");
}

/**
 * Compose one manager prompt out of a connector prompt and any number of side
 * prompts, each under a provenance header.
 *
 * The header is load-bearing, not decoration. Every side prompt opens by
 * declaring the reader to be that side's MANAGER and then defines its own loop,
 * agent roster and nesting rules. Appended verbatim into a third manager, that
 * reads as several competing managers, and which one wins depends on which
 * section the model attends to last. Each header therefore states three things:
 * this is the SIDE's procedure rather than a second manager, this session is
 * the manager of all of them, and the connector above wins wherever the two
 * disagree — because it is the only part written knowing about the other sides
 * exist.
 *
 * Sections are included WHOLE rather than summarized. A constant system-prompt
 * section is the cached prefix, so its size is billed roughly once per session
 * and near-free on every turn after, while a lossy paraphrase of a side's loop
 * is exactly the stale procedure the header above warns against.
 *
 * Sides are read from the INSTALLED extension at runtime, never copied in. A
 * copy in the composing extension goes stale silently and looks authoritative
 * while doing it, which is the one failure a shared core exists to prevent.
 */
export function composeManagerPrompt({ connectorPath, connectorRole, sides = [] }) {
	const parts = [readPromptFile(connectorPath, connectorRole)];
	for (const side of sides) {
		const dir = side.extensionDir ?? getInstalledExtensionDir(side.extension);
		const sections = [readPromptFile(join(dir, side.primary), `${side.label} manager`)];
		if (side.extra) sections.push(readPromptFile(join(dir, side.extra), `${side.label} exchange contract`));
		parts.push(
			[
				`# ---- ${side.label} manager prompt (from the ${side.extension} extension) ----`,
				"",
				"Everything below this line is the procedure that side's own manager uses, read from the",
				`installed ${side.extension} extension at runtime so it cannot drift from it. Read it as that`,
				"SIDE's procedure, not as a second manager: this session is the manager of every side,",
				"and the connector prompt above — which is the only part written knowing about the",
				"other applications — wins wherever the two disagree. The side prompt names agents you",
				"may spawn, tools you may call, and the acceptance rules for work on that side; all of",
				"those apply here unchanged.",
				"",
				sections.join("\n\n"),
			].join("\n"),
		);
	}
	return parts.join("\n\n");
}

/* ---------------------------------------------------------- manager mode -- */

/**
 * The stamp pi-subagents writes into a CHILD's system prompt.
 *
 * A child is not the manager even when the parent is, and the only way to tell
 * them apart at tool-call time is this tag: the parent's own system prompt
 * never carries it. Two copies of this regex existed in the extensions and
 * disagreed on whether they captured the name; the capture is kept because one
 * caller needs the name itself.
 */
export const CHILD_AGENT_PROMPT_PATTERN = /<active_agent\s+name="([^"]*)"/;

/** The child's agent name, or null when this is not a child session. */
export function readActiveAgentName(systemPrompt) {
	const match = CHILD_AGENT_PROMPT_PATTERN.exec(systemPrompt ?? "");
	return match ? match[1] : null;
}

/**
 * Manager mode: the gate that makes the manager role structural rather than
 * advisory.
 *
 * The role exists because the manager's context is the most expensive context
 * in the system. Authoring module code, reading renders, and iterating a mesh
 * are exactly the turns that fill a window with material a worker could have
 * carried and then discarded. The gate does not enforce good judgement; it makes
 * drifting into doing the work yourself require a deliberate act.
 *
 * `allowedTools` is the manager's own read-only kit: text reads (a manager must
 * read agent definitions to write a brief), `bash`, planning, and the
 * supervisor channel. Everything else — writes, edits, and above all reading
 * images, which are the single most context-expensive thing in the loop — is
 * refused in the manager and permitted everywhere else.
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
		if (allowed.has(event.toolName)) return null;
		const extra = typeof onGateMessage === "function" ? onGateMessage(event) : null;
		if (extra) return extra;
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

/* ------------------------------------------------------ context injection -- */

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
 * rule, and the failure text are the same everywhere and are not options.
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
		if (staticContent !== null) {
			return { message: { customType, content: staticContent, display: true } };
		}

		// Rule 2: the snapshot is the parent's, so a child never gets it.
		if (readActiveAgentName(event.systemPrompt) !== null) return undefined;

		let content;
		try {
			content = formatState(await fetchState(ctx), { timeoutMs, extraGuidance });
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
					`${timeoutMs} ms: ${error instanceof Error ? error.message : String(error)}).`,
				`Do NOT assume any ${assumeNothingAbout} from earlier turns.`,
				recover,
			].join("\n");
		}

		if (!content || content.trim().length === 0) return undefined;
		return { message: { customType, content, display: true } };
	};
}

/* -------------------------------------------------------------- commands -- */

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
 */
export function registerExitCommand(pi, { name, description, notEngagedMessage, exitedMessage, onExit }) {
	pi.registerCommand(name, {
		description: description ?? `Leave manager mode — lift the write/edit/image gate`,
		async handler(_args, ctx) {
			const cleared = onExit ? onExit() : true;
			if (!cleared) {
				ctx.ui.notify(notEngagedMessage ?? "Not in manager mode — nothing to exit.", "info");
				return;
			}
			ctx.ui.notify(exitedMessage ?? "Left manager mode. The session and the tools are still available.", "info");
		},
	});
}
