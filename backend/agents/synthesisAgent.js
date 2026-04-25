const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Incident Command", the incident commander in a live wildfire incident command radio call.

ROLE: Make the final coordinated decision each tick. Summarize Fire Behavior, Evacuation, Traffic, and Resources in one clear command decision.

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update. Example: "Copy on the mandatory evac for Zone A — we've got two engines staged at Sunset and Mulholland ready to support."

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. NEVER say "I am an AI". Keep prose to 1–3 sentences, 50 words or fewer total. If two agents contradict each other (e.g. Evac wants a route Infra says is down), you MUST resolve it explicitly by naming both agents.

Tone: Authoritative and decisive. You make the final call each tick.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "resolve_conflict", "conflict_id": "DESC", "agents": ["AGENT_1", "AGENT_2"], "resolution": "DESC", "action": "ACTION"}
- {"type": "playbook_section", "section_id": "ID", "title": "TITLE", "content": "DESC", "priority": "high", "ui_message": "Command plan updated"}
- {"type": "tick_summary", "tick": NUM, "acres_burned": NUM, "percent_contained": NUM, "evacuees": NUM, "structures_threatened": NUM, "resources_deployed": NUM, "key_decisions": ["DECISION"], "next_priorities": ["PRIORITY"], "ui_message": "Incident command updated"}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Add a concise ui_message (80 characters or fewer) to every map-changing or playbook event.
- Address conflicts directly by naming the agents.`;

class SynthesisAgent extends BaseAgent {
  constructor() {
    super('synthesis', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const { location, tick, zones, routes } = this._parseContext(context);
    const z1 = zones[0]?.name || 'the primary zone';
    const r1 = routes[0]?.name || 'main arteries';
    const acres = Number(context.match(/- Fire: ([\d,]+) acres burned/)?.[1]?.replace(/,/g, '')) || 0;
    const evacuees = Number(context.match(/- Total evacuees: ([\d,]+)/)?.[1]?.replace(/,/g, '')) || 0;

    return `Good work everyone — Fire Behavior has the threat area, Evacuation has people moving, Traffic is watching the roads, and Resources are approved. Keep the priority on life safety and holding the line at ${location}.

\`\`\`json
{"type": "playbook_section", "section_id": "command-${tick}", "title": "Incident Command Decision", "content": "Prioritize evacuation from ${z1}, keep ${r1} monitored, and approve resource deployments near ${location}.", "priority": "high", "ui_message": "Incident command plan updated"}
\`\`\`
\`\`\`json
{"type": "tick_summary", "tick": ${tick}, "acres_burned": ${acres}, "percent_contained": 5, "evacuees": ${evacuees}, "structures_threatened": 450, "resources_deployed": 55, "key_decisions": ["Mandatory evacuation for ${z1}", "Resources approved near ${location}"], "next_priorities": ["Protect life safety", "Hold fire edge", "Keep ${r1} moving"], "ui_message": "Command summary updated"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 88}
\`\`\``;
  }
}

module.exports = { SynthesisAgent };
