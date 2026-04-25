const { GoogleGenAI } = require('@google/genai');

class BaseAgent {
  constructor(name, systemPrompt) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.model = 'gemini-2.5-flash';
  }

  async *stream(context) {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || apiKey === 'your_gemini_api_key_here') {
      const simulated = this._simulatedResponse(context);
      const words = simulated.split(' ');
      for (let i = 0; i < words.length; i += 3) {
        const chunk = words.slice(i, i + 3).join(' ') + ' ';
        yield chunk;
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }

    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContentStream({
          model: this.model,
          config: {
            systemInstruction: this.systemPrompt,
            maxOutputTokens: 1800,
          },
          contents: [{ role: 'user', parts: [{ text: context }] }],
        });

        for await (const chunk of response) {
          const text = chunk.text;
          if (text) yield text;
        }
        return; // success
      } catch (err) {
        const isRateLimit = err.message?.includes('429') || err.message?.toLowerCase().includes('quota') || err.message?.toLowerCase().includes('rate');
        if (isRateLimit && attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt + 1) * 1500; // 3s, 6s, 12s
          console.warn(`[${this.name}] Rate limited — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        console.error(`[${this.name}] Gemini API error:`, err.message);
        yield this._simulatedResponse(context);
        return;
      }
    }
  }

  async run(context) {
    let fullText = '';
    for await (const chunk of this.stream(context)) {
      fullText += chunk;
    }
    const mapEvents = this.extractMapEvents(fullText);
    return { text: fullText, mapEvents };
  }

  extractMapEvents(text) {
    const events = [];
    const regex = /```json\s*([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        events.push(parsed);
      } catch (e) {
        console.warn(`[${this.name}] Failed to parse map event JSON:`, e.message);
      }
    }
    return events;
  }

  _parseContext(context) {
    const location = context.match(/Location: (.*?)(?:\n|$)/)?.[1] || 
                     context.match(/SCENARIO: (.*?)(?:\n|$)/)?.[1] || 
                     'the incident area';
    const tick = (context.match(/Agent Run (\d+)/) || [])[1] || '1';
    
    const zones = [];
    const zoneMatch = context.match(/AVAILABLE ZONES \(sample\): (.*)/);
    if (zoneMatch) {
      zoneMatch[1].split(', ').forEach(z => {
        const parts = z.split(': ');
        if (parts.length >= 2) {
          const id = parts[0].trim();
          const name = parts[1].split(' (')[0].trim();
          zones.push({ id, name });
        }
      });
    }

    const shelters = [];
    const shelterMatch = context.match(/AVAILABLE SHELTERS \(sample\): (.*)/);
    if (shelterMatch) {
      shelterMatch[1].split(', ').forEach(s => {
        const parts = s.split(': ');
        if (parts.length >= 2) {
          const id = parts[0].trim();
          const name = parts[1].split(' (')[0].trim();
          shelters.push({ id, name });
        }
      });
    }

    const routes = [];
    const routeMatch = context.match(/AVAILABLE ROUTES \(sample\): (.*)/);
    if (routeMatch) {
      routeMatch[1].split(', ').forEach(r => {
        const parts = r.split(': ');
        if (parts.length >= 2) {
          const id = parts[0].trim();
          const name = parts[1].split(' (')[0].trim();
          routes.push({ id, name });
        }
      });
    }

    const fireOriginMatch = context.match(/FIRE ORIGIN: lat=(-?[\d.]+), lng=(-?[\d.]+)/);
    const fireOrigin = fireOriginMatch
      ? { lat: parseFloat(fireOriginMatch[1]), lng: parseFloat(fireOriginMatch[2]) }
      : null;

    // AVAILABLE FIRE STATIONS lines look like:
    //   - STATION_ID | Name | [lng, lat]
    const fireStations = [];
    const fsBlock = context.match(/AVAILABLE FIRE STATIONS[^\n]*\n([\s\S]*?)(?:\n\n|\n[A-Z]{2,}|$)/);
    if (fsBlock) {
      for (const line of fsBlock[1].split('\n')) {
        const m = line.match(/^\s*-\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/);
        if (m) fireStations.push({ id: m[1].trim(), name: m[2].trim(), lng: parseFloat(m[3]), lat: parseFloat(m[4]) });
      }
    }

    return { location, tick, zones, shelters, routes, fireOrigin, fireStations };
  }

  _simulatedResponse(context) {
    return `[${this.name} Simulated Response]\n\nBased on the current scenario, this agent is analyzing the situation. The simulation is running in demo mode because no Gemini API key is configured.\n\n\`\`\`json\n{"type": "tick_summary", "agent": "${this.name}", "status": "simulated"}\n\`\`\``;
  }
}

module.exports = { BaseAgent };
