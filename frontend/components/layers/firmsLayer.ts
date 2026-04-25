import { ScatterplotLayer } from '@deck.gl/layers';

export interface FIRMSPoint {
  lng: number;
  lat: number;
  brightness: number;   // Kelvin, ~300–500
  confidence: string;   // 'nominal' | 'high' | 'low'
}

export function createFirmsLayer(
  points: FIRMSPoint[],
  visible: boolean,
): ScatterplotLayer<FIRMSPoint> {
  return new ScatterplotLayer<FIRMSPoint>({
    id: 'firms-hotspots',
    data: points,
    visible,
    getPosition: (d) => [d.lng, d.lat],
    getFillColor: (d) => {
      // Hotter = more yellow/white; cooler = more red
      const norm = Math.min(1, Math.max(0, (d.brightness - 300) / 200));
      const r = 255;
      const g = Math.round(norm * 200);
      const b = Math.round(norm * 50);
      const a = d.confidence === 'high' ? 240 : d.confidence === 'low' ? 140 : 190;
      return [r, g, b, a];
    },
    getRadius: 300,
    radiusMinPixels: 3,
    radiusMaxPixels: 10,
    stroked: false,
    pickable: true,
    updateTriggers: { getFillColor: points.map(p => p.brightness) },
  });
}
