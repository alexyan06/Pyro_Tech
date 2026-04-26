const { WebSocketServer } = require('ws');

function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });
  const clients = new Set();

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`[WS] Client connected. Total: ${clients.size}`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on('error', (err) => {
      console.error('[WS] Client error:', err.message);
      clients.delete(ws);
    });
  });

  function broadcast(message) {
    const data = typeof message === 'string' ? message : JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === 1) {
        client.send(data);
      }
    }
  }

  function sendToClient(ws, message) {
    if (ws.readyState === 1) {
      const data = typeof message === 'string' ? message : JSON.stringify(message);
      ws.send(data);
    }
  }

  return { wss, broadcast, sendToClient };
}

/**
 * Validates a `start_simulation` payload against the required structured schema.
 * Rejects legacy free-text `scenario` payloads entirely.
 *
 * Expected shape:
 *   { location, bbox, timestamp, fireOrigin: {lat, lng}, metrics: {windU, windV, temp, humidity}, initialAcres?, durationHours? }
 *
 * @param {Record<string, unknown>} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateScenarioPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  // Reject legacy text-prompt style
  if ('scenario' in payload) {
    errors.push(
      'Free-text "scenario" field is no longer accepted. ' +
      'Send a structured payload: { location, bbox, timestamp, fireOrigin, metrics }.'
    );
  }

  if (typeof payload.location !== 'string' || !payload.location.trim()) {
    errors.push('location must be a non-empty string');
  }

  if (
    !Array.isArray(payload.bbox) ||
    payload.bbox.length !== 4 ||
    payload.bbox.some((v) => typeof v !== 'number')
  ) {
    errors.push('bbox must be an array of exactly 4 numbers [west, south, east, north]');
  }

  if (typeof payload.timestamp !== 'string' || isNaN(Date.parse(payload.timestamp))) {
    errors.push('timestamp must be a valid ISO-8601 date string');
  }

  const fo = payload.fireOrigin;
  if (
    !fo || typeof fo !== 'object' ||
    typeof fo.lat !== 'number' ||
    typeof fo.lng !== 'number'
  ) {
    errors.push('fireOrigin must be an object with numeric lat and lng fields');
  }

  const m = payload.metrics;
  if (
    !m || typeof m !== 'object' ||
    typeof m.windU !== 'number' || !Number.isFinite(m.windU) ||
    typeof m.windV !== 'number' || !Number.isFinite(m.windV) ||
    typeof m.temp !== 'number' ||
    typeof m.humidity !== 'number'
  ) {
    errors.push('metrics must be an object with numeric windU, windV, temp, and humidity fields');
  }

  if (
    payload.initialAcres !== undefined &&
    (
      typeof payload.initialAcres !== 'number' ||
      !Number.isFinite(payload.initialAcres) ||
      payload.initialAcres < 0 ||
      payload.initialAcres > 10000
    )
  ) {
    errors.push('initialAcres must be a number between 0 and 10000');
  }

  if (
    payload.durationHours !== undefined &&
    (
      typeof payload.durationHours !== 'number' ||
      !Number.isFinite(payload.durationHours) ||
      payload.durationHours < 1 ||
      payload.durationHours > 12
    )
  ) {
    errors.push('durationHours must be a number between 1 and 12');
  }

  if (
    payload.enableTts !== undefined &&
    typeof payload.enableTts !== 'boolean'
  ) {
    errors.push('enableTts must be a boolean');
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { setupWebSocket, validateScenarioPayload };
