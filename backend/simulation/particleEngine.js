/**
 * ParticleEngine — emits ambient vehicle trips for the map's TripsLayer.
 *
 * Cars are seeded at random-but-stable highway graph nodes inside the scenario
 * bbox. Trips stay strictly on the road network, so coastal scenarios never
 * draw impossible connector lines from ocean/open terrain to the highway.
 */

const { buildRoadGraph, shortestPath } = require('./roadGraph');

const LOOP_LENGTH = 1800;
const AMBIENT_CAR_COUNT = 180;
const MIN_TRIP_KM = 1.2;

// Seeded RNG so car start positions stay put across rebuilds — otherwise the
// trails would jump every 2s when syncFlows re-runs.
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

class ParticleEngine {
  constructor() {
    this.trips = [];
    this._graph = null;
    this._graphSignature = '';
    this._graphLogged = false;
    this._seeds = null;
    this._seedsBboxKey = '';
  }

  /**
   * @param {Array} _flows — kept for signature compatibility, unused in ambient mode
   * @param {Object} _zones
   * @param {Object} _shelters
   * @param {Object} baseRoutes
   * @param {Object} fireState — { closed_routes, route_congestion, origin, perimeter, bbox }
   */
  syncFlows(_flows, _zones, _shelters, baseRoutes = {}, fireState = {}) {
    this.trips = [];
    this._ensureGraph(baseRoutes);
    if (!this._graph?.nodes?.size) return;

    const bbox = fireState.bbox;
    if (!bbox || bbox.length !== 4) return;

    const routeCongestion = Object.fromEntries(
      (fireState.route_congestion || []).map((route) => [route.route_id, route]),
    );
    const closedRoutes = new Set(fireState.closed_routes || []);
    const nodeList = Array.from(this._graph.nodes.values());
    const fireOrigin = Array.isArray(fireState.origin) ? fireState.origin : null;
    this._ensureSeeds(bbox, nodeList);

    let routed = 0;
    let skipped = 0;
    for (let i = 0; i < this._seeds.length; i++) {
      const seed = this._seeds[i];
      const entry = this._graph.nodes.get(seed.entryKey);
      if (!entry) { skipped++; continue; }

      // Pick a destination node that is far enough on the graph and, if a fire
      // origin is known, lies away from the fire so cars flow outward.
      const exit = this._pickExitNode(entry, nodeList, fireOrigin, seed.rand);
      if (!exit || exit.key === entry.key) { skipped++; continue; }

      const routedPath = shortestPath(this._graph, entry.coord, exit.coord, {
        routeCongestion,
        closedRoutes,
      });
      if (!routedPath?.path || routedPath.path.length < 2) { skipped++; continue; }

      const baselineCongestion = closedRoutes.size > 0
        ? Object.fromEntries(
            Object.entries(routeCongestion).map(([routeId, route]) => [
              routeId,
              closedRoutes.has(routeId) ? { ...route, status: 'open' } : route,
            ]),
          )
        : routeCongestion;
      const baselinePath = closedRoutes.size > 0
        ? shortestPath(this._graph, entry.coord, exit.coord, { routeCongestion: baselineCongestion, closedRoutes: new Set() })
        : null;
      const wasRerouted = Boolean(
        baselinePath?.route_ids?.some((routeId) => closedRoutes.has(routeId))
        && !routedPath.route_ids?.some((routeId) => closedRoutes.has(routeId)),
      );

      const status = this._tripStatus(routedPath.route_ids || [], routeCongestion, closedRoutes, wasRerouted);
      this._addTrip(routedPath.path, i, status);
      routed++;
    }

    if (routed === 0 && skipped > 0) {
      console.log(`[ParticleEngine] No ambient trips routed (skipped ${skipped}).`);
    }
  }

  _ensureGraph(baseRoutes) {
    const signature = Object.keys(baseRoutes || {}).sort().join('|');
    if (signature === this._graphSignature) return;
    this._graph = buildRoadGraph(baseRoutes || {});
    this._graphSignature = signature;
    this._graphLogged = false;
    if (this._graph?.health) {
      const h = this._graph.health;
      console.log(`[ParticleEngine] Road graph: ${h.node_count} nodes, ${h.edge_count} edges, ${h.nodes_dropped} dropped (orphans pruned)`);
      this._graphLogged = true;
    }
  }

  _ensureSeeds(bbox, nodeList) {
    const key = `${this._graphSignature}|${bbox.join(',')}`;
    if (key === this._seedsBboxKey && this._seeds) return;
    const rng = mulberry32(0xE3B42 >>> 0);
    const candidates = this._nodesInBbox(nodeList, bbox);
    if (candidates.length === 0) {
      this._seeds = [];
      this._seedsBboxKey = key;
      return;
    }

    const seeds = [];
    for (let i = 0; i < AMBIENT_CAR_COUNT; i++) {
      const index = Math.floor(rng() * candidates.length);
      // Store a stable node key plus a per-car sub-seed for exit selection.
      seeds.push({ entryKey: candidates[index].key, rand: rng() });
    }
    this._seeds = seeds;
    this._seedsBboxKey = key;
  }

  _nodesInBbox(nodeList, bbox) {
    const [west, south, east, north] = bbox;
    const inBbox = nodeList.filter((node) => {
      const [lng, lat] = node.coord;
      return lng >= west && lng <= east && lat >= south && lat <= north;
    });
    return inBbox.length > 0 ? inBbox : nodeList;
  }

  _pickExitNode(entry, nodeList, fireOrigin, rand) {
    // Prefer a node 3–20 km away. Among candidates, pick the one farthest from
    // the fire origin (when known) so the ambient flow naturally points away.
    let best = null;
    let bestScore = -Infinity;
    const sampleSize = Math.min(48, nodeList.length);
    const offset = Math.floor(rand * nodeList.length);
    for (let i = 0; i < sampleSize; i++) {
      const node = nodeList[(offset + i * 37) % nodeList.length];
      if (node.key === entry.key) continue;
      const dx = node.coord[0] - entry.coord[0];
      const dy = node.coord[1] - entry.coord[1];
      const distDeg = Math.hypot(dx, dy);
      if (distDeg < 0.03) continue; // too close (~3 km)
      if (distDeg > 0.25) continue; // too far
      const awayFromFire = fireOrigin
        ? Math.hypot(node.coord[0] - fireOrigin[0], node.coord[1] - fireOrigin[1])
        : 0;
      const score = awayFromFire + distDeg * 0.5;
      if (score > bestScore) { bestScore = score; best = node; }
    }
    if (best) return best;
    // Fallback: just pick any distinct node.
    for (const node of nodeList) {
      if (node.key !== entry.key) return node;
    }
    return null;
  }

  _tripStatus(routeIds, routeCongestion, closedRoutes, wasRerouted = false) {
    if (wasRerouted) return 'rerouted';
    for (const id of routeIds) {
      if (closedRoutes.has(id)) return 'rerouted';
    }
    for (const id of routeIds) {
      const c = routeCongestion[id];
      if (c?.status === 'congested' || c?.status === 'closed') return 'slowed';
    }
    return 'normal';
  }

  _addTrip(path, index, status) {
    // Compute cumulative distance to spread timestamps proportionally.
    const distances = [0];
    for (let i = 1; i < path.length; i++) {
      const dx = path[i][0] - path[i - 1][0];
      const dy = path[i][1] - path[i - 1][1];
      distances.push(distances[i - 1] + Math.hypot(dx, dy));
    }
    const totalDist = distances[distances.length - 1];
    if (totalDist < MIN_TRIP_KM / 111) return; // skip near-zero paths

    const tripDuration = Math.max(260, Math.min(LOOP_LENGTH * 0.85, totalDist * 1400));
    const window = Math.max(0, LOOP_LENGTH - tripDuration);
    const offset = window > 0 ? ((index * 97) % AMBIENT_CAR_COUNT) / AMBIENT_CAR_COUNT * window : 0;
    const timestamps = distances.map(d => offset + (d / totalDist) * tripDuration);

    this.trips.push({
      path: path.map(c => [c[0], c[1]]),
      timestamps,
      particle_type: 'vehicle',
      one_way: true,
      status,
    });
  }

  update() {}
  getTrips() { return this.trips; }
  getPositions() { return []; }
}

module.exports = { ParticleEngine };
