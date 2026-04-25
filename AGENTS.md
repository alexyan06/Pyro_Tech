# Repository Guidelines

## Project Structure & Module Organization

Pyrotech is a split JavaScript/TypeScript wildfire simulation app. `backend/` contains the Express and WebSocket server, Gemini-backed response agents in `backend/agents/`, simulation logic in `backend/simulation/`, orchestration in `backend/orchestration/`, API routes in `backend/routes/`, and optional Postgres/Redis adapters in `backend/db/`. `frontend/` is a Next.js app; pages live in `frontend/app/`, reusable UI in `frontend/components/`, hooks in `frontend/hooks/`, and shared types/constants in `frontend/lib/`. Static and generated GeoJSON inputs are stored under `data/geojson/`, with data collection scripts in `data/scripts/`. Follow `frontend/AGENTS.md` before changing Next.js-specific code.

## Build, Test, and Development Commands

Install dependencies separately:

```bash
cd backend && npm install
cd ../frontend && npm install
```

Run the backend with `cd backend && npm run dev` for watch mode, or `npm start` for a normal server on `PORT` or `4000`. Run the frontend with `cd frontend && npm run dev` and open `http://localhost:3000`. Use `cd frontend && npm run build` to verify a production Next.js build, and `cd frontend && npm run lint` for ESLint checks. `backend/package.json` has no working test script yet; do not treat `npm test` there as a verification command.

## Coding Style & Naming Conventions

Backend code uses CommonJS, 2-space indentation, semicolons, and descriptive camelCase names. Keep agent classes and modules focused by domain, for example `evacuationAgent.js` or `trafficModel.js`. Frontend code uses TypeScript React with PascalCase components, camelCase hooks beginning with `use`, and path aliases such as `@/lib/types`. Prefer existing CSS class patterns in `frontend/app/globals.css` over introducing a new styling system.

## Testing Guidelines

There is no committed unit test framework or coverage target. For now, validate changes with `npm run lint` and `npm run build` in `frontend/`, then smoke-test backend flows with `npm run dev`, `GET /api/health`, and a frontend simulation start. When adding tests, place them near the code they cover and use clear names such as `trafficModel.test.js` or `MapView.test.tsx`.

## Commit & Pull Request Guidelines

Recent history mostly uses concise subject lines with prefixes such as `feat:`, `refactor:`, and `docs:`. Continue that pattern in imperative mood, for example `fix: handle missing FIRMS data`. Pull requests should summarize behavior changes, list verification commands, note required environment variables, link issues when available, and include screenshots or short recordings for UI/map changes.

## Security & Configuration Tips

Do not commit secrets. Backend configuration belongs in `backend/.env` (`GEMINI_API_KEY`, optional `ELEVENLABS_API_KEY`, `NASA_FIRMS_API_KEY`, `DATABASE_URL`, `REDIS_URL`). Frontend public configuration belongs in `frontend/.env.local` (`NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_WS_URL`).
