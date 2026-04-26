const https = require('https');

// Voices that consume free-tier slots (Adam/Bella/Arnold are already in the
// workspace) sit alongside the new "default" voices (Aria, Roger, …) which
// don't count against the 3-slot cap. If any voice 402s at runtime we fall
// back to Adam so the agent still speaks.
const AGENT_VOICES = {
  disaster:        'pNInz6obpgDQGcFmaJgB',  // Adam — slot voice
  evacuation:      'EXAVITQu4vr4xnSDxMaL',  // Bella — slot voice
  traffic:         'CwhRBWXzGAHq8TQ4Fs17',  // Roger — default (no slot)
  resource:        'VR6AewLTigWG4xSOukaG',  // Arnold — slot voice
  infrastructure:  'JBFqnCBsd6RMkjVDRZzb',  // George — default (no slot)
  communications:  'pFZP5JQG7iQjIQuC4Bku',  // Lily — default (no slot)
  synthesis:       '9BWtsMINqrJLrRacOk9x',  // Aria — default (no slot)
};

const FALLBACK_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'; // Adam — known to be in workspace

/**
 * Synthesize text to speech for a given agent.
 * Returns a Buffer of MP3 audio, or null if synthesis fails / key not set.
 */
function stripMetadata(text) {
  // Remove closed code fences, then strip any unclosed fence (truncated agent output)
  // that runs to the end of the string.
  return text
    .replace(/```json[\s\S]*?```/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/```[\s\S]*/g, '')
    .trim();
}

function _attempt(voiceId, agentName, body, apiKey) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${voiceId}`,
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Accept': 'audio/mpeg',
      },
    };

    const chunks = [];
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        const errChunks = [];
        res.on('data', c => errChunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(errChunks).toString('utf8');
          let detail = raw;
          try {
            const parsed = JSON.parse(raw);
            detail = parsed.detail?.status || parsed.detail?.message || parsed.detail || raw;
          } catch { /* leave as raw body */ }
          const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
          console.warn(`[ElevenLabs] HTTP ${res.statusCode} for agent ${agentName} (voice ${voiceId}): ${detailStr}`);
          resolve({ status: res.statusCode, buffer: null });
        });
        return;
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: 200, buffer: Buffer.concat(chunks) }));
    });

    req.on('error', (err) => {
      console.warn(`[ElevenLabs] Request failed for agent ${agentName} (voice ${voiceId}): ${err.message}`);
      resolve({ status: 0, buffer: null });
    });

    req.setTimeout(10000, () => {
      console.warn(`[ElevenLabs] Request timeout for agent ${agentName} (voice ${voiceId})`);
      req.destroy();
      resolve({ status: 0, buffer: null });
    });

    req.write(body);
    req.end();
  });
}

async function synthesize(agentName, text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    return null; // Gracefully skip if no key
  }

  const voiceId = AGENT_VOICES[agentName];
  if (!voiceId) {
    console.warn(`[ElevenLabs] No voice mapping for agent "${agentName}" — skipping TTS.`);
    return null;
  }

  const prose = stripMetadata(text);
  if (!prose) return null;

  // Trim to avoid excessive synthesis costs (max 500 chars)
  const trimmedText = prose.length > 500
    ? prose.slice(0, 497) + '...'
    : prose;

  const body = JSON.stringify({
    text: trimmedText,
    model_id: 'eleven_turbo_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.2,
      use_speaker_boost: true,
    },
  });

  const result = await _attempt(voiceId, agentName, body, apiKey);
  if (result.buffer) return result.buffer;

  // 402 means the voice isn't reachable on this tier (slot cap, voice not in
  // workspace, etc.). Retry once with the fallback voice so the agent still
  // speaks instead of going silent.
  if (result.status === 402 && voiceId !== FALLBACK_VOICE_ID) {
    console.warn(`[ElevenLabs] Retrying agent ${agentName} with fallback voice (${FALLBACK_VOICE_ID}) after 402.`);
    const retry = await _attempt(FALLBACK_VOICE_ID, agentName, body, apiKey);
    return retry.buffer || null;
  }

  return null;
}

module.exports = { synthesize };
