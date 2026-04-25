# PyroTech — AI Wildfire Incident Command Simulation

PyroTech is a real-time incident command platform that simulates wildfire response using a multi-agent orchestration layer powered by Google Gemini. It combines physics-based fire modeling with real-world geospatial data to provide a 3D decision-support dashboard.

## Project Overview

- **Purpose**: Real-time simulation and tactical recommendation for wildfire disasters.
- **Main Technologies**: 
  - **Frontend**: Next.js 16 (React 19, TypeScript, Tailwind CSS).
  - **Backend**: Node.js/Express 5, WebSocket (`ws`).
  - **AI**: Google Gemini 2.5 Flash (via `@google/genai`).
  - **Visualization**: Mapbox GL v3, deck.gl v9.
  - **Data**: PostgreSQL, Redis (optional), NASA FIRMS, OpenStreetMap (Overpass API).

## Technical Architecture

### Simulation Loop (`backend/orchestration/turnSequencer.js`)
- **Tick Logic**: Each simulation tick (~10s real time) represents 1 hour of incident time.
- **Sequential Agents**: Six specialized agents run in order: Disaster, Evacuation, Resource, Infrastructure, Communications, and Synthesis.
- **Agent Output**: Agents stream radio-style prose and structured JSON map events inside triple-backtick fences.
- **Conflict Detection**: Cross-agent contradictions are flagged after each turn.
- **State Management**: `StateManager` maintains the canonical event store and supports "What-If" branching.

### Agent System (`backend/agents/`)
- **BaseAgent**: A wrapper for Gemini streaming with a simulated fallback for demo modes.
- **Specialized Roles**:
  - `DisasterAgent`: Predicts fire spread and threat zones.
  - `EvacuationAgent`: Manages road closures and zone statuses.
  - `ResourceAgent`: Deploys personnel and equipment.
  - `InfrastructureAgent`: Monitors power, water, and hospitals.
  - `CommunicationsAgent`: Generates public alerts.
  - `SynthesisAgent`: Resolves conflicts and builds the Incident Action Plan (IAP).

### Frontend Architecture (`frontend/hooks/`)
- `useSimulation.ts`: The primary WebSocket client and source of truth for the simulation state, timeline, and branching.
- `useMapState.ts`: A reducer-based store for all deck.gl layer data (polygons, arcs, icons).
- `MapView.tsx`: Renders the 3D Mapbox terrain with overlay layers.

## Commands

### Backend (`/backend`)
- `npm start`: Runs the server at port 4000.
- `npm run dev`: Runs the server with `--watch` mode.

### Frontend (`/frontend`)
- `npm run dev`: Starts the Next.js development server at `http://localhost:3000`.
- `npm run build`: Creates a production build.
- `npm run lint`: Runs ESLint.

## Development Conventions

- **Agent Responses**: When modifying agent prompts, ensure they remain in "radio character" (short, urgent prose) and strictly follow the JSON event schema.
- **Map Events**: New event types must be added to `frontend/lib/types.ts` and handled in `frontend/lib/mapEvents.ts`.
- **State Integrity**: All simulation state changes should flow through the backend `StateManager` to ensure replayability and branching consistency.
- **Visuals**: Prefer Vanilla CSS or Tailwind utility classes. Maintain the dark "war-room" aesthetic defined in `globals.css`.

## Environment Variables

### Backend (`backend/.env`)
- `GEMINI_API_KEY`: Required for live AI orchestration.
- `ELEVENLABS_API_KEY`: Optional; enables agent voice synthesis.
- `NASA_FIRMS_API_KEY`: Optional; enables live fire pixel detection.
- `DATABASE_URL` / `REDIS_URL`: Optional; system falls back to in-memory state if absent.

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_MAPBOX_TOKEN`: Required for map rendering.
- `NEXT_PUBLIC_WS_URL`: WebSocket endpoint (defaults to `ws://localhost:4000`).
