import { HeatmapLayer } from '@deck.gl/aggregation-layers';

export interface PopulationTract {
  tract_id: string;
  population: number;
  density_per_sqkm: number;
  lng: number;
  lat: number;
}

export function createPopulationPointLayer(
  tracts: PopulationTract[],
  visible: boolean,
): HeatmapLayer<PopulationTract> {
  return new HeatmapLayer<PopulationTract>({
    id: 'population-heatmap',
    data: tracts,
    visible,
    getPosition: (d) => [d.lng, d.lat],
    getWeight: (d) => d.density_per_sqkm || d.population || 1,
    radiusPixels: 45,
    intensity: 1,
    threshold: 0.05,
    colorRange: [
      [96, 165, 250, 20],   // Faint blue
      [98, 224, 180, 50],   // Teal
      [255, 216, 92, 100],  // Yellow
      [255, 140, 0, 150],   // Orange
      [239, 68, 68, 180]    // Red
    ],
    pickable: false,
  });
}
