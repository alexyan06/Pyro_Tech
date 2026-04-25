import { PathLayer } from '@deck.gl/layers';

export interface RouteFeature {
  route_id: string;
  name: string;
  status: 'open' | 'closed';
  capacity_vph: number;
  direction?: string;
  priority?: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
}

type RGBA = [number, number, number, number];

// Subtler, thinner colors for static roads so moving traffic pops
function congestionColor(load_pct: number): RGBA {
  if (load_pct < 90)  return [60,  70,  85, 180];   // dim gray-blue
  if (load_pct < 110) return [150, 100, 20, 180];   // dim amber
  if (load_pct < 140) return [180,  80, 20, 180];   // dim orange
  if (load_pct < 170) return [200,  50, 50, 200];   // dim red
  return                     [150,  20, 20, 255];   // deep red
}

function congestionWidth(load_pct: number): number {
  if (load_pct < 90)  return 2;
  if (load_pct < 110) return 3;
  if (load_pct < 140) return 4;
  if (load_pct < 170) return 5;
  return 6;
}

const JAMMED_COLOR: RGBA  = [236, 72, 153, 200];
const CLOSED_COLOR: RGBA  = [239, 68,  68, 255]; // unmistakable bright red for closed roads
const OPEN_COLOR:   RGBA  = [60,  70,  85, 120];

export function createRouteLayer(
  routeFeatures: Record<string, RouteFeature>,
  closedRoutes: Set<string>,
  routeCongestion: Record<string, { status: string; load_pct: number }> = {},
  trafficJams: Record<string, 'extreme' | 'high' | 'moderate'> = {},
  routeCongestionVersion = 0,
  trafficJamsVersion = 0,
): PathLayer<RouteFeature> {
  const data = Object.values(routeFeatures).map(r => ({
    ...r,
    status: closedRoutes.has(r.route_id) ? ('closed' as const) : ('open' as const),
  }));

  return new PathLayer<RouteFeature>({
    id: 'evacuation-routes',
    data,
    getPath: (d) => d.geometry.coordinates,
    getColor: (d) => {
      const cong = routeCongestion[d.route_id];
      if (cong?.status === 'closed') return CLOSED_COLOR;
      if (closedRoutes.has(d.route_id)) return CLOSED_COLOR;
      if (trafficJams[d.route_id]) return JAMMED_COLOR;
      if (cong) return congestionColor(cong.load_pct);
      return OPEN_COLOR;
    },
    getWidth: (d) => {
      const cong = routeCongestion[d.route_id];
      if (cong?.status === 'closed') return 5;
      if (closedRoutes.has(d.route_id)) return 5;
      if (trafficJams[d.route_id] === 'extreme') return 7;
      if (trafficJams[d.route_id]) return 5;
      if (cong) return congestionWidth(cong.load_pct);
      return 2;
    },
    widthUnits: 'pixels',
    widthMinPixels: 1,
    widthMaxPixels: 8,
    capRounded: true,
    jointRounded: true,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 100, 255],
    transitions: {
      getColor: 600,
      getWidth: 400,
    },
    updateTriggers: {
      getColor: [Array.from(closedRoutes).sort().join(','), routeCongestionVersion, trafficJamsVersion],
      getWidth: [Array.from(closedRoutes).sort().join(','), routeCongestionVersion, trafficJamsVersion],
    },
  });
}
