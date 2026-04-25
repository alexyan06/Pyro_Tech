import { AgentName, AGENT_CONFIG } from '@/lib/types';
import { memo } from 'react';

export interface MapNotification {
  id: string;
  message: string;
  agent?: AgentName;
}

export const MapNotifications = memo(function MapNotifications({
  notifications
}: {
  notifications: MapNotification[];
}) {
  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-4 top-16 z-50 flex flex-col gap-2">
      {notifications.map((n) => {
        const config = n.agent ? AGENT_CONFIG[n.agent] : null;
        return (
          <div
            key={n.id}
            className="flex items-center gap-2 rounded-md border px-3 py-2 shadow-lg backdrop-blur-sm transition-all animate-in fade-in slide-in-from-left-4"
            style={{
              background: 'rgba(10, 10, 20, 0.85)',
              borderColor: config ? config.color + '40' : 'rgba(255,255,255,0.1)',
            }}
          >
            {config && (
              <span className="text-sm">{config.emoji}</span>
            )}
            <span className="text-xs font-medium text-gray-200">
              {n.message}
            </span>
          </div>
        );
      })}
    </div>
  );
});
