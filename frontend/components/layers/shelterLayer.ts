import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { ShelterState } from '@/lib/types';

export interface ShelterBase {
  shelter_id: string;
  name: string;
  capacity: number;
  current_occupancy: number;
  status: 'open' | 'closed' | 'full';
  location: { lng: number; lat: number };
}

interface ShelterRenderData extends ShelterBase {
  _occ: number;
  _status: 'open' | 'full' | 'closed' | string;
}

export function createShelterLayer(
  shelterBaseData: Record<string, ShelterBase>,
  dynamicShelters: Record<string, ShelterState>,
  zoom: number
): [ScatterplotLayer<ShelterRenderData>, TextLayer<ShelterRenderData>] {
  const data: ShelterRenderData[] = Object.values(shelterBaseData).map(s => {
    const dyn = dynamicShelters[s.shelter_id];
    const occ = dyn?.occupancy ?? s.current_occupancy;
    const st = (dyn?.status ?? s.status) as 'open' | 'full' | 'closed' | string;
    return { ...s, _occ: occ, _status: st };
  });

  const markerLayer = new ScatterplotLayer<ShelterRenderData>({
    id: 'shelters-markers',
    data,
    getPosition: (d) => [d.location.lng, d.location.lat],
    getFillColor: (d) => {
      if (d._status === 'burning') return [239, 68, 68, 255]; // Red
      if (d._status === 'at_risk') return [245, 158, 11, 255]; // Amber
      if (d._status === 'contained') return [59, 130, 246, 255]; // Blue
      if (d._status === 'offline' || d._status === 'closed') return [156, 163, 175, 255]; // Gray
      if (d._status === 'full') return [249, 115, 22, 255]; // Orange
      return [34, 197, 94, 255]; // Green
    },
    getLineColor: (d) => {
      if (d._status === 'burning') return [255, 140, 0, 255]; // orange pulsing
      if (d._status === 'contained') return [34, 197, 94, 255]; // green outline
      return [255, 255, 255, 200];
    },
    getLineWidth: (d) => (d._status === 'burning' || d._status === 'contained') ? 3 : 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    stroked: true,
    getRadius: (d) => (d._status === 'offline' || d._status === 'burning') ? 7 : 5,
    radiusUnits: 'pixels',
    pickable: true,
    updateTriggers: {
      getFillColor: data.map(d => d._status),
      getLineColor: data.map(d => d._status),
      getLineWidth: data.map(d => d._status),
      getRadius: data.map(d => d._status)
    }
  });

  const labelLayer = new TextLayer<ShelterRenderData>({
    id: 'shelters-labels',
    data,
    getPosition: (d) => [d.location.lng, d.location.lat],
    getText: (d) => {
      if (d._status === 'full' || d._status === 'closed') {
        return `SHL ${d.name.length > 15 ? d.name.slice(0, 13) + '...' : d.name}`;
      }
      if (zoom < 10.5) return '';
      if (zoom < 12.5) return 'SHL';
      return `SHL ${d.name.length > 15 ? d.name.slice(0, 13) + '...' : d.name}`;
    },
    getSize: 9,
    getColor: (d) => {
      if (d._status === 'closed') return [156, 163, 175, 180];
      if (d._status === 'full') return [249, 115, 22, 255];
      return [255, 255, 255, 180];
    },
    getPixelOffset: [0, -12],
    fontFamily: 'monospace',
    billboard: true,
    sizeUnits: 'pixels',
    updateTriggers: {
      getText: [data.map(d => d._status).join(','), zoom],
      getSize: data.map(d => d._status),
      getColor: data.map(d => d._status)
    }
  });

  return [markerLayer, labelLayer];
}
