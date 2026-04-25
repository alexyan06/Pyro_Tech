'use client';

import { useCallback, useRef, useState, useEffect } from 'react';
import type { AgentName } from '@/lib/types';

interface AudioQueueItem {
  agent: AgentName;
  audioBase64: string;
}

export function useAgentAudio() {
  const [isMuted, setIsMuted] = useState(false);
  const queueRef   = useRef<AudioQueueItem[]>([]);
  const playingRef = useRef(false);
  const mutedRef   = useRef(false);

  useEffect(() => {
    mutedRef.current = isMuted;
  }, [isMuted]);

  const playNextRef = useRef<() => void>(() => {});

  const playNext = useCallback(() => {
    if (playingRef.current || queueRef.current.length === 0) return;
    if (mutedRef.current) {
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
      
      const onEnd = () => {
        URL.revokeObjectURL(url);
        playingRef.current = false;
        playNextRef.current();
      };

      audio.onended = onEnd;
      audio.onerror = onEnd;
      audio.play().catch(onEnd);
    } catch {
      playingRef.current = false;
      playNextRef.current();
    }
  }, []);

  useEffect(() => {
    playNextRef.current = playNext;
  }, [playNext]);

  const enqueue = useCallback((agent: AgentName, audioBase64: string) => {
    if (mutedRef.current) return;
    queueRef.current.push({ agent, audioBase64 });
    playNext();
  }, [playNext]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (next) queueRef.current = []; // clear queue on mute
      return next;
    });
  }, []);

  return { enqueue, isMuted, toggleMute };
}
