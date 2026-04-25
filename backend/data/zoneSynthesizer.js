const turf = require('@turf/turf');

/**
 * Synthesize evacuation zones from shelters + population tracts.
 *
 * For each shelter, build a zone covering nearby population tracts:
 *   - include tracts whose centroid is between 0.5km and MAX_RADIUS_KM of the shelter
 *   - take up to MAX_TRACTS_PER_ZONE of them
 *   - compute the convex hull of those centroids as the zone polygon
 *   - fall back to a circle around the shelter if < 3 tracts available
 *
 * @param {object} sheltersFC           FeatureCollection of shelter point features
 * @param {object} populationTractsFC   FeatureCollection of population tract point features
 * @returns {object}                    FeatureCollection of zone polygons
 */
function synthesizeEvacuationZones(sheltersFC, populationTractsFC) {
  const MIN_KM = 0.5;
  const MAX_RADIUS_KM = 3.0;
  const MAX_TRACTS_PER_ZONE = 12;
  const FALLBACK_RADIUS_KM = 1.5;

  const shelters = sheltersFC?.features || [];
  const tracts = populationTractsFC?.features || [];
  if (shelters.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }

  const zoneFeatures = [];

  for (const shelter of shelters) {
    const shelterId = shelter.properties?.shelter_id || shelter.properties?.id;
    const shelterName = shelter.properties?.name || shelterId || 'Shelter';
    if (!shelterId) continue;
    const shelterCoords = shelter.geometry?.coordinates;
    if (!shelterCoords) continue;

    const shelterPt = turf.point(shelterCoords);

    const withDistance = tracts
      .map(t => {
        if (!t.geometry?.coordinates) return null;
        const d = turf.distance(shelterPt, turf.point(t.geometry.coordinates), { units: 'kilometers' });
        return { feature: t, distance: d };
      })
      .filter(x => x && x.distance >= MIN_KM && x.distance <= MAX_RADIUS_KM);

    withDistance.sort((a, b) => a.distance - b.distance);
    const selected = withDistance.slice(0, MAX_TRACTS_PER_ZONE);

    let polygon = null;
    let centroid = shelterCoords;
    let population = 0;

    if (selected.length >= 3) {
      const points = turf.featureCollection(
        selected.map(s => turf.point(s.feature.geometry.coordinates))
      );
      const hull = turf.convex(points);
      if (hull?.geometry?.type === 'Polygon') {
        polygon = hull.geometry;
        const c = turf.centroid(hull).geometry.coordinates;
        centroid = c;
      }
      population = selected.reduce(
        (sum, s) => sum + (Number(s.feature.properties?.population) || 0),
        0,
      );
    }

    if (!polygon) {
      const circle = turf.circle(shelterCoords, FALLBACK_RADIUS_KM, { steps: 24, units: 'kilometers' });
      polygon = circle.geometry;
      centroid = shelterCoords;
      population = selected.reduce(
        (sum, s) => sum + (Number(s.feature.properties?.population) || 0),
        0,
      );
    }

    const zoneId = `zone-${shelterId}`;
    zoneFeatures.push({
      type: 'Feature',
      geometry: polygon,
      properties: {
        zone_id: zoneId,
        id: zoneId,
        name: `Zone near ${shelterName}`,
        nearest_shelter_id: shelterId,
        population,
        centroid_lng: centroid[0],
        centroid_lat: centroid[1],
        status: 'clear',
      },
    });
  }

  return { type: 'FeatureCollection', features: zoneFeatures };
}

module.exports = { synthesizeEvacuationZones };
