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
   * Suppression zones damp local edge growth over time instead of instantly
   * subtracting a full polygon from the active fire shape.
   *
   * @param {number} tick                 1-based tick index
   * @param {Array}  [suppressionZones]   List of { geojson: Feature<Polygon> }
   * @returns {GeoJSON.FeatureCollection}
   */
  generatePerimeter(tick, suppressionZones = []) {
    const baseSpreadKm = 0.12;
    const windFactor   = 1 + (this.windSpeed / 40);
    const humidFactor  = this._humidFactor();
    const tempFactor   = this._tempFactor();

    const initialGrowthKm = this._growthRateForAcres(this.initialAcres);
    const spreadGrowthKm = baseSpreadKm * windFactor * humidFactor * tempFactor * Math.pow(tick, 1.3);
    const growthRate = initialGrowthKm + spreadGrowthKm;

    // Elliptical spread: longer axis aligns with wind direction
    const headFire  = growthRate * 1.8; // downwind — fastest
    const backFire  = growthRate * 0.3; // upwind   — slowest
    const flankFire = growthRate * 0.7; // crosswind

    const numPoints = 72;
    const coordinates = [];
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
        baseRadius * turbulence + canyonChannel * spreadGrowthKm * (0.35 + windAlignment * 0.55),
      );
      const projectedPoint = this._pointAtBearingAndDistance(center, angleDeg, rawRadius);
      const suppression = this._suppressionDamping(projectedPoint, angleDeg, tick, suppressionZones, zoneCenters);
      const radius = Math.max(
        0.02,
        rawRadius * (1 - suppression) - growthRate * suppression * 0.12,
      );

      coordinates.push(
        this._pointAtBearingAndDistance(center, angleDeg, radius)
      );
    }

    // Close the polygon
    coordinates.push(coordinates[0]);

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
        head_position:     this._pointAtBearingAndDistance(center, this.windBearing, headFire),
        center_position:   center,
        irregularity:      true,
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

  applySuppressionToPerimeter(perimeter, tick, suppressionZones = []) {
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

      const coordinates = feature.geometry.coordinates.map((ring) => ring.map((coord) => {
        if (!Array.isArray(coord) || coord.length < 2) return coord;
        const point = [coord[0], coord[1]];
        const bearing = this._bearing(center, point);
        const damping = this._suppressionDamping(point, bearing, tick, suppressionZones, zoneCenters);
        return damping > 0 ? this._pullToward(point, center, damping * 0.42) : point;
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
    const broad = Math.sin(a * 3 + phase + this.seed * 0.001) * 0.16;
    const medium = Math.sin(a * 7 - phase * 1.7 + this.seed * 0.003) * 0.10;
    const fine = (this._noise(angleDeg * 0.17 + Math.floor(tick * 3)) - 0.5) * 0.12;
    const windAmp = Math.min(0.18, this.windSpeed / 260);
    return Math.max(0.68, Math.min(1.42, 1 + broad + medium + fine + windAmp));
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
    return Math.max(strengthA, strengthB);
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

      const radiusKm = Math.max(0.1, Number(zone.radius_km) || (zone.type === 'dozer' ? 1.2 : 0.8));
      const distanceKm = this._distanceKm(point, center);
      if (distanceKm > radiusKm) continue;

      const rampHours = Math.max(0.05, Number(zone.ramp_hours) || (zone.type === 'dozer' ? 0.65 : 0.45));
      const progress = this._smoothstep(Math.max(0, Math.min(1, ageHours / rampHours)));
      const distanceFalloff = Math.pow(1 - distanceKm / radiusKm, zone.type === 'dozer' ? 0.8 : 1.35);
      const zoneBearing = Number.isFinite(Number(zone.bearing_deg))
        ? Number(zone.bearing_deg)
        : this._bearing(this.ignition, center);
      const sectorWidth = Number(zone.sector_degrees) || (zone.type === 'dozer' ? 58 : 90);
      const angularFalloff = Math.max(0, 1 - this._angularDistance(angleDeg, zoneBearing) / sectorWidth);
      const profile = zone.type === 'dozer'
        ? distanceFalloff * Math.pow(angularFalloff, 0.55)
        : distanceFalloff * (0.65 + angularFalloff * 0.35);
      const maxStrength = Number(zone.factor) || (zone.type === 'dozer' ? 0.58 : 0.34);
      const damping = Math.max(0, Math.min(0.72, maxStrength * progress * profile));
      openFraction *= (1 - damping);
    }

    return Math.max(0, Math.min(0.78, 1 - openFraction));
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
