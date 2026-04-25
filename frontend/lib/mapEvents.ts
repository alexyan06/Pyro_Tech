import type { MapEventData } from './types';
import type { MapAction } from '@/hooks/useMapState';

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
    case 'deploy_resource':
      dispatch({
        type: 'DEPLOY_RESOURCE',
        resourceType: event.resource_type,
        location: event.location,
        count: event.count,
      });
      if (Array.isArray(event.from_location) && event.from_location.length === 2) {
        dispatch({
          type: 'ADD_RESOURCE_DISPATCH',
          dispatch: {
            id: `${event.from_station_id ?? 'station'}-${event.resource_type}-${Date.now()}`,
            type: event.resource_type,
            from: event.from_location,
            to: event.location,
            startedAt: Date.now(),
          },
        });
      }
      break;
    case 'suppression_zone':
      dispatch({
        type: 'ADD_SUPPRESSION_ZONE',
        zone: {
          id: event.action_id ?? event.source_resource_event_id ?? `suppression-${Date.now()}`,
          geojson: event.geojson,
          effectiveness: event.effectiveness,
          resource_type: event.resource_type,
        },
      });
      break;
    case 'fire_behavior':
      dispatch({
        type: 'SET_FIRE_BEHAVIOR',
        behavior: {
          origin: event.origin,
          head: event.head,
          bearing: event.bearing,
          wind_speed: event.wind_speed,
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
