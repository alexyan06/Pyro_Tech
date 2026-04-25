export const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000';
export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

export const LA_CENTER: [number, number] = [-118.52, 34.05];
export const LA_ZOOM = 11;
export const LA_PITCH = 60;
export const LA_BEARING = 0;

export const TICK_DURATION_MS = 30000; // 30 seconds wall clock per sim hour
