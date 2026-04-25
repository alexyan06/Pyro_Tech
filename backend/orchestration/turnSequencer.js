const fs = require('fs');
const path = require('path');
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
const { generatePlaybook } = require('../playbook/generator');

const PHYSICS_INTERVAL_MS = 500;  // physics update cadence (real ms)
const LOGICAL_MINUTES_PER_CYCLE = 30;   // each agent cycle advances sim clock by 30 min
const DEMO_AGENT_CYCLE_MS = 30_000; // smooth visual time between agent turns
const DEFAULT_DURATION_HOURS = 6;
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
    this.stateManager.reset();
    this.paused = false;
    this.stopped = false;
    this._agentRunCount = 0;
    this._logicalElapsedHours = 0;
    this._lastElapsedHours = 0;
    this._lastTrafficSignature = '';
    this._cycleStartElapsedHours = 0;
    this._cycleTargetElapsedHours = 0;
    this._cycleStartWallMs = Date.now();
    this._lastImpactSignature = '';

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
    const weather = await fetchWeather(weatherLat, weatherLng);
    if (scenarioInput.metrics) {
      if (scenarioInput.metrics.wind != null) weather.windSpeed = scenarioInput.metrics.wind;
      if (scenarioInput.metrics.windDirection != null) weather.windDirection = scenarioInput.metrics.windDirection;
      if (scenarioInput.metrics.temp != null) weather.temperature = scenarioInput.metrics.temp;
      if (scenarioInput.metrics.humidity != null) weather.humidity = scenarioInput.metrics.humidity;
    }
    console.log('[Sequencer] Weather:', weather);

    const windBearing = weather.windDirection || 45;
    const windSpeed = weather.windSpeed || 40;
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
    physicsIntervalId = setInterval(() => {
      if (this.stopped) { clearInterval(physicsIntervalId); return; }
      if (this.paused) return;

      const elapsedSimHours = this._currentPhysicsElapsedHours(durationHours);
      this._lastElapsedHours = elapsedSimHours;
      const simTime = new Date(simStartSim.getTime() + elapsedSimHours * 3_600_000);
      const simTimeStr = simTime.toISOString();

      // Fire perimeter (grows continuously)
      let perimeter;
      const suppressionZones = this.stateManager.state.fire.suppression_zones || [];
      if (historicalPerimeters) {
        const approxTick = Math.max(1, Math.min(MAX_TICKS, Math.ceil(elapsedSimHours)));
        const stage = historicalPerimeters.features.find(f => f.properties.tick === approxTick)
          || historicalPerimeters.features[Math.min(approxTick - 1, historicalPerimeters.features.length - 1)];
        if (stage) {
          perimeter = engine.applySuppressionToPerimeter(
            { type: 'FeatureCollection', features: [stage] },
            Math.max(0.01, elapsedSimHours),
            suppressionZones,
          );
        } else {
          perimeter = engine.generatePerimeter(Math.max(0.01, elapsedSimHours), suppressionZones);
        }
      } else {
        perimeter = engine.generatePerimeter(Math.max(0.01, elapsedSimHours), suppressionZones);
      }
      this.stateManager.applyEvent({ type: 'update_fire_perimeter', geojson: perimeter });
      this._sendMapEvent(ws, 'disaster', { type: 'fire_update', geojson: perimeter }, this._agentRunCount);

      if (physicsCount % 4 === 0) {
        this._sendMapEvent(ws, 'disaster', this._buildFireBehaviorEvent(perimeter, elapsedSimHours), this._agentRunCount);
        this._refreshFireImpacts(ws, elapsedSimHours, this._agentRunCount);
      }

      // Continuous simulation clock
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
    }, PHYSICS_INTERVAL_MS);

    // ── Agent loop: runs exactly totalCycles times, advancing logical sim clock ──
    const runAgentLoop = async () => {
      while (this._agentRunCount < totalCycles && !this.stopped) {
        while (this.paused && !this.stopped) {
          await new Promise(r => setTimeout(r, 500));
        }
        if (this.stopped) break;

        this._agentRunCount++;
        this._cycleStartElapsedHours = this._lastElapsedHours;
        this._logicalElapsedHours = Math.min(durationHours, this._agentRunCount * LOGICAL_MINUTES_PER_CYCLE / 60);
        this._cycleTargetElapsedHours = this._logicalElapsedHours;
        this._cycleStartWallMs = Date.now();
        const simTimeStr = new Date(simStartSim.getTime() + this._logicalElapsedHours * 3_600_000).toISOString();
        console.log(`[Sequencer] Agent Run ${this._agentRunCount}/${totalCycles} — ${formatElapsedHours(this._logicalElapsedHours)} (${simTimeStr})`);

        await this._runAgentCycle(scenarioInput, this._agentRunCount, simTimeStr, this._logicalElapsedHours, weather, ws);
      }
      this.stopped = true; // signal physics loop to stop
    };

    await runAgentLoop();
    // Brief grace period for the physics loop to observe this.stopped and flush final state
    await new Promise(r => setTimeout(r, 600));
    clearInterval(physicsIntervalId);

    const playbook = generatePlaybook(
      this.stateManager.state.playbook_sections,
      scenarioInput,
      this.stateManager.state,
      { durationHours, elapsedHours: this._lastElapsedHours },
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
    this._ensureGroundResourceDeployment(ws, resourceOut, agentRun, elapsedHours);
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
    const start = this._cycleStartElapsedHours || 0;
    const target = this._cycleTargetElapsedHours || this._logicalElapsedHours || 0;
    if (target <= start) return Math.min(durationHours, target);
    const progress = Math.min(1, Math.max(0, (Date.now() - this._cycleStartWallMs) / DEMO_AGENT_CYCLE_MS));
    return Math.min(durationHours, start + (target - start) * progress);
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

    const mapEvents = agent.extractMapEvents(fullText);
    for (let i = 0; i < mapEvents.length; i++) {
      const event = mapEvents[i];
      if (event.type === 'deploy_resource') {
        this._normalizeResourceDeployment(event, i);
      }
      const enrichedEvent = {
        ...event,
        ui_message: event.ui_message || this._defaultUiMessage(event),
        action_id: event.action_id || `${agent.name}-${tick}-${i}-${event.type}`,
        source_agent: agent.name,
        action_location: event.action_location || this._actionLocationForEvent(event),
        agent: agent.name,
        tick,
        elapsed_hours: elapsedHours,
      };
      const derivedEvents = this.stateManager.applyEvent(enrichedEvent) || [];
      this._sendMapEvent(ws, agent.name, enrichedEvent, tick);
      this._sendDerivedMapEvents(ws, agent.name, enrichedEvent, derivedEvents, tick, elapsedHours);
    }

    // Fire-and-forget voice synthesis (non-blocking)
    synthesize(agent.name, fullText).then(audioBuffer => {
      if (audioBuffer) {
        this.sendToClient(ws, {
          type: 'agent_audio',
          payload: { agent: agent.name, audio_base64: audioBuffer.toString('base64'), tick },
        });
      }
    }).catch(() => { }); // voice is optional, swallow errors

    return { agent: agent.name, text: fullText, mapEvents };
  }

  _ensureGroundResourceDeployment(ws, resourceOut, tick, elapsedHours) {
    const emittedTypes = new Set(
      (resourceOut?.mapEvents || [])
        .filter(event => event.type === 'deploy_resource')
        .map(event => event.resource_type),
    );
    const neededTypes = ['engine', 'dozer'].filter(type => !emittedTypes.has(type));
    if (neededTypes.length === 0) return;

    neededTypes.forEach((type, index) => {
      const target = this._resourceStagingPoint(type, index);
      const station = this._nearestFireStation(target);
      const event = {
        type: 'deploy_resource',
        resource_type: type,
        location: target,
        count: type === 'dozer' ? 2 : 8,
        assignment: type === 'dozer' ? 'Cut containment line at the fire edge' : 'Engine strike team staging at the fire edge',
        from_station_id: station.id,
        from_location: [station.lng, station.lat],
        ui_message: type === 'dozer' ? '2 dozers dispatched to fire line' : '8 engines dispatched to fire line',
        action_id: `resource-${tick}-guaranteed-${type}`,
        source_agent: 'resource',
        action_location: target,
        agent: 'resource',
        tick,
        elapsed_hours: elapsedHours,
      };
      const derivedEvents = this.stateManager.applyEvent(event) || [];
      this._sendMapEvent(ws, 'resource', event, tick);
      this._sendDerivedMapEvents(ws, 'resource', event, derivedEvents, tick, elapsedHours);
    });
  }

  _normalizeResourceDeployment(event, index = 0) {
    const rawType = String(event.resource_type || '').toLowerCase();
    event.resource_type = rawType.includes('dozer') ? 'dozer' : 'engine';

    if (!Array.isArray(event.location) || event.location.length !== 2) {
      event.location = this._resourceStagingPoint(event.resource_type, index);
    }

    if (!Array.isArray(event.from_location) || event.from_location.length !== 2) {
      const station = this._nearestFireStation(event.location);
      event.from_station_id = event.from_station_id || station.id;
      event.from_location = [station.lng, station.lat];
    }

    event.count = Math.max(1, Number(event.count) || (event.resource_type === 'dozer' ? 2 : 8));
  }

  _resourceStagingPoint(resourceType, index = 0) {
    const fireFeature = this.stateManager.state.fire.perimeter_geojson?.features?.[0];
    const props = fireFeature?.properties || {};
    if (resourceType === 'dozer' && Array.isArray(props.head_position)) {
      return props.head_position;
    }
    if (resourceType === 'engine' && Array.isArray(props.center_position)) {
      const bearing = ((props.wind_bearing || this.stateManager.state.fire.spread_bearing || 0) + 95 + index * 20) % 360;
      return this._pointAtBearingAndDistance(props.center_position, bearing, 0.75);
    }

    const origin = this.stateManager.state.scenario?.fireOrigin;
    const base = origin ? [origin.lng, origin.lat] : [-118.24, 34.05];
    const bearing = ((this.stateManager.state.fire.spread_bearing || 45) + (resourceType === 'dozer' ? 0 : 100) + index * 20) % 360;
    return this._pointAtBearingAndDistance(base, bearing, resourceType === 'dozer' ? 1.4 : 0.9);
  }

  _nearestFireStation(target) {
    const infra = this.stateManager.state.baseData?.infrastructure || {};
    const stations = Object.entries(infra)
      .filter(([, value]) => value?.type === 'fire_station' && value.location)
      .map(([id, value]) => ({
        id,
        name: value.name || id,
        lng: Number(value.location.lng),
        lat: Number(value.location.lat),
      }))
      .filter(station => Number.isFinite(station.lng) && Number.isFinite(station.lat));

    if (stations.length > 0) {
      return stations
        .map(station => ({ ...station, dist: Math.hypot(station.lng - target[0], station.lat - target[1]) }))
        .sort((a, b) => a.dist - b.dist)[0];
    }

    return {
      id: 'FS_SIMULATED',
      name: 'Simulated Fire Station',
      lng: target[0] - 0.035,
      lat: target[1] - 0.025,
    };
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
      this._sendMapEvent(ws, agentName, enriched, tick);
    }
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
    const dynamicStatus = s.evacuation.zones || {};

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
      wind_speed: props.wind_speed ?? 0,
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
    const infra = this.stateManager.state.baseData?.infrastructure || {};
    const stations = Object.entries(infra)
      .filter(([, v]) => v && v.type === 'fire_station' && v.location)
      .map(([id, v]) => ({
        id,
        name: v.name || id,
        lng: v.location.lng,
        lat: v.location.lat,
        dist: Math.hypot(v.location.lng - fireOrigin.lng, v.location.lat - fireOrigin.lat),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5);
    if (stations.length === 0) return '';
    const lines = stations.map(
      st => `- ${st.id} | ${st.name} | [${st.lng.toFixed(5)}, ${st.lat.toFixed(5)}]`,
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
      `WEATHER CONDITIONS: Temperature ${weather.temperature}°F, Humidity ${weather.humidity}%, Wind ${weather.windSpeed}mph from ${weather.windDirection}° (gusts to ${weather.windGusts}mph)`,
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
      this._cycleStartWallMs += Date.now() - this._pausedAtWallMs;
      this._pausedAtWallMs = null;
    }
    this.paused = false;
  }
  stop() { this.stopped = true; }

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
      const weather = { temperature: 75, humidity: 8, windSpeed: 70, windDirection: 45, windGusts: 95 };

      // Expanded weather parser
      const dirMap = {
        N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
        S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5
      };
      for (const [dir, deg] of Object.entries(dirMap)) {
        if (new RegExp(`\\b${dir}\\b|${dir.toLowerCase()}`, 'i').test(scenarioModifier)) {
          weather.windDirection = deg;
          break;
        }
      }
      const speedMatch = scenarioModifier.match(/(\d+)\s*mph/i);
      if (speedMatch) weather.windSpeed = parseInt(speedMatch[1], 10);

      const currentFire = forkedState.fire?.perimeter_geojson?.features?.[0];
      let fireCenter = [-118.53, 34.04];
      if (currentFire?.geometry?.coordinates?.[0]?.[0]) {
        const coords = currentFire.geometry.coordinates[0];
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        fireCenter = [cx, cy];
      }
      const { WildfireEngine } = require('../simulation/wildfireEngine');
      const branchEngine = new WildfireEngine(
        fireCenter,
        weather.windDirection,
        weather.windSpeed,
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
          `WEATHER CHANGE: Wind ${weather.windSpeed}mph from ${weather.windDirection}°`,
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
