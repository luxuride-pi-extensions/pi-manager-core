/**
 * Telling a child subagent apart from a manager session.
 *
 * Its own file because it is the one piece of the core that answers a question
 * about pi itself rather than about managers: pi-subagents stamps an
 * `<active_agent name="...">` tag into a CHILD's system prompt, and the parent's
 * prompt never carries it. That tag is the only signal available at tool-call
 * time, and getting it wrong in either direction is expensive — treat a worker
 * as a manager and it is refused tools it legitimately needs; treat a manager as
 * a worker and the gate never applies at all.
 */

/**
 * The stamp pi-subagents writes into a CHILD's system prompt.
 *
 * Two copies of this regex existed in the extensions and disagreed on whether
 * they captured the name; the capture is kept because one caller needs the name
 * itself.
 */
export const CHILD_AGENT_PROMPT_PATTERN = /<active_agent\s+name="([^"]*)"/;

/** The child's agent name, or null when this is not a child session. */
export function readActiveAgentName(systemPrompt) {
	const match = CHILD_AGENT_PROMPT_PATTERN.exec(systemPrompt ?? "");
	return match ? match[1] : null;
}
