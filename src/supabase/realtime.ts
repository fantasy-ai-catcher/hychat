export function getRoomMessagesTopic(roomId: string): string {
  return `room:${roomId}:messages`;
}

export function getRoomPresenceTopic(roomId: string): string {
  return `room:${roomId}:presence`;
}

export function getRoomQuotesTopic(roomId: string): string {
  return `room:${roomId}:quotes`;
}
