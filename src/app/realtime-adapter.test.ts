import { describe, expect, it, vi } from 'vitest';

import { createRealtimeAdapter } from './realtime-adapter.js';

describe('createRealtimeAdapter', () => {
  it('subscribes through the Supabase realtime helper', () => {
    const channel = {
      on: vi.fn(function on() {
        return channel;
      }),
      subscribe: vi.fn(),
      unsubscribe: vi.fn()
    };
    const client = {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn((ch: { unsubscribe: () => void }) => ch.unsubscribe())
    };
    const adapter = createRealtimeAdapter(client);

    const subscription = adapter.subscribeToRoom('room-1', {
      onMessage: vi.fn(),
      onWatchlistChange: vi.fn()
    });

    expect(client.channel).toHaveBeenCalledWith(
      'room:room-1:updates',
      expect.objectContaining({ config: expect.anything() })
    );
    subscription.unsubscribe();
    expect(channel.unsubscribe).toHaveBeenCalledOnce();
  });
});
