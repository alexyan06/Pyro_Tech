/** Structured scenario input — the only accepted form for starting a simulation. */
export interface ScenarioInput {
  /** Human-readable place name (e.g. "Pacific Palisades, Los Angeles") */
  location: string;
  /** Geographic bounding box [west, south, east, north] in decimal degrees */
  bbox: [number, number, number, number];
  /** ISO-8601 simulation start timestamp (e.g. "2025-01-07T10:00:00Z") */
  timestamp: string;
  /** Lat/lng of the initial fire ignition point */
  fireOrigin: { lat: number; lng: number };
  /** Observed or forecast weather metrics at simulation start */
  metrics: {
    /** Wind speed in mph */
    wind: number;
    /** Wind direction in degrees, 0=N, 90=E */
    windDirection?: number;
    /** Temperature in °F */
    temp: number;
    /** Relative humidity 0–100 */
    humidity: number;
  };
  /** Initial fire size in acres */
  initialAcres?: number;
  /** If true, use CAL FIRE historical perimeter data instead of simulated spread */
  historical_mode?: boolean;
  /** Simulated incident duration in hours. Defaults to 6 for legacy scenarios. */
  durationHours?: number;
}

// Trip waypoint for Deck.gl TripsLayer animation
export interface TripWaypoint {
  path: [number, number][];
  timestamps: number[];
  population?: number;
  from_zone?: string;
  to_shelter?: string;
  particle_type?: 'vehicle' | 'pedestrian';
  one_way?: boolean;
  /** 'normal' = flowing, 'slowed' = on congested route, 'rerouted' = path avoids a closed road */
  status?: 'normal' | 'slowed' | 'rerouted';
}

export interface AgentMessage {
  type: 'agent_text';
  payload: {
    agent: AgentName;
    text: string;
    is_complete: boolean;
  };
}

export interface MapEvent {
  type: 'map_event';
  payload: {
    agent: AgentName;
    event: MapEventData;
    tick: number;
    sim_time?: string;
  };
}

export interface StateSnapshot {
  type: 'state_snapshot';
  payload: {
    tick: number;
    sim_time: string;
    elapsed_hours?: number | null;
    fire: {
      perimeter_geojson: GeoJSON.FeatureCollection | null;
      acres_burned: number;
      spread_rate_acres_hr: number;
    };
    evacuation: {
      zones: Record<string, ZoneStatus>;
      total_evacuees: number;
      ordered_to_evacuate?: number;
      departed_evacuees?: number;
      in_transit_evacuees?: number;
      sheltered_evacuees?: number;
      routes_closed: number;
      total_population_at_risk?: number;
      congested_routes?: number;
    };
    resources: {
      engines_deployed: number;
      crews_deployed: number;
      air_tankers_active: number;
      shelters: Record<string, ShelterState>;
    };
    infrastructure: {
      facilities_offline: number;
      power_shutoff_areas: number;
    };
  };
}

export interface PlaybookReady {
  type: 'playbook_ready';
  payload: {
    simulation_id: string;
    playbook_json: PlaybookData;
  };
}

export interface AgentAudioMessage {
  type: 'agent_audio';
  payload: {
    agent: AgentName;
    audio_base64: string;
    tick: number;
  };
}

export interface BranchStartMessage {
  type: 'branch_start';
  payload: { branch_id: string; modifier: string; base_tick: number };
}

export interface BranchAgentTextMessage {
  type: 'branch_agent_text';
  payload: {
    branch_id: string;
    agent: AgentName;
    text: string;
    is_complete: boolean;
    tick: number;
  };
}

export interface BranchMapEventMessage {
  type: 'branch_map_event';
  payload: { branch_id: string; agent: AgentName; event: MapEventData; tick: number };
}

export interface BranchCompleteMessage {
  type: 'branch_complete';
  payload: { branch_id: string };
}

export interface TimeUpdateMessage {
  type: 'time_update';
  payload: { sim_time: string; elapsed_hours: number; duration_hours?: number };
}

export interface ParticleUpdateMessage {
  type: 'particle_update';
  payload: { particles: [number, number][]; trips?: TripWaypoint[] };
}

export type ServerMessage =
  | AgentMessage
  | MapEvent
  | StateSnapshot
  | PlaybookReady
  | AgentAudioMessage
  | BranchStartMessage
  | BranchAgentTextMessage
  | BranchMapEventMessage
  | BranchCompleteMessage
  | TimeUpdateMessage
  | ParticleUpdateMessage
  | { type: 'error'; payload: { message: string } };

export type AgentName =
  | 'disaster'
  | 'evacuation'
  | 'resource'
  | 'infrastructure'
  | 'communications'
  | 'synthesis'
  | 'traffic';

export type ZoneStatus = 'mandatory' | 'warning' | 'voluntary' | 'clear';

export interface ShelterState {
  occupancy: number;
  capacity: number;
  status: 'open' | 'full' | 'closed';
}

export type MapEventData =
  | { type: 'update_fire_perimeter'; geojson: GeoJSON.FeatureCollection; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | { type: 'fire_update'; geojson: GeoJSON.FeatureCollection; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | { type: 'fire_spread_vector'; bearing: number; rate_mph: number; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | {
      type: 'traffic_congestion';
      routes: Array<{
        route_id: string;
        status: 'open' | 'congested' | 'closed';
        load_pct: number;
        reason?: string;
        capacity_multiplier?: number;
      }>;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'threat_zone';
      zone_id: string;
      level: 'extreme' | 'high' | 'moderate';
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | { type: 'set_zone_status'; zone_id: string; status: ZoneStatus; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | { type: 'close_route'; route_id: string; reason?: string; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | { type: 'traffic_jam'; route_id: string; severity: 'extreme' | 'high' | 'moderate'; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | { type: 'open_route'; route_id: string; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | {
      type: 'set_evacuation_flow';
      from_zone: string;
      to_shelter: string;
      population: number;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'deploy_resource';
      resource_type: string;
      location: [number, number];
      count: number;
      from_station_id?: string;
      from_location?: [number, number];
      dispatch_path?: [number, number][];
      travel_hours?: number;
      arrival_elapsed_hours?: number;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'update_shelter';
      shelter_id: string;
      occupancy: number;
      capacity: number;
      status: string;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'infrastructure_status';
      facility_id: string;
      name: string;
      status: string;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'power_shutoff';
      area_id: string;
      affected_customers: number;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'broadcast_alert';
      zone_ids: string[];
      message: string;
      channel: string;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | { type: 'playbook_section'; title: string; content: string; action_id?: string; ui_message?: string; source_agent?: AgentName }
  | {
      type: 'tick_summary';
      tick: number;
      acres_burned: number;
      evacuees: number;
      sheltered: number;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'suppression_zone';
      resource_type: string;
      geojson: GeoJSON.Polygon | GeoJSON.MultiPolygon | GeoJSON.FeatureCollection | GeoJSON.Feature;
      visual_geojson?: GeoJSON.Geometry | GeoJSON.FeatureCollection | GeoJSON.Feature;
      effectiveness: number;
      source_resource_event_id?: string;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    }
  | {
      type: 'fire_behavior';
      origin: [number, number] | null;
      head: [number, number] | null;
      bearing: number;
      wind_speed: number;
      spread_rate_acres_hr: number;
      spot_fire_count?: number;
      elapsed_hours?: number;
      action_id?: string; ui_message?: string; source_agent?: AgentName;
    };

export interface PlaybookSection {
  title: string;
  content: string;
  agent: string;
  tick?: number;
  elapsed_hours?: number;
  time_elapsed?: string;
}

export interface PlaybookData {
  title: string;
  scenario: string;
  sections: PlaybookSection[];
  summary: string;
  generated_at: string;
  duration_hours?: number;
}

export const AGENT_CONFIG: Record<
  AgentName,
  { label: string; emoji: string; color: string }
> = {
  disaster: { label: 'Fire Behavior', emoji: '\u{1F534}', color: '#ff4444' },
  evacuation: {
    label: 'Evacuation',
    emoji: '\u{1F535}',
    color: '#4488ff',
  },
  resource: { label: 'Resources', emoji: '\u{1F7E2}', color: '#44cc66' },
  infrastructure: {
    label: 'Lifelines',
    emoji: '\u{1F7E1}',
    color: '#ffcc00',
  },
  communications: {
    label: 'Public Alerts',
    emoji: '\u{1F4E2}',
    color: '#ff8844',
  },
  synthesis: {
    label: 'Incident Command',
    emoji: '\u{1F7E3}',
    color: '#aa66ff',
  },
  traffic: {
    label: 'Traffic',
    emoji: '\u{1F6A6}',
    color: '#f97316',
  },
};
