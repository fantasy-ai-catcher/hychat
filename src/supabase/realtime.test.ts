import { describe, expect, it, vi } from 'vitest';

import { getRoomUpdatesTopic, subscribeToRoomRealtime } from './realtime.js';

describe('room realtime subscriptions', () => {
  it('builds a stable room updates topic', () => {
    expect(getRoomUpdatesTopic('room-1')).toBe('room:room-1:updates');
  });

  it('subscribes to message inserts and watchlist changes for one room', () => {
    const calls: Array<{ event: string; filter: Record<string, unknown> }> = [];
    const subscribe = vi.fn();
    const unsubscribe = vi.fn();
    const channel = {
      on(event: string, filter: Record<string, unknown>) {
        calls.push({ event, filter });
        return channel;
      },
      subscribe,
      unsubscribe
    };
    const client = {
      channel: vi.fn(() => channel)
    };

    const subscription = subscribeToRoomRealtime(client, {
      roomId: 'room-1',
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    expect(client.channel).toHaveBeenCalledWith('room:room-1:updates');
    expect(calls).toEqual([
      {
        event: 'postgres_changes',
        filter: {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: 'room_id=eq.room-1'
        }
      },
      {
        event: 'postgres_changes',
        filter: {
          event: '*',
          schema: 'public',
          table: 'room_watchlist',
          filter: 'room_id=eq.room-1'
        }
      }
    ]);
    expect(subscribe).toHaveBeenCalledOnce();

    subscription.unsubscribe();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
