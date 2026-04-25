import { ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';

export interface ResourceData {
  type: string;
  location: [number, number];
  count: number;
}

const resourceLabelFor = (type: string): string => {
  const t = type.toLowerCase();
  if (t.includes('crew') || t.includes('hotshot') || t.includes('hand')) return 'CRW';
  if (t.includes('bulldozer') || t.includes('dozer')) return 'DZR';
  if (t.includes('ambulance') || t.includes('medic')) return 'MED';
  return 'ENG';
};

export function createResourceLayer(resources: ResourceData[], zoom: number): Layer[] {
  const haloLayer = new ScatterplotLayer<ResourceData>({
    id: 'resources-halo',
    data: resources,
    getPosition: (d) => [d.location[0], d.location[1]],
    getFillColor: [16, 185, 129, 8],
    getLineColor: [16, 185, 129, 55],
    lineWidthMinPixels: 1,
    stroked: true,
    getRadius: (d) => resourceLabelFor(d.type) === 'DZR' ? 220 : 170,
    radiusUnits: 'meters',
    pickable: false,
  });

  const markerLayer = new ScatterplotLayer<ResourceData>({
    id: 'resources-markers',
    data: resources,
    getPosition: (d) => [d.location[0], d.location[1]],
    getFillColor: [16, 185, 129, 255], // Green for active resources
    getLineColor: [255, 255, 255, 200],
    lineWidthMinPixels: 1,
    stroked: true,
    getRadius: 6,
    radiusUnits: 'pixels',
    pickable: true,
  });

  const labelLayer = new TextLayer<ResourceData>({
    id: 'resources-labels',
    data: resources,
    getPosition: (d) => [d.location[0], d.location[1]],
    getText: (d) => {
      const lbl = resourceLabelFor(d.type);
      if (zoom < 10.5) return '';
      if (zoom < 12.5) return lbl;
      return `${lbl} (${d.count})`;
    },
    getSize: 9,
    getColor: [16, 185, 129, 255], // Green text
    getPixelOffset: [0, -12],
    fontFamily: 'monospace',
    fontWeight: 700,
    billboard: true,
    sizeUnits: 'pixels',
    updateTriggers: {
      getText: [zoom]
    }
  });

  return [haloLayer, markerLayer, labelLayer];
}
