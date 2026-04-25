import { IconLayer } from '@deck.gl/layers';
import type { TripWaypoint } from '@/lib/types';

interface CarPosition {
  position: [number, number];
  bearing: number;
  status: 'normal' | 'slowed' | 'rerouted';
}

const STATUS_COLOR: Record<CarPosition['status'], [number, number, number, number]> = {
  normal: [255, 255, 255, 255],
  slowed: [250, 204, 21, 255],   // yellow: on congested road
  rerouted: [249, 115, 22, 255], // orange: detouring around fire/closure
};

/** Linearly interpolate trip position at the given animation time */
function interpolateTripPosition(trip: TripWaypoint, animTime: number): CarPosition | null {
  const { path, timestamps } = trip;
  if (path.length < 2 || timestamps.length < 2) return null;

  // Normalize animTime into the trip's timestamp range (wrap around)
  const minTs = Math.min(...timestamps);
  const maxTs = Math.max(...timestamps);
  const range = maxTs - minTs;
  if (range <= 0) return null;

  if (trip.one_way) {
    if (animTime < minTs || animTime > maxTs) return null;
  }

  const t = trip.one_way
    ? animTime
    : minTs + ((animTime - minTs) % range + range) % range;

  // Find the segment containing t using binary search
  let segIdx = 0;
  let low = 0;
  let high = timestamps.length - 2;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (t >= timestamps[mid] && t <= timestamps[mid + 1]) {
      segIdx = mid;
      break;
    } else if (t < timestamps[mid]) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  const t0 = timestamps[segIdx];
  const t1 = timestamps[segIdx + 1];
  const segLen = t1 - t0;
  const alpha = segLen > 0 ? (t - t0) / segLen : 0;

  const [lng0, lat0] = path[segIdx];
  const [lng1, lat1] = path[segIdx + 1];
  const lng = lng0 + (lng1 - lng0) * alpha;
  const lat = lat0 + (lat1 - lat0) * alpha;

  // Compute bearing from segment direction
  const dLng = lng1 - lng0;
  const dLat = lat1 - lat0;
  const bearing = Math.atan2(dLng, dLat) * (180 / Math.PI);

  return { position: [lng, lat], bearing, status: trip.status ?? 'normal' };
}

export function createCarLayer(
  tripWaypoints: TripWaypoint[],
  animTime: number,
): IconLayer<CarPosition> | null {
  const vehicleTrips = tripWaypoints.filter(t => t.particle_type === 'vehicle');
  if (vehicleTrips.length === 0) return null;

  const positions: CarPosition[] = vehicleTrips
    .map(trip => interpolateTripPosition(trip, animTime))
    .filter((p): p is CarPosition => p !== null);

  if (positions.length === 0) return null;

  return new IconLayer<CarPosition>({
    id: 'evacuation-cars',
    data: positions,
    getPosition: (d) => d.position,
    getAngle: (d) => -d.bearing,
    getColor: (d) => STATUS_COLOR[d.status],
    getIcon: () => ({
      url: '/car.svg',
      width: 32,
      height: 32,
      anchorX: 16,
      anchorY: 16,
      mask: true,
    }),
    getSize: 22,
    sizeUnits: 'meters',
    sizeMinPixels: 8,
    sizeMaxPixels: 22,
    billboard: false,
    pickable: false,
    updateTriggers: {
      getPosition: [animTime],
      getAngle: [animTime],
      getColor: [animTime],
    },
  });
}
