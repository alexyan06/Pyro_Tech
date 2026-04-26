require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { setupWebSocket, validateScenarioPayload } = require('./websocket/server');
const { TurnSequencer } = require('./orchestration/turnSequencer');
const { initDB } = require('./db/postgres');
const { initRedis } = require('./db/redis');
const apiRoutes = require('./routes/api');
const { normalizeInitialAcres } = require('./simulation/scenarioInputs');

const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

const server = http.createServer(app);
const { wss, broadcast, sendToClient } = setupWebSocket(server);

// Track active simulations per client
const activeSimulations = new Map();

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendToClient(ws, { type: 'error', payload: { message: 'Invalid JSON' } });
      return;
    }

    switch (msg.type) {
      case 'start_simulation': {
        const payload = msg.payload ?? {};
        const { valid, errors } = validateScenarioPayload(payload);
        if (!valid) {
          sendToClient(ws, {
            type: 'error',
            payload: { message: `Invalid scenario payload:\n• ${errors.join('\n• ')}` },
          });
          return;
        }

        // Stop any existing simulation for this client
        const existing = activeSimulations.get(ws);
        if (existing) existing.stop();

        const { location, bbox, timestamp, fireOrigin, metrics, initialAcres } = payload;
        const normalizedInitialAcres = normalizeInitialAcres(initialAcres);
        const durationHours = payload.durationHours ?? 6;
        const historical_mode = payload.historical_mode === true;
        const enableTts = payload.enableTts === true;
        console.log(`[Server] Starting simulation: "${location}" origin=(${fireOrigin.lat},${fireOrigin.lng}) initialAcres=${normalizedInitialAcres} duration=${durationHours}h historical=${historical_mode} tts=${enableTts}`);
        const sequencer = new TurnSequencer(sendToClient);
        activeSimulations.set(ws, sequencer);

        try {
          await sequencer.runSimulation({ location, bbox, timestamp, fireOrigin, metrics, initialAcres: normalizedInitialAcres, durationHours }, ws, { historical_mode, enableTts });
        } catch (err) {
          console.error('[Server] Simulation error:', err);
          sendToClient(ws, { type: 'error', payload: { message: err.message } });
        } finally {
          activeSimulations.delete(ws);
        }
        break;
      }

      case 'control': {
        const sequencer = activeSimulations.get(ws);
        if (!sequencer) return;
        const action = msg.payload?.action;
        if (action === 'pause') sequencer.pause();
        else if (action === 'resume') sequencer.resume();
        else if (action === 'stop') sequencer.stop();
        break;
      }

      case 'start_branch': {
        const modifier = msg.payload?.scenario_modifier;
        if (!modifier) {
          sendToClient(ws, { type: 'error', payload: { message: 'scenario_modifier required' } });
          return;
        }
        const sequencer = activeSimulations.get(ws);
        if (!sequencer) {
          sendToClient(ws, { type: 'error', payload: { message: 'No active simulation to branch from' } });
          return;
        }
        const branchId = `br-${Date.now()}`;
        console.log(`[Server] Starting branch "${modifier}" id=${branchId}`);
        // Run branch in background (fire-and-forget, errors non-fatal)
        sequencer.runBranch(modifier, ws, branchId).catch(err => {
          console.error('[Server] Branch error:', err);
          sendToClient(ws, { type: 'error', payload: { message: `Branch failed: ${err.message}` } });
        });
        break;
      }

      case 'request_playbook': {
        // Playbook is auto-sent at end of simulation
        // This is a no-op for now
        break;
      }

      case 'audio_done': {
        const sequencer = activeSimulations.get(ws);
        const { agent, tick } = msg.payload ?? {};
        if (sequencer) sequencer._resolveAudioAck(agent, tick);
        break;
      }

      default:
        sendToClient(ws, { type: 'error', payload: { message: `Unknown message type: ${msg.type}` } });
    }
  });

  ws.on('close', () => {
    const sequencer = activeSimulations.get(ws);
    if (sequencer) {
      sequencer.stop();
      activeSimulations.delete(ws);
    }
  });
});

async function start() {
  await initDB();
  await initRedis();

  server.listen(PORT, () => {
    console.log(`[PyroTech] Server running on port ${PORT}`);
    console.log(`[PyroTech] WebSocket ready on ws://localhost:${PORT}`);
    console.log(`[PyroTech] Health check: http://localhost:${PORT}/api/health`);
  });
}

start();
