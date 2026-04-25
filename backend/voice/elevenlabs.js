const https = require('https');

// One distinct voice per agent (ElevenLabs premade voice IDs)
const AGENT_VOICES = {
  disaster:        'pNInz6obpgDQGcFmaJgB',  // Adam — authoritative male
  evacuation:      'EXAVITQu4vr4xnSDxMaL',  // Bella — calm female
  resource:        'VR6AewLTigWG4xSOukaG',  // Arnold — commanding male
  infrastructure:  'ErXwobaYiN019PkySvjV',  // Antoni — technical male
  communications:  'MF3mGyEYCl7XYWbV9V6O',  // Elli — clear female
  synthesis:       'jBpfuIE2acCO8z3wKNLl',  // Glinda — authoritative female
};

/**
 * Synthesize text to speech for a given agent.
 * Returns a Buffer of MP3 audio, or null if synthesis fails / key not set.
 */
async function synthesize(agentName, text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey || apiKey === 'your_elevenlabs_key_here') {
    return null; // Gracefully skip if no key
  }

  const voiceId = AGENT_VOICES[agentName] || AGENT_VOICES.synthesis;

  // Trim text to avoid excessive synthesis costs (max 500 chars)
  const trimmedText = text.length > 500
    ? text.slice(0, 497) + '...'
    : text;

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
        console.warn(`[ElevenLabs] HTTP ${res.statusCode} for agent ${agentName}`);
        res.resume();
        resolve(null);
        return;
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', (err) => {
      console.warn(`[ElevenLabs] Request failed: ${err.message}`);
      resolve(null);
    });

    req.setTimeout(10000, () => {
      console.warn('[ElevenLabs] Request timeout');
      req.destroy();
      resolve(null);
    });

    req.write(body);
    req.end();
  });
}

module.exports = { synthesize };
