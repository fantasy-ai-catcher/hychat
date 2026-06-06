export type ParsedChatInput =
  | { type: 'empty' }
  | { type: 'message'; body: string }
  | { type: 'error'; message: string }
  | LoginCommand
  | SignupCommand
  | LogoutCommand
  | RoomsCommand
  | CreateRoomCommand
  | JoinCommand
  | InviteCommand
  | MembersCommand
  | WatchAddCommand
  | WatchRemoveCommand
  | StockCommand
  | RefreshCommand
  | HelpCommand
  | QuitCommand;

type LoginCommand = { type: 'command'; name: 'login' };
type SignupCommand = { type: 'command'; name: 'signup' };
type LogoutCommand = { type: 'command'; name: 'logout' };
type RoomsCommand = { type: 'command'; name: 'rooms' };
type CreateRoomCommand = { type: 'command'; name: 'create-room'; nameText: string };
type JoinCommand = { type: 'command'; name: 'join'; room: string };
type InviteCommand = { type: 'command'; name: 'invite'; email: string };
type MembersCommand = { type: 'command'; name: 'members' };
type WatchAddCommand = { type: 'command'; name: 'watch-add'; symbol: string };
type WatchRemoveCommand = { type: 'command'; name: 'watch-remove'; symbol: string };
type StockCommand = { type: 'command'; name: 'stock'; symbol: string };
type RefreshCommand = { type: 'command'; name: 'refresh'; symbol?: string };
type HelpCommand = { type: 'command'; name: 'help' };
type QuitCommand = { type: 'command'; name: 'quit' };

export function parseChatInput(input: string): ParsedChatInput {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return { type: 'empty' };
  }

  if (!trimmed.startsWith('/')) {
    return { type: 'message', body: trimmed };
  }

  const [command, ...args] = trimmed.split(/\s+/);

  switch (command) {
    case '/login':
      return { type: 'command', name: 'login' };
    case '/signup':
      return { type: 'command', name: 'signup' };
    case '/logout':
      return { type: 'command', name: 'logout' };
    case '/rooms':
      return { type: 'command', name: 'rooms' };
    case '/members':
      return { type: 'command', name: 'members' };
    case '/help':
      return { type: 'command', name: 'help' };
    case '/quit':
      return { type: 'command', name: 'quit' };
    case '/join':
      return requireArgument(args[0], 'Usage: /join <room>', (room) => ({
        type: 'command',
        name: 'join',
        room
      }));
    case '/create':
      return requireRest(args, 'Usage: /create <room name>', (nameText) => ({
        type: 'command',
        name: 'create-room',
        nameText
      }));
    case '/invite':
      return requireArgument(args[0], 'Usage: /invite <email>', (email) => ({
        type: 'command',
        name: 'invite',
        email
      }));
    case '/watch':
      return parseWatchCommand(args);
    case '/stock':
      return requireArgument(args[0], 'Usage: /stock <symbol>', (symbol) => ({
        type: 'command',
        name: 'stock',
        symbol
      }));
    case '/refresh':
      return args[0]
        ? { type: 'command', name: 'refresh', symbol: args[0] }
        : { type: 'command', name: 'refresh' };
    default:
      return { type: 'error', message: `Unknown command: ${command}` };
  }
}

function requireRest<T extends ParsedChatInput>(
  args: string[],
  message: string,
  build: (value: string) => T
): T | { type: 'error'; message: string } {
  const value = args.join(' ').trim();
  return value ? build(value) : { type: 'error', message };
}

function parseWatchCommand(args: string[]): ParsedChatInput {
  const [action, symbol] = args;

  if (action === 'add') {
    return requireArgument(symbol, 'Usage: /watch add <symbol>', (value) => ({
      type: 'command',
      name: 'watch-add',
      symbol: value
    }));
  }

  if (action === 'remove') {
    return requireArgument(symbol, 'Usage: /watch remove <symbol>', (value) => ({
      type: 'command',
      name: 'watch-remove',
      symbol: value
    }));
  }

  return { type: 'error', message: 'Usage: /watch <add|remove> <symbol>' };
}

function requireArgument<T extends ParsedChatInput>(
  value: string | undefined,
  message: string,
  build: (value: string) => T
): T | { type: 'error'; message: string } {
  return value ? build(value) : { type: 'error', message };
}
