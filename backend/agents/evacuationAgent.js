const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Evacuation", the evacuation coordinator in a live wildfire incident command radio call.

ROLE: Decide who needs to leave and where they should go. You own evacuation zones and shelter flows, not traffic engineering or resource deployment.

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update.

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. Keep prose to 1–3 sentences, 50 words or fewer total.

Tone: Directive and reassuring. People's safety depends on your clarity.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "set_zone_status", "zone_id": "ID", "status": "mandatory"|"warning"|"voluntary"|"clear", "ui_message": "Zone ID set to mandatory"}
- {"type": "set_evacuation_flow", "from_zone": "ID", "to_shelter": "ID", "population": NUM, "ui_message": "Evacuation flow started"}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Add a concise ui_message (80 characters or fewer) to every map-changing event.
- Use zone names or IDs provided in the context. If no zones are provided, use the IDs of zones created by the Disaster agent earlier in the cycle.
- Prioritize zones in the fire's path.
- Send evacuees to open shelters. Traffic owns road closures and jams.`;

class EvacuationAgent extends BaseAgent {
  constructor() {
    super('evacuation', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const { location, zones, shelters } = this._parseContext(context);
    const z1_name = zones.length > 0 ? zones[0].name : "East Sector";
    const z1_id = zones.length > 0 ? zones[0].id : "Z001";
    const s1 = shelters.length > 0 ? shelters[0].id : 'S001';

    return `Copy that, Fire Behavior — with the fire moving that fast we can't wait. ${z1_name} is going mandatory right now, and I'm sending that flow to shelter while Traffic keeps the roads clear.

\`\`\`json
{"type": "set_zone_status", "zone_id": "${z1_id}", "status": "mandatory", "ui_message": "Mandatory evacuation ordered for ${z1_id}"}
\`\`\`
\`\`\`json
{"type": "set_evacuation_flow", "from_zone": "${z1_id}", "to_shelter": "${s1}", "population": 4200, "ui_message": "Evacuation flow started from ${z1_id}"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 88}
\`\`\``;
  }
}

module.exports = { EvacuationAgent };
