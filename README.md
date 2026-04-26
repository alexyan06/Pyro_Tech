# PyroTech — AI Wildfire Incident Command Simulation

PyroTech is a real-time incident command platform that simulates wildfire response using a multi-agent orchestration layer powered by Google Gemini. It combines physics-based fire modeling with real-world geospatial data to provide a 3D decision-support dashboard.

## Overview

- **Purpose**: Real-time simulation and tactical recommendation for wildfire disasters.
- **Key Features**:
  - **Physics-Informed Fire Spread**: Vector-based elliptical growth engine driven by wind, humidity, and temperature, with distinct head/flank/back fire sectors.
  - **Hard-Stop Dozer Barriers**: Dozer firebreaks act as true containment lines integrated directly into the perimeter calculation, not post-hoc subtraction.
  - **Automatic Suppression Prestaging**: Resource deployments automatically generate suppression zones ahead of the predicted fire path.
  - **Dynamic Traffic & Evacuation**: Real-time congestion modeling that reacts to fire proximity and auto-closes routes intersecting the perimeter.
  - **Multi-Agent Orchestration**: Eight specialized LLM agents (Disaster, Evacuation, Resource, Infrastructure, Communications, Congestion, Synthesis) coordinate response over a virtual radio net with conflict detection.
  - **What-If Branching**: Fork the simulation at any tick to explore alternative tactical outcomes (e.g., wind shifts).
  - **Live Geospatial Data**: Fetches infrastructure, roads, and population on-the-fly via OSM Overpass, NASA FIRMS, and Census Bureau.
  - **Voice Radio Net**: Optional ElevenLabs TTS for radio-style agent transmissions.

## Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS v4, Mapbox GL v3, deck.gl v9.
- **Backend**: Node.js 20, Express 5, WebSocket (ws), Google Gemini (`@google/genai`), Postgres, Redis (ioredis), pdfmake.
- **Geospatial**: Turf.js for polygon intersections and spatial operations.
- **Data Sources**: OpenStreetMap (Overpass API), NASA FIRMS (live fire detection), Census Bureau (population density).

## Getting Started

### Prerequisites
- Node.js 20+
- Google Gemini API Key
- Mapbox Public Token
- (Optional) ElevenLabs API Key for voice synthesis

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
1. Start the backend: `cd backend && npm start` (runs on port 4000)
2. Start the frontend: `cd frontend && npm run dev`
3. Navigate to `http://localhost:3000`.

## Simulation Architecture

The simulation runs on a dual-loop system:
1. **Physics Loop (500ms)**: Updates continuous visual states — fire perimeter growth, evacuation vehicle particles, route congestion, and suppression geometry.
2. **Agent Cycle (~30 logical min)**: Triggers the LLM agents sequentially to analyze the situation, resolve conflicts via the Synthesis agent, and issue new tactical orders as structured map events.

### Agent System (`backend/agents/`)
- `DisasterAgent` — Predicts fire spread and threat zones.
- `EvacuationAgent` — Manages road closures, shelters, and zone statuses.
- `ResourceAgent` — Deploys engines and dozers with `[lng, lat]` coordinates.
- `InfrastructureAgent` — Monitors power, water, and hospitals.
- `CommunicationsAgent` — Generates public alerts.
- `CongestionAgent` — Monitors and manages evacuation traffic flow.
- `SynthesisAgent` — Resolves agent conflicts and builds the Incident Action Plan.

### Physics Engine (`backend/simulation/`)
- `wildfireEngine.js` — Elliptical perimeter growth with wind/weather inputs.
- `suppressionProbe.js` — Dozer barrier and engine sector suppression geometry.
- `resourceModel.js` — Tracks assigned resources and computes their suppression effects.
- `trafficModel.js` — Dynamic route congestion and fire-driven closures.
- `particleEngine.js` — Ambient evacuation vehicles on the OSM road graph.
- `stateManager.js` — Canonical event log supporting branching and replay.

## Data Structure

PyroTech uses a "merged geospatial state" model:
- **Pre-seeded data**: Baseline infrastructure for Los Angeles (Palisades area).
- **Dynamic data**: Fetched on-demand for the bounding box of any city worldwide during the Setup phase.
- **Spatial Intersections**: Infrastructure damage, route closures, and suppression effects calculated via real-time polygon intersections (`turf.js`).

## Screenshots & Demo

<!-- Add images and demo media below -->

### Setup & Scenario Configuration
<img width="242" height="161" alt="image" src="https://github.com/user-attachments/assets/cebd70aa-21f1-4b0a-a3b3-2eb6d061bdf0" />


### Live Incident Dashboard
<img width="242" height="161" alt="image" src="https://github.com/user-attachments/assets/a7c3ffb5-c8bb-4f9a-9725-2a929c5f1418" />

### Playbook Interactions
<img width="242" height="161" alt="image" src="https://github.com/user-attachments/assets/ad5ab5f3-7080-4650-804a-1b1759c35f96" />
<img width="242" height="161" alt="image" src="https://github.com/user-attachments/assets/e8211f06-9b5e-4132-9890-24a8990d35e7" />

