const turf = require('@turf/turf');

/**
 * wildfireEngine.js
 *
 * Physics-informed fire-spread engine driven by real or simulated weather.
 * Now incorporates suppression logic from agent-deployed resources.
 */
class WildfireEngine {
  /**
   * @param {[number, number]} ignitionPoint  [lng, lat]
   * @param {number} windBearing              TO bearing degrees (0=N, 90=E) — direction fire spreads toward
   * @param {number} windSpeed                mph
   * @param {object} [weatherExtras]          Optional real-weather fields
   * @param {number} [weatherExtras.humidity]     % (0-100), default 30
   * @param {number} [weatherExtras.temperature]  °F, default 75
   * @param {number} [weatherExtras.pm25]         µg/m³, default 15
   * @param {number} [weatherExtras.initialAcres] initial fire size in acres
   */
  constructor(ignitionPoint, windBearing, windSpeed, weatherExtras = {}) {
    this.ignition    = ignitionPoint;
    this.windBearing = windBearing;
    this.windSpeed   = windSpeed;

    // Real weather fields that modulate spread
    this.humidity    = weatherExtras.humidity    ?? 30;
    this.temperature = weatherExtras.temperature ?? 75;
    this.pm25        = weatherExtras.pm25        ?? 15;
    this.initialAcres = Math.max(0, Number(weatherExtras.initialAcres) || 0);
    this.seed        = this._seedFromPoint(ignitionPoint);
    this.sectorCount = 72;
    this._sectorDistancesKm = null;
    this._sectorBearingsDeg = null;
    this._lastPerimeterTick = null;
    // Tracks the formula-predicted raw distance per sector at the previous tick.
    // Used to cap growthDeltaKm to the natural per-tick increment, preventing
    // suppression-pulled sectors from seeing large formula catch-up jumps.
    this._lastRawDistancesKm = null;
  }

  /**
   * Compute the dimensionless humidity spread modifier.
   * Full humidity (100%) halves spread; bone-dry (0%) doubles it.
   */
  _humidFactor() {
    // Linear: 2.0 at 0% → 1.0 at 50% → 0.5 at 100%
    const raw = 2 - this.humidity / 50;
    return Math.max(0.5, Math.min(2.0, raw));
  }

  /**
   * Compute the dimensionless temperature spread modifier.
   * Baseline at 70°F (factor=1); doubles at ~150°F.
   */
  _tempFactor() {
    const raw = 1 + (this.temperature - 70) / 80;
    return Math.max(0.5, Math.min(2.0, raw));
  }

  _growthRateForAcres(acres) {
    if (!Number.isFinite(acres) || acres <= 0) return 0;
    // Area ~= PI * (1.8g) * (0.7g), converted from km² to acres.
    return Math.sqrt(acres / (Math.PI * 1.26 * 247.105)) * 0.8;
  }

  /**
   * Generate an elliptical GeoJSON fire perimeter for the given simulation tick.
   * Suppression effects damp local edge growth over time instead of instantly
   * subtracting a full polygon from the active fire shape.
   *
   * @param {number} tick                 1-based tick index
   * @param {Array}  [suppressionEffects] List of resource-generated suppression effects
   * @returns {GeoJSON.FeatureCollection}
   */
  generatePerimeter(tick, suppressionEffects = []) {
    const suppressionZones = suppressionEffects;
    const baseSpreadKm = 0.12;
    const windFactor   = 1 + (this.windSpeed / 40);
    const humidFactor  = this._humidFactor();
    const tempFactor   = this._tempFactor();

    const initialGrowthKm = this._growthRateForAcres(this.initialAcres);
    const spreadGrowthKm = baseSpreadKm * windFactor * humidFactor * tempFactor * tick * 1.5;
    const growthRate = initialGrowthKm + spreadGrowthKm;

    // Elliptical spread: longer axis aligns with wind direction
    const headFire  = growthRate * 1.8; // downwind — fastest
    const backFire  = growthRate * 0.3; // upwind   — slowest
    const flankFire = growthRate * 0.7; // crosswind

    const numPoints = this.sectorCount;
    const coordinates = [];
    const nextSectorDistances = new Array(numPoints);
    const nextSectorBearings = new Array(numPoints);
    const nextRawDistances = new Array(numPoints);
    const windRad = (this.windBearing * Math.PI) / 180;
    const center = this._pointAtBearingAndDistance(
      this.ignition,
      this.windBearing,
      Math.min(spreadGrowthKm * 0.28, headFire * 0.35),
    );

    // Pre-compute suppression zone centers once — avoids turf.center() per point per zone
    const zoneCenters = suppressionZones.map(z =>
      Array.isArray(z.center) ? z.center : this._zoneCenter(z),
    );

    for (let i = 0; i < numPoints; i++) {
      const angleDeg = (i / numPoints) * 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const relAngle = angleRad - windRad;
      const cos      = Math.cos(relAngle);
      const sin      = Math.sin(relAngle);

      const baseRadius = cos > 0
        ? headFire  * Math.abs(cos) + flankFire * Math.abs(sin)
        : backFire  * Math.abs(cos) + flankFire * Math.abs(sin);

      const turbulence = this._edgeTurbulence(angleDeg, tick);
      const canyonChannel = this._canyonChannel(angleDeg, tick);
      const windAlignment = Math.max(0, cos);
      const rawRadius = Math.max(
        0.02,
        baseRadius * turbulence + canyonChannel * spreadGrowthKm * (0.16 + windAlignment * 0.28),
      );
      const projectedPoint = this._pointAtBearingAndDistance(center, angleDeg, rawRadius);
      const rawBearing = this._bearing(this.ignition, projectedPoint);
      const rawDistanceKm = Math.max(0.02, this._distanceKm(this.ignition, projectedPoint));
      const previousDistanceKm = this._previousSectorDistance(i, tick);
      const previousBearing = this._sectorBearingsDeg?.[i];
      // Cap growth delta to the natural formula increment so suppression-pulled sectors
      // don't see a large catch-up jump that overwhelms engine direct attack.
      const prevRawDistanceKm = this._lastRawDistancesKm?.[i] ?? rawDistanceKm;
      const formulaIncrement = Math.max(0, rawDistanceKm - prevRawDistanceKm);
      const growthDeltaKm = Math.min(Math.max(0, rawDistanceKm - previousDistanceKm), formulaIncrement);
      nextRawDistances[i] = rawDistanceKm;
      const suppressionProbeDistanceKm = Math.min(rawDistanceKm, previousDistanceKm + Math.min(growthDeltaKm, 0.35));
      const suppressionProbe = this._pointAtBearingAndDistance(this.ignition, rawBearing, suppressionProbeDistanceKm);
      const suppression = this._suppressionDamping(suppressionProbe, rawBearing, tick, suppressionZones, zoneCenters);
      const containmentLimitKm = this._containmentLimitDistance(
        rawBearing,
        previousDistanceKm,
        rawDistanceKm,
        tick,
        suppressionZones,
        zoneCenters,
      );

      let growthKm = growthDeltaKm * this._growthMultiplierForSuppression(suppression);

      // Engine direct attack: engines physically at or near the fire edge pull the
      // perimeter back each tick.  This is the primary extinguish mechanism — it works
      // even when combined suppression never reaches the 0.95 threshold.
      const enginePullback = this._engineDirectAttack(suppressionProbe, rawBearing, tick, suppressionZones, zoneCenters);
      growthKm -= enginePullback;

      // Secondary: overwhelming combined suppression causes additional shrinkage.
      if (suppression >= 0.95) {
        const shrinkStrength = Math.min(1.0, (suppression - 0.95) / 0.05);
        growthKm = Math.min(growthKm, -0.06 * shrinkStrength);
      }

      const uncappedDistanceKm = previousDistanceKm + growthKm;
      const distanceKm = Math.max(
        0.02,
        Number.isFinite(containmentLimitKm)
          ? Math.min(uncappedDistanceKm, containmentLimitKm)
          : uncappedDistanceKm,
      );
      const bearing = growthKm <= 0.00001 && Number.isFinite(previousBearing)
        ? previousBearing
        : rawBearing;

      nextSectorDistances[i] = distanceKm;
      nextSectorBearings[i] = bearing;
      coordinates.push(this._pointAtBearingAndDistance(this.ignition, bearing, distanceKm));
    }

    this._sectorDistancesKm = nextSectorDistances;
    this._sectorBearingsDeg = nextSectorBearings;
    this._lastRawDistancesKm = nextRawDistances;
    this._lastPerimeterTick = tick;

    const smoothedCoordinates = this._smoothPerimeterCoordinates(coordinates, suppressionZones, tick, zoneCenters);

    // Close the polygon
    coordinates.length = 0;
    coordinates.push(...smoothedCoordinates);
    coordinates.push(coordinates[0]);
    const headPosition = this._leadingEdgePoint(coordinates, this.windBearing, this.ignition);

    let acresBurned  = Math.round(Math.PI * headFire * flankFire * 247.105);
    const spreadRateAc = Math.round(spreadGrowthKm * 247.105);

    // Derive U/V (m/s) from internal TO-bearing + speed for unambiguous output.
    const _speedMs = this.windSpeed * 0.44704;
    const _bearingRad = this.windBearing * Math.PI / 180;
    const _windU = parseFloat((_speedMs * Math.sin(_bearingRad)).toFixed(4));
    const _windV = parseFloat((_speedMs * Math.cos(_bearingRad)).toFixed(4));

    let perimFeature = {
      type: 'Feature',
      properties: {
        acres:             acresBurned,
        tick,
        spread_rate:       spreadRateAc,
        wind_bearing:      this.windBearing,
        wind_u:            _windU,
        wind_v:            _windV,
        humidity:          this.humidity,
        temperature:       this.temperature,
        pm25:              this.pm25,
        origin:            this.ignition,
        head_position:     headPosition,
        center_position:   center,
        irregularity:      true,
        stateful_growth:   true,
        suppression_active: this._activeSuppressionZones(suppressionZones, tick).length > 0,
      },
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates],
      },
    };

    // Inline shoelace formula — avoids turf.area object allocation on the 500ms hot path.
    // Error < 0.3% at wildfire scales (~50km region).
    acresBurned = Math.max(0, this._shoelaceAcres(coordinates));
    perimFeature.properties.acres = acresBurned;

    const features = [perimFeature, ...this._generateSpotFires(tick, growthRate, suppressionZones, perimFeature)];

    return {
      type: 'FeatureCollection',
      features,
    };
  }

  applySuppressionToPerimeter(perimeter, tick, suppressionEffects = []) {
    const suppressionZones = suppressionEffects;
    if (!perimeter?.features?.length || this._activeSuppressionZones(suppressionZones, tick).length === 0) {
      return perimeter;
    }

    // Pre-compute suppression zone centers once for this call
    const zoneCenters = suppressionZones.map(z =>
      Array.isArray(z.center) ? z.center : this._zoneCenter(z),
    );

    const features = perimeter.features.map((feature) => {
      if (!feature?.geometry || feature.geometry.type !== 'Polygon') return feature;

      const center = Array.isArray(feature.properties?.center_position)
        ? feature.properties.center_position
        : this._zoneCenter({ geojson: feature });
      if (!center) return feature;
      const origin = Array.isArray(feature.properties?.origin)
        ? feature.properties.origin
        : this.ignition;

      const coordinates = feature.geometry.coordinates.map((ring) => ring.map((coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return coord;
        const point = [coord[0], coord[1]];
        const bearing = this._bearing(origin, point);
        const distanceKm = this._distanceKm(origin, point);
        const containmentLimitKm = this._containmentLimitDistance(
          bearing,
          0.02,
          distanceKm,
          tick,
          suppressionZones,
          zoneCenters,
        );
        if (Number.isFinite(containmentLimitKm) && containmentLimitKm < distanceKm) {
          return this._pointAtBearingAndDistance(origin, bearing, containmentLimitKm);
        }
        const damping = this._suppressionDamping(point, bearing, tick, suppressionZones, zoneCenters);
        if (damping >= 0.95) {
          const shrinkStrength = Math.min(1.0, (damping - 0.95) / 0.05);
          // Gradual pull — matches the per-tick shrink rate in generatePerimeter
          return this._pullToward(point, origin, shrinkStrength * 0.35);
        }
        return damping > 0 ? this._pullToward(point, center, damping * 0.30) : point;
      }));

      const suppressed = {
        ...feature,
        properties: {
          ...(feature.properties || {}),
          suppression_active: true,
        },
        geometry: { ...feature.geometry, coordinates },
      };

      const ring = suppressed.geometry?.coordinates?.[0];
      if (ring) {
        suppressed.properties.acres = Math.max(0, this._shoelaceAcres(ring));
      }

      return suppressed;
    });

    return { ...perimeter, features };
  }

  _seedFromPoint(point) {
    const lng = Math.round((point?.[0] || 0) * 10000);
    const lat = Math.round((point?.[1] || 0) * 10000);
    return Math.abs((lng * 73856093) ^ (lat * 19349663)) >>> 0;
  }

  _noise(value) {
    const x = Math.sin(value * 12.9898 + this.seed * 0.0001) * 43758.5453;
    return x - Math.floor(x);
  }

  _edgeTurbulence(angleDeg, tick) {
    const a = angleDeg * Math.PI / 180;
    const phase = tick * 0.85;
    const broad = Math.sin(a * 3 + phase + this.seed * 0.001) * 0.07;
    const medium = Math.sin(a * 7 - phase * 1.7 + this.seed * 0.003) * 0.04;
    const fine = (this._noise(angleDeg * 0.17 + Math.floor(tick * 3)) - 0.5) * 0.04;
    const windAmp = Math.min(0.08, this.windSpeed / 520);
    return Math.max(0.84, Math.min(1.18, 1 + broad + medium + fine + windAmp));
  }

  _canyonChannel(angleDeg, tick) {
    // Deterministic "terrain channeling" lobes. These make growth look like it
    // follows drainages/ridges without requiring a full terrain model.
    const channelA = (this.seed % 360);
    const channelB = (channelA + 115 + (this.seed % 41)) % 360;
    const width = 18 + Math.min(20, this.windSpeed * 0.35);
    const pulse = 0.5 + 0.5 * Math.sin(tick * 1.15 + this.seed * 0.002);
    const strengthA = this._angularFalloff(angleDeg, channelA, width) * pulse;
    const strengthB = this._angularFalloff(angleDeg, channelB, width * 0.8) * (1 - pulse * 0.45);
    return Math.max(strengthA, strengthB) * 0.35;
  }

  _angularFalloff(angleA, angleB, width) {
    let delta = Math.abs(((angleA - angleB + 540) % 360) - 180);
    if (delta > width) return 0;
    const t = delta / width;
    return 1 - t * t * (3 - 2 * t);
  }

  _activeSuppressionZones(suppressionZones, tick) {
    return suppressionZones.filter((zone) => {
      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      return tick >= activeAfter;
    });
  }

  _previousSectorDistance(index, tick) {
    if (
      !this._sectorDistancesKm ||
      this._sectorDistancesKm.length !== this.sectorCount ||
      (this._lastPerimeterTick != null && tick < this._lastPerimeterTick)
    ) {
      this._lastRawDistancesKm = null;
      return 0.02;
    }
    const distance = this._sectorDistancesKm[index];
    return Number.isFinite(distance) ? Math.max(0.02, distance) : 0.02;
  }

  _growthMultiplierForSuppression(suppression) {
    // Single zones slow fire noticeably; requires 4+ overlapping zones to fully stop a sector.
    const holdThreshold = 0.95;
    if (suppression >= holdThreshold) return 0;
    return Math.max(0, 1 - suppression / holdThreshold);
  }

  _containmentLimitDistance(bearingDeg, previousDistanceKm, rawDistanceKm, tick, suppressionZones, precomputedCenters) {
    let limit = Number.POSITIVE_INFINITY;

    for (let zi = 0; zi < suppressionZones.length; zi++) {
      const zone = suppressionZones[zi];
      if (zone.type !== 'dozer' && zone.resource_type !== 'dozer') continue;
      const center = precomputedCenters
        ? precomputedCenters[zi]
        : (Array.isArray(zone.center) ? zone.center : this._zoneCenter(zone));
      if (!center) continue;

      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      const ageHours = tick - activeAfter;
      if (ageHours <= 0) continue;

      const rampHours = Math.max(0.02, Number(zone.ramp_hours) || (zone.type === 'dozer' ? 0.04 : 0.12));
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      // Dozers create their containment line almost immediately (minProgress 0.02);
      // engines ramp up before their soft cap applies.
      const minProgress = zone.type === 'dozer' ? 0.02 : 0.15;
      if (progress < minProgress) continue;

      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || (zone.type === 'dozer' ? 55 : 80);
      const angularDistance = this._angularDistance(bearingDeg, zoneBearing);
      const angularReach = zone.type === 'dozer' ? sectorWidth * 0.9 : sectorWidth * 0.55;
      if (angularDistance > angularReach) continue;

      const radiusKm = Math.max(0.1, Number(zone.radius_km) || (zone.type === 'dozer' ? 1.0 : 0.8));
      const centerDistanceKm = this._distanceKm(this.ignition, center);
      const deltaRad = angularDistance * Math.PI / 180;
      const projectedLineDistanceKm = centerDistanceKm * Math.cos(deltaRad);
      if (!Number.isFinite(projectedLineDistanceKm)) continue;
      if (zone.type !== 'dozer' && projectedLineDistanceKm <= previousDistanceKm + 0.03) continue;
      // Allow dozer line to apply even when fire is approaching; only skip if fire has
      // significantly overtaken the line (0.5x radius behind), preventing stale lines
      // from creating phantom containment far inside the burnt area.
      if (zone.type === 'dozer' && projectedLineDistanceKm < previousDistanceKm - radiusKm * 0.5) continue;
      if (projectedLineDistanceKm > rawDistanceKm + radiusKm * 0.65) continue;

      const zoneFactor = Number(zone.factor);
      const factor = Number.isFinite(zoneFactor) ? zoneFactor : (zone.type === 'dozer' ? 0.88 : 0.52);
      const maturity = Math.max(0.65, progress);
      const holdingPower = Math.min(1, factor * maturity);
      if (holdingPower <= 0.08) continue;
      // Reduced buffer so the stop-line is slightly AHEAD of the current fire edge, not behind it.
      // This prevents the hard cap from snapping the perimeter backward.
      const bufferBehindLine = zone.type === 'dozer'
        ? Math.max(0.05, Math.min(0.4, Number(zone.cut_depth_km) || 0.25))
        : Math.max(0.03, 0.12 * (1 - holdingPower));
      const candidate = projectedLineDistanceKm - bufferBehindLine;

      if (zone.type === 'dozer') {
        // Enforce hard cap for dozers, pulling it back if smoothing pushed it forward.
        limit = Math.min(limit, candidate);
      } else {
        // Never pull the perimeter backward — only prevent future growth past the line.
        limit = Math.min(limit, Math.max(previousDistanceKm, candidate));
      }
    }

    return limit;
  }

  _leadingEdgePoint(coordinates, bearingDeg, origin) {
    let best = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    let bestProjection = Number.NEGATIVE_INFINITY;
    for (const coord of coordinates || []) {
      if (!Array.isArray(coord) || coord.length < 2) continue;
      const distanceKm = this._distanceKm(origin, coord);
      const coordBearing = this._bearing(origin, coord);
      const delta = this._angularDistance(coordBearing, bearingDeg);
      const deltaRad = delta * Math.PI / 180;
      const projection = distanceKm * Math.cos(deltaRad);
      if (delta < bestDelta || (Math.abs(delta - bestDelta) < 0.001 && projection > bestProjection)) {
        bestDelta = delta;
        bestProjection = projection;
        best = coord;
      }
    }
    return best || this._pointAtBearingAndDistance(origin, bearingDeg, 0.02);
  }

  _smoothPerimeterCoordinates(coordinates, suppressionZones, tick, zoneCenters) {
    if (!Array.isArray(coordinates) || coordinates.length < 5) return coordinates;
    const origin = this.ignition;
    const bearings = coordinates.map(coord => this._bearing(origin, coord));
    const distances = coordinates.map(coord => this._distanceKm(origin, coord));
    const smoothed = [];

    for (let i = 0; i < coordinates.length; i++) {
      const bearing = bearings[i];
      const dozerInfluence = this._dozerCutInfluence(bearing, tick, suppressionZones, zoneCenters);
      const engineInfluence = this._engineInfluence(bearing, tick, suppressionZones, zoneCenters);
      const hasInfluence = dozerInfluence > 0 || engineInfluence > 0;
      const maxSpikeDelta = hasInfluence ? 0.7 : 0.22;
      // Lower smoothing weight when suppression is active so pullback isn't averaged away
      const smoothingWeight = hasInfluence ? 0.38 : 0.78;

      const prev2 = distances[(i - 2 + distances.length) % distances.length];
      const prev1 = distances[(i - 1 + distances.length) % distances.length];
      const current = distances[i];
      const next1 = distances[(i + 1) % distances.length];
      const next2 = distances[(i + 2) % distances.length];
      const neighborAvg = (prev2 + prev1 * 2 + current * 3 + next1 * 2 + next2) / 9;
      let distance = current * (1 - smoothingWeight) + neighborAvg * smoothingWeight;

      const localMax = Math.max(prev1, next1) + maxSpikeDelta;
      const localMin = Math.max(0.02, Math.min(prev1, next1) - (dozerInfluence > 0 ? 0.75 : 0.3));
      distance = Math.max(localMin, Math.min(localMax, distance));
      smoothed.push(this._pointAtBearingAndDistance(origin, bearing, distance));
    }

    return smoothed;
  }

  _dozerCutInfluence(bearingDeg, tick, suppressionZones, precomputedCenters) {
    let influence = 0;
    for (let zi = 0; zi < suppressionZones.length; zi++) {
      const zone = suppressionZones[zi];
      if (zone.type !== 'dozer') continue;
      const center = precomputedCenters
        ? precomputedCenters[zi]
        : (Array.isArray(zone.center) ? zone.center : this._zoneCenter(zone));
      if (!center) continue;
      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      const ageHours = tick - activeAfter;
      if (ageHours <= 0) continue;
      const rampHours = Math.max(0.02, Number(zone.ramp_hours) || 0.04);
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || 55;
      const angular = this._angularDistance(bearingDeg, zoneBearing);
      if (angular > sectorWidth) continue;
      influence = Math.max(influence, progress * (1 - angular / sectorWidth));
    }
    return influence;
  }

  // Measures how much active engine suppression is covering this bearing sector.
  // Used to reduce perimeter smoothing so engine pullback isn't averaged away.
  _engineInfluence(bearingDeg, tick, suppressionZones, precomputedCenters) {
    let influence = 0;
    for (let zi = 0; zi < suppressionZones.length; zi++) {
      const zone = suppressionZones[zi];
      if (zone.type === 'dozer' || zone.resource_type === 'dozer') continue;
      const center = precomputedCenters
        ? precomputedCenters[zi]
        : (Array.isArray(zone.center) ? zone.center : this._zoneCenter(zone));
      if (!center) continue;
      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      const ageHours = tick - activeAfter;
      if (ageHours <= 0) continue;
      const rampHours = Math.max(0.02, Number(zone.ramp_hours) || 0.12);
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      if (progress < 0.05) continue;
      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || 80;
      const angular = this._angularDistance(bearingDeg, zoneBearing);
      if (angular > sectorWidth) continue;
      influence = Math.max(influence, progress * (1 - angular / sectorWidth));
    }
    return influence;
  }

  // Engine direct attack: engines at/near the fire edge actively pull the perimeter back
  // each physics tick.  This is the primary extinguishing mechanism for engines.
  // Unlike suppression damping (which only slows growth), this directly removes fire
  // regardless of whether the 0.95 combined-suppression threshold is reached.
  _engineDirectAttack(point, angleDeg, tick, suppressionZones, precomputedCenters) {
    let totalPullback = 0;

    for (let zi = 0; zi < suppressionZones.length; zi++) {
      const zone = suppressionZones[zi];
      if (zone.type === 'dozer' || zone.resource_type === 'dozer') continue;

      const center = precomputedCenters
        ? precomputedCenters[zi]
        : (Array.isArray(zone.center) ? zone.center : this._zoneCenter(zone));
      if (!center) continue;

      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      const ageHours = tick - activeAfter;
      if (ageHours <= 0) continue;

      const radiusKm = Math.max(0.1, Number(zone.radius_km) || 0.8);
      const distanceKm = this._distanceKm(point, center);
      if (distanceKm > radiusKm) continue;

      const rampHours = Math.max(0.02, Number(zone.ramp_hours) || 0.12);
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      if (progress < 0.05) continue;

      // Gentler distance falloff so engines still suppress even when slightly offset from edge
      const distanceFalloff = Math.pow(1 - distanceKm / radiusKm, 0.6);

      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || 80;
      const angularFalloff = Math.max(0, 1 - this._angularDistance(angleDeg, zoneBearing) / sectorWidth);
      if (angularFalloff <= 0) continue;

      const zoneFactor = Number(zone.factor);
      const factor = Number.isFinite(zoneFactor) ? zoneFactor : 0.88;

      // Per-tick pullback per engine group: 0.006 km base.
      // Engines at the fire edge directly remove ~6m of fire radius per 500ms tick,
      // scaling with zone factor (count-dependent) and proximity.
      totalPullback += 0.006 * factor * progress * distanceFalloff * angularFalloff;
    }

    // Cap total pullback per sector per tick so fire doesn't collapse instantly
    return Math.min(0.08, totalPullback);
  }

  _shoelaceAcres(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      area += (coords[i][0] + coords[j][0]) * (coords[i][1] - coords[j][1]);
    }
    area = Math.abs(area) / 2;
    const avgLat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const kmPerDeg = 111.32;
    const cosLat = Math.cos(avgLat * Math.PI / 180);
    return Math.round(area * kmPerDeg * kmPerDeg * cosLat * 247.105);
  }

  _suppressionDamping(point, angleDeg, tick, suppressionZones, precomputedCenters) {
    let openFraction = 1;

    for (let zi = 0; zi < suppressionZones.length; zi++) {
      const zone = suppressionZones[zi];
      const center = precomputedCenters
        ? precomputedCenters[zi]
        : (Array.isArray(zone.center) ? zone.center : this._zoneCenter(zone));
      if (!center) continue;

      const activeAfter = Number(zone.active_after_elapsed_hours ?? zone.created_elapsed_hours ?? 0);
      const ageHours = tick - activeAfter;
      if (ageHours <= 0) continue;

      const radiusKm = Math.max(0.1, Number(zone.radius_km) || (zone.type === 'dozer' ? 1.0 : 0.8));
      const distanceKm = this._distanceKm(point, center);
      if (distanceKm > radiusKm) continue;

      // Use the zone's own ramp_hours (set from resourceModel capabilities).
      const rampHours = Math.max(0.02, Number(zone.ramp_hours) || (zone.type === 'dozer' ? 0.04 : 0.12));
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      const distanceFalloff = Math.pow(1 - distanceKm / radiusKm, zone.type === 'dozer' ? 0.8 : 1.35);
      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || (zone.type === 'dozer' ? 55 : 80);
      const angularFalloff = Math.max(0, 1 - this._angularDistance(angleDeg, zoneBearing) / sectorWidth);

      // Dozers are CONTAINMENT tools — their hard-cap (_containmentLimitDistance) is their
      // primary fire-stopping mechanism.  Their suppression-damping contribution is intentionally
      // weak so that accumulated dozer zones don't cause the fire to shrink backward.
      // Engines are SUPPRESSION tools — high damping factor so overlapping engine groups
      // gradually extinguish fire and can push combined suppression past the shrink threshold.
      const isDozer = zone.type === 'dozer';
      const profile = isDozer
        ? distanceFalloff * Math.pow(angularFalloff, 0.55)
        : distanceFalloff * (0.78 + angularFalloff * 0.22);

      const zoneFactor = Number(zone.factor);
      // Dozers contribute at only 35% of their stated factor for suppression damping.
      const suppressionFactor = isDozer
        ? (Number.isFinite(zoneFactor) ? zoneFactor * 0.35 : 0.30)
        : (Number.isFinite(zoneFactor) ? zoneFactor : 0.90);
      const perZoneCap = isDozer ? 0.35 : 0.90;
      const damping = Math.max(0, Math.min(perZoneCap, suppressionFactor * progress * profile));
      openFraction *= (1 - damping);
    }

    return Math.max(0, Math.min(0.98, 1 - openFraction));
  }

  _zoneCenter(zone) {
    try {
      if (!zone.geojson) return null;
      const center = turf.center(zone.geojson).geometry.coordinates;
      return Array.isArray(center) && center.length >= 2 ? [center[0], center[1]] : null;
    } catch (_) {
      return null;
    }
  }

  _smoothstep(t) {
    return t * t * (3 - 2 * t);
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

  _pullToward(point, target, amount) {
    const t = Math.max(0, Math.min(0.85, amount));
    return [
      parseFloat((point[0] + (target[0] - point[0]) * t).toFixed(6)),
      parseFloat((point[1] + (target[1] - point[1]) * t).toFixed(6)),
    ];
  }

  _generateSpotFires(tick, growthRate, suppressionZones, mainPerimeter) {
    if (this.windSpeed < 18 || tick < 0.35) return [];
    const count = Math.min(3, 1 + Math.floor(this.windSpeed / 35));
    const spots = [];

    for (let i = 0; i < count; i++) {
      const phase = this._noise(i * 9.17 + Math.floor(tick * 2));
      if (phase < 0.34 && i > 0) continue;

      const offset = (i - (count - 1) / 2) * (12 + this.windSpeed * 0.12);
      const bearing = (this.windBearing + offset + (phase - 0.5) * 10 + 360) % 360;
      const distance = growthRate * (1.55 + i * 0.22 + phase * 0.35);
      const radius = Math.max(0.045, growthRate * (0.08 + phase * 0.04));
      const center = this._pointAtBearingAndDistance(this.ignition, bearing, distance);
      const ring = [];
      for (let p = 0; p < 18; p++) {
        const a = (p / 18) * 360;
        const wobble = 0.82 + this._noise(i * 31 + p * 0.7 + Math.floor(tick * 4)) * 0.35;
        ring.push(this._pointAtBearingAndDistance(center, a, radius * wobble));
      }
      ring.push(ring[0]);

      const spotSpeedMs = this.windSpeed * 0.44704;
      const spotBearingRad = this.windBearing * Math.PI / 180;
      const feature = {
        type: 'Feature',
        properties: {
          spot_fire: true,
          source: 'ember_cast',
          wind_bearing: this.windBearing,
          wind_u: parseFloat((spotSpeedMs * Math.sin(spotBearingRad)).toFixed(4)),
          wind_v: parseFloat((spotSpeedMs * Math.cos(spotBearingRad)).toFixed(4)),
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };

      try {
        if (mainPerimeter && turf.booleanPointInPolygon(turf.point(center), mainPerimeter)) continue;
      } catch (_) {}

      const suppressed = this._suppressionDamping(center, bearing, tick, suppressionZones) > 0.18;
      if (!suppressed) spots.push(feature);
    }
    return spots;
    return [];
  }

  /**
   * Compute a destination [lng, lat] given an origin, bearing (deg), and distance (km).
   * Uses the spherical-earth (haversine) formula.
   */
  _pointAtBearingAndDistance(center, bearingDeg, distanceKm) {
    const R       = 6371; // Earth radius km
    const lat1    = (center[1] * Math.PI) / 180;
    const lng1    = (center[0] * Math.PI) / 180;
    const bearing = (bearingDeg * Math.PI) / 180;
    const d       = distanceKm / R;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) +
      Math.cos(lat1) * Math.sin(d) * Math.cos(bearing)
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return [
      parseFloat(((lng2 * 180) / Math.PI).toFixed(6)),
      parseFloat(((lat2 * 180) / Math.PI).toFixed(6)),
    ];
  }
}

/**
 * Convert U/V wind components (m/s) to the TO-bearing (degrees) and speed (mph)
 * expected by WildfireEngine's constructor.
 * @param {number} windU  Eastward component m/s
 * @param {number} windV  Northward component m/s
 * @returns {{ windBearing: number, windSpeed: number }}
 */
WildfireEngine.uvToEngine = function uvToEngine(windU, windV) {
  const speedMs = Math.sqrt(windU * windU + windV * windV);
  const speedMph = speedMs / 0.44704;
  const bearingDeg = ((Math.atan2(windU, windV) * 180 / Math.PI) + 360) % 360;
  return { windBearing: bearingDeg, windSpeed: speedMph };
};

/**
 * Factory that accepts U/V wind components instead of bearing + speed.
 * @param {[number, number]} ignition  [lng, lat]
 * @param {number} windU               Eastward component m/s
 * @param {number} windV               Northward component m/s
 * @param {object} [extras]            Passed to WildfireEngine constructor extras
 */
WildfireEngine.fromUV = function fromUV(ignition, windU, windV, extras = {}) {
  const { windBearing, windSpeed } = WildfireEngine.uvToEngine(windU, windV);
  return new WildfireEngine(ignition, windBearing, windSpeed, extras);
};

module.exports = { WildfireEngine };
