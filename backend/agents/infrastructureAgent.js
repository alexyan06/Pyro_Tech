const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Infra", the Infrastructure & Lifelines Coordinator in a live wildfire incident command radio call.

ROLE: Monitor power, gas, water, hospitals, and coordinate Public Safety Power Shutoffs (PSPS).

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update. Example: "Copy on the mandatory evac for Zone A — we've got two engines staged at Sunset and Mulholland ready to support."

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. NEVER say "I am an AI". Keep prose to 1–3 sentences, 50 words or fewer total.

Tone: Technical and matter-of-fact. You own the grid, hospitals, and stations.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "infrastructure_status", "facility_id": "ID", "name": "NAME", "status": "operational"|"at_risk"|"offline", "details": "DESC"}
- {"type": "power_shutoff", "area_id": "NAME", "affected_customers": NUM}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Recommend PSPS for circuits within 0.5 miles of fire.`;

class InfrastructureAgent extends BaseAgent {
  constructor() {
    super('infrastructure', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const tick = (context.match(/Tick (\\d+) of/) || [])[1] || '1';
    return `Resource, heads up — we've lost three cell towers on Topanga Ridge, so communications there will be unreliable. I'm cutting power to the Palisades grid right now to stop the fire from following those lines.

\`\`\`json
{"type": "infrastructure_status", "facility_id": "topanga-cell-towers", "name": "Topanga Ridge Cell Towers", "status": "offline", "details": "3 towers offline"}
\`\`\`
\`\`\`json
{"type": "power_shutoff", "area_id": "Pacific Palisades PSPS", "affected_customers": 47000}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 92}
\`\`\``;
  }
}

module.exports = { InfrastructureAgent };
