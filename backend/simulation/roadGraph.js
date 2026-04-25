const turf = require('@turf/turf');

function nodeKey(coord) {
  return `${coord[0].toFixed(3)},${coord[1].toFixed(3)}`;
}

function buildRoadGraph(baseRoutes = {}) {
  const nodes = new Map();
  const adjacency = new Map();

  function ensureNode(coord) {
    const key = nodeKey(coord);
    if (!nodes.has(key)) nodes.set(key, { key, coord: [coord[0], coord[1]] });
    if (!adjacency.has(key)) adjacency.set(key, []);
    return key;
  }

  for (const route of Object.values(baseRoutes || {})) {
    const coords = route.geometry?.coordinates || [];
    if (coords.length < 2) continue;

    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const aKey = ensureNode(a);
      const bKey = ensureNode(b);
      if (aKey === bKey) continue;
      const distanceKm = turf.distance(turf.point(a), turf.point(b), { units: 'kilometers' });
      const edge = {
        to: bKey,
        route_id: route.route_id,
        distance_km: distanceKm,
        capacity_vph: Number(route.capacity_vph) || 1200,
        coords: [a, b],
      };
      const reverse = {
        to: aKey,
        route_id: route.route_id,
        distance_km: distanceKm,
        capacity_vph: Number(route.capacity_vph) || 1200,
        coords: [b, a],
      };
      adjacency.get(aKey).push(edge);
      adjacency.get(bKey).push(reverse);
    }
  }

  const totalBeforePrune = nodes.size;
  pruneToLargestComponent(nodes, adjacency);
  const health = {
    node_count: nodes.size,
    edge_count: Array.from(adjacency.values()).reduce((sum, edges) => sum + edges.length, 0) / 2,
    nodes_dropped: totalBeforePrune - nodes.size,
  };

  return { nodes, adjacency, health };
}

/**
 * Find the largest connected component via BFS and drop everything else.
 * Zones/shelters will snap to the main highway network; disconnected
 * side-spurs are removed so pathfinding never routes into a dead-end island.
 */
function pruneToLargestComponent(nodes, adjacency) {
  if (nodes.size === 0) return;
  const visited = new Set();
  let largest = [];
  for (const startKey of nodes.keys()) {
    if (visited.has(startKey)) continue;
    const component = [];
    const queue = [startKey];
    visited.add(startKey);
    while (queue.length > 0) {
      const key = queue.shift();
      component.push(key);
      for (const edge of adjacency.get(key) || []) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  const keep = new Set(largest);
  for (const key of Array.from(nodes.keys())) {
    if (!keep.has(key)) {
      nodes.delete(key);
      adjacency.delete(key);
    }
  }
}

function nearestGraphNode(graph, coord, excludeKeys = null) {
  let best = null;
  for (const node of graph.nodes.values()) {
    if (excludeKeys && excludeKeys.has(node.key)) continue;
    const distanceKm = turf.distance(turf.point(coord), turf.point(node.coord), { units: 'kilometers' });
    if (!best || distanceKm < best.distance_km) {
      best = { key: node.key, coord: node.coord, distance_km: distanceKm };
    }
  }
  return best;
}

function shortestPath(graph, startCoord, endCoord, opts = {}) {
  if (!graph?.nodes?.size) return null;

  const start = nearestGraphNode(graph, startCoord);
  let end = nearestGraphNode(graph, endCoord);
  if (!start || !end) return null;
  // If zone and shelter snap to the same highway node (common when the
  // highway network is sparse), force the shelter end onto a different node so
  // we always traverse at least one edge and produce a visible trail.
  if (start.key === end.key) {
    const alt = nearestGraphNode(graph, endCoord, new Set([start.key]));
    if (alt) end = alt;
  }

  const closedRoutes = opts.closedRoutes || new Set();
  const routeCongestion = opts.routeCongestion || {};

  const dist = new Map();
  const prev = new Map();
  const visited = new Set();
  const queue = [{ key: start.key, cost: 0 }];
  dist.set(start.key, 0);

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current || visited.has(current.key)) continue;
    visited.add(current.key);
    if (current.key === end.key) break;

    for (const edge of graph.adjacency.get(current.key) || []) {
      if (closedRoutes.has(edge.route_id)) continue;
      const congestion = routeCongestion[edge.route_id];
      const penalty =
        congestion?.status === 'closed' ? 10 :
        congestion?.status === 'congested' ? 2.5 :
        1;
      const nextCost = (dist.get(current.key) || 0) + edge.distance_km * penalty;
      if (nextCost < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nextCost);
        prev.set(edge.to, { from: current.key, edge });
        queue.push({ key: edge.to, cost: nextCost });
      }
    }
  }

  if (!prev.has(end.key) && start.key !== end.key) return null;

  const pathNodes = [end.key];
  const edges = [];
  let cursor = end.key;
  while (cursor !== start.key) {
    const step = prev.get(cursor);
    if (!step) break;
    edges.push(step.edge);
    pathNodes.push(step.from);
    cursor = step.from;
  }
  pathNodes.reverse();
  edges.reverse();

  // Path lives strictly on the road network — no off-road straights from the
  // zone centroid / shelter point into the nearest node.
  const coords = [start.coord];
  const routeCounts = new Map();
  let distanceKm = 0;

  for (const edge of edges) {
    const [, dest] = edge.coords;
    coords.push(dest);
    distanceKm += edge.distance_km;
    routeCounts.set(edge.route_id, (routeCounts.get(edge.route_id) || 0) + edge.distance_km);
  }

  let primaryRouteId = null;
  let dominantDistance = -1;
  for (const [routeId, routeDistance] of routeCounts.entries()) {
    if (routeDistance > dominantDistance) {
      primaryRouteId = routeId;
      dominantDistance = routeDistance;
    }
  }

  return {
    path: dedupe(coords),
    distance_km: distanceKm,
    route_id: primaryRouteId,
    route_ids: Array.from(routeCounts.keys()),
    snap_start_km: start.distance_km,
    snap_end_km: end.distance_km,
  };
}

function dedupe(coords) {
  const deduped = [];
  for (const coord of coords) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== coord[0] || prev[1] !== coord[1]) {
      deduped.push(coord);
    }
  }
  return deduped;
}

module.exports = {
  buildRoadGraph,
  nearestGraphNode,
  shortestPath,
};
