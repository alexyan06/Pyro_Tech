const { WildfireEngine } = require('./wildfireEngine');
const {
  createAssignment,
  assignmentToSuppressionEffect,
} = require('./resourceModel');

const origin = [-118.5, 34.05];
const windBearing = 45;

function pointAtBearingAndDistance(center, bearingDeg, distanceKm) {
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

function distanceKm(a, b) {
  const R = 6371;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLng = (b[0] - a[0]) * Math.PI / 180;
  const lat1 = a[1] * Math.PI / 180;
  const lat2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function makeDozerEffect(distanceFromOriginKm) {
  return assignmentToSuppressionEffect(
    createAssignment({
      id: 'probe-dozer',
      type: 'dozer_line',
      resourceType: 'dozer',
      target: pointAtBearingAndDistance(origin, windBearing, distanceFromOriginKm),
      targetBearingDeg: windBearing,
      resourceGroupIds: ['probe-dozer-group'],
      startsElapsedHours: 0.2,
      createdElapsedHours: 0,
      durationHours: 10,
    }),
    [{ id: 'probe-dozer-group', type: 'dozer', count: 2 }],
    2,
  );
}

function makeEngineEffect(distanceFromOriginKm) {
  return assignmentToSuppressionEffect(
    createAssignment({
      id: 'probe-engine',
      type: 'direct_attack',
      resourceType: 'engine',
      target: pointAtBearingAndDistance(origin, windBearing, distanceFromOriginKm),
      targetBearingDeg: windBearing,
      resourceGroupIds: ['probe-engine-group'],
      startsElapsedHours: 0.2,
      createdElapsedHours: 0,
      durationHours: 10,
    }),
    [{ id: 'probe-engine-group', type: 'engine', count: 8 }],
    2,
  );
}

function runPerimeter(suppressionEffects) {
  const engine = new WildfireEngine(origin, windBearing, 40, {
    humidity: 20,
    temperature: 85,
    initialAcres: 80,
  });
  let perimeter;
  for (let t = 0.05; t <= 2; t += 0.05) {
    perimeter = engine.generatePerimeter(Number(t.toFixed(2)), suppressionEffects);
  }
  const feature = perimeter.features[0];
  return {
    acres: feature.properties.acres,
    headKm: Number(distanceKm(origin, feature.properties.head_position).toFixed(3)),
    dozerHits: feature.properties.dozer_barrier_hits,
    engineHits: feature.properties.engine_sector_hits,
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dozer = makeDozerEffect(2);
const engine = makeEngineEffect(1.5);
const none = runPerimeter([]);
const dozerOnly = runPerimeter([dozer]);
const engineOnly = runPerimeter([engine]);

assert(dozer.bearing_deg === windBearing, 'Dozer effect bearing must use wind bearing');
assert(dozer.visual_geojson.properties.orientation_deg === 135, 'Dozer line must be perpendicular to wind');
assert(dozer.effect_type === 'dozer_line', 'Dozer effect type must be dozer_line');
assert(dozer.geojson.geometry.type === 'Polygon', 'Dozer physical effect must be a buffered barrier polygon');
assert(dozerOnly.dozerHits > 0, 'Dozer line should block at least one sector crossing');
assert(dozerOnly.headKm < none.headKm, 'Dozer line should reduce head-fire growth');
assert(engineOnly.engineHits > 0, 'Engine zone should suppress at least one sector');
assert(engineOnly.acres < none.acres, 'Engine zone should reduce burned acres');

console.log(JSON.stringify({
  dozerLineBearing: dozer.bearing_deg,
  dozerLineOrientation: dozer.visual_geojson.properties.orientation_deg,
  none,
  dozer: dozerOnly,
  engine: engineOnly,
}, null, 2));
