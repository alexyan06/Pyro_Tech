const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Traffic", the Traffic & Congestion Manager in a live wildfire incident command radio call.

ROLE: Keep evacuation roads usable. You own congestion, jams, route closures, and reopenings. You do not issue evacuation orders or deploy resources.

You are joining a group radio call. Start your response by acknowledging the evacuation coordinator's last decision, then give your traffic assessment.

Example opening: "Copy Evac — Route 2 is already filling up, I'm pushing everyone onto I-5 South."

Speak in plain English. Keep prose to 1–3 sentences, 50 words or fewer total. Sound like a real dispatcher. NEVER say "I am an AI".

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences — emit only what applies:
- {"type": "traffic_jam", "route_id": "ID", "severity": "extreme"|"high"|"moderate", "ui_message": "Traffic jam on ID"}
- {"type": "close_route", "route_id": "ID", "reason": "gridlock"|"fire_crossing"|"traffic", "ui_message": "Route ID closed"}
- {"type": "open_route", "route_id": "ID", "ui_message": "Route ID reopened"}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Add a concise ui_message (80 characters or fewer) to every map-changing event.
- Only reference route IDs that appear in the simulation context.
- Issue traffic_jam for any route at or above 90% load.
- Reroute vehicles to alternate open routes with available capacity.
- If all routes are clear, say so briefly and emit a high confidence score.`;

class CongestionAgent extends BaseAgent {
  constructor() {
    super('traffic', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const congestionLine = context.match(/Route congestion: (.*)/)?.[1] || '';
    const congestionEntries = congestionLine
      .split(', ')
      .map((entry) => {
        const match = entry.match(/^([^:]+):\s+(\w+)\s+\((\d+)%\)$/);
        if (!match) return null;
        return {
          routeId: match[1],
          status: match[2],
          loadPct: Number(match[3]),
        };
      })
      .filter(Boolean);

    const jammed = congestionEntries
      .filter((entry) => entry.status === 'congested' && entry.loadPct >= 90)
      .sort((a, b) => b.loadPct - a.loadPct)[0];

    if (!jammed) {
      return `Traffic is moving on the open routes right now. I don't have a sustained gridlock that justifies another closure.

\`\`\`json
{"type": "agent_confidence", "score": 95}
\`\`\``;
    }

    const severity = jammed.loadPct >= 140 ? 'extreme' : jammed.loadPct >= 110 ? 'high' : 'moderate';
    return `${jammed.routeId} is the main choke point now. I'm flagging the backup and keeping other lanes available instead of forcing another closure.

\`\`\`json
{"type": "traffic_jam", "route_id": "${jammed.routeId}", "severity": "${severity}", "ui_message": "Traffic jam detected on ${jammed.routeId}"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 92}
\`\`\``;
  }
}

module.exports = { CongestionAgent };
