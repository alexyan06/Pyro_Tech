'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { WS_URL } from '@/lib/constants';
import type {
  AgentName,
  MapEventData,
  PlaybookData,
  ScenarioInput,
  ServerMessage,
  StateSnapshot,
  TripWaypoint,
} from '@/lib/types';

export interface BranchAgentMessage {
  agent: AgentName;
  text: string;
  tick: number;
}

interface UseSimulationOptions {
  onMapEvent?: (event: MapEventData, agent?: AgentName, uiMessage?: string) => void;
  onAgentAudio?: (agent: AgentName, audioBase64: string, tick: number) => void;
  onStateSnapshot?: (snap: StateSnapshot) => void;
  onSimulationReady?: () => void;
  onParticleUpdate?: (particles: [number, number][], trips?: TripWaypoint[]) => void;
}

interface SimClockBase {
  simMs: number;
  receivedAt: number;
  rate: number;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DEFAULT_SIM_CLOCK_RATE = 60;

function formatSimDate(simDate: Date): string {
  const hh = String(simDate.getUTCHours()).padStart(2, '0');
  const mm = String(simDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(simDate.getUTCSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss} ${MONTHS[simDate.getUTCMonth()]} ${simDate.getUTCDate()}, ${simDate.getUTCFullYear()}`;
}

// ScenarioInput is imported from @/lib/types — no local options interface needed.

export function useSimulation(options: UseSimulationOptions = {}) {
  const [isConnected, setIsConnected]   = useState(false);
  const [isRunning, setIsRunning]       = useState(false);
  const [isPaused, setIsPaused]         = useState(false);
  const [agentMessages, setAgentMessages] = useState<Map<AgentName, string[]>>(new Map());
  // Flat chronological list for in-order rendering
  const [timeline, setTimeline]         = useState<Array<{ agent: AgentName; text: string }>>([]);
  const [currentAgent, setCurrentAgent] = useState<AgentName | null>(null);
  const [currentText, setCurrentText]   = useState('');
  const [currentSnapshot, setCurrentSnapshot] = useState<StateSnapshot | null>(null);
  const [snapshots, setSnapshots]       = useState<StateSnapshot[]>([]);
  const [playbook, setPlaybook]         = useState<PlaybookData | null>(null);
  const [simTick, setSimTick]           = useState<number>(0);
  const [simTimeString, setSimTimeString] = useState<string>('');
  const [agentConfidence, setAgentConfidence] = useState<Partial<Record<AgentName, number>>>({});

  const [branchId, setBranchId]         = useState<string | null>(null);
  const [branchRunning, setBranchRunning] = useState(false);
  const [branchModifier, setBranchModifier] = useState<string>('');
  const [branchMessages, setBranchMessages] = useState<BranchAgentMessage[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamBufferRef = useRef<Map<AgentName, string>>(new Map());
  const branchBufferRef = useRef<Map<string, string>>(new Map()); // key: `${branchId}:${agent}`
  const onMapEventRef   = useRef(options.onMapEvent);
  const onAgentAudioRef = useRef(options.onAgentAudio);
  const onStateSnapshotRef = useRef(options.onStateSnapshot);
  const onSimulationReadyRef = useRef(options.onSimulationReady);
  const onParticleUpdateRef = useRef(options.onParticleUpdate);
  const simClockBaseRef = useRef<SimClockBase | null>(null);

  useEffect(() => {
    onMapEventRef.current   = options.onMapEvent;
    onAgentAudioRef.current = options.onAgentAudio;
    onStateSnapshotRef.current = options.onStateSnapshot;
    onSimulationReadyRef.current = options.onSimulationReady;
    onParticleUpdateRef.current = options.onParticleUpdate;
  }, [options.onMapEvent, options.onAgentAudio, options.onStateSnapshot, options.onSimulationReady, options.onParticleUpdate]);

  /** Extract agent_confidence score from a completed agent message */
  function extractConfidence(text: string): number | null {
    // Match "score": NUMBER anywhere near "agent_confidence"
    const idx = text.indexOf('"agent_confidence"');
    if (idx === -1) return null;
    const snippet = text.slice(idx, idx + 200);
    const m = snippet.match(/"score"\s*:\s*(\d+)/);
    return m ? Math.min(100, Math.max(0, parseInt(m[1], 10))) : null;
  }

  const updateSimClockBase = useCallback((simTime: string) => {
    const simDate = new Date(simTime);
    const simMs = simDate.getTime();
    if (!Number.isFinite(simMs)) return;

    const now = Date.now();
    const previous = simClockBaseRef.current;
    let rate = previous?.rate ?? DEFAULT_SIM_CLOCK_RATE;
    if (previous) {
      const realDelta = now - previous.receivedAt;
      const simDelta = simMs - previous.simMs;
      if (realDelta > 100 && simDelta > 0) {
        rate = Math.min(240, Math.max(1, simDelta / realDelta));
      }
    }

    simClockBaseRef.current = { simMs, receivedAt: now, rate };
    setSimTimeString(formatSimDate(simDate));
  }, []);

  useEffect(() => {
    if (!isRunning || isPaused) return;

    const interval = window.setInterval(() => {
      const base = simClockBaseRef.current;
      if (!base) return;
      const interpolatedMs = base.simMs + (Date.now() - base.receivedAt) * base.rate;
      const formatted = formatSimDate(new Date(interpolatedMs));
      setSimTimeString(prev => prev === formatted ? prev : formatted);
    }, 250);

    return () => window.clearInterval(interval);
  }, [isRunning, isPaused]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen  = () => { setIsConnected(true); };
    ws.onclose = () => { setIsConnected(false); setIsRunning(false); wsRef.current = null; };
    ws.onerror = () => { console.error('WebSocket error'); };

    ws.onmessage = (event) => {
      let msg: ServerMessage & { type: string; payload: Record<string, unknown> };
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.error('Failed to parse message:', event.data);
        return;
      }

      switch (msg.type) {
        case 'agent_text': {
          const { agent, text, is_complete } = msg.payload as { agent: AgentName; text: string; is_complete: boolean };
          setCurrentAgent(agent);

          const current = streamBufferRef.current.get(agent) || '';
          const updated = current + text;
          streamBufferRef.current.set(agent, updated);
          setCurrentText(updated);

          if (is_complete) {
            // Extract confidence score from completed message
            const confidence = extractConfidence(updated);
            if (confidence !== null) {
              setAgentConfidence(prev => ({ ...prev, [agent]: confidence }));
            }

            setAgentMessages((prev) => {
              const next = new Map(prev);
              const existing = next.get(agent) || [];
              next.set(agent, [...existing, updated]);
              return next;
            });
            // Append to flat chronological timeline
            setTimeline(prev => [...prev, { agent, text: updated }]);
            streamBufferRef.current.set(agent, '');
            setCurrentText('');
            setCurrentAgent(null);
          }
          break;
        }

        case 'map_event': {
          const payload = msg.payload as { event: MapEventData & { ui_message?: string }; agent?: AgentName };
          onMapEventRef.current?.(payload.event, payload.agent, payload.event.ui_message);
          break;
        }

        case 'state_snapshot': {
          const snap = msg as unknown as StateSnapshot;
          setCurrentSnapshot(snap);
          setSnapshots(prev => {
            // Keep snapshots in tick order, replace if same tick
            const existing = prev.filter(s => s.payload.tick !== snap.payload.tick);
            return [...existing, snap].sort((a, b) => a.payload.tick - b.payload.tick);
          });
          setSimTick(Math.floor(snap.payload.elapsed_hours ?? snap.payload.tick));
          updateSimClockBase(snap.payload.sim_time);
          onStateSnapshotRef.current?.(snap);
          break;
        }

        case 'simulation_ready':
          onSimulationReadyRef.current?.();
          break;

        case 'playbook_ready':
          setPlaybook((msg.payload as { playbook_json: PlaybookData }).playbook_json);
          setIsRunning(false);
          break;

        case 'agent_audio': {
          const { agent, audio_base64, tick } = msg.payload as { agent: AgentName; audio_base64: string; tick: number };
          onAgentAudioRef.current?.(agent, audio_base64, tick);
          break;
        }

        case 'branch_start': {
          const { branch_id, modifier } = msg.payload as { branch_id: string; modifier: string };
          setBranchId(branch_id);
          setBranchModifier(modifier);
          setBranchRunning(true);
          setBranchMessages([]);
          branchBufferRef.current = new Map();
          break;
        }

        case 'branch_agent_text': {
          const { branch_id, agent, text, is_complete, tick } = msg.payload as {
            branch_id: string; agent: AgentName; text: string; is_complete: boolean; tick: number;
          };
          const key = `${branch_id}:${agent}:${tick}`;
          const current = branchBufferRef.current.get(key) || '';
          const updated = current + text;
          branchBufferRef.current.set(key, updated);

          if (is_complete && updated.trim()) {
            setBranchMessages(prev => [...prev, { agent, text: updated, tick }]);
            branchBufferRef.current.delete(key);
          }
          break;
        }

        case 'branch_complete': {
          setBranchRunning(false);
          break;
        }

        case 'time_update': {
          const { sim_time, elapsed_hours } = msg.payload as { sim_time: string; elapsed_hours: number };
          updateSimClockBase(sim_time);
          setSimTick(Math.floor(elapsed_hours));
          break;
        }

        case 'particle_update': {
          const { particles, trips } = msg.payload as { particles: [number, number][]; trips?: TripWaypoint[] };
          onParticleUpdateRef.current?.(particles, trips);
          break;
        }

        case 'error':
          console.error('Server error:', (msg.payload as { message: string }).message);
          break;
      }
    };
  }, [updateSimClockBase]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const send = useCallback((data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const startSimulation = useCallback(
    (input: ScenarioInput) => {
      setAgentMessages(new Map());
      setTimeline([]);
      setCurrentAgent(null);
      setCurrentText('');
      setCurrentSnapshot(null);
      setSnapshots([]);
      setPlaybook(null);
      setSimTick(0);
      setSimTimeString('');
      setAgentConfidence({});
      streamBufferRef.current = new Map();
      simClockBaseRef.current = null;

      send({
        type: 'start_simulation',
        payload: {
          location:      input.location,
          bbox:          input.bbox,
          timestamp:     input.timestamp,
          fireOrigin:    input.fireOrigin,
          metrics:       input.metrics,
          initialAcres:  input.initialAcres ?? 10,
          historical_mode: input.historical_mode ?? false,
          durationHours: input.durationHours ?? 6,
          enableTts:     input.enableTts ?? false,
        },
      });
      setIsRunning(true);
    },
    [send],
  );

  const pause = useCallback(() => {
    setIsPaused(true);
    send({ type: 'control', payload: { action: 'pause' } });
  }, [send]);
  const resume = useCallback(() => {
    setIsPaused(false);
    send({ type: 'control', payload: { action: 'resume' } });
  }, [send]);
  const stop    = useCallback(() => { send({ type: 'control', payload: { action: 'stop' } }); setIsRunning(false); }, [send]);
  const requestPlaybook = useCallback(() => send({ type: 'request_playbook', payload: {} }), [send]);

  const startBranch = useCallback(
    (scenarioModifier: string) => {
      if (!scenarioModifier.trim()) return;
      send({ type: 'start_branch', payload: { scenario_modifier: scenarioModifier } });
    },
    [send],
  );

  const clearBranch = useCallback(() => {
    setBranchId(null);
    setBranchRunning(false);
    setBranchModifier('');
    setBranchMessages([]);
    branchBufferRef.current = new Map();
  }, []);

  const sendAudioDone = useCallback((agent: AgentName, tick: number) => {
    send({ type: 'audio_done', payload: { agent, tick } });
  }, [send]);

  // Stop simulation and close WS when the dashboard unmounts (navigation away, browser back).
  useEffect(() => {
    return () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'control', payload: { action: 'stop' } }));
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    isConnected, isRunning,
    agentMessages, timeline, currentAgent, currentText,
    currentSnapshot, snapshots,
    playbook, simTick, simTimeString,
    agentConfidence,
    branchId, branchRunning, branchModifier, branchMessages,
    connect, disconnect, startSimulation,
    pause, resume, stop, isPaused, requestPlaybook,
    startBranch, clearBranch,
    sendAudioDone,
  };
}
