const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');
const { loadAllData } = require('../data/loader');
const { synthesize } = require('../voice/elevenlabs');
const { computeCongestion } = require('../simulation/trafficModel');
const { DisasterAgent } = require('../agents/disasterAgent');
const { EvacuationAgent } = require('../agents/evacuationAgent');
const { ResourceAgent } = require('../agents/resourceAgent');
const { SynthesisAgent } = require('../agents/synthesisAgent');
const { CongestionAgent } = require('../agents/congestionAgent');
const { StateManager } = require('../simulation/stateManager');
const { WildfireEngine } = require('../simulation/wildfireEngine');
const { fetchWeather } = require('../simulation/weatherFetcher');
const { detectConflicts } = require('./conflictDetector');
const { generatePlaybook, generateExecutiveSummary } = require('../playbook/generator');

const PHYSICS_INTERVAL_MS = 500;  // physics update cadence (real ms)
const LOGICAL_MINUTES_PER_CYCLE = 30;   // each agent cycle advances sim clock by 30 min
const DEMO_AGENT_CYCLE_MS = 30_000; // smooth visual time between agent turns
const DEFAULT_DURATION_HOURS = 6;
// Lead-in between sending `simulation_ready` and the first physics tick.
// The frontend's LoadingScreen needs OVERLAY_CLEAR_BUDGET_MS to finish its
// `done`-phase tween (~140 ms) and opacity fade-out (FADE_MS = 650 ms in
// frontend/components/LoadingScreen.tsx). After the overlay is fully gone we
// hold for POST_FADE_GAP_MS — a deliberate beat on a clean simulation map
// before the fire perimeter and any agent transmissions arrive. Keep these
// two sides in sync if FADE_MS or the done-tween rate change.
const OVERLAY_CLEAR_BUDGET_MS = 800;
const POST_FADE_GAP_MS = 1000;
const SIM_LEAD_IN_MS = OVERLAY_CLEAR_BUDGET_MS + POST_FADE_GAP_MS;

// Default wind: 35 mph from NE (45° FROM) expressed as U/V components (m/s)
const DEFAULT_WIND_U = parseFloat((-35 * 0.44704 * Math.sin(Math.PI / 4)).toFixed(4));
const DEFAULT_WIND_V = parseFloat((-35 * 0.44704 * Math.cos(Math.PI / 4)).toFixed(4));

/**
 * Convert U/V wind components (m/s) to a human-readable string for agent prompts.
 * Returns speed in mph and FROM direction in degrees.
 */
function uvToHuman(windU, windV) {
  const speedMs = Math.sqrt(windU * windU + windV * windV);
  const speedMph = Math.round(speedMs / 0.44704);
  const toBearingDeg = ((Math.atan2(windU, windV) * 180 / Math.PI) + 360) % 360;
  const fromDeg = Math.round((toBearingDeg + 180) % 360);
  return { speedMph, fromDeg };
}

/**
 * Convert FROM-degrees (meteorological) + speed (mph) to U/V components (m/s).
 */
function fromDegToUV(fromDeg, speedMph) {
  const speedMs = speedMph * 0.44704;
  const rad = fromDeg * Math.PI / 180;
  return {
    windU: parseFloat((-speedMs * Math.sin(rad)).toFixed(4)),
    windV: parseFloat((-speedMs * Math.cos(rad)).toFixed(4)),
  };
}
const MAX_TICKS = 6;    // kept for branch simulation compatibility

function normalizeDurationHours(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_DURATION_HOURS;
  return Math.min(12, Math.max(1, value));
}

function formatElapsedHours(hours) {
  const totalMinutes = Math.round(Math.max(0, hours) * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours === 0) return `${minutes}m`;
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}

class TurnSequencer {
  constructor(sendToClient) {
    this.sendToClient = sendToClient;
    this.agents = [
      new DisasterAgent(),
      new EvacuationAgent(),
      new CongestionAgent(),
      new ResourceAgent(),
      new SynthesisAgent(),
    ];

    this.stateManager = new StateManager();
    this.paused = false;
    this.stopped = false;
    this.branchInProgress = false;
    this._lastTrafficSignature = '';
  }

  async runSimulation(scenarioInput, ws, opts = {}) {
    const historicalMode = opts.historical_mode === true;
    const historicalPerimeters = historicalMode ? this._loadHistoricalPerimeters() : null;
    const durationHours = normalizeDurationHours(scenarioInput.durationHours);
    const totalCycles = Math.ceil(durationHours * 60 / LOGICAL_MINUTES_PER_CYCLE);
    scenarioInput.durationHours = durationHours;
    this.ttsMode = opts.enableTts === true;
    this._audioWaiters = new Map();
    this.stateManager.reset();
    this.paused = false;
    this.stopped = false;
    this._agentRunCount = 0;
    this._logicalElapsedHours = 0;
    this._lastElapsedHours = 0;
    this._physicsElapsedHours = 0;
    this._lastTrafficSignature = '';
    this._lastImpactSignature = '';
    // Monotonic sim clock — advances at a constant rate regardless of agent latency
    this._simStartWallMs    = Date.now();
    this._physicsHoursPerMs = (LOGICAL_MINUTES_PER_CYCLE / 60) / DEMO_AGENT_CYCLE_MS;

    this.stateManager.seedFromScenario(scenarioInput);

    try {
      const geoData = loadAllData();
      this.stateManager.seedFromData(geoData);
    } catch (err) {
      console.warn('[Sequencer] Could not load GeoJSON data:', err.message);
    }

    let weatherLat = scenarioInput.fireOrigin.lat;
    let weatherLng = scenarioInput.fireOrigin.lng;
    if (Array.isArray(scenarioInput.bbox) && scenarioInput.bbox.length === 4) {
      const [west, south, east, north] = scenarioInput.bbox;
      weatherLat = (south + north) / 2;
      weatherLng = (west + east) / 2;
    }

    // Apply any user-supplied metric overrides
    const metricsOverrides = scenarioInput.metrics || {};

    // Start physics immediately with defaults; real weather updates the engine when it arrives.
    let weather = {
      windU:        metricsOverrides.windU ?? DEFAULT_WIND_U,
      windV:        metricsOverrides.windV ?? DEFAULT_WIND_V,
      temperature:  metricsOverrides.temp  ?? 75,
      humidity:     metricsOverrides.humidity ?? 30,
      windGusts:    40,
      pm25:         15,
    };

    // Kick off the weather fetch in the background — engine will be reseeded once it lands.
    fetchWeather(weatherLat, weatherLng).then(realWeather => {
      if (this.stopped) return;
      if (metricsOverrides.windU != null) realWeather.windU = metricsOverrides.windU;
      if (metricsOverrides.windV != null) realWeather.windV = metricsOverrides.windV;
      if (metricsOverrides.temp  != null) realWeather.temperature = metricsOverrides.temp;
      if (metricsOverrides.humidity != null) realWeather.humidity = metricsOverrides.humidity;
      weather = realWeather;
      // Reseed engine with real weather values so physics reflects actual conditions
      const { windBearing: rb, windSpeed: rs } = WildfireEngine.uvToEngine(realWeather.windU ?? DEFAULT_WIND_U, realWeather.windV ?? DEFAULT_WIND_V);
      engine.windBearing = rb;
      engine.windSpeed   = rs;
      engine.humidity    = realWeather.humidity    ?? 30;
      engine.temperature = realWeather.temperature ?? 75;
      engine.pm25        = realWeather.pm25        ?? 15;
      console.log('[Sequencer] Weather resolved (background):', realWeather);
    }).catch(err => {
      console.warn('[Sequencer] Weather fetch failed, using defaults:', err.message);
    });

    console.log('[Sequencer] Starting physics with default weather; real weather fetching in background...');

    const { windBearing, windSpeed } = WildfireEngine.uvToEngine(weather.windU, weather.windV);
    const engine = new WildfireEngine(
      [scenarioInput.fireOrigin.lng, scenarioInput.fireOrigin.lat],
      windBearing,
      windSpeed,
      {
        humidity: weather.humidity,
        temperature: weather.temperature,
        pm25: weather.pm25,
        initialAcres: scenarioInput.initialAcres,
      },
    );

    const simStartSim = new Date(scenarioInput.timestamp);

    const { ParticleEngine } = require('../simulation/particleEngine');
    const particleEngine = new ParticleEngine();

    // ── Physics loop: continuous fire + particles + congestion ─────────────────
    let physicsCount = 0;
    let physicsIntervalId;
    let physicsStartTimeoutId;

    // Tell the client backend init is done. The client uses this to dismiss
    // the loading overlay; we hold the first physics tick for SIM_LEAD_IN_MS
    // so the overlay finishes its fade-out on a clean (no fire, no agent
    // transmissions) map.
    this.sendToClient(ws, { type: 'simulation_ready' });

    const physicsTick = () => {
      if (this.stopped) { clearInterval(physicsIntervalId); return; }
      if (this.paused) return;

      const elapsedSimHours = this._currentPhysicsElapsedHours(durationHours);
      this._lastElapsedHours = elapsedSimHours;
      const simTime = new Date(simStartSim.getTime() + elapsedSimHours * 3_600_000);
      const simTimeStr = simTime.toISOString();

      // Heartbeat log every ~10s so we can verify the physics loop is alive
      if (physicsCount % 20 === 0) {
        const groupCount = Object.keys(this.stateManager.state.resources.groups || {}).length;
        console.log(`[Physics] tick=${physicsCount} elapsed=${elapsedSimHours.toFixed(3)}h groups=${groupCount}`);
      }

      // Resource status updates + suppression zone geometry — MUST run before
      // getActiveSuppressionEffects so a newly-arrived group's zone is included
      // in the same tick's fire perimeter calculation (no 1-tick blind spot).
      if (physicsCount % 4 === 0) {
        const resourceEvents = this.stateManager.updateResources(elapsedSimHours);
        for (let i = 0; i < resourceEvents.length; i++) {
          const event = {
            ...resourceEvents[i],
            action_id: resourceEvents[i].action_id || `resource-effect-${this._agentRunCount}-${physicsCount}-${i}`,
            source_agent: 'resource',
            agent: 'resource',
            tick: this._agentRunCount,
            elapsed_hours: elapsedSimHours,
          };
          if (event.type === 'resource_update') {
            console.log(`[Physics] Resource ${event.resource_group_id} → ${event.status} at ${elapsedSimHours.toFixed(3)}h`);
          }
          if (event.type === 'suppression_zone') {
            console.log(`[Physics] Suppression zone ${event.action_id} type=${event.resource_type} at ${elapsedSimHours.toFixed(3)}h`);
          }
          this._sendMapEvent(ws, 'resource', event, this._agentRunCount);
        }
      }

      // Fetch suppression effects AFTER updateResources so newly-arrived groups are included
      let perimeter;
      const suppressionEffects = this.stateManager.getActiveSuppressionEffects(elapsedSimHours);
      if (physicsCount % 20 === 0 && suppressionEffects.length > 0) {
        console.log(`[Physics] Fire engine using ${suppressionEffects.length} active suppression effect(s)`);
      }
      if (historicalPerimeters) {
        const approxTick = Math.max(1, Math.min(MAX_TICKS, Math.ceil(elapsedSimHours)));
        const stage = historicalPerimeters.features.find(f => f.properties.tick === approxTick)
          || historicalPerimeters.features[Math.min(approxTick - 1, historicalPerimeters.features.length - 1)];
        if (stage) {
          perimeter = engine.applySuppressionToPerimeter(
            { type: 'FeatureCollection', features: [stage] },
            Math.max(0.01, elapsedSimHours),
            suppressionEffects,
          );
        } else {
          perimeter = engine.generatePerimeter(Math.max(0.01, elapsedSimHours), suppressionEffects);
        }
      } else {
        perimeter = engine.generatePerimeter(Math.max(0.01, elapsedSimHours), suppressionEffects);
      }
      this.stateManager.applyEvent({ type: 'update_fire_perimeter', geojson: perimeter });

      // Only send the heavy fire GeoJSON to the client periodically (every 2 seconds)
      // to keep the WebSocket and event loop clear for the clock + other updates.
      if (physicsCount % 4 === 0) {
        this._sendMapEvent(ws, 'disaster', { type: 'fire_update', geojson: perimeter }, this._agentRunCount);
        this._sendMapEvent(ws, 'disaster', this._buildFireBehaviorEvent(perimeter, elapsedSimHours), this._agentRunCount);
        this._refreshFireImpacts(ws, elapsedSimHours, this._agentRunCount);
      }

      // Continuous simulation clock — lightweight, sent every tick
      this.sendToClient(ws, {
        type: 'time_update',
        payload: { sim_time: simTimeStr, elapsed_hours: elapsedSimHours, duration_hours: durationHours },
      });

      // Trip waypoints for car layer (every 4 physics ticks = 2 real seconds)
      // Skip traffic refresh here when the % 20 block will call it in the same tick
      if (physicsCount % 4 === 0) {
        const baseData = this.stateManager.state.baseData || {};
        if (physicsCount % 20 !== 0) {
          this._refreshTrafficState(ws, elapsedSimHours, this._agentRunCount);
        }
        // scenario.bbox is stored as [west, south, east, north] — same shape particleEngine expects.
        const sbx = this.stateManager.state.scenario?.bbox;
        const normBbox = Array.isArray(sbx) && sbx.length === 4 ? sbx.slice() : null;
        const fireState = {
          spread_bearing: this.stateManager.state.fire.spread_bearing,
          origin: this.stateManager.state.scenario?.fireOrigin
            ? [this.stateManager.state.scenario.fireOrigin.lng, this.stateManager.state.scenario.fireOrigin.lat]
            : null,
          route_congestion: this.stateManager.state.evacuation.route_congestion || [],
          closed_routes: this.stateManager.state.evacuation.closed_routes || [],
          bbox: normBbox,
        };
        particleEngine.syncFlows(
          this.stateManager.state.evacuation.flows,
          baseData.zones || {},
          baseData.shelters || {},
          baseData.routes || {},
          fireState,
        );
        const trips = particleEngine.getTrips();
        if (trips.length > 0) {
          this.sendToClient(ws, { type: 'particle_update', payload: { particles: [], trips } });
        }
      }

      // Congestion + full state snapshot immediately, then every 10 real seconds.
      if (physicsCount % 20 === 0) {
        this._refreshTrafficState(ws, elapsedSimHours, this._agentRunCount);

        this.stateManager.evolve(
          Math.max(1, this._agentRunCount),
          weather,
          this.stateManager.state.fire.acres_burned || 0,
          elapsedSimHours,
        );
        const snapshot = this.stateManager.getSnapshot(this._agentRunCount, simTimeStr, elapsedSimHours);
        this.sendToClient(ws, { type: 'state_snapshot', payload: snapshot });
      }

      physicsCount++;
    };

    physicsStartTimeoutId = setTimeout(() => {
      if (this.stopped) return;
      physicsTick();
      physicsIntervalId = setInterval(physicsTick, PHYSICS_INTERVAL_MS);
    }, SIM_LEAD_IN_MS);

    // ── Agent loop: runs exactly totalCycles times, advancing logical sim clock ──
    const runAgentLoop = async () => {
      // Hold the same lead-in as the physics loop so no agent transmissions
      // can stream while the client's loading overlay is fading out.
      await new Promise(r => setTimeout(r, SIM_LEAD_IN_MS));
      while (this._agentRunCount < totalCycles && !this.stopped) {
        while (this.paused && !this.stopped) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (this.stopped) break;

        this._agentRunCount++;
        this._logicalElapsedHours = Math.min(durationHours, this._agentRunCount * LOGICAL_MINUTES_PER_CYCLE / 60);
        const simTimeStr = new Date(simStartSim.getTime() + this._logicalElapsedHours * 3_600_000).toISOString();
        console.log(`[Sequencer] Agent Run ${this._agentRunCount}/${totalCycles} — ${formatElapsedHours(this._logicalElapsedHours)} (${simTimeStr})`);

        await this._runAgentCycle(scenarioInput, this._agentRunCount, simTimeStr, this._logicalElapsedHours, weather, ws);
      }
      this.stopped = true; // signal physics loop to stop
    };

    await runAgentLoop();
    // Brief grace period for the physics loop to observe this.stopped and flush final state
    await new Promise(r => setTimeout(r, 600));
    clearTimeout(physicsStartTimeoutId);
    clearInterval(physicsIntervalId);

    const executiveSummary = await generateExecutiveSummary(
      this.stateManager.state.agent_transcripts,
      this.stateManager.state.playbook_sections,
      this.stateManager.state,
      { durationHours, elapsedHours: this._lastElapsedHours },
    );
    const playbook = generatePlaybook(
      this.stateManager.state.playbook_sections,
      scenarioInput,
      this.stateManager.state,
      { durationHours, elapsedHours: this._lastElapsedHours },
      executiveSummary,
    );
    this.sendToClient(ws, {
      type: 'playbook_ready',
      payload: { simulation_id: 'sim-' + Date.now(), playbook_json: playbook },
    });

    console.log('[Sequencer] Simulation complete');
  }

  async _runAgentCycle(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, ws) {
    const disasterAgent = this.agents.find(a => a.name === 'disaster');
    const evacuationAgent = this.agents.find(a => a.name === 'evacuation');
    const congestionAgent = this.agents.find(a => a.name === 'traffic');
    const resourceAgent = this.agents.find(a => a.name === 'resource');
    const synthesisAgent = this.agents.find(a => a.name === 'synthesis');

    const disasterOut = await this._runAgent(
      disasterAgent,
      this._buildContext(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, []),
      ws, agentRun, elapsedHours,
    );
    const cycleOutputs = [disasterOut];
    if (this.stopped) return;
    await this._interruptibleDelay(800);

    // Run sequentially to avoid Gemini rate limits
    if (this.stopped) return;
    const evacOut = await this._runAgent(evacuationAgent, this._buildContext(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, cycleOutputs), ws, agentRun, elapsedHours);

    // Guarantee at least one evacuation flow per cycle so cars/particles have something to animate.
    this._ensureEvacuationFlow(ws, agentRun, elapsedHours);
    await new Promise(r => setImmediate(r)); // yield for physics

    if (this.stopped) return;
    await this._interruptibleDelay(800);

    if (this.stopped) return;
    const congestionOut = await this._runAgent(congestionAgent, this._buildContext(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, cycleOutputs), ws, agentRun, elapsedHours);
    cycleOutputs.push(evacOut, congestionOut);

    if (this.stopped) return;
    await this._interruptibleDelay(800);

    if (this.stopped) return;
    const resourceOut = await this._runAgent(
      resourceAgent,
      this._buildContext(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, cycleOutputs),
      ws, agentRun, elapsedHours,
    );
    await this._ensureGroundResourceDeployment(ws, resourceOut, agentRun, elapsedHours);
    cycleOutputs.push(resourceOut);

    if (this.stopped) return;
    await this._interruptibleDelay(800);

    if (this.stopped) return;
    await this._runAgent(
      synthesisAgent,
      this._buildContext(scenarioInput, agentRun, simTimeStr, elapsedHours, weather, cycleOutputs),
      ws, agentRun, elapsedHours,
    );

    const conflicts = detectConflicts(cycleOutputs);
    if (conflicts.length > 0) {
      console.log('[Sequencer] Conflicts:', conflicts);
    }
  }

  _currentPhysicsElapsedHours(durationHours) {
    // Fixed delta per tick — ensures consistent pacing that doesn't outrun the agent loop.
    // Each 500ms tick advances sim time by a visible amount for smooth fire growth.
    // Rate: LOGICAL_MINUTES_PER_CYCLE (30 min) over DEMO_AGENT_CYCLE_MS (30s) = 1 sim min per real second.
    const deltaHours = (PHYSICS_INTERVAL_MS / DEMO_AGENT_CYCLE_MS) * (LOGICAL_MINUTES_PER_CYCLE / 60);
    this._physicsElapsedHours = (this._physicsElapsedHours || 0) + deltaHours;
    return Math.min(durationHours, this._physicsElapsedHours);
  }

  async _interruptibleDelay(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.stopped) return;
      await new Promise(r => setTimeout(r, 50));
    }
  }

  async _runAgent(agent, context, ws, tick, elapsedHours) {
    let fullText = '';
    for await (const chunk of agent.stream(context)) {
      while (this.paused && !this.stopped) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.stopped) break;
      fullText += chunk;
      this._sendAgentText(ws, agent.name, chunk, false);
    }
    this._sendAgentText(ws, agent.name, '', true);

    // Yield to let physics loop fire before heavy sync processing
    await new Promise(r => setImmediate(r));

    const mapEvents = agent.extractMapEvents(fullText);
    for (let i = 0; i < mapEvents.length; i++) {
      // Yield between each event so physics loop can fire
      if (i > 0) await new Promise(r => setImmediate(r));

      const event = mapEvents[i];
      const eventsToApply = event.type === 'deploy_resource'
        ? this._expandResourceDeployment(event, i, elapsedHours)
        : [event];

      for (let j = 0; j < eventsToApply.length; j++) {
        const expandedEvent = eventsToApply[j];
        const physicsTime = this._physicsElapsedHours;
        if (expandedEvent.type === 'deploy_resource') {
          this._normalizeResourceDeployment(expandedEvent, i + j);
          this._attachDispatchPlan(expandedEvent, physicsTime);
        }
        const enrichedEvent = {
          ...expandedEvent,
          ui_message: expandedEvent.ui_message || this._defaultUiMessage(expandedEvent),
          action_id: expandedEvent.action_id || `${agent.name}-${tick}-${i}-${j}-${expandedEvent.type}`,
          source_agent: agent.name,
          action_location: expandedEvent.action_location || this._actionLocationForEvent(expandedEvent),
          agent: agent.name,
          tick,
          elapsed_hours: physicsTime,
        };
        const derivedEvents = this.stateManager.applyEvent(enrichedEvent) || [];
        this._sendMapEvent(ws, agent.name, enrichedEvent, tick);
        this._sendDerivedMapEvents(ws, agent.name, enrichedEvent, derivedEvents, tick, physicsTime);
      }
    }

    // Yield again after all events applied
    await new Promise(r => setImmediate(r));

    this.stateManager.state.agent_transcripts.push({
      cycle: tick,
      agent: agent.name,
      text: fullText,
      elapsed_hours: elapsedHours,
    });

    if (this.ttsMode) {
      // Sequential TTS: synthesize, send, then await client ack before returning.
      // If synthesis fails (null buffer), skip the wait so the sim never deadlocks.
      let audioBuffer = null;
      try { audioBuffer = await synthesize(agent.name, fullText); } catch { /* optional */ }
      if (audioBuffer && !this.stopped) {
        // Register waiter BEFORE sending so a fast audio_done ack never races past it.
        const key = `${agent.name}:${tick}`;
        const ackPromise = new Promise((resolve) => {
          const timer = setTimeout(() => {
            this._audioWaiters.delete(key);
            console.warn(`[TTS] audio_done timeout for ${key}`);
            resolve();
          }, 30000);
          this._audioWaiters.set(key, { resolve, timer });
        });
        this.sendToClient(ws, {
          type: 'agent_audio',
          payload: { agent: agent.name, audio_base64: audioBuffer.toString('base64'), tick },
        });
        await ackPromise;
      }
    }

    return { agent: agent.name, text: fullText, mapEvents };
  }

  async _ensureGroundResourceDeployment(ws, resourceOut, tick, elapsedHours) {
    const emittedTypes = new Set(
      (resourceOut?.mapEvents || [])
        .filter(event => event.type === 'deploy_resource')
        .map(event => event.resource_type),
    );
    const neededTypes = ['engine', 'dozer'].filter(type => !emittedTypes.has(type));
    if (neededTypes.length === 0) return;

    for (const type of neededTypes) {
      const deployments = this._plannedResourceDeployments(type, elapsedHours);
      for (let index = 0; index < deployments.length; index++) {
        // Yield between deployments so physics loop can fire
        if (index > 0) await new Promise(r => setImmediate(r));
        const deployment = deployments[index];
        const physicsTime = this._physicsElapsedHours;
        const event = {
          type: 'deploy_resource',
          resource_type: type,
          location: deployment.location,
          count: deployment.count,
          assignment: type === 'dozer' ? 'Cut containment line at the fire edge' : 'Engine strike team staging at the fire edge',
          from_station_id: deployment.station.id,
          from_location: [deployment.station.lng, deployment.station.lat],
          ui_message: type === 'dozer' ? `${deployment.count} dozers dispatched to fire line` : `${deployment.count} engines dispatched to fire line`,
          action_id: `resource-${tick}-guaranteed-${type}-${index}`,
          source_agent: 'resource',
          action_location: deployment.location,
          agent: 'resource',
          tick,
          elapsed_hours: physicsTime,
          _unit_index: index,
        };
        this._attachDispatchPlan(event, physicsTime);
        console.log(`[Resource] Deployed ${type} group=${event.resource_group_id || event.action_id} physics=${physicsTime.toFixed(3)}h arrival=${event.arrival_elapsed_hours}h travel=${event.travel_hours}h`);
        const derivedEvents = this.stateManager.applyEvent(event) || [];
        this._sendMapEvent(ws, 'resource', event, tick);
        this._sendDerivedMapEvents(ws, 'resource', event, derivedEvents, tick, physicsTime);
      }
    }
  }

  _expandResourceDeployment(event, index, elapsedHours) {
    const rawType = String(event.resource_type || '').toLowerCase();
    const resourceType = rawType.includes('dozer') ? 'dozer' : 'engine';
    const deployments = this._plannedResourceDeployments(resourceType, elapsedHours, Number(event.count) || null);
    return deployments.map((deployment, deploymentIndex) => ({
      ...event,
      resource_type: resourceType,
      location: deployment.location,
      count: deployment.count,
      from_station_id: deployment.station.id,
      from_location: [deployment.station.lng, deployment.station.lat],
      action_id: event.action_id ? `${event.action_id}-${deploymentIndex}` : undefined,
      action_location: deployment.location,
      ui_message: resourceType === 'dozer'
        ? `${deployment.count} dozers cutting line near the head`
        : `${deployment.count} engines deployed around the flank`,
      _staged: true,
      _staging_index: index + deploymentIndex,
      _unit_index: deploymentIndex,
    }));
  }

  _normalizeResourceDeployment(event, index = 0) {
    const rawType = String(event.resource_type || '').toLowerCase();
    event.resource_type = rawType.includes('dozer') ? 'dozer' : 'engine';

    // Backend geometry is the source of truth for staging. This keeps dozers
    // around the head and engines spread across the flanks.
    if (!event._staged) {
      event.location = this._resourceStagingPoint(event.resource_type, index);
    }

    const fromInFire = Array.isArray(event.from_location) &&
      event.from_location.length === 2 &&
      this._isLocationInFire(event.from_location);

    if (!Array.isArray(event.from_location) || event.from_location.length !== 2 || fromInFire) {
      const station = this._nearestFireStation(event.location, new Set(), event.resource_type);
      event.from_station_id = station.id;
      event.from_location = [station.lng, station.lat];
    }

    const fallbackCount = this._resourceCountFor(event.resource_type, event.elapsed_hours ?? this._lastElapsedHours);
    event.count = event._staged
      ? Math.max(1, Number(event.count) || 1)
      : Math.max(1, Number(event.count) || fallbackCount, fallbackCount);
  }

  _plannedResourceDeployments(resourceType, elapsedHours = 0, requestedCount = null) {
    const availableTotal = this._availableResourceTotal(resourceType);
    if (availableTotal <= 0) return [];
    const desiredCount = Math.max(1, Number(requestedCount) || this._resourceCountFor(resourceType, elapsedHours));
    const totalCount = Math.min(desiredCount, availableTotal);
    // Scale dispatch groups sub-linearly with total count so larger fires send more
    // visible strike teams while keeping animations and suppression zones manageable.
    // Each group carries count = totalCount / units so resource numbers stay accurate.
    const maxUnits = resourceType === 'dozer' ? 5 : 7;
    const units = Math.min(maxUnits, Math.max(1, Math.ceil(Math.sqrt(totalCount / 3))));
    const usedStations = new Set();

    return Array.from({ length: units }, (_, index) => {
      const location = this._resourceStagingPoint(resourceType, index);
      const station = this._nearestFireStation(location, usedStations, resourceType);
      if (usedStations.size < 8) usedStations.add(station.id);
      return {
        location,
        station,
        count: Math.max(1, Math.round(totalCount / units)),
      };
    });
  }

  _availableResourceTotal(resourceType) {
    const stations = Object.values(this.stateManager.state.resources?.stations || {});
    if (stations.length === 0) return Infinity;
    const key = resourceType === 'dozer' ? 'dozers_available' : 'engines_available';
    return stations
      .filter(station => this._canStationDispatch(station, resourceType))
      .reduce((sum, station) => sum + Math.max(0, Math.round(Number(station[key]) || 0)), 0);
  }

  _attachDispatchPlan(event, elapsedHours) {
    if (!Array.isArray(event.from_location) || !Array.isArray(event.location)) return;
    const path = this._buildResourceDispatchPath(event.from_location, event.location);
    const distanceKm = this._pathDistanceKm(path);
    const unitIndex = Number(event._unit_index ?? event._staging_index ?? 0) || 0;
    const travelHours = this._travelHoursForResource(event.resource_type, distanceKm) + unitIndex * 0.012;
    event.dispatch_path = path;
    event.dispatch_distance_km = Number(distanceKm.toFixed(2));
    event.travel_hours = Number(travelHours.toFixed(2));
    event.arrival_elapsed_hours = Number((Number(elapsedHours || 0) + travelHours).toFixed(3));
  }

  _buildResourceDispatchPath(from, to) {
    const direct = [from, to];
    if (!this._pathIntersectsFire(direct)) return direct;

    const perim = this.stateManager.state.fire.perimeter_geojson?.features?.[0];
    const bbox = perim ? turf.bbox(perim) : null;
    if (!bbox) return direct;

    const pad = 0.035;
    const [west, south, east, north] = bbox;
    const candidates = [
      [from, [from[0], north + pad], [to[0], north + pad], to],
      [from, [from[0], south - pad], [to[0], south - pad], to],
      [from, [west - pad, from[1]], [west - pad, to[1]], to],
      [from, [east + pad, from[1]], [east + pad, to[1]], to],
      [from, [west - pad, from[1]], [west - pad, north + pad], [to[0], north + pad], to],
      [from, [east + pad, from[1]], [east + pad, north + pad], [to[0], north + pad], to],
      [from, [west - pad, from[1]], [west - pad, south - pad], [to[0], south - pad], to],
      [from, [east + pad, from[1]], [east + pad, south - pad], [to[0], south - pad], to],
    ];

    const valid = candidates
      .map(path => this._dedupePath(path))
      .filter(path => !this._pathIntersectsFire(path))
      .sort((a, b) => this._pathDistanceKm(a) - this._pathDistanceKm(b));

    if (valid[0]) return valid[0];

    for (const multiplier of [1.8, 2.6, 3.5]) {
      const widePad = pad * multiplier;
      const wideCandidates = [
        [from, [from[0], north + widePad], [to[0], north + widePad], to],
        [from, [from[0], south - widePad], [to[0], south - widePad], to],
        [from, [west - widePad, from[1]], [west - widePad, to[1]], to],
        [from, [east + widePad, from[1]], [east + widePad, to[1]], to],
      ]
        .map(path => this._dedupePath(path))
        .filter(path => !this._pathIntersectsFire(path))
        .sort((a, b) => this._pathDistanceKm(a) - this._pathDistanceKm(b));
      if (wideCandidates[0]) return wideCandidates[0];
    }

    return this._dedupePath([from, [west - pad, north + pad], [east + pad, north + pad], to]);
  }

  _getBufferedFirePerimeter() {
    const perim = this.stateManager.state.fire.perimeter_geojson?.features?.[0];
    if (!perim) return null;
    // Cache the buffered perimeter — regenerate only when the perimeter object changes
    const perimKey = perim.properties?.tick ?? perim.properties?.acres ?? 0;
    if (this._cachedFireBuffer && this._cachedFireBufferKey === perimKey) {
      return this._cachedFireBuffer;
    }
    try {
      this._cachedFireBuffer = turf.buffer(perim, 0.15, { units: 'kilometers' });
      this._cachedFireBufferKey = perimKey;
      return this._cachedFireBuffer;
    } catch (_) {
      return perim; // fallback to raw perimeter
    }
  }

  _pathIntersectsFire(pathCoords) {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return false;
    const buffered = this._getBufferedFirePerimeter();
    if (!buffered) return false;
    try {
      const line = turf.lineString(pathCoords);
      return turf.booleanIntersects(line, buffered) ||
        pathCoords.some(coord => turf.booleanPointInPolygon(turf.point(coord), buffered));
    } catch (_) {
      return false;
    }
  }

  _pathDistanceKm(pathCoords) {
    if (!Array.isArray(pathCoords) || pathCoords.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < pathCoords.length; i++) {
      total += this._distanceKm(pathCoords[i - 1], pathCoords[i]);
    }
    return total;
  }

  _travelHoursForResource(resourceType, distanceKm) {
    const speedKph = resourceType === 'dozer' ? 18 : 42;
    const setupHours = resourceType === 'dozer' ? 0.18 : 0.08;
    return Math.max(0.05, distanceKm / speedKph + setupHours);
  }

  _dedupePath(pathCoords) {
    return pathCoords.filter((coord, index, path) => {
      if (index === 0) return true;
      return this._distanceKm(coord, path[index - 1]) > 0.005;
    });
  }

  _resourceStagingPoint(resourceType, index = 0) {
    const fireFeature = this.stateManager.state.fire.perimeter_geojson?.features?.[0];
    const props = fireFeature?.properties || {};
    const windBearing = props.wind_bearing || this.stateManager.state.fire.spread_bearing || 0;
    const perimeterReady = fireFeature?.geometry?.type === 'Polygon';

    // Distribute evenly across 360 degrees. Dozers start at wind head, engines start at tail.
    const spreadAngle = 360 / 8; // Distribute at 45 degree intervals
    const baseBearing = resourceType === 'dozer' ? windBearing : (windBearing + 180) % 360;
    
    // index 0 -> 0, index 1 -> +45, index 2 -> -45, index 3 -> +90, etc.
    const sign = index % 2 === 0 ? 1 : -1;
    const mag = Math.ceil(index / 2) * spreadAngle;
    const bearing = (baseBearing + sign * mag + 360) % 360;

    if (perimeterReady) {
      const edge = this._perimeterPointAtBearing(fireFeature, bearing);
      if (edge) {
        return this._pointAtBearingAndDistance(edge, bearing, 0.3 + (index % 3) * 0.08);
      }
    }

    const origin = this.stateManager.state.scenario?.fireOrigin;
    const base = origin ? [origin.lng, origin.lat] : [-118.24, 34.05];
    return this._pointAtBearingAndDistance(base, bearing, resourceType === 'dozer' ? 2.0 : 1.2);
  }

  _resourceCountFor(resourceType, elapsedHours = 0) {
    const acres = Number(this.stateManager.state.fire.acres_burned) || 0;
    const hours = Math.max(0, Number(elapsedHours) || 0);
    if (resourceType === 'dozer') {
      return Math.min(24, Math.max(2, Math.ceil(acres / 350) + Math.ceil(hours / 2)));
    }
    return Math.min(80, Math.max(8, Math.ceil(acres / 80) + Math.ceil(hours * 2)));
  }

  _perimeterPointAtBearing(feature, bearingDeg) {
    const origin = this._fireOriginLngLat(feature);
    const ring = feature?.geometry?.coordinates?.[0] || [];
    if (!origin || ring.length === 0) return null;

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const coord of ring) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const coordBearing = this._bearing(origin, coord);
      const score = this._angularDistance(coordBearing, bearingDeg);
      if (score < bestScore) {
        bestScore = score;
        best = coord;
      }
    }
    return best;
  }

  _fireOriginLngLat(feature) {
    const props = feature?.properties || {};
    if (Array.isArray(props.origin)) return props.origin;
    const origin = this.stateManager.state.scenario?.fireOrigin;
    return origin ? [origin.lng, origin.lat] : null;
  }

  _isLocationInFire(lngLat) {
    const perimeter = this.stateManager.state.fire.perimeter_geojson;
    if (!perimeter?.features?.length) return false;
    try {
      const turf = require('@turf/turf');
      const point = turf.point(lngLat);
      return perimeter.features.some(feature => {
        try { return turf.booleanPointInPolygon(point, feature); } catch (_) { return false; }
      });
    } catch (_) {
      return false;
    }
  }

  _nearestFireStation(target, excludeIds = new Set(), resourceType = null) {
    const stationState = this.stateManager.state.resources?.stations || {};
    const infra = this.stateManager.state.baseData?.infrastructure || {};
    const sourceEntries = Object.keys(stationState).length > 0
      ? Object.entries(stationState)
      : Object.entries(infra).filter(([, value]) => value?.type === 'fire_station' && value.location);
    const availabilityKey = resourceType === 'dozer' ? 'dozers_available' : 'engines_available';
    const allStations = sourceEntries
      .map(([id, value]) => ({
        id,
        name: value.name || id,
        lng: Number(value.location.lng),
        lat: Number(value.location.lat),
        available: resourceType ? Number(value[availabilityKey]) : 1,
        status: value.status,
        operational_status: value.operational_status,
      }))
      .filter(station => Number.isFinite(station.lng) && Number.isFinite(station.lat))
      .filter(station => !this._isLocationInFire([station.lng, station.lat]));
    const inventoryStations = resourceType
      ? allStations.filter(station => this._canStationDispatch(station, resourceType))
      : allStations;
    const stations = inventoryStations.filter(station => !excludeIds.has(station.id));

    const candidates = stations.length > 0 ? stations : inventoryStations.length > 0 ? inventoryStations : allStations;
    if (candidates.length > 0) {
      return candidates
        .map(station => {
          const from = [station.lng, station.lat];
          const directPath = [from, target];
          const routePath = this._buildResourceDispatchPath(from, target);
          const crossesFire = this._pathIntersectsFire(directPath);
          return {
            ...station,
            dist: this._pathDistanceKm(routePath) + (crossesFire ? 3 : 0),
          };
        })
        .sort((a, b) => a.dist - b.dist)[0];
    }

    return {
      id: 'FS_SIMULATED',
      name: 'Simulated Fire Station',
      lng: target[0] - 0.035,
      lat: target[1] - 0.025,
    };
  }

  _canStationDispatch(station, resourceType) {
    if (!station) return false;
    const status = String(station.status || '').toLowerCase();
    const operationalStatus = String(station.operational_status || '').toLowerCase();
    if (['offline', 'damaged', 'burning', 'depleted'].includes(status)) return false;
    if (['offline', 'damaged', 'burning'].includes(operationalStatus)) return false;
    const key = resourceType === 'dozer' ? 'dozers_available' : 'engines_available';
    return Math.max(0, Math.round(Number(station[key]) || 0)) > 0;
  }

  _pointAtBearingAndDistance(center, bearingDeg, distanceKm) {
    const R = 6371;
    const lat1 = center[1] * Math.PI / 180;
    const lng1 = center[0] * Math.PI / 180;
    const bearing = bearingDeg * Math.PI / 180;
    const d = distanceKm / R;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(bearing),
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    return [
      Number((lng2 * 180 / Math.PI).toFixed(6)),
      Number((lat2 * 180 / Math.PI).toFixed(6)),
    ];
  }

  _distanceKm(a, b) {
    const R = 6371;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  _bearing(from, to) {
    const lat1 = from[1] * Math.PI / 180;
    const lat2 = to[1] * Math.PI / 180;
    const deltaLng = (to[0] - from[0]) * Math.PI / 180;
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  _angularDistance(angleA, angleB) {
    return Math.abs(((angleA - angleB + 540) % 360) - 180);
  }

  _defaultUiMessage(event) {
    switch (event.type) {
      case 'threat_zone':
        return event.zone_id ? `Threat zone updated: ${event.zone_id}` : 'Threat zone updated';
      case 'set_zone_status':
        return event.zone_id ? `Zone ${event.zone_id} set to ${event.status}` : 'Evacuation zone updated';
      case 'set_evacuation_flow':
        return event.from_zone ? `Evacuation flow started from ${event.from_zone}` : 'Evacuation flow started';
      case 'close_route':
        return event.route_id ? `Route ${event.route_id} closed` : 'Route closed';
      case 'open_route':
        return event.route_id ? `Route ${event.route_id} reopened` : 'Route reopened';
      case 'traffic_jam':
        return event.route_id ? `Traffic jam on ${event.route_id}` : 'Traffic jam detected';
      case 'deploy_resource':
        return `${event.count || ''} ${event.resource_type || 'resources'} deployed`.trim();
      case 'update_shelter':
        return event.shelter_id ? `Shelter ${event.shelter_id} updated` : 'Shelter updated';
      case 'infrastructure_status':
        return event.name ? `${event.name} marked ${event.status}` : 'Infrastructure status updated';
      case 'broadcast_alert':
        return event.channel ? `${event.channel} alert issued` : 'Public alert issued';
      case 'suppression_zone':
        return 'Suppression area established';
      case 'remove_suppression_zone':
        return 'Suppression assignment ended';
      case 'playbook_section':
        return 'Command plan updated';
      case 'tick_summary':
        return 'Command summary updated';
      default:
        return undefined;
    }
  }

  _actionLocationForEvent(event) {
    if (Array.isArray(event.location) && event.location.length === 2) return event.location;
    if (Array.isArray(event.from_location) && event.from_location.length === 2) return event.from_location;
    if (event.type === 'update_shelter' && event.shelter_id) {
      const shelter = this.stateManager.state.baseData?.shelters?.[event.shelter_id];
      if (shelter?.location) return [shelter.location.lng, shelter.location.lat];
    }
    if (event.type === 'infrastructure_status' && event.facility_id) {
      const facility = this.stateManager.state.baseData?.infrastructure?.[event.facility_id];
      if (facility?.location) return [facility.location.lng, facility.location.lat];
    }
    return undefined;
  }

  _sendDerivedMapEvents(ws, agentName, parentEvent, derivedEvents, tick, elapsedHours) {
    for (let i = 0; i < derivedEvents.length; i++) {
      const event = derivedEvents[i];
      const enriched = {
        ...event,
        ui_message: event.ui_message || this._defaultUiMessage(event),
        action_id: event.action_id || `${parentEvent.action_id}-derived-${i}-${event.type}`,
        source_agent: parentEvent.source_agent || agentName,
        agent: agentName,
        tick,
        elapsed_hours: elapsedHours,
      };
      const activeAfter = Number(enriched.active_after_elapsed_hours);
      if (enriched.type === 'suppression_zone' && Number.isFinite(activeAfter) && activeAfter > elapsedHours) {
        const delayMs = this._simHoursToWallMs(activeAfter - elapsedHours);
        setTimeout(() => {
          if (!this.stopped) this._sendMapEvent(ws, agentName, enriched, tick);
        }, delayMs);
      } else {
        this._sendMapEvent(ws, agentName, enriched, tick);
      }
    }
  }

  _simHoursToWallMs(hours) {
    const cycleHours = LOGICAL_MINUTES_PER_CYCLE / 60;
    return Math.max(0, Math.round((Number(hours) || 0) / cycleHours * DEMO_AGENT_CYCLE_MS));
  }

  /**
   * Ensure at least one evacuation flow is active, even if the Evacuation agent forgot
   * to emit one. Picks the highest-priority zone + the nearest open shelter and
   * synthesizes a set_evacuation_flow event.
   */
  _ensureEvacuationFlow(ws, agentRun, elapsedHours) {
    const s = this.stateManager.state;
    const existingFlows = s.evacuation.flows || [];
    const MIN_FLOWS = 5; // ensure the map always shows meaningful traffic activity
    if (existingFlows.length >= MIN_FLOWS) return;

    const zones = s.baseData?.zones || {};
    const shelters = s.baseData?.shelters || {};
    const zoneIds = Object.keys(zones);
    const shelterIds = Object.keys(shelters);
    if (zoneIds.length === 0 || shelterIds.length === 0) return;

    const fireOrigin = s.scenario?.fireOrigin;
    const usedPairs = new Set(existingFlows.map(f => `${f.from_zone}|${f.to_shelter}`));
    const usedZones = new Set(existingFlows.map(f => f.from_zone));

    const statusRank = { mandatory: 0, warning: 1, voluntary: 2, clear: 3 };
    const dynamicStatus = { ...(s.evacuation.derivedZones || {}), ...(s.evacuation.zones || {}) };

    // Rank zones by (dynamic evacuation severity, then proximity to fire).
    const rankedZones = zoneIds
      .filter(id => !usedZones.has(id))
      .map(id => {
        const zone = zones[id];
        const zLng = Number(zone.centroid_lng);
        const zLat = Number(zone.centroid_lat);
        const distToFire = fireOrigin && Number.isFinite(zLng) && Number.isFinite(zLat)
          ? Math.hypot(zLng - fireOrigin.lng, zLat - fireOrigin.lat)
          : Infinity;
        return {
          id,
          rank: statusRank[dynamicStatus[id]] ?? 4,
          pop: Number(zone.population) || 0,
          distToFire,
        };
      })
      .sort((a, b) => a.rank - b.rank || a.distToFire - b.distToFire || b.pop - a.pop);

    const flowsAdded = [];
    const need = MIN_FLOWS - existingFlows.length;
    for (const picked of rankedZones) {
      if (flowsAdded.length >= need) break;
      const zone = zones[picked.id];
      if (!zone) continue;
      const zLng = Number(zone.centroid_lng);
      const zLat = Number(zone.centroid_lat);
      if (!Number.isFinite(zLng) || !Number.isFinite(zLat)) continue;

      let best = null;
      for (const sid of shelterIds) {
        const sh = shelters[sid];
        const dyn = s.resources.shelters?.[sid];
        if (dyn?.status === 'full' || dyn?.status === 'closed') continue;
        if (usedPairs.has(`${picked.id}|${sid}`)) continue;
        const lng = sh.location?.lng;
        const lat = sh.location?.lat;
        if (lng == null || lat == null) continue;
        const d = Math.hypot(lng - zLng, lat - zLat);
        if (!best || d < best.d) best = { id: sid, d };
      }
      if (!best) continue;

      const population = Math.max(500, Math.round((Number(zone.population) || 2000) * 0.5));
      const event = {
        type: 'set_evacuation_flow',
        from_zone: picked.id,
        to_shelter: best.id,
        population,
        ui_message: `Evacuation flow started from ${picked.id}`,
        action_id: `evacuation-${agentRun}-synthetic-flow-${flowsAdded.length}`,
        source_agent: 'evacuation',
        action_location: [zLng, zLat],
        agent: 'evacuation',
        tick: agentRun,
        elapsed_hours: elapsedHours,
      };
      this.stateManager.applyEvent(event);
      this._sendMapEvent(ws, 'evacuation', event, agentRun);
      usedPairs.add(`${picked.id}|${best.id}`);
      flowsAdded.push(`${picked.id}→${best.id}`);
    }
    if (flowsAdded.length > 0) {
      console.log(`[Sequencer] Synthesized ${flowsAdded.length} evacuation flow(s): ${flowsAdded.join(', ')}`);
    }
  }

  _refreshTrafficState(ws, elapsedHours, tick) {
    try {
      const baseRoutes = this.stateManager.state.baseData?.routes || {};
      const baseZones = this.stateManager.state.baseData?.zones || {};
      const currentPerim = this.stateManager.state.fire.perimeter_geojson;
      const congestion = computeCongestion(
        this.stateManager.state.evacuation,
        baseRoutes,
        currentPerim,
        baseZones,
      );
      if (congestion.length === 0) return;

      const signature = JSON.stringify(
        congestion.map((route) => [route.route_id, route.status, route.load_pct]),
      );
      const event = {
        type: 'traffic_congestion',
        routes: congestion,
        elapsed_hours: elapsedHours,
        ui_message: this._trafficUiMessage(congestion),
        action_id: `traffic-${tick}-refresh`,
        source_agent: 'traffic',
        agent: 'traffic',
      };
      this.stateManager.applyEvent(event);
      if (signature !== this._lastTrafficSignature) {
        this._lastTrafficSignature = signature;
        this._sendMapEvent(ws, 'resource', event, tick);
      }
    } catch (err) {
      console.warn('[Sequencer] Traffic refresh failed:', err.message);
    }
  }

  _trafficUiMessage(congestion) {
    const closed = congestion.find((route) => route.status === 'closed');
    if (closed) return `Route ${closed.route_id} closed`;
    const jammed = congestion
      .filter((route) => route.status === 'congested')
      .sort((a, b) => (b.load_pct || 0) - (a.load_pct || 0))[0];
    if (jammed) return `Congestion building on ${jammed.route_id}`;
    return undefined;
  }

  _buildFireBehaviorEvent(perimeter, elapsedHours) {
    const feature = perimeter?.features?.[0];
    const props = feature?.properties || {};
    const scenarioOrigin = this.stateManager.state.scenario?.fireOrigin;
    const origin = Array.isArray(props.origin)
      ? props.origin
      : scenarioOrigin
        ? [scenarioOrigin.lng, scenarioOrigin.lat]
        : null;
    const head = Array.isArray(props.head_position)
      ? props.head_position
      : origin;
    const spotCount = (perimeter?.features || []).filter(f => f.properties?.spot_fire).length;

    return {
      type: 'fire_behavior',
      origin,
      head,
      bearing: props.wind_bearing ?? this.stateManager.state.fire.spread_bearing ?? 0,
      wind_u: props.wind_u ?? 0,
      wind_v: props.wind_v ?? 0,
      spread_rate_acres_hr: props.spread_rate ?? this.stateManager.state.fire.spread_rate_acres_hr ?? 0,
      spot_fire_count: spotCount,
      elapsed_hours: elapsedHours,
      ui_message: spotCount > 0 ? `${spotCount} ember spot fire${spotCount === 1 ? '' : 's'} ahead of the front` : undefined,
    };
  }

  _refreshFireImpacts(ws, elapsedHours, tick) {
    const perimeter = this.stateManager.state.fire.perimeter_geojson;
    const events = this.stateManager.computeFireImpactEvents(perimeter, elapsedHours);
    if (events.length === 0) return;

    const signature = JSON.stringify(events.map((event) => [event.type, event.facility_id || event.shelter_id, event.status]));
    if (signature === this._lastImpactSignature) return;
    this._lastImpactSignature = signature;

    for (const event of events) {
      const enriched = {
        ...event,
        action_id: event.action_id || `fire-impact-${tick}-${event.facility_id || event.shelter_id || event.type}`,
        source_agent: 'disaster',
        action_location: event.action_location || this._actionLocationForEvent(event),
        agent: 'disaster',
        tick,
        elapsed_hours: elapsedHours,
      };
      this.stateManager.applyEvent(enriched);
      this._sendMapEvent(ws, 'disaster', enriched, tick);
    }
  }

  /**
   * List the 5 nearest fire stations to the fire origin for the Resource agent.
   * Returned as a plain-text block the agent must use when picking dispatch origins.
   */
  _buildFireStationContext(fireOrigin) {
    const stationState = this.stateManager.state.resources?.stations || {};
    const infra = this.stateManager.state.baseData?.infrastructure || {};
    const sourceEntries = Object.keys(stationState).length > 0
      ? Object.entries(stationState)
      : Object.entries(infra).filter(([, v]) => v && v.type === 'fire_station' && v.location);
    const stations = sourceEntries
      .map(([id, v]) => ({
        id,
        name: v.name || id,
        lng: v.location.lng,
        lat: v.location.lat,
        engines: Math.max(0, Math.round(Number(v.engines_available ?? 6) || 0)),
        dozers: Math.max(0, Math.round(Number(v.dozers_available ?? 1) || 0)),
        engines_available: Math.max(0, Math.round(Number(v.engines_available ?? 6) || 0)),
        dozers_available: Math.max(0, Math.round(Number(v.dozers_available ?? 1) || 0)),
        status: v.status,
        operational_status: v.operational_status,
        dist: Math.hypot(v.location.lng - fireOrigin.lng, v.location.lat - fireOrigin.lat),
      }))
      .filter(st => Object.keys(stationState).length === 0 || this._canStationDispatch(st, 'engine') || this._canStationDispatch(st, 'dozer'))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
    if (stations.length === 0) return '';
    const lines = stations.map(
      st => `- ${st.id} | ${st.name} | [${st.lng.toFixed(5)}, ${st.lat.toFixed(5)}] | engines available: ${st.engines}, dozer teams available: ${st.dozers}`,
    );
    return `AVAILABLE FIRE STATIONS (pick one for each deploy_resource.from_station_id / from_location):\n${lines.join('\n')}`;
  }

  _generatePhysicalFeedback() {
    const s = this.stateManager.state;
    const feedback = [];

    // Check suppression zones
    const suppressionZones = s.fire.suppression_zones || [];
    if (suppressionZones.length > 0) {
      const activeTypes = [...new Set(suppressionZones.map(z => z.type))];
      feedback.push(`PHYSICAL IMPACT: Deployed ${activeTypes.join(' and ')} units are currently providing localized suppression. Fire spread has been modified in these sectors.`);
    }

    // Check infrastructure intersections
    const offlineInfra = Object.values(s.infrastructure.facilities).filter(f => f.status === 'offline');
    if (offlineInfra.length > 0) {
      feedback.push(`CRITICAL ALERT: The fire perimeter has physically intersected and disabled the following infrastructure: ${offlineInfra.map(f => f.name).join(', ')}.`);
    }

    // Check road intersections
    const closedByFire = (s.evacuation.route_congestion || []).filter(r => r.status === 'closed');
    if (closedByFire.length > 0) {
      feedback.push(`ROUTE UPDATE: The following routes are now PHYSICALLY CLOSED due to fire intersection: ${closedByFire.map(r => r.route_id).join(', ')}.`);
    }

    return feedback.length > 0 ? '\nPHYSICAL FEEDBACK FROM SIMULATION ENGINE:\n' + feedback.join('\n') : '';
  }

  _buildContext(scenarioInput, agentRun, simTime, elapsedHours, weather, priorOutputs) {
    const sc = scenarioInput;
    const physicalFeedback = this._generatePhysicalFeedback();
    const parts = [
      `SCENARIO: ${sc.location}`,
      `FIRE ORIGIN: lat=${sc.fireOrigin.lat}, lng=${sc.fireOrigin.lng}`,
      `BBOX (W,S,E,N): ${sc.bbox.join(', ')}`,
      `SIMULATION TIME: ${simTime}`,
      `TIME ELAPSED: ${formatElapsedHours(elapsedHours)} of ${formatElapsedHours(sc.durationHours || DEFAULT_DURATION_HOURS)} (Agent Run ${agentRun} — Continuous Real-Time Simulation)`,
      (() => { const { speedMph, fromDeg } = uvToHuman(weather.windU ?? DEFAULT_WIND_U, weather.windV ?? DEFAULT_WIND_V); return `WEATHER CONDITIONS: Temperature ${weather.temperature}°F, Humidity ${weather.humidity}%, Wind ${speedMph}mph from ${fromDeg}° (gusts to ${weather.windGusts}mph)`; })(),
      `PM2.5 Air Quality: ${weather.pm25} µg/m³`,
      this.stateManager.getContext(),
      this._buildFireStationContext(sc.fireOrigin),
      physicalFeedback,
    ];

    if (priorOutputs.length > 0) {
      parts.push('\nPRIOR AGENT OUTPUTS THIS CYCLE:');
      for (const output of priorOutputs) {
        parts.push(`--- ${output.agent.toUpperCase()} ---`);
        parts.push(output.text.substring(0, 1000));
      }
    }

    const full = parts.join('\n\n');
    // Hard cap: Gemini Flash allows ~1M tokens but we stay well under for reliability
    const MAX_CHARS = 24_000;
    return full.length > MAX_CHARS ? full.slice(0, MAX_CHARS) + '\n...[context trimmed]' : full;
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

  pause() {
    this.paused = true;
    this._pausedAtWallMs = Date.now();
  }
  resume() {
    if (this._pausedAtWallMs != null) {
      // Shift the sim start forward so paused time doesn't count toward elapsed hours
      this._simStartWallMs += Date.now() - this._pausedAtWallMs;
      this._pausedAtWallMs = null;
    }
    this.paused = false;
  }
  stop() {
    this.stopped = true;
    // Unblock any pending audio ack waiters so the sim loop can exit cleanly.
    if (this._audioWaiters) {
      for (const { resolve, timer } of this._audioWaiters.values()) {
        clearTimeout(timer);
        resolve();
      }
      this._audioWaiters.clear();
    }
  }

  _resolveAudioAck(agent, tick) {
    if (!this._audioWaiters) return;
    const key = `${agent}:${tick}`;
    const waiter = this._audioWaiters.get(key);
    if (waiter) {
      clearTimeout(waiter.timer);
      this._audioWaiters.delete(key);
      waiter.resolve();
    }
  }

  /**
   * Run a "what-if" branch simulation.
   */
  async runBranch(scenarioModifier, ws, branchId) {
    if (this.branchInProgress) {
      console.warn('[Sequencer] Branch already in progress, skipping.');
      return;
    }
    this.branchInProgress = true;

    try {
      const BRANCH_HOURS = 3;
      const BRANCH_AGENTS = ['disaster', 'evacuation', 'synthesis'];

      // Fork state from current snapshot
      const forkedState = JSON.parse(JSON.stringify(this.stateManager.state));
      const branchState = new (require('../simulation/stateManager').StateManager)();
      branchState.state = forkedState;

      const branchAgents = this.agents.filter(a => BRANCH_AGENTS.includes(a.name));
      // Branch weather starts as U/V equivalent of 70 mph from NE (45° FROM)
      let branchFromDeg = 45;
      let branchSpeedMph = 70;
      const weather = { temperature: 75, humidity: 8, windGusts: 95 };

      // Expanded weather parser — parse natural-language modifier into FROM degrees + mph
      const dirMap = {
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
      };
      for (const [dir, deg] of Object.entries(dirMap)) {
        if (new RegExp(`\\b${dir}\\b|${dir.toLowerCase()}`, 'i').test(scenarioModifier)) {
          branchFromDeg = deg;
          break;
        }
      }
      const speedMatch = scenarioModifier.match(/(\d+)\s*mph/i);
      if (speedMatch) branchSpeedMph = parseInt(speedMatch[1], 10);

      const { windU: bWindU, windV: bWindV } = fromDegToUV(branchFromDeg, branchSpeedMph);
      weather.windU = bWindU;
      weather.windV = bWindV;

      const currentFire = forkedState.fire?.perimeter_geojson?.features?.[0];
      let fireCenter = [-118.53, 34.04];
      if (currentFire?.geometry?.coordinates?.[0]?.[0]) {
        const coords = currentFire.geometry.coordinates[0];
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        fireCenter = [cx, cy];
      }
      const { WildfireEngine: _BranchWE } = require('../simulation/wildfireEngine');
      const branchEngine = _BranchWE.fromUV(
        fireCenter,
        weather.windU,
        weather.windV,
        {
          humidity: weather.humidity,
          temperature: weather.temperature,
          pm25: weather.pm25,
        },
      );

      const startElapsed = this._lastElapsedHours;

      this._sendBranchEvent(ws, branchId, 'branch_start', {
        branch_id: branchId,
        modifier: scenarioModifier,
        base_elapsed: startElapsed,
      });

      const branchOutputs = [];

      for (let i = 1; i <= BRANCH_HOURS; i++) {
        const elapsedHours = startElapsed + i;

        // Generate branch fire perimeter
        const branchPerimeter = branchEngine.generatePerimeter(i);
        branchState.applyEvent({ type: 'update_fire_perimeter', geojson: branchPerimeter });
        this._sendBranchEvent(ws, branchId, 'branch_map_event', {
          agent: 'disaster',
          event: { type: 'update_fire_perimeter', geojson: branchPerimeter },
          tick: i,
        });

        const context = [
          `WHAT-IF BRANCH — MODIFIER: ${scenarioModifier}`,
          `DIVERGES FROM MAIN SIM AT ${formatElapsedHours(startElapsed)} ELAPSED`,
          `CURRENT BRANCH TIME: ${formatElapsedHours(elapsedHours)} elapsed`,
          (() => { const { speedMph, fromDeg } = uvToHuman(weather.windU, weather.windV); return `WEATHER CHANGE: Wind ${speedMph}mph from ${fromDeg}°`; })(),
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
              tick: i,
            });
          }
          this._sendBranchEvent(ws, branchId, 'branch_agent_text', { agent: agent.name, text: '', is_complete: true, tick: i });
          const mapEvents = agent.extractMapEvents(fullText);
          for (const event of mapEvents) branchState.applyEvent(event);
          branchOutputs.push({ agent: agent.name, text: fullText });
        }
      }
      this._sendBranchEvent(ws, branchId, 'branch_complete', { branch_id: branchId });
    } finally {
      this.branchInProgress = false;
    }
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
