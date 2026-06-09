import { describe, expect, it } from 'vitest';

import {
  createMessageRepository,
  createRoomRepository,
  createWatchlistRepository
} from './repositories.js';
import { getRoomMessagesTopic, getRoomPresenceTopic, getRoomQuotesTopic } from './realtime.js';

type RecordedCall = {
  method: string;
  args: unknown[];
};

class RecordingQuery {
  constructor(private readonly calls: RecordedCall[]) {}

  select(...args: unknown[]) {
    this.calls.push({ method: 'select', args });
    return this;
  }

  insert(...args: unknown[]) {
    this.calls.push({ method: 'insert', args });
    return this;
  }

  delete(...args: unknown[]) {
    this.calls.push({ method: 'delete', args });
    return this;
  }

  eq(...args: unknown[]) {
    this.calls.push({ method: 'eq', args });
    return this;
  }

  order(...args: unknown[]) {
    this.calls.push({ method: 'order', args });
    return this;
  }

  limit(...args: unknown[]) {
    this.calls.push({ method: 'limit', args });
    return this;
  }
}

function createRecordingClient() {
  const calls: RecordedCall[] = [];
  return {
    calls,
    client: {
      from(table: string) {
        calls.push({ method: 'from', args: [table] });
        return new RecordingQuery(calls);
      }
    }
  };
}

describe('room repository', () => {
  it('builds a rooms query ordered by creation time', () => {
    const { client, calls } = createRecordingClient();
    createRoomRepository(client).listRooms();

    expect(calls).toEqual([
      { method: 'from', args: ['rooms'] },
      { method: 'select', args: ['id,name,owner_id,created_at,updated_at'] },
      { method: 'order', args: ['created_at', { ascending: false }] }
    ]);
  });
});

describe('message repository', () => {
  it('builds recent message queries for a room', () => {
    const { client, calls } = createRecordingClient();
    createMessageRepository(client).listRecentMessages('room-1', 25);

    expect(calls).toEqual([
      { method: 'from', args: ['messages'] },
      {
        method: 'select',
        args: ['id,room_id,sender_id,sender_display_name,kind,body,metadata,created_at']
      },
      { method: 'eq', args: ['room_id', 'room-1'] },
      { method: 'order', args: ['created_at', { ascending: false }] },
      { method: 'limit', args: [25] }
    ]);
  });

  it('builds message inserts as the current sender', () => {
    const { client, calls } = createRecordingClient();
    createMessageRepository(client).sendTextMessage({
      roomId: 'room-1',
      senderId: 'user-1',
      body: 'hello'
    });

    expect(calls).toEqual([
      { method: 'from', args: ['messages'] },
      {
        method: 'insert',
        args: [
          {
            room_id: 'room-1',
            sender_id: 'user-1',
            kind: 'text',
            body: 'hello',
            metadata: {}
          }
        ]
      }
    ]);
  });
});

describe('watchlist repository', () => {
  it('builds watchlist add and remove queries', () => {
    const { client, calls } = createRecordingClient();
    const repo = createWatchlistRepository(client);

    repo.addSymbol({ roomId: 'room-1', symbol: 'AAPL.US', addedBy: 'user-1' });
    repo.removeSymbol({ roomId: 'room-1', symbol: 'AAPL.US' });

    expect(calls).toEqual([
      { method: 'from', args: ['room_watchlist'] },
      {
        method: 'insert',
        args: [
          {
            room_id: 'room-1',
            canonical_symbol: 'AAPL.US',
            added_by: 'user-1'
          }
        ]
      },
      { method: 'from', args: ['room_watchlist'] },
      { method: 'delete', args: [] },
      { method: 'eq', args: ['room_id', 'room-1'] },
      { method: 'eq', args: ['canonical_symbol', 'AAPL.US'] }
    ]);
  });
});

describe('Realtime topics', () => {
  it('uses stable room-scoped topic names', () => {
    expect(getRoomMessagesTopic('room-1')).toBe('room:room-1:messages');
    expect(getRoomPresenceTopic('room-1')).toBe('room:room-1:presence');
    expect(getRoomQuotesTopic('room-1')).toBe('room:room-1:quotes');
  });
});
