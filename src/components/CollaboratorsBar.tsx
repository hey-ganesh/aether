import React from 'react';

interface CollaboratorsBarProps {
  users: Map<number, any>;
  localClientId?: number;
  onJumpToUser: (worldX: number, worldY: number) => void;
}

export default function CollaboratorsBar({ users, localClientId, onJumpToUser }: CollaboratorsBarProps) {
  // Convert map to array and sort out any clients without 'user' set up
  const activeUsers = Array.from(users.entries()).filter(([id, state]) => state.user);

  return (
    <div className="flex items-center gap-2">
      {activeUsers.map(([clientId, state]) => {
        const isSelf = clientId === localClientId;
        const initial = state.user.name.charAt(0).toUpperCase();

        return (
          <button
            key={clientId}
            onClick={() => {
              if (!isSelf && state.cursor) {
                onJumpToUser(state.cursor.x, state.cursor.y);
              }
            }}
            disabled={isSelf || !state.cursor}
            title={isSelf ? `${state.user.name} (You)` : state.user.name}
            className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-sm transition-transform border border-white/20 dark:border-black/20
              ${!isSelf && state.cursor ? 'hover:scale-110 active:scale-95 cursor-pointer ring-2 ring-white/50' : 'opacity-80 cursor-default'}
            `}
            style={{ backgroundColor: state.user.color }}
          >
            {initial}
          </button>
        );
      })}
    </div>
  );
}
