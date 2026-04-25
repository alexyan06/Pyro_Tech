const turf = require('@turf/turf');
const { planEvacuationRoute, planEvacuationRoutes } = require('./trafficModel');

class StateManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      fire: {
        perimeter_geojson: null,
        acres_burned: 0,
        spread_rate_acres_hr: 0,
        spread_bearing: 0,
        suppression_zones: [], // List of { geojson: Polygon, factor: 0.1-0.9 }
      },
      evacuation: {
        zones: {},
        total_evacuees: 0,
        ordered_to_evacuate: 0,
        departed_evacuees: 0,
        in_transit_evacuees: 0,
        sheltered_evacuees: 0,
        routes_closed: 0,
        closed_routes: [],
        flows: [],
        route_congestion: [],
        traffic_jams: [],
      },
      resources: {
        engines_deployed: 0,
        crews_deployed: 0,
        air_tankers_active: 0,
        shelters: {},
        deployments: [],
      },
      infrastructure: {
        facilities: {},
        facilities_offline: 0,
        power_shutoff_areas: 0,
        shutoff_area_ids: [],
      },
      communications: {
        alerts: [],
      },
      playbook_sections: [],
      tick_summaries: [],
      agent_transcripts: [],
    };
    this._lastEvolveElapsedHours = 0;
    // Cache for zone buffer polygons (computed once per zone, never change)
    this._zoneBufferCache = new Map();
    // Cache for zone bounding boxes ([minLng, minLat, maxLng, maxLat])
    this._zoneBboxCache = new Map();
  }

  _resolveZoneId(identifier) {
    if (!identifier) return null;
    const zones = this.state.baseData?.zones || {};
    if (zones[identifier]) return identifier; // Already an ID
    // Try to find by name (case-insensitive)
    const lowerId = identifier.toLowerCase();
    for (const [id, zone] of Object.entries(zones)) {
      if (zone.name && zone.name.toLowerCase() === lowerId) return id;
    }
    return identifier; // Fallback to whatever was provided
  }

  _resolveRouteId(identifier) {
    if (!identifier) return null;
    const routes = this.state.baseData?.routes || {};
    if (routes[identifier]) return identifier; // Already an ID
    const lowerId = identifier.toLowerCase();
    for (const [id, route] of Object.entries(routes)) {
      if (route.name && route.name.toLowerCase() === lowerId) return id;
    }
    return identifier;
  }

  _planFlow(fromZoneId, toShelterId) {
    const closedRoutes = new Set(this.state.evacuation?.closed_routes || []);
    return planEvacuationRoute(
      { from_zone: fromZoneId, to_shelter: toShelterId },
      this.state.baseData?.routes || {},
      this.state.baseData?.zones || {},
      this.state.baseData?.shelters || {},
      closedRoutes,
    );
  }

  _planFlowOptions(fromZoneId, toShelterId) {
    const closedRoutes = new Set(this.state.evacuation?.closed_routes || []);
    return planEvacuationRoutes(
      { from_zone: fromZoneId, to_shelter: toShelterId },
      this.state.baseData?.routes || {},
      this.state.baseData?.zones || {},
      this.state.baseData?.shelters || {},
      closedRoutes,
    );
  }

  _findAlternateShelter(fromZoneId, excludeShelterId = null) {
    const baseShelters = this.state.baseData?.shelters || {};
    const zone = this.state.baseData?.zones?.[fromZoneId];
    if (!zone) return null;

    let best = null;
    for (const [shelterId, shelter] of Object.entries(baseShelters)) {
      if (shelterId === excludeShelterId) continue;
      const dyn = this.state.resources.shelters?.[shelterId];
      const capacity = Number(dyn?.capacity ?? shelter.capacity ?? 0);
      const occupancy = Number(dyn?.occupancy || 0);
      if (capacity <= occupancy) continue;
      if (dyn?.status === 'closed') continue;
      const lng = shelter.location?.lng;
      const lat = shelter.location?.lat;
      if (lng == null || lat == null) continue;
      const distance = Math.hypot(lng - zone.centroid_lng, lat - zone.centroid_lat);
      if (!best || distance < best.distance) {
        best = { shelterId, distance };
      }
    }
    return best?.shelterId || null;
  }

  _upsertEvacuationFlow(fromZoneId, toShelterId, population, seed = {}) {
    if (!fromZoneId || !toShelterId || population <= 0) return;
    const routePlan = this._planFlow(fromZoneId, toShelterId);
    const routeOptions = this._planFlowOptions(fromZoneId, toShelterId);
    const idx = this.state.evacuation.flows.findIndex(
      (flow) => flow.from_zone === fromZoneId && flow.to_shelter === toShelterId,
    );

    if (idx >= 0) {
      const existing = this.state.evacuation.flows[idx];
      this.state.evacuation.flows[idx] = {
        ...existing,
        population: (Number(existing.population) || 0) + population,
        route_id: routePlan.route_id,
        distance_km: routePlan.distance_km,
        route_options: routeOptions,
      };
      return;
    }

    this.state.evacuation.flows.push({
      from_zone: fromZoneId,
      to_shelter: toShelterId,
      population,
      route_id: routePlan.route_id,
      distance_km: routePlan.distance_km,
      route_options: routeOptions,
      departed: seed.departed || 0,
      arrived: seed.arrived || 0,
    });
  }

  applyEvent(event) {
    const derivedEvents = [];
    switch (event.type) {
      case 'update_fire_perimeter':
        this.state.fire.perimeter_geojson = event.geojson;
        if (event.geojson?.features?.[0]?.properties?.tick != null) {
          this._pruneSuppressionZones(event.geojson.features[0].properties.tick);
        }
        if (event.geojson?.features?.[0]?.properties?.acres != null) {
          this.state.fire.acres_burned = event.geojson.features[0].properties.acres;
        }
        if (event.geojson?.features?.[0]?.properties?.spread_rate != null) {
          this.state.fire.spread_rate_acres_hr = event.geojson.features[0].properties.spread_rate;
        }
        if (event.geojson?.features?.[0]?.properties?.wind_bearing != null) {
          this.state.fire.spread_bearing = event.geojson.features[0].properties.wind_bearing;
        }
        break;

      case 'fire_spread_vector':
        this.state.fire.spread_bearing = event.bearing;
        break;

      case 'threat_zone': {
        const zoneId = this._resolveZoneId(event.zone_id);
        if (!zoneId) break;
        this.state.evacuation.zones[zoneId] = event.level === 'extreme' ? 'mandatory' : event.level === 'high' ? 'warning' : 'voluntary';
        // If the agent provided a new geometry for this zone, save it to baseData so the frontend can render it
        if (event.geojson) {
          if (!this.state.baseData) this.state.baseData = {};
          if (!this.state.baseData.zones) this.state.baseData.zones = {};
          this.state.baseData.zones[zoneId] = {
            zone_id: zoneId,
            name: event.zone_id, // Original provided name
            geometry: event.geojson,
            status: this.state.evacuation.zones[zoneId],
          };
        }
        break;
      }

      case 'set_zone_status': {
        const zoneId = this._resolveZoneId(event.zone_id);
        if (zoneId) this.state.evacuation.zones[zoneId] = event.status;
        // Evacuation counters are derived in evolve() from current zone statuses and flow progress.
        break;
      }

      case 'close_route': {
        const routeId = this._resolveRouteId(event.route_id);
        if (!routeId) break;
        if (!this.state.evacuation.closed_routes.includes(routeId)) {
          this.state.evacuation.closed_routes.push(routeId);
          this.state.evacuation.routes_closed = this.state.evacuation.closed_routes.length;
        }
        break;
      }

      case 'open_route': {
        const routeId = this._resolveRouteId(event.route_id);
        if (!routeId) break;
        this.state.evacuation.closed_routes = this.state.evacuation.closed_routes.filter(r => r !== routeId);
        this.state.evacuation.routes_closed = this.state.evacuation.closed_routes.length;
        break;
      }

      case 'set_evacuation_flow': {
        const fromZone = this._resolveZoneId(event.from_zone);
        if (!fromZone) break;
        const routePlan = this._planFlow(fromZone, event.to_shelter);
        const routeOptions = this._planFlowOptions(fromZone, event.to_shelter);
        // Dedup: replace existing flow with the same (from_zone, to_shelter) pair.
        const idx = this.state.evacuation.flows.findIndex(
          f => f.from_zone === fromZone && f.to_shelter === event.to_shelter,
        );
        const population = Number(event.population) || 0;
        if (idx >= 0) {
          this.state.evacuation.flows[idx] = {
            from_zone: fromZone,
            to_shelter: event.to_shelter,
            population,
            route_id: routePlan.route_id,
            distance_km: routePlan.distance_km,
            route_options: routeOptions,
            departed: this.state.evacuation.flows[idx]?.departed || 0,
            arrived: this.state.evacuation.flows[idx]?.arrived || 0,
          };
        } else {
          this._upsertEvacuationFlow(fromZone, event.to_shelter, population);
        }
        break;
      }

      case 'deploy_resource':
        if (!['engine', 'dozer'].includes(event.resource_type)) {
          event.resource_type = 'engine';
        }
        event.count = Math.max(1, Number(event.count) || (event.resource_type === 'dozer' ? 2 : 8));
        this.state.resources.deployments.push({
          type: event.resource_type,
          location: event.location, // [lng, lat]
          count: event.count,
        });

        // Create a suppression zone (buffer) around the deployment
        if (Array.isArray(event.location) && event.location.length === 2) {
          const createdElapsedHours = Number.isFinite(Number(event.elapsed_hours))
            ? Number(event.elapsed_hours)
            : this._lastEvolveElapsedHours;
          const arrivalElapsedHours = Number.isFinite(Number(event.arrival_elapsed_hours))
            ? Number(event.arrival_elapsed_hours)
            : createdElapsedHours + 0.04;
          this._pruneSuppressionZones(createdElapsedHours);

          // Engines hold a tighter flank; dozers create a wider containment line.
          const radiusBaseMap = { engine: 0.45, dozer: 0.8 };
          const radiusCapMap = { engine: 1.25, dozer: 1.7 };
          const radius = Math.min(
            radiusCapMap[event.resource_type] || 1.25,
            (radiusBaseMap[event.resource_type] || 0.45) * Math.sqrt(Math.min(3, event.count)),
          );
          
          try {
            const factorMap = { engine: 0.52, dozer: 0.88 };
            const factorCapMap = { engine: 0.72, dozer: 0.96 };
            const baselineCountMap = { engine: 8, dozer: 2 };
            const rampMap = { engine: 0.45, dozer: 0.65 };
            const sectorMap = { engine: 90, dozer: 58 };
            const ttlMap = { engine: 1.4, dozer: 2.4 };
            const baseFactor = factorMap[event.resource_type] || 0.34;
            const baselineCount = baselineCountMap[event.resource_type] || 8;
            const countScale = 0.85 + 0.15 * Math.sqrt(event.count / baselineCount);
            const factor = Math.min(factorCapMap[event.resource_type] || 0.72, baseFactor * countScale);
            const centers = [event.location];
            let primaryZone = null;
            for (let i = 0; i < centers.length; i++) {
              const center = centers[i];
              const zoneCount = 1;
              const point = turf.point(center);
              const buffer = turf.buffer(point, radius, { units: 'kilometers' });
              const zoneBearing = this._suppressionZoneBearing(center);
              const zone = {
                id: `${event.action_id || `${event.resource_type}-${Date.now()}`}-${i}`,
                geojson: buffer,
                factor,
                type: event.resource_type,
                center,
                bearing_deg: zoneBearing,
                radius_km: radius,
                cut_depth_km: event.resource_type === 'dozer' ? Math.min(1.1, 0.75 + 0.03 * zoneCount) : 0,
                count: 1,
                ramp_hours: rampMap[event.resource_type] || 0.5,
                sector_degrees: sectorMap[event.resource_type] || 75,
                created_elapsed_hours: createdElapsedHours,
                last_refreshed_elapsed_hours: createdElapsedHours,
                active_after_elapsed_hours: arrivalElapsedHours,
                expires_elapsed_hours: arrivalElapsedHours + (ttlMap[event.resource_type] || 1.5),
                timestamp: Date.now(),
              };
              primaryZone = primaryZone || zone;

              const existingIdx = this._findSimilarSuppressionZone(zone);
              if (existingIdx >= 0) {
                const existing = this.state.fire.suppression_zones[existingIdx];
                this.state.fire.suppression_zones[existingIdx] = {
                  ...existing,
                  ...zone,
                  id: existing.id || zone.id,
                  factor: Math.max(Number(existing.factor) || 0, zone.factor),
                  count: Math.max(Number(existing.count) || 0, zone.count),
                  created_elapsed_hours: Number(existing.created_elapsed_hours ?? zone.created_elapsed_hours),
                  active_after_elapsed_hours: Number(existing.active_after_elapsed_hours ?? zone.active_after_elapsed_hours),
                };
              } else {
                this.state.fire.suppression_zones.push(zone);
              }
            }
            this._capSuppressionZones();
            derivedEvents.push({
              type: 'suppression_zone',
              action_id: primaryZone?.id || event.action_id,
              resource_type: event.resource_type,
              geojson: primaryZone?.geojson,
              visual_geojson: primaryZone ? this._suppressionVisualGeoJson(primaryZone) : undefined,
              effectiveness: factor,
              radius_km: radius,
              ramp_hours: rampMap[event.resource_type] || 0.5,
              active_after_elapsed_hours: primaryZone?.active_after_elapsed_hours,
              source_resource_event_id: event.action_id,
              action_location: event.location,
              ui_message: `${event.resource_type || 'Resource'} suppression area established`,
            });
          } catch (err) {
            console.error('[StateManager] Failed to create suppression zone:', err.message);
          }
        }

        if (event.resource_type === 'engine') this.state.resources.engines_deployed += event.count;
        if (event.resource_type === 'dozer') this.state.resources.crews_deployed += event.count;
        break;

      case 'update_shelter':
        this.state.resources.shelters[event.shelter_id] = {
          occupancy: event.occupancy,
          capacity: event.capacity,
          status: event.status,
          intake_rate_per_hour:
            this.state.resources.shelters[event.shelter_id]?.intake_rate_per_hour ||
            Math.max(120, Math.min(900, Math.round((event.capacity || 0) * 0.18))),
        };
        break;

      case 'infrastructure_status':
        this.state.infrastructure.facilities[event.facility_id] = {
          name: event.name,
          status: event.status,
        };
        this.state.infrastructure.facilities_offline = Object.values(this.state.infrastructure.facilities)
          .filter(f => f.status === 'offline' || f.status === 'damaged' || f.status === 'burning').length;
        break;

      case 'power_shutoff':
        if (event.area_id && !this.state.infrastructure.shutoff_area_ids.includes(event.area_id)) {
          this.state.infrastructure.shutoff_area_ids.push(event.area_id);
        }
        this.state.infrastructure.power_shutoff_areas = this.state.infrastructure.shutoff_area_ids.length;
        break;

      case 'traffic_congestion':
        this.state.evacuation.route_congestion = event.routes || [];
        for (const route of this.state.evacuation.route_congestion) {
          if (route.status === 'closed' && route.route_id && !this.state.evacuation.closed_routes.includes(route.route_id)) {
            this.state.evacuation.closed_routes.push(route.route_id);
          }
        }
        this.state.evacuation.routes_closed = this.state.evacuation.closed_routes.length;
        break;

      case 'traffic_jam':
        this.state.evacuation.traffic_jams = this.state.evacuation.traffic_jams
          .filter(j => j.route_id !== event.route_id);
        this.state.evacuation.traffic_jams.push({
          route_id: event.route_id,
          severity: event.severity,
          elapsed_hours: event.elapsed_hours,
        });
        break;

      case 'broadcast_alert':
        this.state.communications.alerts.push({
          zone_ids: event.zone_ids,
          message: event.message,
          channel: event.channel,
        });
        break;

      case 'playbook_section':
        this.state.playbook_sections.push({
          title: event.title,
          content: event.content,
          agent: event.agent || 'synthesis',
          tick: event.tick,
          elapsed_hours: event.elapsed_hours,
        });
        break;

      case 'tick_summary':
        this.state.tick_summaries.push(event);
        break;
    }
    return derivedEvents;
  }

  _pruneSuppressionZones(elapsedHours) {
    if (!Array.isArray(this.state.fire.suppression_zones)) {
      this.state.fire.suppression_zones = [];
      return;
    }
    if (!Number.isFinite(Number(elapsedHours))) return;
    const now = Number(elapsedHours);
    this.state.fire.suppression_zones = this.state.fire.suppression_zones.filter((zone) => {
      const expires = Number(zone.expires_elapsed_hours);
      return !Number.isFinite(expires) || expires > now;
    });
  }

  _capSuppressionZones() {
    const zones = this.state.fire.suppression_zones || [];
    const maxZones = 30;
    if (zones.length <= maxZones) return;
    this.state.fire.suppression_zones = zones
      .slice()
      .sort((a, b) => Number(a.last_refreshed_elapsed_hours ?? a.created_elapsed_hours ?? 0) -
        Number(b.last_refreshed_elapsed_hours ?? b.created_elapsed_hours ?? 0))
      .slice(zones.length - maxZones);
  }

  _findSimilarSuppressionZone(candidate) {
    const zones = this.state.fire.suppression_zones || [];
    const center = candidate.center;
    if (!Array.isArray(center)) return -1;
    const distanceThreshold = candidate.type === 'dozer' ? 0.35 : 0.35;
    const sectorThreshold = Math.max(25, Number(candidate.sector_degrees || 75) * 0.65);

    return zones.findIndex((zone) => {
      if (zone.type !== candidate.type || !Array.isArray(zone.center)) return false;
      if (this._distanceKm(zone.center, center) > distanceThreshold) return false;
      if (!Number.isFinite(Number(zone.bearing_deg)) || !Number.isFinite(Number(candidate.bearing_deg))) return true;
      return this._angularDistance(Number(zone.bearing_deg), Number(candidate.bearing_deg)) <= sectorThreshold;
    });
  }

  _suppressionZoneBearing(location) {
    const props = this.state.fire.perimeter_geojson?.features?.[0]?.properties || {};
    const origin = Array.isArray(props.origin)
      ? props.origin
      : this.state.scenario?.fireOrigin
        ? [this.state.scenario.fireOrigin.lng, this.state.scenario.fireOrigin.lat]
        : null;
    return origin && Array.isArray(location) ? this._bearing(origin, location) : undefined;
  }

  _expandedSuppressionCenters(location, resourceType, count, bearingDeg) {
    if (!Array.isArray(location)) return [];
    const maxSegments = resourceType === 'dozer' ? 5 : 6;
    const unitsPerSegment = resourceType === 'dozer' ? 3 : 10;
    const segments = Math.max(1, Math.min(maxSegments, Math.ceil((Number(count) || 1) / unitsPerSegment)));
    if (segments === 1 || !Number.isFinite(Number(bearingDeg))) return [location];

    const lateralBearing = (Number(bearingDeg) + 90) % 360;
    const spacingKm = resourceType === 'dozer' ? 0.55 : 0.7;
    const midpoint = (segments - 1) / 2;
    const centers = [];
    for (let i = 0; i < segments; i++) {
      const offsetKm = (i - midpoint) * spacingKm;
      const bearing = offsetKm >= 0 ? lateralBearing : (lateralBearing + 180) % 360;
      centers.push(this._pointAtBearingAndDistance(location, bearing, Math.abs(offsetKm)));
    }
    return centers;
  }

  _suppressionVisualGeoJson(zone) {
    if (!zone || !Array.isArray(zone.center)) return zone?.geojson;
    if (zone.type === 'dozer') {
      const bearing = Number.isFinite(Number(zone.bearing_deg)) ? Number(zone.bearing_deg) : 0;
      const lengthKm = Math.max(0.6, Math.min(1.6, Number(zone.radius_km) || 1.0));
      const lateral = (bearing + 90) % 360;
      const start = this._pointAtBearingAndDistance(zone.center, lateral + 180, lengthKm / 2);
      const end = this._pointAtBearingAndDistance(zone.center, lateral, lengthKm / 2);
      return {
        type: 'Feature',
        properties: {
          type: 'dozer_line',
          resource_type: 'dozer',
          effectiveness: zone.factor,
        },
        geometry: {
          type: 'LineString',
          coordinates: [start, end],
        },
      };
    }

    const radius = Math.max(0.12, Math.min(0.32, (Number(zone.radius_km) || 0.8) * 0.22));
    try {
      return turf.buffer(turf.point(zone.center), radius, { units: 'kilometers' });
    } catch (_) {
      return zone.geojson;
    }
  }

  _angularDistance(angleA, angleB) {
    return Math.abs(((angleA - angleB + 540) % 360) - 180);
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

  /**
   * evolve(tick, weather, fireAcres)
   * ---------------------------------
   * Called each tick BEFORE getSnapshot() to drive realistic metric growth.
   * Does NOT touch applyEvent() — it is purely additive.
   *
   * @param {number} tick       1-based tick number
   * @param {object} weather    { wind_speed, humidity, temperature }
   * @param {number} fireAcres  Current acres burned
   */
  evolve(tick, weather, fireAcres, elapsedHours = null) {
    const acres = fireAcres || this.state.fire.acres_burned || 0;
    const baseZones = this.state.baseData?.zones || {};
    const getZonePop = (zoneId) => baseZones[zoneId]?.population || 5000;
    const firePerim = this.state.fire.perimeter_geojson;
    const totalZonePop = Object.values(baseZones)
      .reduce((sum, zone) => sum + (Number(zone.population) || 0), 0);
    const deltaHours = elapsedHours == null
      ? 0.5
      : Math.max(0, elapsedHours - (this._lastEvolveElapsedHours || 0));

    // -----------------------------------------------------------------------
    // 0. Proactive fire-zone intersection — auto-escalate zones near the fire
    // -----------------------------------------------------------------------
    if (firePerim && firePerim.features && firePerim.features.length > 0) {
      const perimFeature = firePerim.features[0];
      const perimBbox = turf.bbox(perimFeature);

      for (const [zoneId, zone] of Object.entries(baseZones)) {
        if (!zone.geometry) continue;

        const current = this.state.evacuation.zones[zoneId];
        // Terminal state — mandatory can only stay mandatory; no spatial check needed
        if (current === 'mandatory') continue;

        // Cheap bbox pre-filter: skip zones whose bbox doesn't overlap the fire bbox
        const zoneBbox = this._zoneBboxCache.get(zoneId);
        if (zoneBbox) {
          // [minLng, minLat, maxLng, maxLat]
          if (perimBbox[0] > zoneBbox[2] || perimBbox[2] < zoneBbox[0] ||
              perimBbox[1] > zoneBbox[3] || perimBbox[3] < zoneBbox[1]) {
            // Fire bbox doesn't even reach this zone — skip both turf checks
            continue;
          }
        }

        try {
          // Case 1: Fire actually intersects the zone polygon
          const isIntersecting = turf.booleanIntersects(perimFeature, zone.geometry);

          if (isIntersecting) {
            this.state.evacuation.zones[zoneId] = 'mandatory';
            continue;
          }

          // Case 2: Fire is very close (within 1km buffer) — use cached buffer
          if (!this._zoneBufferCache.has(zoneId)) {
            this._zoneBufferCache.set(zoneId, turf.buffer(zone.geometry, 1, { units: 'kilometers' }));
          }
          const zoneBuffer = this._zoneBufferCache.get(zoneId);
          const isNear = turf.booleanIntersects(perimFeature, zoneBuffer);

          if (isNear && (!current || current === 'clear')) {
            this.state.evacuation.zones[zoneId] = 'warning';
          }
        } catch (err) {
          // Fallback logic handled below if turf fails or data missing
        }
      }
    } else {
      // Fallback: Approximate fire as circle: area = π * r²; r in km, 1° ≈ 111 km
      const ignLng = this.state.scenario?.fireOrigin?.lng;
      const ignLat = this.state.scenario?.fireOrigin?.lat;
      if (ignLng != null && ignLat != null && acres > 0) {
        const fireRadiusDeg = Math.sqrt(acres / 247.105 / Math.PI) / 111;
        for (const [zoneId, zone] of Object.entries(baseZones)) {
          const zLng = zone.centroid_lng;
          const zLat = zone.centroid_lat;
          if (zLng == null || zLat == null) continue;
          const dist = Math.sqrt(Math.pow(zLng - ignLng, 2) + Math.pow(zLat - ignLat, 2));
          const current = this.state.evacuation.zones[zoneId];
          if (dist <= fireRadiusDeg && current !== 'mandatory') {
            this.state.evacuation.zones[zoneId] = 'mandatory';
          } else if (dist <= fireRadiusDeg * 2.5 && (!current || current === 'clear')) {
            this.state.evacuation.zones[zoneId] = 'warning';
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 1. Evacuation demand and movement — derive ordered/departed/in-transit/sheltered counts
    // -----------------------------------------------------------------------
    const complianceRate = Math.min(0.55 + tick * 0.07, 0.95);
    let orderedToEvacuate = 0;
    for (const [zoneId, status] of Object.entries(this.state.evacuation.zones)) {
      if (status === 'mandatory') {
        orderedToEvacuate += getZonePop(zoneId);
      }
    }
    this.state.evacuation.ordered_to_evacuate = orderedToEvacuate;

    const routeCongestion = Object.fromEntries(
      (this.state.evacuation.route_congestion || []).map((route) => [route.route_id, route]),
    );
    const shelterOccupancy = new Map(
      Object.entries(this.state.resources.shelters || {}).map(([id, shelter]) => [id, Number(shelter.occupancy || 0)]),
    );
    const shelterIntakeUsed = new Map();

    for (const flow of this.state.evacuation.flows) {
      const zoneStatus = this.state.evacuation.zones[flow.from_zone] || 'clear';
      const currentShelter = this.state.resources.shelters?.[flow.to_shelter];
      const currentShelterOccupancy = Number(shelterOccupancy.get(flow.to_shelter) || currentShelter?.occupancy || 0);
      const currentShelterCapacity = Number(currentShelter?.capacity || this.state.baseData?.shelters?.[flow.to_shelter]?.capacity || 0);
      const shelterIsEffectivelyFull = currentShelterCapacity > 0 && currentShelterOccupancy >= currentShelterCapacity;
      if (shelterIsEffectivelyFull) {
        const alternateShelter = this._findAlternateShelter(flow.from_zone, flow.to_shelter);
        if (alternateShelter) {
          flow.to_shelter = alternateShelter;
        }
      }

      if (!flow.route_id || this.state.evacuation.closed_routes.includes(flow.route_id) || shelterIsEffectivelyFull) {
        const routePlan = this._planFlow(flow.from_zone, flow.to_shelter);
        flow.route_id = routePlan.route_id;
        flow.distance_km = routePlan.distance_km;
        flow.route_options = this._planFlowOptions(flow.from_zone, flow.to_shelter);
      }

      const zonePopulation = getZonePop(flow.from_zone);
      const targetParticipation =
        zoneStatus === 'mandatory' ? complianceRate :
        zoneStatus === 'warning' ? 0.35 :
        zoneStatus === 'voluntary' ? 0.15 :
        0;
      const notYetDeparted = Math.max(0, (Number(flow.population) || 0) - (Number(flow.departed) || 0));
      const projectedShelterHeadroom = Math.max(0, currentShelterCapacity - currentShelterOccupancy);
      if (notYetDeparted > projectedShelterHeadroom && currentShelterCapacity > 0) {
        const alternateShelter = this._findAlternateShelter(flow.from_zone, flow.to_shelter);
        const overflowPopulation = Math.max(0, notYetDeparted - projectedShelterHeadroom);
        if (alternateShelter && overflowPopulation > 0) {
          flow.population = Math.max(Number(flow.departed) || 0, (Number(flow.population) || 0) - overflowPopulation);
          this._upsertEvacuationFlow(flow.from_zone, alternateShelter, overflowPopulation);
        }
      }
      const targetFlowPopulation = Math.min(
        Number(flow.population) || 0,
        Math.floor(zonePopulation * targetParticipation),
      );
      const alreadyDeparted = Number(flow.departed) || 0;
      const remainingToDepart = Math.max(0, targetFlowPopulation - alreadyDeparted);
      const departureRatePerHour =
        zoneStatus === 'mandatory' ? 0.7 :
        zoneStatus === 'warning' ? 0.28 :
        zoneStatus === 'voluntary' ? 0.12 :
        0;
      const routeState = flow.route_id ? routeCongestion[flow.route_id] : null;
      const routeFactor =
        routeState?.status === 'closed' ? 0.05 :
        routeState?.status === 'congested' ? 0.55 :
        1;
      const departingNow = Math.min(
        remainingToDepart,
        Math.round(targetFlowPopulation * departureRatePerHour * routeFactor * deltaHours),
      );
      flow.departed = alreadyDeparted + Math.max(0, departingNow);

      const inTransitBeforeArrival = Math.max(0, (Number(flow.departed) || 0) - (Number(flow.arrived) || 0));
      const speedKph =
        routeState?.status === 'closed' ? 5 :
        routeState?.status === 'congested' ? 25 :
        flow.route_id ? 55 : 35;
      const travelHours = Math.max(0.25, (Number(flow.distance_km) || 10) / speedKph);
      const reachedShelterNow = Math.min(
        inTransitBeforeArrival,
        Math.round(inTransitBeforeArrival * Math.min(1, deltaHours / travelHours)),
      );

      const shelterId = flow.to_shelter;
      const shelterState = this.state.resources.shelters?.[shelterId];
      const shelterCapacity = Number(shelterState?.capacity || this.state.baseData?.shelters?.[shelterId]?.capacity || 0);
      const currentOccupancy = Number(shelterOccupancy.get(shelterId) || shelterState?.occupancy || 0);
      const intakeRatePerHour = Number(
        shelterState?.intake_rate_per_hour ||
        Math.max(120, Math.min(900, Math.round(shelterCapacity * 0.18))),
      );
      const intakeRemaining = Math.max(
        0,
        Math.round(intakeRatePerHour * deltaHours) - Number(shelterIntakeUsed.get(shelterId) || 0),
      );
      const remainingCapacity = Math.max(0, shelterCapacity - currentOccupancy);
      const admittedNow = Math.min(Math.max(0, reachedShelterNow), intakeRemaining, remainingCapacity);

      shelterIntakeUsed.set(shelterId, (shelterIntakeUsed.get(shelterId) || 0) + admittedNow);
      shelterOccupancy.set(shelterId, currentOccupancy + admittedNow);
      flow.arrived = Math.min(Number(flow.departed) || 0, (Number(flow.arrived) || 0) + admittedNow);
    }

    const departedTotal = (this.state.evacuation.flows || [])
      .reduce((sum, flow) => sum + (Number(flow.departed) || 0), 0);
    const shelteredTotal = (this.state.evacuation.flows || [])
      .reduce((sum, flow) => sum + (Number(flow.arrived) || 0), 0);
    const evacueeCap = totalZonePop > 0 ? totalZonePop : Number.POSITIVE_INFINITY;
    this.state.evacuation.departed_evacuees = Math.min(evacueeCap, departedTotal);
    this.state.evacuation.sheltered_evacuees = Math.min(evacueeCap, shelteredTotal);
    this.state.evacuation.in_transit_evacuees = Math.max(
      0,
      this.state.evacuation.departed_evacuees - this.state.evacuation.sheltered_evacuees,
    );
    this.state.evacuation.total_evacuees = this.state.evacuation.departed_evacuees;

    // -----------------------------------------------------------------------
    // 2. Fire resources — grow with fire severity, never decrease
    // -----------------------------------------------------------------------
    const newEngines = Math.min(
      Math.max(this.state.resources.engines_deployed, 5) + Math.floor(acres / 500),
      85,
    );
    if (newEngines > this.state.resources.engines_deployed) {
      this.state.resources.engines_deployed = newEngines;
    }

    const newCrews = Math.min(
      Math.max(this.state.resources.crews_deployed, 3) + Math.floor(acres / 800),
      60,
    );
    if (newCrews > this.state.resources.crews_deployed) {
      this.state.resources.crews_deployed = newCrews;
    }

    this.state.resources.air_tankers_active = 0;

    // -----------------------------------------------------------------------
    // 3. Infrastructure — spatial degradation
    // -----------------------------------------------------------------------
    const infra = this.state.baseData?.infrastructure || {};
    const perimFeatureForInfra = firePerim?.features?.[0];
    for (const [id, facility] of Object.entries(infra)) {
      if (!this.state.infrastructure.facilities[id]) {
        this.state.infrastructure.facilities[id] = {
          name: facility.name || id,
          status: 'operational',
        };
      }

      // Skip spatial check for facilities already offline — offline is terminal
      if (this.state.infrastructure.facilities[id].status === 'offline') continue;

      // Spatial check for infrastructure damage
      if (perimFeatureForInfra && facility.geometry) {
        try {
          if (turf.booleanIntersects(perimFeatureForInfra, facility.geometry)) {
            this.state.infrastructure.facilities[id].status = 'offline';
          }
        } catch (_) {}
      } else if (perimFeatureForInfra && facility.location) {
        try {
          const point = turf.point([facility.location.lng, facility.location.lat]);
          if (turf.booleanPointInPolygon(point, perimFeatureForInfra)) {
            this.state.infrastructure.facilities[id].status = 'offline';
          }
        } catch (_) {}
      }
    }

    // Recount offline facilities
    this.state.infrastructure.facilities_offline = Object.values(
      this.state.infrastructure.facilities,
    ).filter(f => f.status === 'offline' || f.status === 'damaged').length;

    // -----------------------------------------------------------------------
    // 4. Power shutoffs
    // -----------------------------------------------------------------------
    const estimatedShutoffs = Math.min(Math.floor(acres / 3000), 20);
    this.state.infrastructure.power_shutoff_areas = Math.max(
      this.state.infrastructure.shutoff_area_ids.length,
      estimatedShutoffs,
    );

    // -----------------------------------------------------------------------
    // 5. Distribute new evacuees proportionally across open shelters
    // -----------------------------------------------------------------------
    const openShelters = Object.entries(this.state.resources.shelters).filter(
      ([, sh]) => sh.status === 'open' && sh.capacity > 0,
    );
    if (openShelters.length > 0) {
      const incomingByShelter = new Map();
      for (const flow of this.state.evacuation.flows || []) {
        if (!flow?.to_shelter) continue;
        incomingByShelter.set(
          flow.to_shelter,
          (incomingByShelter.get(flow.to_shelter) || 0) + (Number(flow.arrived) || 0),
        );
      }
      for (const [id, sh] of openShelters) {
        const share = Number(shelterOccupancy.get(id) || incomingByShelter.get(id) || 0);
        this.state.resources.shelters[id].occupancy = Math.min(share, sh.capacity);
        this.state.resources.shelters[id].status = share >= sh.capacity ? 'full' : 'open';
      }
    }

    if (elapsedHours != null) {
      this._lastEvolveElapsedHours = elapsedHours;
    }
  }

  seedFromScenario(scenarioInput) {
    // Store structured scenario data so agents receive ground-truth fields
    // and cannot hallucinate location, coordinates, time, or initial weather.
    this.state.scenario = {
      location:   scenarioInput.location,
      bbox:       scenarioInput.bbox,          // [west, south, east, north]
      timestamp:  scenarioInput.timestamp,     // ISO-8601 simulation start
      fireOrigin: scenarioInput.fireOrigin,    // { lat, lng }
      metrics:    scenarioInput.metrics,       // { wind, temp, humidity }
      durationHours: scenarioInput.durationHours || 6,
    };
    console.log(
      `[StateManager] Scenario seeded: "${scenarioInput.location}" ` +
      `origin=(${scenarioInput.fireOrigin.lat},${scenarioInput.fireOrigin.lng}) ` +
      `start=${scenarioInput.timestamp}`
    );
  }

  seedFromData(data) {
    this.state.baseData = {
      zones: data.zones || {},
      shelters: data.shelters || {},
      infrastructure: data.infrastructure || {},
      routes: data.routes || {},
      populationTracts: data.populationTracts || [],
    };

    // Compute zone centroids and assign real populations from nearest census tract
    const tracts = data.populationTracts || [];
    for (const zone of Object.values(this.state.baseData.zones)) {
      // Compute centroid from polygon geometry if not already present
      if (zone.centroid_lng == null && zone.geometry?.type === 'Polygon') {
        const ring = zone.geometry.coordinates[0] || [];
        if (ring.length > 0) {
          zone.centroid_lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
          zone.centroid_lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        }
      }

      // Assign population from nearest census tract (overrides hardcoded 8000)
      if (tracts.length > 0) {
        let nearest = null, bestDist = Infinity;
        for (const tract of tracts) {
          const d = Math.hypot((tract.lng || 0) - (zone.centroid_lng || 0), (tract.lat || 0) - (zone.centroid_lat || 0));
          if (d < bestDist) { bestDist = d; nearest = tract; }
        }
        if (nearest && nearest.population > 0) {
          zone.population = nearest.population;
        }
      }
    }

    // Pre-populate shelter capacities so agents see real capacities
    Object.entries(data.shelters || {}).forEach(([id, shelter]) => {
      if (!this.state.resources.shelters[id]) {
        this.state.resources.shelters[id] = {
          occupancy: 0,
          capacity: shelter.capacity || 0,
          status: 'open',
          intake_rate_per_hour: Math.max(120, Math.min(900, Math.round((shelter.capacity || 0) * 0.18))),
        };
      }
    });

    // Pre-compute per-zone bounding boxes for fast bbox overlap checks in evolve()
    this._zoneBboxCache = new Map();
    this._zoneBufferCache = new Map();
    for (const [zoneId, zone] of Object.entries(data.zones || {})) {
      if (zone.geometry?.type === 'Polygon') {
        try {
          const bb = turf.bbox(zone.geometry);
          this._zoneBboxCache.set(zoneId, bb);
        } catch (_) {}
      }
    }

    const zoneCount = Object.keys(data.zones || {}).length;
    const shelterCount = Object.keys(data.shelters || {}).length;
    const routeCount = Object.keys(data.routes || {}).length;
    const tractCount = tracts.length;
    console.log(`[StateManager] Seeded: ${zoneCount} zones, ${shelterCount} shelters, ${routeCount} routes, ${tractCount} population tracts`);
  }

  _computePopulationAtRisk() {
    const baseZones = this.state.baseData?.zones || {};
    let atRisk = 0;
    for (const [zoneId, status] of Object.entries(this.state.evacuation.zones)) {
      const pop = baseZones[zoneId]?.population || 5000;
      if (status === 'mandatory') atRisk += pop;
      else if (status === 'warning') atRisk += pop * 0.4;
    }
    return Math.floor(atRisk);
  }

  computeFireImpactEvents(firePerimeter, elapsedHours = null) {
    const perimFeatures = firePerimeter?.features || [];
    const perimFeature = perimFeatures[0];
    if (!perimFeature) return [];

    const events = [];
    const suppressionZones = this.state.fire.suppression_zones || [];
    const impactedStatuses = new Set(['burning', 'offline', 'damaged', 'at_risk']);

    const pointStatus = (coord, currentStatus) => {
      if (!Array.isArray(coord) || coord.length !== 2) return null;
      const point = turf.point(coord);
      try {
        if (perimFeatures.some(feature => turf.booleanPointInPolygon(point, feature))) return 'burning';
      } catch (_) {}

      const contained = suppressionZones.some((zone) => {
        try {
          if (elapsedHours != null) {
            const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
            const rampHours = Math.max(0.05, Number(zone.ramp_hours) || 0.5);
            const progress = Math.max(0, Math.min(1, (elapsedHours - activeAfter) / rampHours));
            if (progress < 0.5) return false;
          }
          return zone.geojson && turf.booleanPointInPolygon(point, zone.geojson);
        } catch (_) {
          return false;
        }
      });
      if (contained && impactedStatuses.has(currentStatus)) return 'contained';

      try {
        const nearFire = perimFeatures.some((feature) => {
          const buffered = turf.buffer(feature, 0.5, { units: 'kilometers' });
          return turf.booleanPointInPolygon(point, buffered);
        });
        if (nearFire && currentStatus !== 'contained') return 'at_risk';
      } catch (_) {}

      return null;
    };

    for (const [facilityId, facility] of Object.entries(this.state.baseData?.infrastructure || {})) {
      const coord = facility.location ? [facility.location.lng, facility.location.lat] : null;
      const current = this.state.infrastructure.facilities[facilityId]?.status || facility.status || 'operational';
      const status = pointStatus(coord, current);
      if (!status || status === current) continue;
      const name = facility.name || facilityId;
      events.push({
        type: 'infrastructure_status',
        facility_id: facilityId,
        name,
        status,
        details: status === 'burning'
          ? 'Facility is inside the active fire perimeter'
          : status === 'contained'
            ? 'Suppression has stabilized fire impact near this facility'
            : 'Facility is near the active fire perimeter',
        ui_message: status === 'burning'
          ? `${name} impacted by fire`
          : status === 'contained'
            ? `Fire contained near ${name}`
            : `${name} at risk from fire`,
        action_location: coord,
        elapsed_hours: elapsedHours,
      });
    }

    for (const [shelterId, shelter] of Object.entries(this.state.baseData?.shelters || {})) {
      const coord = shelter.location ? [shelter.location.lng, shelter.location.lat] : null;
      const existing = this.state.resources.shelters[shelterId] || {};
      const current = existing.status || shelter.status || 'open';
      const status = pointStatus(coord, current);
      if (!status || status === current) continue;
      events.push({
        type: 'update_shelter',
        shelter_id: shelterId,
        occupancy: existing.occupancy ?? shelter.current_occupancy ?? 0,
        capacity: existing.capacity ?? shelter.capacity ?? 0,
        status,
        ui_message: status === 'burning'
          ? `Shelter ${shelterId} impacted by fire`
          : status === 'contained'
            ? `Fire contained near shelter ${shelterId}`
            : `Shelter ${shelterId} at risk from fire`,
        action_location: coord,
        elapsed_hours: elapsedHours,
      });
    }

    return events;
  }

  // Lightweight snapshot for live streaming — omits perimeter_geojson (already sent via physics_tick)
  getMetricsSnapshot(tick, simTime, elapsedHours = null) {
    const snap = this.getSnapshot(tick, simTime, elapsedHours);
    delete snap.fire.perimeter_geojson;
    return snap;
  }

  getSnapshot(tick, simTime, elapsedHours = null) {
    return {
      tick,
      sim_time: simTime,
      elapsed_hours: elapsedHours,
      fire: {
        perimeter_geojson: this.state.fire.perimeter_geojson,
        acres_burned: this.state.fire.acres_burned,
        spread_rate_acres_hr: this.state.fire.spread_rate_acres_hr,
      },
      evacuation: {
        zones: { ...this.state.evacuation.zones },
        total_evacuees: this.state.evacuation.total_evacuees,
        ordered_to_evacuate: this.state.evacuation.ordered_to_evacuate,
        departed_evacuees: this.state.evacuation.departed_evacuees,
        in_transit_evacuees: this.state.evacuation.in_transit_evacuees,
        sheltered_evacuees: this.state.evacuation.sheltered_evacuees,
        routes_closed: this.state.evacuation.routes_closed,
        total_population_at_risk: this._computePopulationAtRisk(),
        congested_routes: (this.state.evacuation.route_congestion || []).filter(r => r.status === 'congested').length,
      },
      resources: {
        engines_deployed: this.state.resources.engines_deployed,
        crews_deployed: this.state.resources.crews_deployed,
        air_tankers_active: this.state.resources.air_tankers_active,
        shelters: { ...this.state.resources.shelters },
      },
      infrastructure: {
        facilities_offline: this.state.infrastructure.facilities_offline,
        power_shutoff_areas: this.state.infrastructure.power_shutoff_areas,
      },
    };
  }

  getContext() {
    const s = this.state;
    const base = s.baseData || {};

    // Priority-sort zones: mandatory first, then warning, then others — cap at 25
    const sortedZones = Object.entries(s.evacuation.zones)
      .sort(([, a], [, b]) => {
        const rank = { mandatory: 0, warning: 1, voluntary: 2, clear: 3 };
        return (rank[a] ?? 4) - (rank[b] ?? 4);
      })
      .slice(0, 25);
    const zoneStr = sortedZones.map(([zId, st]) => {
      const zBase = base.zones?.[zId];
      return zBase ? `${zId} (${zBase.name}, pop ${zBase.population}): ${st}` : `${zId}: ${st}`;
    }).join(', ') || 'none set';

    // Only show the 12 most occupied/relevant shelters
    const shelterStr = Object.entries(s.resources.shelters)
      .sort(([, a], [, b]) => (b.occupancy ?? 0) - (a.occupancy ?? 0))
      .slice(0, 12)
      .map(([id, sh]) => {
        const sBase = base.shelters?.[id];
        return sBase ? `${id} (${sBase.name}): ${sh.occupancy}/${sh.capacity} (${sh.status})` : `${id}: ${sh.occupancy}/${sh.capacity} (${sh.status})`;
      }).join(', ') || 'none active';

    // List available zones/shelters for agent reference (first 5 of each)
    const availZones = Object.keys(base.zones || {}).slice(0, 5).map(id => {
      const z = base.zones[id];
      return `${id}: ${z.name} (pop ${z.population})`;
    }).join(', ');

    const availShelters = Object.keys(base.shelters || {}).slice(0, 5).map(id => {
      const sh = base.shelters[id];
      return `${id}: ${sh.name} (cap ${sh.capacity})`;
    }).join(', ');

    const availRoutes = Object.keys(base.routes || {}).slice(0, 5).map(id => {
      const r = base.routes[id];
      return `${id}: ${r.name} (${r.highway})`;
    }).join(', ');

    const sc = s.scenario || {};
    const scenarioBlock = sc.location ? [
      `SCENARIO IDENTITY (DO NOT ALTER THESE VALUES):`,
      `- Location: ${sc.location}`,
      `- Bounding box (W,S,E,N): ${sc.bbox ? sc.bbox.join(', ') : 'unknown'}`,
      `- Simulation start time: ${sc.timestamp || 'unknown'}`,
      `- Simulation duration: ${sc.durationHours || 6} simulated hours`,
      `- Fire origin: lat=${sc.fireOrigin?.lat}, lng=${sc.fireOrigin?.lng}`,
      `- Initial weather: wind ${sc.metrics?.wind}mph, temp ${sc.metrics?.temp}°F, humidity ${sc.metrics?.humidity}%`,
    ].join('\n') : '';

    const congStr = (s.evacuation.route_congestion || [])
      .slice(0, 10)
      .map(r => `${r.route_id}: ${r.status} (${r.load_pct}%)`)
      .join(', ') || 'none computed';

    return `${scenarioBlock ? scenarioBlock + '\n\n' : ''}CURRENT SIMULATION STATE:
- Fire: ${s.fire.acres_burned} acres burned, spreading at bearing ${s.fire.spread_bearing}° at ~${s.fire.spread_rate_acres_hr} acres/hr
- Active evacuation zones: ${zoneStr}
- Routes closed: ${s.evacuation.closed_routes.join(', ') || 'none'}
- Route congestion: ${congStr}
- Evacuation totals: ordered ${s.evacuation.ordered_to_evacuate}, departed ${s.evacuation.departed_evacuees}, in transit ${s.evacuation.in_transit_evacuees}, sheltered ${s.evacuation.sheltered_evacuees}
- Total evacuees: ${s.evacuation.total_evacuees}
- Resources deployed: ${s.resources.engines_deployed} engines, ${s.resources.crews_deployed} dozer/crew teams
- Shelter status: ${shelterStr}
- Infrastructure offline: ${s.infrastructure.facilities_offline} facilities, ${s.infrastructure.power_shutoff_areas} power shutoff areas
- Alerts issued: ${s.communications.alerts.length}
${availZones ? `\nAVAILABLE ZONES (sample): ${availZones}` : ''}
${availShelters ? `AVAILABLE SHELTERS (sample): ${availShelters}` : ''}
${availRoutes ? `AVAILABLE ROUTES (sample): ${availRoutes}` : ''}`;
  }
}

module.exports = { StateManager };
