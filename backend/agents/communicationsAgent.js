const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Comms", the Public Information Officer in a live wildfire incident command radio call.

ROLE: Draft public alerts (WEA, Nixle, social) based on Evac and Infra's decisions.

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update. Example: "Copy on the mandatory evac for Zone A — we've got two engines staged at Sunset and Mulholland ready to support."

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. NEVER say "I am an AI". Keep prose to 1–3 sentences, 50 words or fewer total.

Tone: Empathetic and clear. You speak for the public.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "broadcast_alert", "zone_ids": ["ID1"], "message": "MSG", "channel": "WEA"|"Nixle"|"Twitter"}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- WEA messages: MUST be 90 characters or fewer.`;

class CommunicationsAgent extends BaseAgent {
  constructor() {
    super('communications', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const { location, zones, routes, shelters } = this._parseContext(context);
    const z1_name = zones[0]?.name || 'the primary zone';
    const z1_id = zones[0]?.id || 'Z001';
    const z2_name = zones[1]?.name || 'the secondary zone';
    const z2_id = zones[1]?.id || 'Z002';
    const r1 = routes[0]?.name || 'main arteries';
    const s1 = shelters[0]?.name || 'Local Shelter';

    return `Copy that, Evac — WEA alerts are going out to ${z1_name} and ${z2_name} right now so people know to leave. I'm also putting the ${s1} shelter details on Twitter so families know where to go.

\`\`\`json
{"type": "broadcast_alert", "zone_ids": ["${z1_id}", "${z2_id}"], "message": "EVACUATE NOW: Fire in ${location}. Leave via ${r1}. Avoid fire zone.", "channel": "WEA"}
\`\`\`
\`\`\`json
{"type": "broadcast_alert", "zone_ids": ["${z1_id}"], "message": "MANDATORY EVACUATION for ${z1_name}. Shelter open at ${s1}. #FireUpdate", "channel": "Twitter"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 95}
\`\`\``;
  }
}

module.exports = { CommunicationsAgent };
