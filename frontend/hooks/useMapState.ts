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
  visual_geojson?: GeoJSON.Geometry | GeoJSON.FeatureCollection | GeoJSON.Feature;
  effectiveness: number;
  resource_type: string;
  progress?: number;
  line_progress?: number;
  effect_type?: string;
  arrivedAt?: number;
}

export interface FireBehaviorState {
  origin: [number, number] | null;
  head: [number, number] | null;
  bearing: number;
  wind_u: number;
  wind_v: number;
  spread_rate_acres_hr: number;
  spot_fire_count?: number;
  elapsed_hours?: number;
}

export interface ResourceGroupState {
  id: string;
  type: string;
  count: number;
  status: string;
  location?: [number, number] | null;
  destination?: [number, number] | null;
  assignment_id?: string | null;
  assignment_type?: string;
  progress?: number;
}

export interface MapState {
  // Dynamic agent-driven state
  firePerimeter: GeoJSON.FeatureCollection | null;
  zones: Record<string, ZoneStatus>;
  closedRoutes: Set<string>;
  shelters: Record<string, ShelterState>;
  resources: Array<{ id?: string; type: string; location: [number, number]; count: number }>;
  resourceGroups: Record<string, ResourceGroupState>;
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
    groupId?: string;
    type: string;
    from: [number, number];
    to: [number, number];
    path?: [number, number][];
    durationMs?: number;
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
  | { type: 'DEPLOY_RESOURCE'; resourceType: string; location: [number, number]; count: number; groupId?: string }
  | { type: 'UPSERT_RESOURCE_GROUP'; group: ResourceGroupState }
  | { type: 'REMOVE_RESOURCE'; groupId: string }
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
  | { type: 'ADD_RESOURCE_DISPATCH'; dispatch: { id: string; groupId?: string; type: string; from: [number, number]; to: [number, number]; path?: [number, number][]; durationMs?: number; startedAt: number } }
  | { type: 'COMPLETE_RESOURCE_DISPATCH'; groupId: string }
  | { type: 'PRUNE_RESOURCE_DISPATCHES'; olderThan: number }
  | { type: 'ADD_RECENT_ACTION'; action: MapActionPulse }
  | { type: 'EXPIRE_RECENT_ACTIONS'; olderThan: number }
  | { type: 'ADD_SUPPRESSION_ZONE'; zone: SuppressionZone }
  | { type: 'REMOVE_SUPPRESSION_ZONE'; zoneId: string }
  | { type: 'SET_FIRE_BEHAVIOR'; behavior: FireBehaviorState }
  | { type: 'RESET' };

const initialState: MapState = {
  firePerimeter: null,
  zones: {},
  closedRoutes: new Set<string>(),
  shelters: {},
  resources: [],
  resourceGroups: {},
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
      const incoming = { id: action.groupId, type: action.resourceType, location: action.location, count: action.count };
      const isDozer = incoming.type.toLowerCase().includes('dozer');
      const mergeDistanceKm = isDozer ? 0.03 : 0.04;
      const maxVisibleByType = isDozer ? 18 : 36;
      const distanceKm = (a: [number, number], b: [number, number]) => {
        const latKm = (b[1] - a[1]) * 111.32;
        const lngKm = (b[0] - a[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
        return Math.sqrt(latKm * latKm + lngKm * lngKm);
      };
      const idx = incoming.id
        ? state.resources.findIndex(r => r.id === incoming.id)
        : state.resources.findIndex(r =>
          r.type === incoming.type && distanceKm(r.location, incoming.location) <= mergeDistanceKm
        );
      const merged = state.resources.slice();
      if (idx >= 0) merged[idx] = incoming;
      else merged.push(incoming);

      const sameType = merged.filter(r => r.type === incoming.type);
      let overflow = Math.max(0, sameType.length - maxVisibleByType);
      const next = merged.filter((r) => {
        if (r.type !== incoming.type || overflow <= 0) return true;
        overflow -= 1;
        return false;
      });
      return { ...state, resources: next };
    }

    case 'UPSERT_RESOURCE_GROUP':
      return {
        ...state,
        resourceGroups: {
          ...state.resourceGroups,
          [action.group.id]: action.group,
        },
      };

    case 'REMOVE_RESOURCE':
      return {
        ...state,
        resources: state.resources.filter(r => r.id !== action.groupId),
        resourceDispatches: state.resourceDispatches.filter(d => d.groupId !== action.groupId),
        resourceGroups: Object.fromEntries(
          Object.entries(state.resourceGroups).filter(([id]) => id !== action.groupId),
        ),
      };

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

    case 'ADD_RESOURCE_DISPATCH': {
      const now = Date.now();
      // Prune entries that have been completed for more than 5 seconds to prevent unbounded growth
      const maxAge = 5000;
      const active = state.resourceDispatches.filter(d => {
        const duration = d.durationMs ?? 24000;
        return (now - d.startedAt) < duration + maxAge;
      });
      return { ...state, resourceDispatches: [...active, action.dispatch] };
    }

    case 'PRUNE_RESOURCE_DISPATCHES': {
      const keep = state.resourceDispatches.filter(d => d.startedAt >= action.olderThan);
      if (keep.length === state.resourceDispatches.length) return state;
      return { ...state, resourceDispatches: keep };
    }

    case 'COMPLETE_RESOURCE_DISPATCH': {
      const keep = state.resourceDispatches.filter(d => d.groupId !== action.groupId);
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
          [action.zone.id]: { ...action.zone, arrivedAt: Date.now() },
        }
      };

    case 'REMOVE_SUPPRESSION_ZONE': {
      if (!state.suppressionZones[action.zoneId]) return state;
      const next = { ...state.suppressionZones };
      delete next[action.zoneId];
      return { ...state, suppressionZones: next };
    }

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
        resourceGroups: {},
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
