CREATE TABLE IF NOT EXISTS simulations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_text TEXT NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL DEFAULT -118.52,
    center_lat DOUBLE PRECISION NOT NULL DEFAULT 34.05,
    status VARCHAR(20) DEFAULT 'running',
    current_tick INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_messages (
    id SERIAL PRIMARY KEY,
    simulation_id UUID REFERENCES simulations(id),
    tick INTEGER NOT NULL,
    agent VARCHAR(30) NOT NULL,
    message_text TEXT NOT NULL,
    map_events JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS simulation_snapshots (
    id SERIAL PRIMARY KEY,
    simulation_id UUID REFERENCES simulations(id),
    tick INTEGER NOT NULL,
    state_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(simulation_id, tick)
);

CREATE TABLE IF NOT EXISTS playbooks (
    id SERIAL PRIMARY KEY,
    simulation_id UUID REFERENCES simulations(id) UNIQUE,
    title TEXT NOT NULL,
    sections JSONB NOT NULL,
    summary TEXT,
    generated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_sim ON agent_messages(simulation_id, tick);
CREATE INDEX IF NOT EXISTS idx_snapshots_sim ON simulation_snapshots(simulation_id, tick);
