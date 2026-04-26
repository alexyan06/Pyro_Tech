'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import type { AgentName } from '@/lib/types';

interface AudioQueueItem {
  agent: AgentName;
  audioBase64: string;
  tick: number;
}

interface UseAgentAudioOptions {
  ttsMode?: boolean;
  onPlaybackEnd?: (agent: AgentName, tick: number) => void;
}

export function useAgentAudio({ ttsMode = false, onPlaybackEnd }: UseAgentAudioOptions = {}) {
  const [isMuted, setIsMuted] = useState(false);
  const queueRef         = useRef<AudioQueueItem[]>([]);
  const playingRef       = useRef(false);
  const mutedRef         = useRef(false);
  const ttsModeRef       = useRef(ttsMode);
  const onPlaybackEndRef = useRef(onPlaybackEnd);
  const currentAudioRef  = useRef<HTMLAudioElement | null>(null);

  useEffect(() => { mutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { ttsModeRef.current = ttsMode; }, [ttsMode]);
  useEffect(() => { onPlaybackEndRef.current = onPlaybackEnd; }, [onPlaybackEnd]);

  const playNextRef = useRef<() => void>(() => {});

  const stopAll = useCallback(() => {
    queueRef.current = [];
    playingRef.current = false;
    if (currentAudioRef.current) {
      currentAudioRef.current.onended = null;
      currentAudioRef.current.onerror = null;
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
  }, []);

  // Stop audio on unmount (navigation away, component teardown).
  useEffect(() => () => { stopAll(); }, [stopAll]);

  const playNext = useCallback(() => {
    if (playingRef.current || queueRef.current.length === 0) return;

    // Non-TTS mute: drop queue, don't ack (backend isn't gating on us)
    if (mutedRef.current && !ttsModeRef.current) {
      queueRef.current = [];
      return;
    }

    const item = queueRef.current.shift()!;
    playingRef.current = true;

    try {
      const binary = atob(item.audioBase64);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'audio/mpeg' });
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;

      // TTS mode + muted: play silently so onended fires after the natural duration,
      // keeping the backend gate in sync.
      if (mutedRef.current && ttsModeRef.current) {
        audio.muted = true;
      }

      const onEnd = () => {
        URL.revokeObjectURL(url);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        playingRef.current = false;
        onPlaybackEndRef.current?.(item.agent, item.tick);
        playNextRef.current();
      };

      audio.onended = onEnd;
      audio.onerror = onEnd;
      audio.play().catch(onEnd);
    } catch {
      currentAudioRef.current = null;
      playingRef.current = false;
      onPlaybackEndRef.current?.(item.agent, item.tick);
      playNextRef.current();
    }
  }, []);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const enqueue = useCallback((agent: AgentName, audioBase64: string, tick: number = 0) => {
    // Non-TTS mute: silently discard (no backend waiting for ack)
    if (mutedRef.current && !ttsModeRef.current) return;
    queueRef.current.push({ agent, audioBase64, tick });
    playNext();
  }, [playNext]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      // Only clear queue when muting in non-TTS mode; in TTS mode the backend
      // is waiting for the ack so we must still play through (silently).
      if (next && !ttsModeRef.current) queueRef.current = [];
      return next;
    });
  }, []);

  return { enqueue, isMuted, toggleMute, stopAll };
}
