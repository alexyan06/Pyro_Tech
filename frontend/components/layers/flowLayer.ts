import { ArcLayer } from '@deck.gl/layers';
import { TripsLayer } from '@deck.gl/geo-layers';
import type { TripWaypoint } from '@/lib/types';

export interface EvacuationFlowArc {
  zone_id: string;
  shelter_id: string;
  population: number;
  source_lng: number;
  source_lat: number;
  target_lng: number;
  target_lat: number;
}

export function createFlowLayer(
  flows: EvacuationFlowArc[],
): ArcLayer<EvacuationFlowArc> {
  return new ArcLayer<EvacuationFlowArc>({
    id: 'evacuation-flows',
    data: flows,
    getSourcePosition: (d) => [d.source_lng, d.source_lat],
    getTargetPosition: (d) => [d.target_lng, d.target_lat],
    getSourceColor: [245, 158, 11, 160],
    getTargetColor: [34, 197, 94, 160],
    getWidth: (d) => Math.max(1, Math.sqrt(d.population / 500)),
    widthUnits: 'pixels',
    widthMinPixels: 1,
    widthMaxPixels: 8,
    greatCircle: false,
    numSegments: 64,
    pickable: true,
    autoHighlight: true,
    transitions: {
      getWidth: 800,
    },
    updateTriggers: {
      getWidth: flows.map(d => d.population),
    },
  });
}

type RGBA = [number, number, number, number];
const STATUS_TRAIL_COLOR: Record<NonNullable<TripWaypoint['status']>, RGBA> = {
  normal:   [96, 250, 180, 255],  // bright green — free flow
  slowed:   [250, 204,  21, 255], // bright yellow — congested
  rerouted: [249, 115,  22, 255], // bright orange — detouring around closure
};

export function createTripsLayer(
  waypoints: TripWaypoint[],
  currentTime: number,
  trailLength = 280,
): TripsLayer<TripWaypoint> {
  return new TripsLayer<TripWaypoint>({
    id: 'evacuation-trips',
    data: waypoints,
    getPath: (d) => d.path as [number, number][],
    getTimestamps: (d) => d.timestamps,
    getColor: (d) => {
      if (d.particle_type === 'pedestrian') return [180, 220, 255, 200];
      return STATUS_TRAIL_COLOR[d.status ?? 'normal'];
    },
    widthMinPixels: 4,
    widthMaxPixels: 10,
    currentTime,
    trailLength,
    capRounded: true,
    jointRounded: true,
    updateTriggers: {
      currentTime,
      getColor: waypoints.map(w => w.status ?? 'normal').join(','),
    },
  });
}
