# Ember — AI Wildfire Incident Command Simulation

Ember is a real-time incident command platform that simulates wildfire response using a multi-agent orchestration layer powered by Google Gemini. It combines physics-based fire modeling with real-world geospatial data to provide a 3D decision-support dashboard.

## Overview

- **Purpose**: Real-time simulation and tactical recommendation for wildfire disasters.
- **Key Features**:
  - **Physics-Informed Fire Spread**: Vector-based growth engine modified by wind, weather, and localized suppression.
  - **Dynamic Traffic & Evacuation**: Real-time congestion modeling that reacts to fire proximity and route closures.
  - **Multi-Agent Orchestration**: Seven specialized LLM agents (Disaster, Evac, Resource, Infra, Comms, Congestion, Synthesis) coordinate a response over a virtual radio net.
  - **What-If Branching**: Fork the simulation at any point to explore alternative tactical outcomes.
  - **Live Geospatial Data**: Fetches infrastructure and population data on-the-fly via OSM Overpass and NASA FIRMS.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, Mapbox GL v3, deck.gl v9.
- **Backend**: Node.js 20, Express 5, WebSocket (ws), Google Gemini 1.5 Flash.
- **Data**: OpenStreetMap (Overpass), Census Bureau (Population), NASA (FIRMS).

## Getting Started

### Prerequisites
- Node.js 20+
- Google Gemini API Key
- Mapbox Public Token

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   # Backend
   cd backend && npm install
   # Frontend
   cd ../frontend && npm install
   ```
3. Set up environment variables (see `.env.example` in each folder).

### Running the App
1. Start the backend: `cd backend && npm start`
2. Start the frontend: `cd frontend && npm run dev`
3. Navigate to `http://localhost:3000`.

## Simulation Architecture

The simulation runs on a dual-loop system:
1. **Physics Loop (500ms)**: Updates continuous visual states like the fire perimeter, evacuation vehicle positions (particles), and real-time route congestion.
2. **Agent Cycle (30 logical min)**: Triggers the LLM agents to analyze the situation, resolve conflicts, and issue new tactical orders.

## Data Structure

Ember uses a "merged geospatial state" model:
- **Pre-seeded data**: Baseline infrastructure for Los Angeles (Palisades area).
- **Dynamic data**: Fetched for the specific bounding box of any city worldwide during the Setup phase.
- **Spatial Intersections**: All infrastructure damage and route closures are calculated using real-time polygon intersections (`turf.js`).
