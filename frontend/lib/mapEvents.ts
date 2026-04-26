import type { MapEventData } from './types';
import type { MapAction } from '@/hooks/useMapState';

const SIM_HOUR_TO_DISPATCH_MS = 60000;

function isLngLatPath(value: unknown): value is [number, number][] {
  return Array.isArray(value) && value.every(coord =>
    Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === 'number' &&
    typeof coord[1] === 'number'
  );
}

function isLngLat(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number';
}

/**
 * Translates a MapEventData from the server into a dispatch call
 * for the useMapState reducer.
 */
export function dispatchMapEvent(
  event: MapEventData,
  dispatch: (action: MapAction) => void,
): void {
  // Capture recent action if action_id is present
  if (event.action_id) {
    dispatch({
      type: 'ADD_RECENT_ACTION',
      action: {
        id: event.action_id,
        type: event.type,
        payload: event,
        agent: event.source_agent,
        timestamp: Date.now(),
      },
    });
  }

  switch (event.type) {
    case 'update_fire_perimeter':
      dispatch({ type: 'SET_FIRE_PERIMETER', geojson: event.geojson });
      break;
    case 'set_zone_status':
      dispatch({
        type: 'SET_ZONE_STATUS',
        zoneId: event.zone_id,
        status: event.status,
      });
      break;
    case 'close_route':
      dispatch({ type: 'CLOSE_ROUTE', routeId: event.route_id });
      break;
    case 'open_route':
      dispatch({ type: 'OPEN_ROUTE', routeId: event.route_id });
      break;
    case 'update_shelter':
      dispatch({
        type: 'UPDATE_SHELTER',
        shelterId: event.shelter_id,
        occupancy: event.occupancy,
        capacity: event.capacity,
        status: event.status as 'open' | 'full' | 'closed',
      });
      break;
    case 'deploy_resource': {
      if (event.count <= 0) break;
      const durationMs = typeof event.travel_hours === 'number'
        ? Math.max(4000, event.travel_hours * SIM_HOUR_TO_DISPATCH_MS)
        : undefined;
      const groupId = event.resource_group_id ?? event.action_id ?? `${event.from_station_id ?? 'station'}-${event.resource_type}`;
      dispatch({
        type: 'UPSERT_RESOURCE_GROUP',
        group: {
          id: groupId,
          type: event.resource_type,
          count: event.count,
          status: 'dispatching',
          location: event.from_location,
          destination: event.location,
          progress: 0,
        },
      });
      if (Array.isArray(event.from_location) && event.from_location.length === 2) {
        dispatch({
          type: 'ADD_RESOURCE_DISPATCH',
          dispatch: {
            id: `${groupId}-${Date.now()}`,
            groupId,
            type: event.resource_type,
            from: event.from_location,
            to: event.location,
            path: isLngLatPath(event.dispatch_path) ? event.dispatch_path : undefined,
            durationMs,
            startedAt: Date.now(),
          },
        });
      }

      // Auto-deploy only the active resource icon when the travel animation finishes.
      // Suppression work visuals are backend-authoritative and arrive via suppression_zone.
      const deployDelay = durationMs ?? 4000;
      const loc = event.location;
      const resType = event.resource_type;
      const cnt = event.count;
      setTimeout(() => {
        dispatch({ type: 'COMPLETE_RESOURCE_DISPATCH', groupId });
        if (isLngLat(loc)) {
          dispatch({
            type: 'DEPLOY_RESOURCE',
            resourceType: resType,
            location: loc,
            count: cnt,
            groupId,
          });
        }
      }, deployDelay);
      break;
    }
    case 'resource_update': {
      dispatch({
        type: 'UPSERT_RESOURCE_GROUP',
        group: {
          id: event.resource_group_id,
          type: event.resource_type,
          count: event.count,
          status: event.status,
          location: event.location,
          destination: event.destination,
          assignment_id: event.assignment_id,
          assignment_type: event.assignment_type,
          progress: event.progress,
        },
      });
      if ((event.status === 'staged' || event.status === 'working') && isLngLat(event.location)) {
        dispatch({ type: 'COMPLETE_RESOURCE_DISPATCH', groupId: event.resource_group_id });
        dispatch({
          type: 'DEPLOY_RESOURCE',
          resourceType: event.resource_type,
          location: event.location,
          count: event.count,
          groupId: event.resource_group_id,
        });
      }
      if (event.status === 'released' || event.status === 'failed') {
        dispatch({ type: 'REMOVE_RESOURCE', groupId: event.resource_group_id });
      }
      break;
    }
    case 'suppression_zone':
      dispatch({
        type: 'ADD_SUPPRESSION_ZONE',
        zone: {
          id: event.action_id ?? event.source_resource_event_id ?? `suppression-${Date.now()}`,
          geojson: event.geojson,
          visual_geojson: event.visual_geojson,
          effectiveness: event.effectiveness,
          resource_type: event.resource_type,
          progress: event.progress,
          line_progress: event.line_progress,
          effect_type: event.effect_type,
        },
      });
      break;
    case 'remove_suppression_zone':
      dispatch({ type: 'REMOVE_SUPPRESSION_ZONE', zoneId: event.suppression_zone_id });
      break;
    case 'fire_behavior':
      dispatch({
        type: 'SET_FIRE_BEHAVIOR',
        behavior: {
          origin: event.origin,
          head: event.head,
          bearing: event.bearing,
          wind_u: event.wind_u,
          wind_v: event.wind_v,
          spread_rate_acres_hr: event.spread_rate_acres_hr,
          spot_fire_count: event.spot_fire_count,
          elapsed_hours: event.elapsed_hours,
        },
      });
      break;
    case 'infrastructure_status':
      dispatch({
        type: 'SET_INFRASTRUCTURE',
        facilityId: event.facility_id,
        name: event.name,
        status: event.status,
      });
      break;
    case 'set_evacuation_flow':
      dispatch({
        type: 'SET_EVACUATION_FLOW',
        fromZone: event.from_zone,
        toShelter: event.to_shelter,
        population: event.population,
      });
      break;
    case 'traffic_jam':
      dispatch({ type: 'SET_TRAFFIC_JAM', routeId: event.route_id, severity: event.severity });
      break;
    case 'fire_update':
      dispatch({ type: 'SET_FIRE_PERIMETER', geojson: event.geojson });
      break;
    case 'traffic_congestion':
      dispatch({ type: 'SET_ROUTE_CONGESTION', congestion: event.routes });
      break;
    case 'threat_zone':
      dispatch({ type: 'SET_THREAT_ZONE', zoneId: event.zone_id, level: event.level });
      break;
    case 'broadcast_alert':
      dispatch({ type: 'ADD_ALERT', zone_ids: event.zone_ids, message: event.message, channel: event.channel });
      break;
    default:
      break;
  }
}
