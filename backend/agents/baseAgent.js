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

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContentStream({
        model: this.model,
        config: {
          systemInstruction: this.systemPrompt,
        },
        contents: [{ role: 'user', parts: [{ text: context }] }],
      });

      for await (const chunk of response) {
        const text = chunk.text;
        if (text) {
          yield text;
        }
      }
    } catch (err) {
      console.error(`[${this.name}] Gemini API error:`, err.message);
      const fallback = this._simulatedResponse(context);
      yield fallback;
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

  _simulatedResponse(context) {
    return `[${this.name} Simulated Response]\n\nBased on the current scenario, this agent is analyzing the situation. The simulation is running in demo mode because no Gemini API key is configured.\n\n\`\`\`json\n{"type": "tick_summary", "agent": "${this.name}", "status": "simulated"}\n\`\`\``;
  }
}

module.exports = { BaseAgent };
