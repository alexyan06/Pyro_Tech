'use client';
import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import Map, { Source, type MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, PathLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import { MAPBOX_TOKEN, LA_CENTER, LA_ZOOM, LA_PITCH, LA_BEARING } from '@/lib/constants';
import type { MapState, MapActionPulse } from '@/hooks/useMapState';
import type { ZoneStatus } from '@/lib/types';
import { createRouteLayer } from './layers/routeLayer';
import { createPopulationPointLayer } from './layers/populationLayer';
import { createFirmsLayer } from './layers/firmsLayer';
import { createTripsLayer } from './layers/flowLayer';
import { createInfrastructureLayer } from './layers/infrastructureLayer';
import { createShelterLayer } from './layers/shelterLayer';
import { createResourceLayer } from './layers/resourceLayer';
import MapLegend from './MapLegend';

interface MapViewProps {
  mapState: MapState;
  center?: { lat: number; lng: number };
}

interface ZoneFeature {
  type: 'Feature';
  properties: {
    zoneId: string;
    status: ZoneStatus;
  };
  geometry: GeoJSON.Polygon;
}

interface DispatchMoving {
  id: string;
  type: string;
  position: [number, number];
  path: [number, number][];
  t: number;
}

interface DispatchPath {
  id: string;
  type: string;
  path: [number, number][];
  startedAt: number;
}

interface ActionPulseData extends MapActionPulse {
  progress: number;
}

type ActionFeature = GeoJSON.Feature<GeoJSON.Geometry, ActionPulseData>;

function payloadValue(payload: MapActionPulse['payload'], key: string): unknown {
  return key in payload ? payload[key as keyof MapActionPulse['payload']] : undefined;
}

function asLngLat(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lng, lat] = value;
  return typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null;
}

function actionZoneId(action: ActionPulseData): string | null {
  const zoneId = payloadValue(action.payload, 'zone_id');
  return typeof zoneId === 'string' ? zoneId : null;
}

function actionRouteId(action: ActionPulseData): string | null {
  const routeId = payloadValue(action.payload, 'route_id');
  return typeof routeId === 'string' ? routeId : null;
}

function actionProgress(feature: unknown): number {
  if (typeof feature !== 'object' || feature === null || !('properties' in feature)) return 0;
  const properties = (feature as { properties?: unknown }).properties;
  if (typeof properties !== 'object' || properties === null || !('progress' in properties)) return 0;
  const progress = (properties as { progress?: unknown }).progress;
  return typeof progress === 'number' ? progress : 0;
}

function routeCoordinates(routes: MapState['routeFeatures']): [number, number][] {
  const coords: [number, number][] = [];
  for (const route of Object.values(routes)) {
    const geometry = route.geometry as GeoJSON.Geometry | undefined;
    if (!geometry) continue;
    if (geometry.type === 'LineString') {
      coords.push(...geometry.coordinates.filter(isLngLat));
    } else if (geometry.type === 'MultiLineString') {
      for (const line of geometry.coordinates) coords.push(...line.filter(isLngLat));
    }
  }
  return coords;
}

function isLngLat(coord: unknown): coord is [number, number] {
  return Array.isArray(coord) &&
    coord.length >= 2 &&
    typeof coord[0] === 'number' &&
    typeof coord[1] === 'number';
}

function nearestCoord(coords: [number, number][], target: [number, number]): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDist = Infinity;
  for (const coord of coords) {
    const dist = coordDistance(coord, target);
    if (dist < bestDist) {
      best = coord;
      bestDist = dist;
    }
  }
  return best;
}

function coordDistance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function buildDispatchPath(from: [number, number], to: [number, number], highwayCoords: [number, number][]): [number, number][] {
  if (highwayCoords.length === 0) return [from, to];
  const highwayStart = nearestCoord(highwayCoords, from);
  const highwayEnd = nearestCoord(highwayCoords, to);
  if (!highwayStart || !highwayEnd) return [from, to];

  const directDistance = coordDistance(from, to);
  const highwayDistance =
    coordDistance(from, highwayStart) +
    coordDistance(highwayStart, highwayEnd) +
    coordDistance(highwayEnd, to);

  if (directDistance === 0 || highwayDistance > directDistance * 1.6) return [from, to];

  return [from, highwayStart, highwayEnd, to].filter((coord, index, path) => {
    return index === 0 || coordDistance(coord, path[index - 1]) > 0.00001;
  });
}

function interpolatePath(path: [number, number][], t: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1) return path[0];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const length = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return path[path.length - 1];
  let remaining = total * Math.min(1, Math.max(0, t));
  for (let i = 1; i < path.length; i++) {
    const length = lengths[i - 1];
    if (remaining <= length) {
      const localT = length === 0 ? 1 : remaining / length;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * localT,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * localT,
      ];
    }
    remaining -= length;
  }
  return path[path.length - 1];
}

// Lerp fire polygon vertices between two perimeter states for smooth 60fps expansion.
// Requires both perimeters to have the same vertex count (guaranteed by WildfireEngine's
// fixed numPoints=72). Spot fires (features[1..]) snap immediately.
function lerpPerimeter(
  prev: GeoJSON.FeatureCollection | null,
  next: GeoJSON.FeatureCollection | null,
  t: number,
): GeoJSON.FeatureCollection | null {
  if (!prev || !next || prev.features.length === 0 || next.features.length === 0) return next;
  if (t >= 1) return next;
  const prevGeom = prev.features[0].geometry as GeoJSON.Polygon;
  const nextGeom = next.features[0].geometry as GeoJSON.Polygon;
  const prevCoords = prevGeom?.coordinates?.[0];
  const nextCoords = nextGeom?.coordinates?.[0];
  if (!prevCoords || !nextCoords || prevCoords.length !== nextCoords.length) return next;
  const lerpedCoords = prevCoords.map((pc, i) => {
    const nc = nextCoords[i];
    return [pc[0] + (nc[0] - pc[0]) * t, pc[1] + (nc[1] - pc[1]) * t];
  });
  return {
    ...next,
    features: [
      {
        ...next.features[0],
        geometry: { type: 'Polygon' as const, coordinates: [lerpedCoords] },
      },
      ...next.features.slice(1),
    ],
  };
}

const ZONE_FILL_COLORS: Record<ZoneStatus, [number, number, number, number]> = {
  mandatory: [239, 68, 68, 120],
  warning: [249, 115, 22, 100],
  voluntary: [234, 179, 8, 80],
  clear: [34, 197, 94, 40],
};
const ZONE_LINE_COLORS: Record<ZoneStatus, [number, number, number, number]> = {
  mandatory: [239, 68, 68, 255],
  warning: [249, 115, 22, 255],
  voluntary: [234, 179, 8, 255],
  clear: [34, 197, 94, 120],
};

/** Animation loop length — must match LOOP_LENGTH in trafficModel.js */
const ANIM_LOOP_LENGTH = 1800;
/** How many animation units to advance per millisecond */
const ANIM_SPEED = 0.03; // 1800 units ÷ 0.03 = 60,000 ms = 60 seconds per full loop
/** Must match PHYSICS_INTERVAL_MS in backend/orchestration/turnSequencer.js */
const PHYSICS_INTERVAL_MS = 500;

// ── Sub-component for DeckGL to isolate animation re-renders ────────────────
const MapOverlay = memo(function MapOverlay({
  mapState,
  staticLayers,
  viewState,
  firePerimeter,
}: {
  mapState: MapState,
  staticLayers: Layer[],
  viewState: Record<string, unknown>,
  firePerimeter: GeoJSON.FeatureCollection | null,
}) {
  const [animTime, setAnimTime] = useState(0);
  const [wallClockMs, setWallClockMs] = useState(0);
  const [lerpedPerimeter, setLerpedPerimeter] = useState(firePerimeter);

  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);

  // Lerp refs — track previous and target perimeter for smooth interpolation
  const prevPerimRef = useRef<GeoJSON.FeatureCollection | null>(firePerimeter);
  const nextPerimRef = useRef<GeoJSON.FeatureCollection | null>(firePerimeter);
  const perimUpdateTimeRef = useRef<number>(0);
  const lerpedPerimRef = useRef<GeoJSON.FeatureCollection | null>(firePerimeter);

  const hasFirePerimeter = (firePerimeter?.features?.length ?? 0) > 0;
  const hasAnimated = hasFirePerimeter || (mapState.resourceDispatches?.length ?? 0) > 0 || mapState.tripWaypoints.length > 0 || mapState.recentActions.length > 0;


  // When a new perimeter arrives, save the current lerped position as start point
  useEffect(() => {
    prevPerimRef.current = lerpedPerimRef.current ?? firePerimeter;
    nextPerimRef.current = firePerimeter;
    perimUpdateTimeRef.current = Date.now();
  }, [firePerimeter]);

  useEffect(() => {
    if (!hasAnimated) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const delta = ts - lastTsRef.current;
      lastTsRef.current = ts;
      setAnimTime(prev => (prev + delta * ANIM_SPEED) % ANIM_LOOP_LENGTH);

      // Throttle wallClockMs to ~10fps — dispatch/pulse position memos only recompute
      // when this changes, so limiting it to 10fps cuts their work by ~6×
      frameCountRef.current += 1;
      if (frameCountRef.current % 6 === 0) {
        setWallClockMs(Date.now());
      }

      // Lerp fire perimeter vertices between physics ticks for smooth 60fps expansion
      const elapsed = Date.now() - perimUpdateTimeRef.current;
      if (elapsed < PHYSICS_INTERVAL_MS) {
        const t = elapsed / PHYSICS_INTERVAL_MS;
        const lerped = lerpPerimeter(prevPerimRef.current, nextPerimRef.current, t);
        lerpedPerimRef.current = lerped;
        setLerpedPerimeter(lerped);
      } else if (lerpedPerimRef.current !== nextPerimRef.current) {
        lerpedPerimRef.current = nextPerimRef.current;
        setLerpedPerimeter(nextPerimRef.current);
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
    };
  }, [hasAnimated]);

  const fireLayer = useMemo(() => new GeoJsonLayer({
    id: 'fire-perimeter',
    data: lerpedPerimeter ?? { type: 'FeatureCollection', features: [] },
    filled: true,
    stroked: true,
    getFillColor: [220, 60, 0, 120],
    getLineColor: [255, 140, 0, 255],
    getLineWidth: 3,
    lineWidthUnits: 'pixels',
  }), [lerpedPerimeter]);

  // Stable path data — recomputed only when dispatches/routes change, not on every frame
  const dispatchPaths = useMemo((): DispatchPath[] => {
    const dispatches = mapState.resourceDispatches;
    if (!dispatches || dispatches.length === 0) return [];
    const highwayCoords = routeCoordinates(mapState.routeFeatures);
    return dispatches.map(d => ({
      id: d.id,
      type: d.type,
      path: buildDispatchPath(d.from, d.to, highwayCoords),
      startedAt: d.startedAt,
    }));
  }, [mapState.resourceDispatches, mapState.routeFeatures]);

  const tripsLayer = useMemo(
    () => mapState.tripWaypoints.length > 0
      ? createTripsLayer(mapState.tripWaypoints, animTime)
      : null,
    [mapState.tripWaypoints, animTime],
  );

  const dispatchLayers = useMemo(() => {
    if (dispatchPaths.length === 0) return [];
    const DURATION_MS = 24000;
    const moving: DispatchMoving[] = dispatchPaths
      .map(d => {
        const t = Math.min(1, Math.max(0, (wallClockMs - d.startedAt) / DURATION_MS));
        return { id: d.id, type: d.type, path: d.path, position: interpolatePath(d.path, t), t };
      })
      .filter(d => d.t < 1);
    const layers: Layer[] = [
      new PathLayer<DispatchPath>({
        id: 'resource-dispatch-paths',
        data: dispatchPaths,
        getPath: (d) => d.path,
        getColor: (d) => d.type === 'dozer' ? [250, 204, 21, 230] : [239, 68, 68, 235],
        getWidth: 5,
        widthUnits: 'pixels',
        rounded: true,
        billboard: true,
      }),
    ];

    if (moving.length > 0) {
      layers.push(
        new ScatterplotLayer<DispatchMoving>({
          id: 'resource-dispatch-markers',
          data: moving,
          getPosition: (d) => d.position,
          getRadius: 16,
          getFillColor: (d) => d.type === 'dozer' ? [250, 204, 21, 255] : [239, 68, 68, 255],
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          stroked: true,
          radiusUnits: 'pixels',
          updateTriggers: { getPosition: wallClockMs },
        }),
        new TextLayer<DispatchMoving>({
          id: 'resource-dispatch-truck-icons',
          data: moving,
          getPosition: (d) => d.position,
          getText: (d) => d.type === 'dozer' ? 'DZR' : '🚒',
          getSize: (d) => d.type === 'dozer' ? 12 : 22,
          getColor: [255, 255, 255, 255],
          getTextAnchor: 'middle',
          getAlignmentBaseline: 'center',
          billboard: true,
          sizeUnits: 'pixels',
          updateTriggers: { getPosition: wallClockMs },
        }),
      );
    }

    return layers;
  }, [dispatchPaths, wallClockMs]);

  const suppressionLayer = useMemo(() => {
    const zones = Object.values(mapState.suppressionZones);
    if (zones.length === 0) return null;
    const features = zones.flatMap((zone): GeoJSON.Feature[] => {
      if (zone.geojson.type === 'FeatureCollection') {
        return zone.geojson.features.map((feature) => ({
          ...feature,
          properties: { ...(feature.properties ?? {}), ...zone },
        }));
      }
      if (zone.geojson.type === 'Feature') {
        return [{
          ...zone.geojson,
          properties: { ...(zone.geojson.properties ?? {}), ...zone },
        }];
      }
      return [{
        type: 'Feature',
        properties: zone,
        geometry: zone.geojson,
      }];
    });

    return new GeoJsonLayer<GeoJSON.Feature>({
      id: 'suppression-zones',
      data: features,
      filled: true,
      stroked: true,
      getFillColor: [59, 130, 246, 18],
      getLineColor: [34, 197, 94, 95],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
    });
  }, [mapState.suppressionZones]);

  const actionPulseLayer = useMemo(() => {
    const actions = mapState.recentActions;
    if (actions.length === 0) return null;

    const pulseData: ActionPulseData[] = actions.map(a => {
      const age = wallClockMs - a.timestamp;
      const progress = Math.min(1, age / 5000);
      return { ...a, progress };
    });

    const getPointPosition = (action: ActionPulseData): [number, number] | null => {
      const explicitLocation = asLngLat(payloadValue(action.payload, 'action_location'))
        ?? asLngLat(payloadValue(action.payload, 'location'));
      if (explicitLocation) return explicitLocation;

      const facilityId = payloadValue(action.payload, 'facility_id');
      const shelterId = payloadValue(action.payload, 'shelter_id');
      const id = typeof facilityId === 'string' ? facilityId : typeof shelterId === 'string' ? shelterId : null;
      if (id) {
        const base = mapState.infraBaseData[id] ?? mapState.shelterBaseData[id];
        if (base) return [base.location.lng, base.location.lat];
      }
      return null;
    };

    const pointActions = pulseData.filter(a => getPointPosition(a) !== null);
    const zoneActions = pulseData.filter(a => actionZoneId(a) !== null);
    const routeActions = pulseData.filter(a => actionRouteId(a) !== null);

    const layers: Layer[] = [];

    if (pointActions.length > 0) {
      layers.push(new ScatterplotLayer<ActionPulseData>({
        id: 'action-pulse-points',
        data: pointActions,
        getPosition: (d) => getPointPosition(d) || [0, 0],
        getRadius: (d) => 10 + d.progress * 40,
        getFillColor: (d) => [255, 255, 255, Math.floor((1 - d.progress) * 160)],
        getLineColor: (d) => [255, 255, 255, Math.floor((1 - d.progress) * 255)],
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        radiusUnits: 'pixels',
        updateTriggers: { getRadius: wallClockMs }
      }));
    }

    if (zoneActions.length > 0) {
      const zoneFeatures: ActionFeature[] = zoneActions.flatMap((action) => {
        const zoneId = actionZoneId(action);
        const zone = zoneId ? mapState.zonePolygons[zoneId] : null;
        return zone ? [{ type: 'Feature', properties: action, geometry: zone.geometry }] : [];
      });

      layers.push(new GeoJsonLayer<ActionFeature>({
        id: 'action-pulse-zones',
        data: zoneFeatures,
        getFillColor: (d) => [255, 255, 255, Math.floor((1 - actionProgress(d)) * 80)],
        getLineColor: (d) => [255, 255, 255, Math.floor((1 - actionProgress(d)) * 255)],
        getLineWidth: 4,
        lineWidthUnits: 'pixels',
        updateTriggers: { getFillColor: wallClockMs }
      }));
    }

    if (routeActions.length > 0) {
      const routeFeatures: ActionFeature[] = routeActions.flatMap((action) => {
        const routeId = actionRouteId(action);
        const route = routeId ? mapState.routeFeatures[routeId] : null;
        return route ? [{ type: 'Feature', properties: action, geometry: route.geometry }] : [];
      });

      layers.push(new GeoJsonLayer<ActionFeature>({
        id: 'action-pulse-routes',
        data: routeFeatures,
        getLineColor: (d) => [255, 255, 255, Math.floor((1 - actionProgress(d)) * 255)],
        getLineWidth: 6,
        lineWidthUnits: 'pixels',
        updateTriggers: { getLineColor: wallClockMs }
      }));
    }

    return layers;
  }, [mapState.recentActions, mapState.zonePolygons, mapState.routeFeatures, mapState.infraBaseData, mapState.shelterBaseData, wallClockMs]);

  const layers = useMemo(() => [
    ...staticLayers,
    fireLayer,
    suppressionLayer,
    tripsLayer,
    ...dispatchLayers,
    ...(Array.isArray(actionPulseLayer) ? actionPulseLayer : [actionPulseLayer]),
  ].filter((l): l is Layer => l !== null), [staticLayers, fireLayer, suppressionLayer, tripsLayer, dispatchLayers, actionPulseLayer]);

  return (
    <DeckGL
      layers={layers}
      viewState={viewState}
      controller={false}
      style={{ position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', pointerEvents: 'none' }}
    />
  );
});

export default function MapView({ mapState, center }: MapViewProps) {
  const [viewState, setViewState] = useState({
    longitude: center?.lng ?? LA_CENTER[0],
    latitude: center?.lat ?? LA_CENTER[1],
    zoom: LA_ZOOM,
    pitch: LA_PITCH,
    bearing: LA_BEARING,
  });

  const centeredRef = useRef(false);
  const mapRef = useRef<MapRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      mapRef.current?.getMap().resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const setProgrammaticView = useCallback((lat: number, lng: number) => {
    setViewState(prev => ({ ...prev, latitude: lat, longitude: lng }));
  }, []);

  useEffect(() => {
    if (center && !centeredRef.current) {
      centeredRef.current = true;
      const t = setTimeout(() => setProgrammaticView(center.lat, center.lng), 0);
      return () => clearTimeout(t);
    }
  }, [center, setProgrammaticView]);

  const fireBehaviorLayer = useMemo(() => {
    const behavior = mapState.fireBehavior;
    if (!behavior?.origin || !behavior.head) return null;

    const features: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        properties: { kind: 'wind-vector', ...behavior },
        geometry: {
          type: 'LineString',
          coordinates: [behavior.origin, behavior.head],
        },
      },
      {
        type: 'Feature',
        properties: { kind: 'wind-head', ...behavior },
        geometry: {
          type: 'Point',
          coordinates: behavior.head,
        },
      },
    ];

    return new GeoJsonLayer<GeoJSON.Feature>({
      id: 'fire-behavior-vector',
      data: features,
      stroked: true,
      filled: true,
      pointType: 'circle',
      getLineColor: [255, 190, 80, 230],
      getLineWidth: 4,
      lineWidthUnits: 'pixels',
      getPointRadius: 8,
      pointRadiusUnits: 'pixels',
      getFillColor: [255, 235, 120, 230],
      getText: () => '',
    });
  }, [mapState.fireBehavior]);

  // ── Evacuation zone polygons ───────────────────────────────────────────────
  const zoneLayer = useMemo(() => {
    const threatToStatus: Record<string, ZoneStatus> = { extreme: 'mandatory', high: 'warning', moderate: 'voluntary' };
    const features: ZoneFeature[] = Object.entries(mapState.zonePolygons).map(([zoneId, zp]) => {
      const status: ZoneStatus = mapState.zones[zoneId]
        ?? (mapState.threatZones[zoneId] ? threatToStatus[mapState.threatZones[zoneId]] : undefined)
        ?? 'clear';
      return {
        type: 'Feature' as const,
        properties: { zoneId, status },
        geometry: zp.geometry,
      };
    }).filter(f => f.properties.status !== 'clear');
    return new GeoJsonLayer({
      id: 'evacuation-zones',
      data: { type: 'FeatureCollection', features },
      filled: true,
      stroked: true,
      getFillColor: (f) => ZONE_FILL_COLORS[(f as ZoneFeature).properties.status] ?? ZONE_FILL_COLORS.clear,
      getLineColor: (f) => ZONE_LINE_COLORS[(f as ZoneFeature).properties.status] ?? ZONE_LINE_COLORS.clear,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      transitions: { getFillColor: 800 },
      updateTriggers: { getFillColor: [mapState.zones, mapState.threatZones], getLineColor: [mapState.zones, mapState.threatZones] },
      pickable: true,
    });
  }, [mapState.zonePolygons, mapState.zones, mapState.threatZones]);

  // ── Evacuation routes ───────────────────────────────────────────────────────
  const routeLayer = useMemo(
    () => Object.keys(mapState.routeFeatures).length > 0
      ? createRouteLayer(mapState.routeFeatures, mapState.closedRoutes, mapState.routeCongestion, mapState.trafficJams)
      : null,
    [mapState.routeFeatures, mapState.closedRoutes, mapState.routeCongestion, mapState.trafficJams],
  );

  const populationPointLayer = useMemo(
    () => mapState.populationTracts.length > 0
      ? createPopulationPointLayer(mapState.populationTracts, mapState.populationVisible)
      : null,
    [mapState.populationTracts, mapState.populationVisible],
  );

  const firmsLayer = useMemo(
    () => mapState.firmsData.length > 0
      ? createFirmsLayer(mapState.firmsData, mapState.firmsVisible)
      : null,
    [mapState.firmsData, mapState.firmsVisible],
  );

  const infrastructureLayers = useMemo(
    () => Object.keys(mapState.infraBaseData).length > 0
      ? createInfrastructureLayer(mapState.infraBaseData, mapState.infrastructure, viewState.zoom)
      : [],
    [mapState.infraBaseData, mapState.infrastructure, viewState.zoom]
  );

  const shelterLayers = useMemo(
    () => Object.keys(mapState.shelterBaseData).length > 0
      ? createShelterLayer(mapState.shelterBaseData, mapState.shelters, viewState.zoom)
      : [],
    [mapState.shelterBaseData, mapState.shelters, viewState.zoom]
  );

  const resourceLayer = useMemo(
    () => mapState.resources.length > 0
      ? createResourceLayer(mapState.resources, viewState.zoom)
      : null,
    [mapState.resources, viewState.zoom]
  );

  // Fire perimeter is handled inside MapOverlay with client-side lerp — excluded here
  const staticLayers = useMemo(() => [
    populationPointLayer,
    firmsLayer,
    fireBehaviorLayer,
    zoneLayer,
    routeLayer,
    ...infrastructureLayers,
    ...shelterLayers,
    ...(resourceLayer || []),
  ].filter((l) => l !== null) as Layer[], [
    populationPointLayer, firmsLayer, zoneLayer, routeLayer, fireBehaviorLayer,
    infrastructureLayers, shelterLayers, resourceLayer
  ]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--panel-bg)]">
        <div className="text-center">
          <p className="text-lg text-[var(--accent-yellow)]">Map Unavailable</p>
          <p className="mt-2 text-sm text-gray-500">Set NEXT_PUBLIC_MAPBOX_TOKEN to enable map</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden rounded-lg">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        mapboxAccessToken={MAPBOX_TOKEN}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: '100%', height: '100%' }}
        terrain={{ source: 'mapbox-dem', exaggeration: 1.5 }}
        onLoad={(e) => {
          // Hide unnecessary road layers, keep highways strong, dim secondary
          const map = e.target;
          const keepPatterns = [/motorway/, /trunk/, /primary/];
          const faintPatterns = [/secondary/, /tertiary/, /arterial/];
          const layers = map.getStyle().layers || [];

          for (const layer of layers) {
            const id = layer.id;
            if (!/road|tunnel|bridge/i.test(id)) continue;
            if (/label/i.test(id)) continue; // keep labels

            if (keepPatterns.some((p) => p.test(id))) {
              try {
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setPaintProperty(id, 'line-opacity', 0.3);
              } catch {}
              continue;
            }

            if (faintPatterns.some((p) => p.test(id))) {
              try {
                map.setLayoutProperty(id, 'visibility', 'visible');
                map.setPaintProperty(id, 'line-opacity', 0.15);
              } catch {}
              continue;
            }

            // Hide all other roads (local, street, path, etc.)
            try {
              map.setLayoutProperty(id, 'visibility', 'none');
            } catch {}
          }
        }}
      >
        <Source
          id="mapbox-dem"
          type="raster-dem"
          url="mapbox://mapbox.mapbox-terrain-dem-v1"
          tileSize={512}
          maxzoom={14}
        />
      </Map>

      <MapOverlay
        mapState={mapState}
        staticLayers={staticLayers}
        viewState={viewState}
        firePerimeter={mapState.firePerimeter}
      />

      <MapLegend />
    </div>
  );
}
