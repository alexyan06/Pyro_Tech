const turf = require('@turf/turf');

const RESOURCE_TYPES = Object.freeze({
  ENGINE: 'engine',
  DOZER: 'dozer',
});

const RESOURCE_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  DISPATCHING: 'dispatching',
  STAGED: 'staged',
  WORKING: 'working',
  RELEASED: 'released',
  FAILED: 'failed',
});

const ASSIGNMENT_TYPES = Object.freeze({
  FLANK_HOLD: 'flank_hold',
  DIRECT_ATTACK: 'direct_attack',
  DOZER_LINE: 'dozer_line',
  STRUCTURE_DEFENSE: 'structure_defense',
});

const EFFECT_TYPES = Object.freeze({
  ENGINE_AREA: 'engine_area',
  DOZER_LINE: 'dozer_line',
});

const RESOURCE_CAPABILITIES = Object.freeze({
  [RESOURCE_TYPES.ENGINE]: Object.freeze({
    speedKph: 42,
    setupHours: 0.05,   // faster setup so engines start working sooner
    baselineCount: 8,
    baseFactor: 0.88,   // high factor — engines suppress/extinguish existing fire
    factorCap: 0.95,    // can achieve near-full suppression with multiple groups
    radiusBaseKm: 0.65,
    radiusCapKm: 1.2,
    rampHours: 0.12,    // ramp up quickly (~7 min sim time) for immediate visible effect
    ttlHours: 3.0,      // engines work longer
    sectorDegrees: 80,
    cutDepthKm: 0,
  }),
  [RESOURCE_TYPES.DOZER]: Object.freeze({
    speedKph: 18,
    setupHours: 0.08,   // faster deployment
    baselineCount: 2,
    baseFactor: 0.82,
    factorCap: 0.92,
    radiusBaseKm: 1.0,  // longer containment coverage
    radiusCapKm: 1.8,
    rampHours: 0.04,    // line appears almost immediately on arrival
    ttlHours: 1.6,
    sectorDegrees: 55,
    cutDepthKm: 0.45,   // deeper cut depth for stronger hard cap
    barrierWidthKm: 0.08,
  }),
});

const ASSIGNMENT_EFFECT_PROFILES = Object.freeze({
  [ASSIGNMENT_TYPES.FLANK_HOLD]: Object.freeze({
    factorScale: 0.78,
    radiusScale: 0.9,
    sectorDegrees: 82,
  }),
  [ASSIGNMENT_TYPES.DIRECT_ATTACK]: Object.freeze({
    factorScale: 0.62,
    radiusScale: 0.65,
    sectorDegrees: 46,
  }),
  [ASSIGNMENT_TYPES.STRUCTURE_DEFENSE]: Object.freeze({
    factorScale: 0.48,
    radiusScale: 0.55,
    sectorDegrees: 360,
  }),
  [ASSIGNMENT_TYPES.DOZER_LINE]: Object.freeze({
    factorScale: 1,
    radiusScale: 1,
    sectorDegrees: 58,
  }),
});

let nextSequence = 1;

function normalizeResourceType(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('dozer') || raw.includes('bulldozer')) return RESOURCE_TYPES.DOZER;
  return RESOURCE_TYPES.ENGINE;
}

function normalizeAssignmentType(value, resourceType) {
  const raw = String(value || '').toLowerCase();
  if (raw === ASSIGNMENT_TYPES.STRUCTURE_DEFENSE || /structure|hospital|shelter|facility|defen[sc]e/.test(raw)) return ASSIGNMENT_TYPES.STRUCTURE_DEFENSE;
  if (raw === ASSIGNMENT_TYPES.DIRECT_ATTACK || /direct|attack|edge|perimeter/.test(raw)) return ASSIGNMENT_TYPES.DIRECT_ATTACK;
  if (raw === ASSIGNMENT_TYPES.FLANK_HOLD || /flank|hold/.test(raw)) return ASSIGNMENT_TYPES.FLANK_HOLD;
  if (raw === ASSIGNMENT_TYPES.DOZER_LINE || /dozer|line|contain|cut/.test(raw)) return ASSIGNMENT_TYPES.DOZER_LINE;
  return normalizeResourceType(resourceType) === RESOURCE_TYPES.DOZER
    ? ASSIGNMENT_TYPES.DOZER_LINE
    : ASSIGNMENT_TYPES.FLANK_HOLD;
}

function resourceCapabilities(resourceType) {
  return RESOURCE_CAPABILITIES[normalizeResourceType(resourceType)];
}

function createResourceGroup(input = {}) {
  const type = normalizeResourceType(input.type || input.resource_type);
  const count = positiveInteger(input.count, type === RESOURCE_TYPES.DOZER ? 2 : 8);
  const departedElapsedHours = finiteNumber(input.departedElapsedHours ?? input.departed_elapsed_hours, 0);
  const arrivalElapsedHours = finiteNumber(
    input.arrivalElapsedHours ?? input.arrival_elapsed_hours,
    departedElapsedHours,
  );
  const destination = normalizeLngLat(input.destination || input.location);
  const from = normalizeLngLat(input.from || input.from_location);

  return {
    id: input.id || makeId(type),
    type,
    count,
    homeStationId: input.homeStationId || input.from_station_id || null,
    homeStationName: input.homeStationName || input.from_station_name || null,
    status: input.status || RESOURCE_STATUSES.DISPATCHING,
    location: from || destination,
    destination,
    dispatchPath: normalizePath(input.dispatchPath || input.dispatch_path, from, destination),
    departedElapsedHours,
    arrivalElapsedHours,
    assignmentId: input.assignmentId || input.assignment_id || null,
    metadata: { ...(input.metadata || {}) },
  };
}

function createAssignment(input = {}) {
  const resourceType = normalizeResourceType(input.resourceType || input.resource_type);
  const type = normalizeAssignmentType(input.type || input.assignment_type, resourceType);
  const startsElapsedHours = finiteNumber(
    input.startsElapsedHours ?? input.starts_elapsed_hours,
    finiteNumber(input.createdElapsedHours ?? input.created_elapsed_hours, 0),
  );
  const capabilities = resourceCapabilities(resourceType);
  const durationHours = finiteNumber(input.durationHours ?? input.duration_hours, capabilities.ttlHours);
  const target = normalizeLngLat(input.target || input.location);

  return {
    id: input.id || makeId(type),
    type,
    resourceType,
    resourceGroupIds: Array.isArray(input.resourceGroupIds)
      ? input.resourceGroupIds.slice()
      : Array.isArray(input.resource_group_ids)
        ? input.resource_group_ids.slice()
        : [],
    target,
    targetBearingDeg: finiteNumberOrNull(input.targetBearingDeg ?? input.target_bearing_deg),
    createdElapsedHours: finiteNumber(input.createdElapsedHours ?? input.created_elapsed_hours, startsElapsedHours),
    startsElapsedHours,
    expiresElapsedHours: finiteNumber(
      input.expiresElapsedHours ?? input.expires_elapsed_hours,
      startsElapsedHours + durationHours,
    ),
    expectedDurationHours: durationHours,
    effectiveness: finiteNumber(input.effectiveness, null),
    progress: finiteNumber(input.progress, 0),
    metadata: { ...(input.metadata || {}) },
  };
}

function statusForResourceGroup(group, elapsedHours) {
  if (!group) return RESOURCE_STATUSES.FAILED;
  if (group.status === RESOURCE_STATUSES.RELEASED || group.status === RESOURCE_STATUSES.FAILED) {
    return group.status;
  }
  const now = finiteNumber(elapsedHours, 0);
  const arrival = finiteNumber(group.arrivalElapsedHours ?? group.arrival_elapsed_hours, Infinity);
  if (now < arrival) return RESOURCE_STATUSES.DISPATCHING;
  return group.assignmentId || group.assignment_id
    ? RESOURCE_STATUSES.WORKING
    : RESOURCE_STATUSES.STAGED;
}

function progressForAssignment(assignment, elapsedHours) {
  if (!assignment) return 0;
  const now = finiteNumber(elapsedHours, 0);
  const start = finiteNumber(assignment.startsElapsedHours ?? assignment.starts_elapsed_hours, 0);
  const end = finiteNumber(
    assignment.expiresElapsedHours ?? assignment.expires_elapsed_hours,
    start + finiteNumber(assignment.expectedDurationHours ?? assignment.expected_duration_hours, 1),
  );
  if (now <= start) return 0;
  if (end <= start) return 1;
  return clamp((now - start) / (end - start), 0, 1);
}

function summarizeResourceGroups(groups) {
  const values = Array.isArray(groups) ? groups : Object.values(groups || {});
  return values.reduce((summary, group) => {
    const type = normalizeResourceType(group.type || group.resource_type);
    const count = positiveInteger(group.count, 0);
    const status = group.status || RESOURCE_STATUSES.DISPATCHING;
    const active = status !== RESOURCE_STATUSES.RELEASED && status !== RESOURCE_STATUSES.FAILED;
    if (active) {
      if (type === RESOURCE_TYPES.DOZER) summary.dozers_deployed += count;
      else summary.engines_deployed += count;
      summary.total_deployed += count;
    }
    summary.by_status[status] = (summary.by_status[status] || 0) + count;
    return summary;
  }, {
    engines_deployed: 0,
    dozers_deployed: 0,
    total_deployed: 0,
    by_status: {},
  });
}

function assignmentToSuppressionEffect(assignment, groups = [], elapsedHours = null) {
  if (!assignment?.target) return null;
  const resourceType = normalizeResourceType(assignment.resourceType || assignment.resource_type);
  const type = normalizeAssignmentType(assignment.type || assignment.assignment_type, resourceType);
  const capabilities = resourceCapabilities(resourceType);
  const profile = ASSIGNMENT_EFFECT_PROFILES[type] || ASSIGNMENT_EFFECT_PROFILES[ASSIGNMENT_TYPES.FLANK_HOLD];
  const groupList = Array.isArray(groups) ? groups : Object.values(groups || {});
  const assignmentGroupIds = assignment.resourceGroupIds || assignment.resource_group_ids || [];
  const assignedCount = groupList
    .filter(group => !assignmentGroupIds.length || assignmentGroupIds.includes(group.id))
    .reduce((sum, group) => sum + positiveInteger(group.count, 0), 0);
  const count = assignedCount || positiveInteger(assignment.count, resourceType === RESOURCE_TYPES.DOZER ? 2 : 8);
  const radiusKm = Math.min(
    capabilities.radiusCapKm,
    capabilities.radiusBaseKm * Math.sqrt(Math.min(3, count)),
  ) * profile.radiusScale;
  const progress = elapsedHours == null
    ? finiteNumber(assignment.progress, 0)
    : progressForAssignment(assignment, elapsedHours);
  const lineProgress = 1; // Dozer lines appear at full length instantly on arrival
  const baseFactor = finiteNumber(
    assignment.effectiveness,
    Math.min(
      capabilities.factorCap,
      capabilities.baseFactor * (0.85 + 0.15 * Math.sqrt(count / capabilities.baselineCount)),
    ),
  );
  const factor = baseFactor * profile.factorScale;
  const isDozerLine = type === ASSIGNMENT_TYPES.DOZER_LINE;

  // Cache geometry on the assignment to avoid repeated turf.buffer calls every tick
  if (isDozerLine) {
    if (!assignment._cachedLineGeojson) {
      assignment._cachedLineGeojson = buildDozerLineGeometry(
        assignment.target,
        assignment.targetBearingDeg,
        radiusKm,
        lineProgress,
      );
    }
    if (!assignment._cachedPhysicalGeojson) {
      assignment._cachedPhysicalGeojson = buildDozerBarrierGeometry(
        assignment._cachedLineGeojson,
        capabilities.barrierWidthKm,
      );
    }
  } else if (!assignment._cachedPhysicalGeojson) {
    assignment._cachedPhysicalGeojson = buildEngineAreaGeometry(assignment.target, radiusKm);
  }
  if (!assignment._cachedVisualGeojson) {
    assignment._cachedVisualGeojson = isDozerLine
      ? assignment._cachedLineGeojson
      : buildEngineAreaGeometry(assignment.target, Math.max(0.12, Math.min(0.32, radiusKm * 0.22)));
  }
  const physicalGeojson = assignment._cachedPhysicalGeojson;
  const visualGeojson = assignment._cachedVisualGeojson;
  const lineGeojson = assignment._cachedLineGeojson || null;
  const lineCoords = lineGeojson?.geometry?.coordinates || null;

  return {
    id: assignment.effectId || assignment.effect_id || `${assignment.id}-effect`,
    sourceAssignmentId: assignment.id,
    type: resourceType,
    effect_type: type === ASSIGNMENT_TYPES.DOZER_LINE ? EFFECT_TYPES.DOZER_LINE : EFFECT_TYPES.ENGINE_AREA,
    resourceType,
    resource_type: resourceType,
    geojson: physicalGeojson,
    visual_geojson: visualGeojson,
    line_geojson: lineGeojson,
    barrier_geojson: isDozerLine ? physicalGeojson : null,
    barrier_width_km: isDozerLine ? capabilities.barrierWidthKm : 0,
    line_start: Array.isArray(lineCoords?.[0]) ? lineCoords[0] : null,
    line_end: Array.isArray(lineCoords?.[1]) ? lineCoords[1] : null,
    factor,
    center: assignment.target,
    bearing_deg: finiteNumberOrNull(assignment.targetBearingDeg ?? assignment.target_bearing_deg),
    radius_km: radiusKm,
    cut_depth_km: capabilities.cutDepthKm,
    count,
    progress,
    line_progress: lineProgress,
    ramp_hours: capabilities.rampHours,
    sector_degrees: profile.sectorDegrees || capabilities.sectorDegrees,
    active_after_elapsed_hours: finiteNumber(assignment.startsElapsedHours ?? assignment.starts_elapsed_hours, 0),
    expires_elapsed_hours: type === ASSIGNMENT_TYPES.DOZER_LINE 
      ? Infinity 
      : finiteNumber(
          assignment.expiresElapsedHours ?? assignment.expires_elapsed_hours,
          capabilities.ttlHours,
        ),
  };
}

function buildEngineAreaGeometry(center, radiusKm) {
  try {
    return turf.buffer(turf.point(center), radiusKm, { units: 'kilometers' });
  } catch (_) {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: center },
    };
  }
}

function buildDozerLineGeometry(center, bearingDeg, radiusKm, progress = 1) {
  const bearing = finiteNumber(bearingDeg, 0);
  const lateral = (bearing + 90) % 360;
  const lengthKm = Math.max(0.6, Math.min(1.8, radiusKm * 1.6));
  const lineProgress = clamp(progress, 0.02, 1);
  const start = pointAtBearingAndDistance(center, lateral + 180, lengthKm / 2);
  const end = pointAtBearingAndDistance(center, lateral, lengthKm / 2);
  const builtEnd = [
    Number((start[0] + (end[0] - start[0]) * lineProgress).toFixed(6)),
    Number((start[1] + (end[1] - start[1]) * lineProgress).toFixed(6)),
  ];
  return {
    type: 'Feature',
    properties: {
      type: 'dozer_line',
      resource_type: RESOURCE_TYPES.DOZER,
      progress: clamp(progress, 0, 1),
      bearing_deg: bearing,
      orientation_deg: lateral,
    },
    geometry: {
      type: 'LineString',
      coordinates: [start, builtEnd],
    },
  };
}

function buildDozerBarrierGeometry(lineGeojson, widthKm) {
  try {
    const buffered = turf.buffer(lineGeojson, Math.max(0.02, widthKm), { units: 'kilometers' });
    return {
      ...buffered,
      properties: {
        ...(buffered.properties || {}),
        type: 'dozer_barrier',
        resource_type: RESOURCE_TYPES.DOZER,
        barrier_width_km: widthKm,
      },
    };
  } catch (_) {
    return lineGeojson;
  }
}

function normalizeLngLat(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function normalizePath(path, from, to) {
  const normalized = Array.isArray(path)
    ? path.map(normalizeLngLat).filter(Boolean)
    : [];
  if (normalized.length >= 2) return normalized;
  if (from && to) return [from, to];
  return [];
}

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

function makeId(prefix) {
  const seq = nextSequence++;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function finiteNumber(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function finiteNumberOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveInteger(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  RESOURCE_TYPES,
  RESOURCE_STATUSES,
  ASSIGNMENT_TYPES,
  EFFECT_TYPES,
  RESOURCE_CAPABILITIES,
  ASSIGNMENT_EFFECT_PROFILES,
  normalizeResourceType,
  normalizeAssignmentType,
  resourceCapabilities,
  createResourceGroup,
  createAssignment,
  statusForResourceGroup,
  progressForAssignment,
  summarizeResourceGroups,
  assignmentToSuppressionEffect,
};
