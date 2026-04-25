const fs = require('fs');
const path = require('path');
const { loadAllData } = require('../data/loader');
const { synthesize } = require('../voice/elevenlabs');
const { fetchFIRMS } = require('../simulation/firmsFetcher');
const { computeCongestion } = require('../simulation/trafficModel');
const { DisasterAgent } = require('../agents/disasterAgent');
const { EvacuationAgent } = require('../agents/evacuationAgent');
const { ResourceAgent } = require('../agents/resourceAgent');
const { InfrastructureAgent } = require('../agents/infrastructureAgent');
const { CommunicationsAgent } = require('../agents/communicationsAgent');
const { SynthesisAgent } = require('../agents/synthesisAgent');
const { StateManager } = require('../simulation/stateManager');
const { WildfireEngine } = require('../simulation/wildfireEngine');
const { fetchWeather } = require('../simulation/weatherFetcher');
const { detectConflicts } = require('./conflictDetector');
const { generatePlaybook } = require('../playbook/generator');

const TICK_DURATION_MS = 10000;
const MAX_TICKS = 6;

class TurnSequencer {
  constructor(sendToClient) {
    this.sendToClient = sendToClient;
    this.agents = [
      new DisasterAgent(),
      new EvacuationAgent(),
      new ResourceAgent(),
      new InfrastructureAgent(),
      new CommunicationsAgent(),
      new SynthesisAgent(),
    ];
    
    // Create a special debate phase agent that shares the Evacuation identity
    this.debateAgent = new EvacuationAgent();
    // Overwrite the simulated response just for the debate phase to look natural
    this.debateAgent._simulatedResponse = (context) => {
      const tick = (context.match(/Tick (\\d+) of/) || [])[1] || '1';
      return `Heard, Infra — if Sunset's got lines down we can't send people that way. Shifting all evac traffic to I-405 South right now.

\`\`\`json
{"type": "close_route", "route_id": "Sunset Blvd East", "reason": "power_lines_down"}
\`\`\`
\`\`\`json
{"type": "agent_confidence", "score": 90}
\`\`\``;
    };

    this.stateManager = new StateManager();
    this.paused = false;
    this.stopped = false;
  }

  async runSimulation(scenarioInput, ws, opts = {}) {
    const historicalMode = opts.historical_mode === true;
    const historicalPerimeters = historicalMode ? this._loadHistoricalPerimeters() : null;
    this.stateManager.reset();
    this.paused = false;
    this.stopped = false;

    // Seed structured scenario metadata first (ground truth for agents)
    this.stateManager.seedFromScenario(scenarioInput);

    // Seed simulation with real GeoJSON data
    try {
      const geoData = loadAllData();
      this.stateManager.seedFromData(geoData);
    } catch (err) {
      console.warn('[Sequencer] Could not load GeoJSON data:', err.message);
    }

    // Derive bbox centroid for weather fetch; fallback to fire origin
    let weatherLat = scenarioInput.fireOrigin.lat;
    let weatherLng = scenarioInput.fireOrigin.lng;
    if (Array.isArray(scenarioInput.bbox) && scenarioInput.bbox.length === 4) {
      const [west, south, east, north] = scenarioInput.bbox;
      weatherLat = (south + north) / 2;
      weatherLng = (west + east) / 2;
    }
    const weather = await fetchWeather(weatherLat, weatherLng);
    // Override wind/temp/humidity with the user-supplied metrics if provided
    if (scenarioInput.metrics) {
      if (scenarioInput.metrics.wind    != null) weather.windSpeed   = scenarioInput.metrics.wind;
      if (scenarioInput.metrics.temp    != null) weather.temperature = scenarioInput.metrics.temp;
      if (scenarioInput.metrics.humidity != null) weather.humidity   = scenarioInput.metrics.humidity;
    }
    console.log('[Sequencer] Weather:', weather);

    // Use scenario wind for fire spread bearing
    const windBearing = weather.windDirection || 45;
    const windSpeed = weather.windSpeed || 40;

    // Create wildfire engine centered on the supplied fire origin
    const engine = new WildfireEngine(
      [scenarioInput.fireOrigin.lng, scenarioInput.fireOrigin.lat],
      windBearing,
      windSpeed
    );

    // Simulation clock starts at the requested date
    const simStartTime = new Date(scenarioInput.timestamp);

    for (let tick = 1; tick <= MAX_TICKS; tick++) {
      if (this.stopped) break;

      // Wait while paused
      while (this.paused && !this.stopped) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (this.stopped) break;

      const simTime = new Date(simStartTime.getTime() + tick * 3600000);
      const simTimeStr = simTime.toISOString();
      console.log(`[Sequencer] Tick ${tick} — ${simTimeStr}`);

      // Generate fire perimeter for this tick (historical or simulated)
      let firePerimeter;
      if (historicalPerimeters) {
        // Pick the stage closest to this tick (clamp to available stages)
        const stage = historicalPerimeters.features.find(f => f.properties.tick === tick)
          || historicalPerimeters.features[Math.min(tick - 1, historicalPerimeters.features.length - 1)];
        if (stage) {
          firePerimeter = { type: 'FeatureCollection', features: [stage] };
        } else {
          firePerimeter = engine.generatePerimeter(tick);
        }
      } else {
        firePerimeter = engine.generatePerimeter(tick);
      }
      this.stateManager.applyEvent({
        type: 'update_fire_perimeter',
        geojson: firePerimeter,
      });

      // Send fire update to map
      this._sendMapEvent(ws, 'disaster', { type: 'update_fire_perimeter', geojson: firePerimeter }, tick);

      // Resolve individual agents by name for staged DAG execution
      const disasterAgent      = this.agents.find(a => a.name === 'disaster');
      const evacuationAgent    = this.agents.find(a => a.name === 'evacuation');
      const infrastructureAgent = this.agents.find(a => a.name === 'infrastructure');
      const communicationsAgent = this.agents.find(a => a.name === 'communications');
      const resourceAgent      = this.agents.find(a => a.name === 'resource');
      const synthesisAgent     = this.agents.find(a => a.name === 'synthesis');

      // Stage 1: disaster (must run first — sees fire state)
      const disasterOut = await this._runAgent(disasterAgent, this._buildContext(scenarioInput, tick, simTimeStr, weather, []), ws, tick);
      const tickOutputs = [disasterOut];

      // Stage 2: evacuation, infrastructure, communications run in parallel — all see disaster's output
      const [evacOut, infraOut, commsOut] = await Promise.all([
        this._runAgent(evacuationAgent,    this._buildContext(scenarioInput, tick, simTimeStr, weather, tickOutputs), ws, tick),
        this._runAgent(infrastructureAgent, this._buildContext(scenarioInput, tick, simTimeStr, weather, tickOutputs), ws, tick),
        this._runAgent(communicationsAgent, this._buildContext(scenarioInput, tick, simTimeStr, weather, tickOutputs), ws, tick),
      ]);
      tickOutputs.push(evacOut, infraOut, commsOut);

      // Stage 3: resource — sees full trio from stage 2
      const resourceOut = await this._runAgent(resourceAgent, this._buildContext(scenarioInput, tick, simTimeStr, weather, tickOutputs), ws, tick);
      tickOutputs.push(resourceOut);

      // Stage 4: synthesis — sees everyone
      const synthesisOut = await this._runAgent(synthesisAgent, this._buildContext(scenarioInput, tick, simTimeStr, weather, tickOutputs), ws, tick);
      tickOutputs.push(synthesisOut);

      // Compute traffic congestion and send route load events
      try {
        const baseRoutes = this.stateManager.state.baseData?.routes || {};
        const congestion = computeCongestion(this.stateManager.state.evacuation, baseRoutes);
        if (congestion.length > 0) {
          this._sendMapEvent(ws, 'resource', { type: 'traffic_congestion', routes: congestion }, tick);
        }
      } catch (err) {
        // non-critical, swallow
      }

      // Detect conflicts
      const conflicts = detectConflicts(tickOutputs);
      if (conflicts.length > 0) {
        console.log(`[Sequencer] Conflicts detected:`, conflicts);
      }

      // Evolve state manager for this tick (P3 integration)
      this.stateManager.evolve(tick, weather, this.stateManager.state.fire.acres_burned || 0);

      // Send state snapshot
      const snapshot = this.stateManager.getSnapshot(tick, simTimeStr);
      this.sendToClient(ws, {
        type: 'state_snapshot',
        payload: snapshot,
      });

      // Wait between ticks
      if (tick < MAX_TICKS) {
        await new Promise(r => setTimeout(r, TICK_DURATION_MS));
      }
    }

    // Generate and send playbook
    const playbook = generatePlaybook(
      this.stateManager.state.playbook_sections,
      scenarioInput
    );
    this.sendToClient(ws, {
      type: 'playbook_ready',
      payload: {
        simulation_id: 'sim-' + Date.now(),
        playbook_json: playbook,
      },
    });

    console.log('[Sequencer] Simulation complete');
  }

  async _runAgent(agent, context, ws, tick) {
    let fullText = '';
    for await (const chunk of agent.stream(context)) {
      fullText += chunk;
      this._sendAgentText(ws, agent.name, chunk, false);
    }
    this._sendAgentText(ws, agent.name, '', true);

    const mapEvents = agent.extractMapEvents(fullText);
    for (const event of mapEvents) {
      this.stateManager.applyEvent(event);
      this._sendMapEvent(ws, agent.name, event, tick);
    }

    // Fire-and-forget voice synthesis (non-blocking)
    synthesize(agent.name, fullText).then(audioBuffer => {
      if (audioBuffer) {
        this.sendToClient(ws, {
          type: 'agent_audio',
          payload: { agent: agent.name, audio_base64: audioBuffer.toString('base64'), tick },
        });
      }
    }).catch(() => {}); // voice is optional, swallow errors

    return { agent: agent.name, text: fullText, mapEvents };
  }

  _buildContext(scenarioInput, tick, simTime, weather, priorOutputs) {
    const sc = scenarioInput;
    const parts = [
      `SCENARIO: ${sc.location}`,
      `FIRE ORIGIN: lat=${sc.fireOrigin.lat}, lng=${sc.fireOrigin.lng}`,
      `BBOX (W,S,E,N): ${sc.bbox.join(', ')}`,
      `SIMULATION TIME: ${simTime} (Tick ${tick} of ${MAX_TICKS})`,
      `WEATHER CONDITIONS: Temperature ${weather.temperature}°F, Humidity ${weather.humidity}%, Wind ${weather.windSpeed}mph from ${weather.windDirection}° (gusts to ${weather.windGusts}mph)`,
      `PM2.5 Air Quality: ${weather.pm25} µg/m³`,
      this.stateManager.getContext(),
    ];

    if (priorOutputs.length > 0) {
      parts.push('\nPRIOR AGENT OUTPUTS THIS TICK:');
      for (const output of priorOutputs) {
        parts.push(`--- ${output.agent.toUpperCase()} ---`);
        parts.push(output.text.substring(0, 1000)); // Truncate to save tokens
      }
    }

    return parts.join('\n\n');
  }

  _sendAgentText(ws, agent, text, isComplete) {
    this.sendToClient(ws, {
      type: 'agent_text',
      payload: { agent, text, is_complete: isComplete },
    });
  }

  _sendMapEvent(ws, agent, event, tick) {
    this.sendToClient(ws, {
      type: 'map_event',
      payload: { agent, event, tick },
    });
  }

  pause()  { this.paused  = true; }
  resume() { this.paused  = false; }
  stop()   { this.stopped = true; }

  /**
   * Run a "what-if" branch simulation.
   * Forks the current stateManager state, applies the scenario modifier,
   * and runs BRANCH_TICKS abbreviated ticks (disaster + evacuation + synthesis only).
   *
   * @param {string} scenarioModifier  - e.g. "wind shifts NE at 70mph"
   * @param {object} ws                - WebSocket client
   * @param {string} branchId          - Unique identifier for this branch
   */
  async runBranch(scenarioModifier, ws, branchId) {
    const BRANCH_TICKS = 3;
    const BRANCH_AGENTS = ['disaster', 'evacuation', 'synthesis'];

    // Fork state from current snapshot
    const forkedState = JSON.parse(JSON.stringify(this.stateManager.state));

    // Build a lightweight branch sequencer
    const branchState = new (require('../simulation/stateManager').StateManager)();
    branchState.state = forkedState;

    const branchAgents = this.agents.filter(a => BRANCH_AGENTS.includes(a.name));
    const weather = { temperature: 75, humidity: 8, windSpeed: 70, windDirection: 45, windGusts: 95 };

    // Parse wind shift from modifier text
    const neMatch = scenarioModifier.match(/NE|northeast/i);
    const nwMatch = scenarioModifier.match(/NW|northwest/i);
    const swMatch = scenarioModifier.match(/SW|southwest/i);
    const speedMatch = scenarioModifier.match(/(\d+)\s*mph/i);
    if (neMatch) weather.windDirection = 45;
    else if (nwMatch) weather.windDirection = 315;
    else if (swMatch) weather.windDirection = 225;
    if (speedMatch) weather.windSpeed = parseInt(speedMatch[1], 10);

    // Build branch-aware engine using current fire center
    const currentFire = forkedState.fire?.perimeter?.features?.[0];
    let fireCenter = [-118.53, 34.04];
    if (currentFire?.geometry?.coordinates?.[0]?.[0]) {
      const coords = currentFire.geometry.coordinates[0];
      const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
      const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
      fireCenter = [cx, cy];
    }
    const { WildfireEngine } = require('../simulation/wildfireEngine');
    const branchEngine = new WildfireEngine(fireCenter, weather.windDirection, weather.windSpeed);

    const startTick = (forkedState.tick || 1);

    this._sendBranchEvent(ws, branchId, 'branch_start', {
      branch_id: branchId,
      modifier: scenarioModifier,
      base_tick: startTick,
    });

    const branchOutputs = [];

    for (let i = 1; i <= BRANCH_TICKS; i++) {
      const tick = startTick + i;

      // Generate branch fire perimeter
      const branchPerimeter = branchEngine.generatePerimeter(i);
      branchState.applyEvent({ type: 'update_fire_perimeter', geojson: branchPerimeter });
      this._sendBranchEvent(ws, branchId, 'branch_map_event', {
        agent: 'disaster',
        event: { type: 'update_fire_perimeter', geojson: branchPerimeter },
        tick,
      });

      const context = [
        `WHAT-IF BRANCH — MODIFIER: ${scenarioModifier}`,
        `DIVERGES FROM MAIN SIM AT TICK ${startTick}`,
        `CURRENT BRANCH TICK: ${tick}`,
        `WEATHER CHANGE: Wind ${weather.windSpeed}mph from ${weather.windDirection}°, gusts ${weather.windGusts}mph`,
        branchState.getContext(),
        branchOutputs.length > 0 ? '\nBRANCH PRIOR OUTPUTS:\n' + branchOutputs.map(o => `--- ${o.agent.toUpperCase()} ---\n${o.text.substring(0, 600)}`).join('\n') : '',
      ].join('\n\n');

      for (const agent of branchAgents) {
        let fullText = '';
        for await (const chunk of agent.stream(context)) {
          fullText += chunk;
          this._sendBranchEvent(ws, branchId, 'branch_agent_text', {
            agent: agent.name,
            text: chunk,
            is_complete: false,
            tick,
          });
        }
        this._sendBranchEvent(ws, branchId, 'branch_agent_text', {
          agent: agent.name,
          text: '',
          is_complete: true,
          tick,
        });

        const mapEvents = agent.extractMapEvents(fullText);
        for (const event of mapEvents) {
          branchState.applyEvent(event);
          this._sendBranchEvent(ws, branchId, 'branch_map_event', { agent: agent.name, event, tick });
        }
        branchOutputs.push({ agent: agent.name, text: fullText });
      }
    }

    this._sendBranchEvent(ws, branchId, 'branch_complete', { branch_id: branchId });
  }

  _sendBranchEvent(ws, branchId, type, data) {
    this.sendToClient(ws, { type, payload: { branch_id: branchId, ...data } });
  }

  _loadHistoricalPerimeters() {
    try {
      const filePath = path.join(__dirname, '../../data/geojson/palisades_perimeter_historical.geojson');
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }
}

module.exports = { TurnSequencer };
