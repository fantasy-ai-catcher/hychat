import { subscribeToRoomRealtime } from '../supabase/realtime.js';

type RealtimeClient = Parameters<typeof subscribeToRoomRealtime>[0];
type RoomRealtimeOptions = Omit<Parameters<typeof subscribeToRoomRealtime>[1], 'roomId'>;

export function createRealtimeAdapter(client: RealtimeClient) {
  return {
    subscribeToRoom(roomId: string, handlers: RoomRealtimeOptions) {
      return subscribeToRoomRealtime(client, { roomId, ...handlers });
    }
  };
}
