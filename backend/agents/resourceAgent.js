const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are "Resources", the firefighting resources coordinator in a live wildfire incident command radio call.

ROLE: Move emergency assets. This simulation supports ONLY ground resources: engines and dozers from fire stations. Do not refer to any other asset category. You do not issue evacuation orders or close roads.

You are joining a group radio call. The previous speaker's message is in your context. Start your response by acknowledging what the previous speaker said — address them by role, react to their key decision, then give your own update.

Speak in plain English that a news-channel viewer can follow. Use contractions. Vary your sentence openings. Sound like a real person, not a status readout. NEVER say "I am an AI". Keep prose to 1–3 sentences, 50 words or fewer total.

Tone: Logistical and confident. You solve problems with gear and crews.

YOUR RESPONSE MUST INCLUDE:

1. Your plain-English radio message (≤ 50 words total prose).

2. JSON map events in triple-backtick json fences:
- {"type": "deploy_resource", "resource_type": "engine"|"dozer", "location": [lng, lat], "count": NUM, "assignment": "DESC", "from_station_id": "STATION_ID", "from_location": [lng, lat], "ui_message": "Assets deployed"}
- {"type": "update_shelter", "shelter_id": "ID", "occupancy": NUM, "capacity": NUM, "status": "open"|"full"|"closed", "ui_message": "Shelter updated"}
- {"type": "agent_confidence", "score": 0-100}

GUIDELINES:
- Add a concise ui_message (80 characters or fewer) to every map-changing event.
- If fire is active and at least one fire station is available, emit at least one deploy_resource event every cycle.
- MANDATORY: every deploy_resource MUST include both \`from_station_id\` and \`from_location\` chosen from the "AVAILABLE FIRE STATIONS" block in the context. Resources physically roll out from those stations toward the \`location\` where they'll stage.
- Pick the station closest to the deployment \`location\` so the response feels realistic.
- \`location\` is the staging point near the fire perimeter (not inside it unless attacking the head).
- NEVER mention or deploy any resource_type outside "engine" and "dozer".
- PHYSICAL IMPACT: deployments create suppression zones that slow fire spread. Engines attack structure protection and dozers cut containment lines.`;

class ResourceAgent extends BaseAgent {
  constructor() {
    super('resource', SYSTEM_PROMPT);
  }

  _simulatedResponse(context) {
    const { location, zones, shelters, fireOrigin, fireStations } = this._parseContext(context);
    const z1 = zones[0]?.name || 'the primary zone';
    const s1 = shelters[0] || { id: 'S001', name: 'Local Shelter' };

    const lat = fireOrigin?.lat || 34.05;
    const lng = fireOrigin?.lng || -118.24;

    // Prefer a real fire station from context; fall back to synthetic origin.
    const station = (fireStations && fireStations[0]) || {
      id: 'FS_UNKNOWN',
      name: 'Local Fire Station',
      lng: lng - 0.03,
      lat: lat - 0.02,
    };
    const secondStation = (fireStations && fireStations[1]) || station;

    const flankLng = (lng + 0.01).toFixed(4);
    const flankLat = (lat + 0.01).toFixed(4);
    const headLng  = (lng + 0.02).toFixed(4);
    const headLat  = (lat + 0.02).toFixed(4);

    return `Heard, Evac — ${s1.name} is open for the ${z1} flow. Rolling 12 engines from ${station.name} to the fire flank and sending two dozer teams from ${secondStation.name} to cut a containment line near the head.

\`\`\`json
{"type": "deploy_resource", "resource_type": "engine", "location": [${flankLng}, ${flankLat}], "count": 12, "assignment": "Hold the southern flank near ${location}", "from_station_id": "${station.id}", "from_location": [${station.lng.toFixed(5)}, ${station.lat.toFixed(5)}], "ui_message": "12 engines deployed to fire flank"}
\`\`\`
\`\`\`json
{"type": "deploy_resource", "resource_type": "dozer", "location": [${headLng}, ${headLat}], "count": 2, "assignment": "Cut containment line near the fire head", "from_station_id": "${secondStation.id}", "from_location": [${secondStation.lng.toFixed(5)}, ${secondStation.lat.toFixed(5)}], "ui_message": "2 dozers cutting containment line"}
\`\`\`
\`\`\`json
{"type": "update_shelter", "shelter_id": "${s1.id}", "occupancy": 800, "capacity": 3000, "status": "open", "ui_message": "Shelter ${s1.id} opened for evacuees"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 82}
\`\`\``;
  }
}

module.exports = { ResourceAgent };
