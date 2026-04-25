import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';

export interface InfraBase {
  id: string;
  name: string;
  type: string;
  status: 'operational' | 'compromised' | 'offline' | string;
  location: { lng: number; lat: number };
  capacity?: number;
}

interface InfraRenderData extends InfraBase {
  _dynamicStatus: string;
}

export function createInfrastructureLayer(
  infraBaseData: Record<string, InfraBase>,
  dynamicInfra: Record<string, { name: string; status: string }>,
  zoom: number
): [ScatterplotLayer<InfraRenderData>, TextLayer<InfraRenderData>] {
  const data: InfraRenderData[] = Object.values(infraBaseData)
    .filter(f => f.type === 'hospital' || f.type === 'fire_station')
    .map(f => ({
      ...f,
      _dynamicStatus: dynamicInfra[f.id]?.status ?? f.status,
    }));

  const markerLayer = new ScatterplotLayer<InfraRenderData>({
    id: 'infrastructure-markers',
    data,
    getPosition: (d) => [d.location.lng, d.location.lat],
    getFillColor: (d) => {
      if (d._dynamicStatus === 'offline' || d._dynamicStatus === 'compromised') return [156, 163, 175, 255]; // Gray
      if (d._dynamicStatus === 'burning') return [239, 68, 68, 255]; // Red
      if (d._dynamicStatus === 'at_risk') return [245, 158, 11, 255]; // Amber
      if (d._dynamicStatus === 'contained') return [59, 130, 246, 255]; // Blue

      if (d.type === 'hospital') return [59, 130, 246, 255]; // Blue for hospital
      return [234, 179, 8, 255]; // Yellow/amber for fire station
    },
    getLineColor: (d) => {
      if (d._dynamicStatus === 'burning') return [255, 140, 0, 255]; // orange pulsing
      if (d._dynamicStatus === 'contained') return [34, 197, 94, 255]; // green outline
      return [255, 255, 255, 200];
    },
    getLineWidth: (d) => (d._dynamicStatus === 'burning' || d._dynamicStatus === 'contained') ? 3 : 1,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    stroked: true,
    getRadius: (d) => (d._dynamicStatus === 'offline' || d._dynamicStatus === 'burning') ? 7 : 5,
    radiusUnits: 'pixels',
    pickable: true,
    updateTriggers: {
      getFillColor: data.map(d => d._dynamicStatus),
      getLineColor: data.map(d => d._dynamicStatus),
      getLineWidth: data.map(d => d._dynamicStatus),
      getRadius: data.map(d => d._dynamicStatus)
    }
  });

  const labelLayer = new TextLayer<InfraRenderData>({
    id: 'infrastructure-labels',
    data,
    getPosition: (d) => [d.location.lng, d.location.lat],
    getText: (d) => {
      const icon = d.type === 'hospital' ? 'H' : 'FS';
      if (d._dynamicStatus === 'offline' || d._dynamicStatus === 'compromised') {
        return `${icon} ${d.name.length > 20 ? d.name.slice(0, 18) + '...' : d.name}`;
      }
      if (zoom < 10.5) return '';
      if (zoom < 12.5) return icon;
      return `${icon} ${d.name.length > 20 ? d.name.slice(0, 18) + '...' : d.name}`;
    },
    getSize: (d) => d._dynamicStatus === 'offline' ? 11 : 9,
    getColor: (d) => d._dynamicStatus === 'offline' ? [255, 100, 100, 255] : [255, 255, 255, 180],
    getPixelOffset: [0, -14],
    fontFamily: 'monospace',
    billboard: true,
    sizeUnits: 'pixels',
    updateTriggers: {
      getText: [data.map(d => d._dynamicStatus).join(','), zoom],
      getSize: data.map(d => d._dynamicStatus),
      getColor: data.map(d => d._dynamicStatus)
    }
  });

  return [markerLayer, labelLayer];
}
