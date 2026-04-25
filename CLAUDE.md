# Ember — AI Wildfire Incident Command Simulation

Ember is a real-time incident command platform that simulates wildfire response using a multi-agent orchestration layer powered by Google Gemini.

## Technical Architecture

### Simulation Loop (`backend/orchestration/turnSequencer.js`)
- **Physics Tick**: Every 500ms. Updates fire perimeter, particle positions, and congestion.
- **Agent Cycle**: Every 30 minutes of logical incident time. Advances the simulation state and drives agent decision-making.
- **Sequential Agents**: Seven specialized agents: Disaster, Evacuation, Resource, Infrastructure, Communications, Synthesis, and Congestion.
- **Agent Output**: Agents stream radio-style prose and structured JSON map events.
- **State Management**: `StateManager` maintains the canonical event store and supports spatial suppression and branching.

### Agent System (`backend/agents/`)
- `DisasterAgent`: Predicts fire spread and threat zones.
- `EvacuationAgent`: Manages road closures and zone statuses.
- `ResourceAgent`: Deploys personnel and equipment (requires [lng, lat] coordinates).
- `InfrastructureAgent`: Monitors power, water, and hospitals.
- `CommunicationsAgent`: Generates public alerts.
- `CongestionAgent`: Monitors and manages evacuation traffic flow.
- `SynthesisAgent`: Resolves conflicts and builds the Incident Action Plan (IAP).

### Key Workflows
- **Setup**: `app/page.tsx` (SetupPage) → Nominatim Geocoding → Overpass API Fetch → Dashboard.
- **Continuous Simulation**: Physics loop runs independently of agent cycles to provide smooth visual updates.
- **Branching**: "What-If" scenarios fork the state to explore alternative outcomes (e.g., wind shifts).

## Commands

### Backend (`/backend`)
- `npm start`: Runs the server at port 4000.
- `npm run dev`: Runs the server with `--watch`.

### Frontend (`/frontend`)
- `npm run dev`: Starts Next.js 16 at `http://localhost:3000`.
- `npm run build`: Production build.
- `npm run lint`: ESLint check.
