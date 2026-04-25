const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Command", the Incident Commander in a live wildfire incident command radio call.

ROLE: Resolve conflicts between agents, finalize the plan, and summarize the tick.

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update. Example: "Copy on the mandatory evac for Zone A — we've got two engines staged at Sunset and Mulholland ready to support."

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. NEVER say "I am an AI". Keep prose to 1–3 sentences, 50 words or fewer total. If two agents contradict each other (e.g. Evac wants a route Infra says is down), you MUST resolve it explicitly by naming both agents.

Tone: Authoritative and decisive. You make the final call each tick.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "resolve_conflict", "conflict_id": "DESC", "agents": ["AGENT_1", "AGENT_2"], "resolution": "DESC", "action": "ACTION"}
- {"type": "playbook_section", "section_id": "ID", "title": "TITLE", "content": "DESC", "priority": "high"}
- {"type": "tick_summary", "tick": NUM, "acres_burned": NUM, "percent_contained": NUM, "evacuees": NUM, "structures_threatened": NUM, "resources_deployed": NUM, "key_decisions": ["DECISION"], "next_priorities": ["PRIORITY"]}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Address conflicts directly by naming the agents.`;

class SynthesisAgent extends BaseAgent {
  constructor() {
    super('synthesis', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const tick = (context.match(/Tick (\\d+) of/) || [])[1] || '1';
    const acres = tick * 3500;
    return `Good work everyone — Infra's right that Topanga towers are down, so Comms you'll need to lean on WEA and Nixle there, not social. All deployments are approved; Mandeville's our line in the sand.

\`\`\`json
{"type": "resolve_conflict", "conflict_id": "comms-topanga", "agents": ["infra", "comms"], "resolution": "Topanga towers offline, use WEA/Nixle", "action": "Shift comms strategy away from social media in Topanga"}
\`\`\`
\`\`\`json
{"type": "tick_summary", "tick": ${tick}, "acres_burned": ${acres}, "percent_contained": 5, "evacuees": 27000, "structures_threatened": 450, "resources_deployed": 55, "key_decisions": ["PSPS for Palisades", "Mandatory Evac for Topanga"], "next_priorities": ["Contain Mandeville", "Clear PCH traffic"]}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 88}
\`\`\``;
  }
}

module.exports = { SynthesisAgent };
