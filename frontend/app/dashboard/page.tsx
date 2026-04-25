'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import MapView from '@/components/MapView';
import AgentFeed from '@/components/AgentFeed';
import MetricsBar from '@/components/MetricsBar';
import PlaybookViewer from '@/components/PlaybookViewer';
import ReplayScrubber from '@/components/ReplayScrubber';
import BranchPanel from '@/components/BranchPanel';
import { MapNotifications, type MapNotification } from '@/components/MapNotifications';
import { useSimulation } from '@/hooks/useSimulation';
import { useMapState, type SuppressionZone } from '@/hooks/useMapState';
import { useAgentAudio } from '@/hooks/useAgentAudio';
import { useReplay } from '@/hooks/useReplay';
import { dispatchMapEvent } from '@/lib/mapEvents';
import type { AgentName, ScenarioInput, TripWaypoint, MapEventData } from '@/lib/types';
import type { RouteFeature } from '@/components/layers/routeLayer';
import type { ShelterBase } from '@/components/layers/shelterLayer';
import type { InfraBase } from '@/components/layers/infrastructureLayer';
import type { PopulationTract } from '@/components/layers/populationLayer';

interface StoredScenario {
  scenarioText: string;
  city: string;
  displayName: string;
  centerLat: number;
  centerLng: number;
  fireLat: number;
  fireLng: number;
  initialAcres: number;
  durationHours?: number;
  datetime: string;
  bbox: number[];
  metrics?: { windU: number; windV: number; temp: number; humidity: number };
  historical_mode?: boolean;
}

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:4000';
const API_BASE = WS_BASE.replace(/^ws/, 'http');

interface GeoJSONFeature {
  type: string;
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: number[] | number[][] | number[][][];
  };
}

interface GeoJSONCollection {
  type: string;
  features: GeoJSONFeature[];
}

async function fetchGeoJSON(filename: string, bust?: string): Promise<GeoJSONCollection> {
  const url = bust
    ? `${API_BASE}/api/geojson/${filename}?v=${encodeURIComponent(bust)}`
    : `${API_BASE}/api/geojson/${filename}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch ${filename}: ${res.status}`);
  return res.json() as Promise<GeoJSONCollection>;
}

const EMPTY_GEOJSON: GeoJSONCollection = { type: 'FeatureCollection', features: [] };

function SimControl({ label, onClick, danger, purple }: { label: string; onClick: () => void; danger?: boolean; purple?: boolean }) {
  const color = danger ? 'var(--accent-red)' : purple ? 'var(--accent-purple)' : 'var(--text-secondary)';
  return (
    <button
      onClick={onClick}
      style={{
        height: '30px',
        border: `1px solid var(--border)`,
        borderRadius: '2px',
        padding: '0 14px',
        background: 'transparent',
        color,
        fontFamily: 'var(--font-condensed)',
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-raised)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </button>
  );
}

export default function Home() {
  const router = useRouter();
  const { mapState, dispatch, reset } = useMapState();
  const [showPlaybook, setShowPlaybook] = useState(false);
  const { enqueue: enqueueAudio, isMuted, toggleMute } = useAgentAudio();
  const [storedScenario, setStoredScenario] = useState<StoredScenario | null>(null);
  const [notifications, setNotifications] = useState<MapNotification[]>([]);
  const [mapWidth, setMapWidth] = useState(60);
  const isDraggingRef = useRef(false);
  const mainContentRef = useRef<HTMLDivElement>(null);

  const recentNotificationsRef = useRef<Map<string, number>>(new Map());

  const addNotification = useCallback((message: string, agent?: AgentName) => {
    const now = Date.now();
    const key = `${agent ?? 'system'}:${message}`;
    const lastSeen = recentNotificationsRef.current.get(key) ?? 0;
    if (now - lastSeen < 5000) return;
    recentNotificationsRef.current.set(key, now);

    const id = `${now}-${Math.random().toString(36).substring(2, 9)}`;
    setNotifications(prev => {
      return [...prev.slice(-4), { id, message, agent }];
    });
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 4000);
  }, []);

  const handleAudio = useCallback((agent: AgentName, audioBase64: string) => {
    enqueueAudio(agent, audioBase64);
  }, [enqueueAudio]);

  // Seed GeoJSON base data from the backend (serves OSM scenario data when available)
  const seedBaseData = useCallback(async (bust?: string) => {
    try {
      let sheltersGeo: GeoJSONCollection = EMPTY_GEOJSON;
      let hospitalsGeo: GeoJSONCollection = EMPTY_GEOJSON;
      let stationsGeo: GeoJSONCollection = EMPTY_GEOJSON;
      let popGeo: GeoJSONCollection = EMPTY_GEOJSON;
      let routesGeo: GeoJSONCollection = EMPTY_GEOJSON;
      let zonesGeo: GeoJSONCollection = EMPTY_GEOJSON;

      // 1. Try to load from pre-fetched promise in window
      const bundlePromise = (window as unknown as Record<string, Promise<unknown>>).__EMBER_GEOJSON_PROMISE__;
      if (bundlePromise) {
        try {
          const bundle = await bundlePromise as Record<string, unknown>;
          if (bundle) {
            sheltersGeo = (bundle.shelters as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            hospitalsGeo = (bundle.hospitals as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            stationsGeo = (bundle.fire_stations as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            popGeo = (bundle.population_tracts as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            routesGeo = (bundle.evacuation_routes as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            zonesGeo = (bundle.evacuation_zones as GeoJSONCollection | undefined) ?? EMPTY_GEOJSON;
            console.log('[Ember] Using pre-fetched GeoJSON bundle from window promise');
          }
        } catch { /* fallback to fetch */ }
        delete (window as unknown as Record<string, unknown>).__EMBER_GEOJSON_PROMISE__;
      }

      // 2. Fallback to individual fetches if bundle was missing or failed
      if (sheltersGeo.features.length === 0) {
        console.log('[Ember] Fetching GeoJSON layers individually...');
        [sheltersGeo, hospitalsGeo, stationsGeo, popGeo, routesGeo, zonesGeo] =
          await Promise.all([
            fetchGeoJSON('shelters.geojson',           bust).catch(() => EMPTY_GEOJSON),
            fetchGeoJSON('hospitals.geojson',          bust).catch(() => EMPTY_GEOJSON),
            fetchGeoJSON('fire_stations.geojson',      bust).catch(() => EMPTY_GEOJSON),
            fetchGeoJSON('population_tracts.geojson',  bust).catch(() => EMPTY_GEOJSON),
            fetchGeoJSON('evacuation_routes.geojson',  bust).catch(() => EMPTY_GEOJSON),
            fetchGeoJSON('evacuation_zones.geojson',   bust).catch(() => EMPTY_GEOJSON),
          ]);
      }

      const routes: Record<string, { geometry: unknown } & Record<string, unknown>> = {};
      routesGeo.features.forEach((f) => {
        const props = f.properties as Record<string, unknown>;
        const id = (props?.route_id || props?.id) as string | undefined;
        if (id) routes[id] = { ...props, geometry: f.geometry };
      });

      const shelters: Record<string, { location: { lng: number; lat: number } } & Record<string, unknown>> = {};
      sheltersGeo.features.forEach((f) => {
        const props = f.properties as Record<string, unknown>;
        const id = (props?.shelter_id || props?.id) as string | undefined;
        const coords = f.geometry.coordinates as number[];
        if (id)
          shelters[id] = {
            ...props,
            location: { lng: coords[0], lat: coords[1] },
          };
      });

      const infra: Record<string, { location: { lng: number; lat: number } } & Record<string, unknown>> = {};
      [...hospitalsGeo.features, ...stationsGeo.features].forEach((f) => {
        const props = f.properties as Record<string, unknown>;
        const id = props?.id as string | undefined;
        const coords = f.geometry.coordinates as number[];
        if (id)
          infra[id] = {
            ...props,
            location: { lng: coords[0], lat: coords[1] },
          };
      });

      const population = popGeo.features.map((f) => {
        const coords = f.geometry.coordinates as number[];
        return {
          ...(f.properties as Record<string, unknown>),
          lng: coords[0],
          lat: coords[1],
        };
      });

      const zones: Record<string, { zone_id: string; name: string; population: number; centroid_lng: number; centroid_lat: number; geometry: GeoJSON.Polygon }> = {};
      zonesGeo.features.forEach((f) => {
        const props = f.properties as Record<string, unknown>;
        const id = (props?.zone_id || props?.id) as string | undefined;
        if (!id) return;
        const geom = f.geometry as GeoJSON.Polygon;
        if (geom?.type !== 'Polygon') return;
        const lng = (props?.centroid_lng as number) ?? 0;
        const lat = (props?.centroid_lat as number) ?? 0;
        zones[id] = {
          zone_id: id,
          name: (props?.name as string) || id,
          population: (props?.population as number) || 0,
          centroid_lng: lng,
          centroid_lat: lat,
          geometry: geom,
        };
      });

      dispatch({
        type: 'SEED_BASE_DATA',
        routes: routes as unknown as Record<string, RouteFeature>,
        shelters: shelters as unknown as Record<string, ShelterBase>,
        infra: infra as unknown as Record<string, InfraBase>,
        population: population as unknown as PopulationTract[],
        zones,
      });
    } catch (err) {
      console.warn('[Ember] Could not seed base data:', err);
    }
  }, [dispatch]);

  const handleMapEvent = useCallback(
    (event: MapEventData & { ui_message?: string; source_agent?: AgentName; action_id?: string }, agent?: AgentName, uiMessage?: string) => {
      dispatchMapEvent(event, dispatch);

      // Skip noisy events for notifications
      if (
        event.type === 'update_fire_perimeter' ||
        event.type === 'fire_update' ||
        event.type === 'fire_behavior'
      ) return;

      let message = uiMessage || event.ui_message;
      if (!message) {
        switch (event.type) {
          case 'threat_zone': message = `Threat zone updated`; break;
          case 'set_zone_status': message = `Zone ${event.zone_id} set to ${event.status}`; break;
          case 'set_evacuation_flow': message = `Evacuation flow started`; break;
          case 'close_route': message = `Route ${event.route_id} closed`; break;
          case 'open_route': message = `Route ${event.route_id} reopened`; break;
          case 'traffic_jam': message = `Traffic jam on ${event.route_id}`; break;
          case 'deploy_resource': message = `${event.count} ${event.resource_type} deployed`; break;
          case 'update_shelter': message = `Shelter ${event.shelter_id} updated`; break;
          case 'infrastructure_status': message = `${event.name} marked ${event.status}`; break;
          case 'broadcast_alert': message = `${event.channel} alert issued`; break;
          case 'power_shutoff': message = `PSPS initiated for area ${event.area_id}`; break;
          case 'traffic_congestion': {
            const closed = event.routes.find((route) => route.status === 'closed');
            const jammed = event.routes.find((route) => route.status === 'congested');
            message = closed ? `Route ${closed.route_id} closed` : jammed ? `Congestion building on ${jammed.route_id}` : undefined;
            break;
          }
          case 'fire_spread_vector': message = `Fire spread vector updated`; break;
          case 'playbook_section': message = `Incident command plan updated`; break;
          case 'tick_summary': message = `Command summary updated`; break;
        }
      }
      if (message) addNotification(message, agent || event.source_agent);
    },
    [dispatch, addNotification],
  );

  const handleStateSnapshot = useCallback(
    () => {
      // Trip waypoints are driven by particle_update (every 2s), not state_snapshot.
    },
    [],
  );

  const handleParticleUpdate = useCallback(
    (particles: [number, number][], trips?: TripWaypoint[]) => {
      dispatch({ type: 'SET_PARTICLES', particles });
      if (trips?.length) {
        dispatch({ type: 'SET_TRIP_WAYPOINTS', waypoints: trips });
      }
    },
    [dispatch],
  );

  const {
    isConnected,
    isRunning,
    timeline,
    currentAgent,
    currentText,
    currentSnapshot,
    snapshots,
    playbook,
    simTimeString,
    branchRunning,
    branchModifier,
    branchMessages,
    connect,
    startSimulation,
    pause,
    resume,
    stop,
    isPaused,
    requestPlaybook,
    startBranch,
    clearBranch,
  } = useSimulation({ onMapEvent: handleMapEvent, onAgentAudio: handleAudio, onStateSnapshot: handleStateSnapshot, onParticleUpdate: handleParticleUpdate });

  const { isReplaying, replayTick, replaySnapshot, setReplayTick, exitReplay, minTick, maxTick } =
    useReplay(snapshots);

  // When replaying, overlay snapshot data onto live mapState so the map rewinds correctly.
  // Live state keeps updating in the background; when replay exits, live state is already current.
  const displayMapState = useMemo(() => {
    if (!isReplaying || !replaySnapshot) return mapState;
    const snap = replaySnapshot.payload;

    const suppressionZones: Record<string, SuppressionZone> = {};
    for (const z of snap.fire.suppression_zones ?? []) {
      const id = `${z.type}-${z.center[0].toFixed(5)}-${z.center[1].toFixed(5)}`;
      suppressionZones[id] = {
        id,
        geojson: z.geojson,
        effectiveness: z.factor,
        resource_type: z.type,
      };
    }

    return {
      ...mapState,
      // Already-working overrides
      firePerimeter: snap.fire.perimeter_geojson,
      zones: snap.evacuation.zones,
      shelters: snap.resources.shelters,
      threatZones: {},
      tripWaypoints: [],
      particles: [],
      recentActions: [],
      resourceDispatches: [],
      // New overrides
      suppressionZones,
      closedRoutes: new Set<string>(snap.evacuation.closed_routes ?? []),
      routeCongestion: Object.fromEntries(
        (snap.evacuation.route_congestion ?? []).map(r => [
          r.route_id,
          { status: r.status, load_pct: r.load_pct, reason: r.reason, capacity_multiplier: r.capacity_multiplier },
        ])
      ),
      trafficJams: Object.fromEntries(
        (snap.evacuation.traffic_jams ?? []).map(j => [j.route_id, j.severity])
      ),
      infrastructure: snap.infrastructure.facilities ?? {},
      resources: (snap.resources.deployments ?? []).map(d => ({
        type: d.type,
        location: d.location,
        count: d.count,
      })),
    };
  }, [isReplaying, replaySnapshot, mapState]);

  useEffect(() => {
    connect();
  }, [connect]);

  // Cleanup effects for ephemeral map elements (pulses, moving dispatches)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      dispatch({ type: 'EXPIRE_RECENT_ACTIONS', olderThan: now - 6000 });
      dispatch({ type: 'PRUNE_RESOURCE_DISPATCHES', olderThan: now - 30000 });
    }, 2000);
    return () => clearInterval(timer);
  }, [dispatch]);

  // Derived state to show playbook modal — avoids synchronous setState in useEffect
  const playbookActive = !!playbook;
  useEffect(() => {
    if (playbookActive) {
      const t = setTimeout(() => setShowPlaybook(true), 0);
      return () => clearTimeout(t);
    }
  }, [playbookActive]);

  // Drag-to-resize map / agent feed split
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !mainContentRef.current) return;
      const rect = mainContentRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setMapWidth(Math.min(80, Math.max(20, pct)));
    };
    const onMouseUp = () => { isDraggingRef.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Fetch FIRMS data once on mount (show current real-world hot pixels)
  useEffect(() => {
    fetch(`${API_BASE}/api/firms`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.points) dispatch({ type: 'SET_FIRMS_DATA', points: data.points });
      })
      .catch(() => { }); // FIRMS is optional
  }, [dispatch]);

  // On mount: load scenario from sessionStorage, redirect to setup if missing
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ember_scenario');
      if (!raw) {
        router.push('/');
        return;
      }
      const scenario = JSON.parse(raw) as StoredScenario;
      const t = setTimeout(() => setStoredScenario(scenario), 0);
      return () => clearTimeout(t);
    } catch {
      router.push('/');
    }
  }, [router]);

  // Auto-start: once connected and storedScenario is loaded, launch the simulation
  const autoLaunched = useRef(false);

  useEffect(() => {
    // Only run once when both connected and scenario data is available
    if (!isConnected || autoLaunched.current || !storedScenario) return;
    autoLaunched.current = true;

    // bbox from API is [south, west, north, east]
    // ScenarioInput expects [west, south, east, north]
    const payload: ScenarioInput = {
      location: storedScenario.displayName || storedScenario.city,
      bbox: [
        storedScenario.bbox[1], // west
        storedScenario.bbox[0], // south
        storedScenario.bbox[3], // east
        storedScenario.bbox[2], // north
      ],
      timestamp: storedScenario.datetime + (storedScenario.datetime.endsWith('Z') ? '' : ':00Z'),
      fireOrigin: { lat: storedScenario.fireLat, lng: storedScenario.fireLng },
      metrics: storedScenario.metrics ?? { windU: -11.066, windV: -11.066, temp: 85, humidity: 15 },
      initialAcres: storedScenario.initialAcres ?? 10,
      historical_mode: storedScenario.historical_mode ?? false,
      durationHours: storedScenario.durationHours ?? 6,
    };

    reset();
    startSimulation(payload);
    
    // Seed base data for this specific scenario
    const bust = `${storedScenario.city}-${Date.now()}`;
    seedBaseData(bust);
  }, [isConnected, storedScenario, reset, startSimulation, seedBaseData]);

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4"
        style={{
          borderBottom: '1px solid var(--border)',
          borderTop: '2px solid var(--accent)',
          background: 'var(--panel-bg)',
          height: '44px',
          flexShrink: 0,
        }}
      >
        <div className="flex items-center" style={{ gap: '12px' }}>
          <Link
            href="/"
            style={{
              fontFamily: 'var(--font-condensed)',
              fontSize: '0.65rem',
              fontWeight: 600,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              padding: '3px 8px',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}
          >
            ← Setup
          </Link>
          <div style={{ width: '1px', height: '18px', background: 'var(--border)' }} />
          <h1 style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: '1.2rem',
            fontWeight: 800,
            letterSpacing: '0.1em',
            color: 'var(--accent)',
            margin: 0,
          }}>
            EMBER
          </h1>
          <span style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: '0.65rem',
            fontWeight: 500,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            ICS Unified Command
          </span>
        </div>

        {simTimeString && (
          <div className="flex flex-col items-center">
            <span className="sim-clock-label">Incident Clock</span>
            <span className="sim-clock">{simTimeString}</span>
          </div>
        )}

        <div className="flex items-center" style={{ gap: '10px' }}>
          <button
            onClick={toggleMute}
            title={isMuted ? 'Unmute agent voices' : 'Mute agent voices'}
            style={{
              fontFamily: 'var(--font-condensed)',
              fontSize: '0.65rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              padding: '3px 8px',
              background: 'transparent',
              color: isMuted ? 'var(--accent-red)' : 'var(--accent-green)',
              cursor: 'pointer',
            }}
          >
            {isMuted ? 'Audio Off' : 'Audio On'}
          </button>
          <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
          <span
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '50%',
              background: isConnected ? 'var(--accent-green)' : 'var(--accent-red)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          <span style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: '0.65rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Metrics Bar — shows replay snapshot when scrubbing, live snapshot otherwise */}
      <MetricsBar snapshot={(isReplaying ? replaySnapshot : currentSnapshot)?.payload ?? null} simTimeString={simTimeString} />

      {/* Main Content: Map + Agent Feed */}
      <div ref={mainContentRef} className="flex min-h-0 flex-1">
        {/* Map */}
        <div className="relative" style={{ width: `${mapWidth}%` }}>
          <MapView
            mapState={displayMapState}
            center={storedScenario ? { lat: storedScenario.centerLat, lng: storedScenario.centerLng } : undefined}
            isReplaying={isReplaying}
          />
          <MapNotifications notifications={notifications} />
          {isRunning && (
            <div
              className="animate-pulse-glow absolute left-4 top-4"
              style={{
                background: 'var(--accent-red)',
                color: 'oklch(96% 0.003 24)',
                fontFamily: 'var(--font-condensed)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                padding: '4px 10px',
              }}
            >
              Simulation Active
            </div>
          )}
          {/* What-If Branch Panel */}
          <BranchPanel
            isRunning={isRunning}
            branchRunning={branchRunning}
            branchModifier={branchModifier}
            branchMessages={branchMessages}
            onStartBranch={startBranch}
            onClearBranch={clearBranch}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={(e) => { e.preventDefault(); isDraggingRef.current = true; }}
          style={{
            width: '4px',
            cursor: 'col-resize',
            flexShrink: 0,
            background: 'var(--border)',
            transition: 'background 0.15s',
            zIndex: 10,
          }}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--accent-purple)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--border)')}
        />

        {/* Agent Feed */}
        <div
          className="flex flex-col"
          style={{ width: `${100 - mapWidth}%`, borderColor: 'var(--border)' }}
        >
          <div
            className="border-b px-4 py-2"
            style={{ borderColor: 'var(--border)', background: 'var(--panel-bg)' }}
          >
            <h2 style={{
              fontFamily: 'var(--font-condensed)',
              fontSize: '0.65rem',
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              margin: 0,
            }}>
              Agent Transmissions
            </h2>
          </div>
          <div className="min-h-0 flex-1">
            <AgentFeed
              timeline={timeline}
              currentAgent={currentAgent}
              currentText={currentText}
            />
          </div>
        </div>
      </div>

      {/* Replay Scrubber */}
      {snapshots.length > 1 && (
        <ReplayScrubber
          minTick={minTick}
          maxTick={maxTick}
          replayTick={replayTick}
          isReplaying={isReplaying}
          onSetTick={setReplayTick}
          onExit={exitReplay}
        />
      )}

      {/* Footer: sim controls when running, setup link when idle */}
      <div
        className="flex items-center justify-center gap-3 border-t px-4 py-2"
        style={{ borderColor: 'var(--border)', background: 'var(--panel-bg)' }}
      >
        {isRunning ? (
          <>
            <SimControl label={isPaused ? 'Resume' : 'Pause'} onClick={() => { if (isPaused) { resume(); } else { pause(); } }} />
            <SimControl label="Stop" danger onClick={stop} />
          </>
        ) : (
          <>
            <Link href="/" style={{
              fontFamily: 'var(--font-condensed)',
              fontSize: '0.65rem',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              transition: 'color 0.15s',
            }}>
              ← Configure New Scenario
            </Link>
            {playbook && (
              <SimControl label="View Playbook" purple onClick={() => setShowPlaybook(true)} />
            )}
          </>
        )}
      </div>

      {/* Playbook Modal */}
      {showPlaybook && (
        <PlaybookViewer
          playbook={playbook}
          onClose={() => setShowPlaybook(false)}
        />
      )}
    </div>
  );
}
