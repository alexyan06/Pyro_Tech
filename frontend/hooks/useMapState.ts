'use client';

import { useReducer, useCallback } from 'react';
import type { ZoneStatus, ShelterState, TripWaypoint, AgentName, MapEventData } from '@/lib/types';
import type { RouteFeature } from '@/components/layers/routeLayer';
import type { ShelterBase } from '@/components/layers/shelterLayer';
import type { InfraBase } from '@/components/layers/infrastructureLayer';
import type { PopulationTract } from '@/components/layers/populationLayer';
import type { FIRMSPoint } from '@/components/layers/firmsLayer';

export interface ZonePolygon {
  zone_id: string;
  name: string;
  population: number;
  centroid_lng: number;
  centroid_lat: number;
  geometry: GeoJSON.Polygon;
}

export interface MapActionPulse {
  id: string;
  type: string;
  payload: MapEventData;
  agent?: AgentName;
  timestamp: number;
}

export interface SuppressionZone {
  id: string;
  geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.FeatureCollection | GeoJSON.Feature;
  effectiveness: number;
  resource_type: string;
}

export interface FireBehaviorState {
  origin: [number, number] | null;
  head: [number, number] | null;
  bearing: number;
  wind_speed: number;
  spread_rate_acres_hr: number;
  spot_fire_count?: number;
  elapsed_hours?: number;
}

export interface MapState {
  // Dynamic agent-driven state
  firePerimeter: GeoJSON.FeatureCollection | null;
  zones: Record<string, ZoneStatus>;
  closedRoutes: Set<string>;
  shelters: Record<string, ShelterState>;
  resources: Array<{ type: string; location: [number, number]; count: number }>;
  infrastructure: Record<string, { name: string; status: string }>;
  evacuationFlows: Array<{ from: string; to: string; population: number }>;
  tripWaypoints: TripWaypoint[];
  routeCongestion: Record<string, { status: 'open' | 'congested' | 'closed'; load_pct: number; reason?: string; capacity_multiplier?: number }>;
  trafficJams: Record<string, 'extreme' | 'high' | 'moderate'>;
  threatZones: Record<string, 'extreme' | 'high' | 'moderate'>;
  alerts: Array<{ zone_ids: string[]; message: string; channel: string }>;
  particles: Array<[number, number]>;
  resourceDispatches: Array<{
    id: string;
    type: string;
    from: [number, number];
    to: [number, number];
    startedAt: number;
  }>;
  recentActions: MapActionPulse[];
  suppressionZones: Record<string, SuppressionZone>;
  fireBehavior: FireBehaviorState | null;

  // Static base data (seeded from GeoJSON on mount)
  routeFeatures: Record<string, RouteFeature>;
  shelterBaseData: Record<string, ShelterBase>;
  infraBaseData: Record<string, InfraBase>;
  populationTracts: PopulationTract[];
  zonePolygons: Record<string, ZonePolygon>;
  populationVisible: boolean;
  firmsData: FIRMSPoint[];
  firmsVisible: boolean;
}

export type MapAction =
  | { type: 'SET_FIRE_PERIMETER'; geojson: GeoJSON.FeatureCollection }
  | { type: 'SET_ZONE_STATUS'; zoneId: string; status: ZoneStatus }
  | { type: 'CLOSE_ROUTE'; routeId: string }
  | { type: 'OPEN_ROUTE'; routeId: string }
  | { type: 'UPDATE_SHELTER'; shelterId: string; occupancy: number; capacity: number; status: 'open' | 'full' | 'closed' }
  | { type: 'DEPLOY_RESOURCE'; resourceType: string; location: [number, number]; count: number }
  | { type: 'SET_INFRASTRUCTURE'; facilityId: string; name: string; status: string }
  | { type: 'SET_EVACUATION_FLOW'; fromZone: string; toShelter: string; population: number }
  | { type: 'SET_TRIP_WAYPOINTS'; waypoints: TripWaypoint[] }
  | { type: 'SEED_BASE_DATA'; routes: Record<string, RouteFeature>; shelters: Record<string, ShelterBase>; infra: Record<string, InfraBase>; population: PopulationTract[]; zones: Record<string, ZonePolygon> }
  | { type: 'TOGGLE_POPULATION' }
  | { type: 'SET_FIRMS_DATA'; points: FIRMSPoint[] }
  | { type: 'TOGGLE_FIRMS' }
  | { type: 'SET_ROUTE_CONGESTION'; congestion: Array<{ route_id: string; status: 'open' | 'congested' | 'closed'; load_pct: number; reason?: string; capacity_multiplier?: number }> }
  | { type: 'SET_TRAFFIC_JAM'; routeId: string; severity: 'extreme' | 'high' | 'moderate' }
  | { type: 'SET_THREAT_ZONE'; zoneId: string; level: 'extreme' | 'high' | 'moderate' }
  | { type: 'ADD_ALERT'; zone_ids: string[]; message: string; channel: string }
  | { type: 'SET_PARTICLES'; particles: Array<[number, number]> }
  | { type: 'ADD_RESOURCE_DISPATCH'; dispatch: { id: string; type: string; from: [number, number]; to: [number, number]; startedAt: number } }
  | { type: 'PRUNE_RESOURCE_DISPATCHES'; olderThan: number }
  | { type: 'ADD_RECENT_ACTION'; action: MapActionPulse }
  | { type: 'EXPIRE_RECENT_ACTIONS'; olderThan: number }
  | { type: 'ADD_SUPPRESSION_ZONE'; zone: SuppressionZone }
  | { type: 'SET_FIRE_BEHAVIOR'; behavior: FireBehaviorState }
  | { type: 'RESET' };

const initialState: MapState = {
  firePerimeter: null,
  zones: {},
  closedRoutes: new Set<string>(),
  shelters: {},
  resources: [],
  infrastructure: {},
  evacuationFlows: [],
  tripWaypoints: [],
  routeCongestion: {},
  trafficJams: {},
  threatZones: {},
  alerts: [],
  particles: [],
  resourceDispatches: [],
  recentActions: [],
  suppressionZones: {},
  fireBehavior: null,
  routeFeatures: {},
  shelterBaseData: {},
  infraBaseData: {},
  populationTracts: [],
  zonePolygons: {},
  populationVisible: true,
  firmsData: [],
  firmsVisible: true,
};

function mapReducer(state: MapState, action: MapAction): MapState {
  switch (action.type) {
    case 'SET_FIRE_PERIMETER':
      return { ...state, firePerimeter: action.geojson };

    case 'SET_ZONE_STATUS':
      return { ...state, zones: { ...state.zones, [action.zoneId]: action.status } };

    case 'CLOSE_ROUTE': {
      const next = new Set(state.closedRoutes);
      next.add(action.routeId);
      return { ...state, closedRoutes: next };
    }

    case 'OPEN_ROUTE': {
      const next = new Set(state.closedRoutes);
      next.delete(action.routeId);
      return { ...state, closedRoutes: next };
    }

    case 'UPDATE_SHELTER':
      return {
        ...state,
        shelters: {
          ...state.shelters,
          [action.shelterId]: {
            occupancy: action.occupancy,
            capacity: action.capacity,
            status: action.status,
          },
        },
      };

    case 'DEPLOY_RESOURCE': {
      const keyOf = (r: { type: string; location: [number, number] }) =>
        `${r.type}@${r.location[0].toFixed(4)},${r.location[1].toFixed(4)}`;
      const incoming = { type: action.resourceType, location: action.location, count: action.count };
      const idx = state.resources.findIndex(r => keyOf(r) === keyOf(incoming));
      if (idx >= 0) {
        const next = state.resources.slice();
        next[idx] = incoming;
        return { ...state, resources: next };
      }
      return { ...state, resources: [...state.resources, incoming] };
    }

    case 'SET_INFRASTRUCTURE':
      return {
        ...state,
        infrastructure: {
          ...state.infrastructure,
          [action.facilityId]: { name: action.name, status: action.status },
        },
      };

    case 'SET_EVACUATION_FLOW': {
      const incoming = { from: action.fromZone, to: action.toShelter, population: action.population };
      const idx = state.evacuationFlows.findIndex(
        f => f.from === incoming.from && f.to === incoming.to,
      );
      if (idx >= 0) {
        const next = state.evacuationFlows.slice();
        next[idx] = incoming;
        return { ...state, evacuationFlows: next };
      }
      return { ...state, evacuationFlows: [...state.evacuationFlows, incoming] };
    }

    case 'SET_TRIP_WAYPOINTS':
      return { ...state, tripWaypoints: action.waypoints };

    case 'SEED_BASE_DATA':
      return {
        ...state,
        routeFeatures: action.routes,
        shelterBaseData: action.shelters,
        infraBaseData: action.infra,
        populationTracts: action.population,
        zonePolygons: action.zones,
      };

    case 'TOGGLE_POPULATION':
      return { ...state, populationVisible: !state.populationVisible };

    case 'SET_FIRMS_DATA':
      return { ...state, firmsData: action.points };

    case 'TOGGLE_FIRMS':
      return { ...state, firmsVisible: !state.firmsVisible };

    case 'SET_ROUTE_CONGESTION': {
      const next: MapState['routeCongestion'] = {};
      for (const r of action.congestion) {
        next[r.route_id] = {
          status: r.status,
          load_pct: r.load_pct,
          reason: r.reason,
          capacity_multiplier: r.capacity_multiplier,
        };
      }
      return { ...state, routeCongestion: next };
    }

    case 'SET_TRAFFIC_JAM':
      return { ...state, trafficJams: { ...state.trafficJams, [action.routeId]: action.severity } };

    case 'SET_THREAT_ZONE':
      return { ...state, threatZones: { ...state.threatZones, [action.zoneId]: action.level } };

    case 'ADD_ALERT':
      return { ...state, alerts: [...state.alerts, { zone_ids: action.zone_ids, message: action.message, channel: action.channel }] };

    case 'SET_PARTICLES':
      return { ...state, particles: action.particles };

    case 'ADD_RESOURCE_DISPATCH':
      return { ...state, resourceDispatches: [...state.resourceDispatches, action.dispatch] };

    case 'PRUNE_RESOURCE_DISPATCHES': {
      const keep = state.resourceDispatches.filter(d => d.startedAt >= action.olderThan);
      if (keep.length === state.resourceDispatches.length) return state;
      return { ...state, resourceDispatches: keep };
    }

    case 'ADD_RECENT_ACTION':
      return { 
        ...state, 
        recentActions: [...state.recentActions.filter(a => a.id !== action.action.id), action.action] 
      };

    case 'EXPIRE_RECENT_ACTIONS': {
      const keep = state.recentActions.filter(a => a.timestamp >= action.olderThan);
      if (keep.length === state.recentActions.length) return state;
      return { ...state, recentActions: keep };
    }

    case 'ADD_SUPPRESSION_ZONE':
      return {
        ...state,
        suppressionZones: {
          ...state.suppressionZones,
          [action.zone.id]: action.zone,
        }
      };

    case 'SET_FIRE_BEHAVIOR':
      return { ...state, fireBehavior: action.behavior };

    case 'RESET':
      return {
        ...initialState,
        closedRoutes: new Set<string>(),
        routeCongestion: {},
        trafficJams: {},
        threatZones: {},
        alerts: [],
        particles: [],
        resourceDispatches: [],
        recentActions: [],
        suppressionZones: {},
        fireBehavior: null,
        // Preserve base data across resets (don't re-fetch on each sim start)
        routeFeatures: state.routeFeatures,
        shelterBaseData: state.shelterBaseData,
        infraBaseData: state.infraBaseData,
        populationTracts: state.populationTracts,
        populationVisible: state.populationVisible,
        zonePolygons: state.zonePolygons,
        firmsData: state.firmsData,
        firmsVisible: state.firmsVisible,
      };

    default:
      return state;
  }
}

export function useMapState() {
  const [state, rawDispatch] = useReducer(mapReducer, {
    ...initialState,
    closedRoutes: new Set<string>(),
  });

  const dispatch = useCallback((action: MapAction) => rawDispatch(action), []);
  const reset = useCallback(() => rawDispatch({ type: 'RESET' }), []);

  return { mapState: state, dispatch, reset };
}
