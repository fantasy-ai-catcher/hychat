export type ParsedChatInput =
  | { type: 'empty' }
  | { type: 'message'; body: string }
  | { type: 'error'; message: string }
  | StartCommand
  | LogoutCommand
  | RoomsCommand
  | CreateRoomCommand
  | JoinCommand
  | InviteCommand
  | InviteCodeCommand
  | MembersCommand
  | WatchAddCommand
  | WatchRemoveCommand
  | StockCommand
  | RefreshCommand
  | ColorShowCommand
  | ColorListCommand
  | ColorSetCommand
  | HelpCommand
  | QuitCommand;

type StartCommand = {
  type: 'command';
  name: 'start';
  displayName?: string;
  inviteCode?: string;
};
type LogoutCommand = { type: 'command'; name: 'logout' };
type RoomsCommand = { type: 'command'; name: 'rooms' };
type CreateRoomCommand = { type: 'command'; name: 'create-room'; nameText: string };
type JoinCommand = { type: 'command'; name: 'join'; room: string };
type InviteCommand = { type: 'command'; name: 'invite'; displayName: string };
type InviteCodeCommand = { type: 'command'; name: 'invite-code' };
type MembersCommand = { type: 'command'; name: 'members' };
type WatchAddCommand = { type: 'command'; name: 'watch-add'; symbol: string };
type WatchRemoveCommand = { type: 'command'; name: 'watch-remove'; symbol: string };
type StockCommand = { type: 'command'; name: 'stock'; symbol: string };
type RefreshCommand = { type: 'command'; name: 'refresh'; symbol?: string };
type ColorShowCommand = { type: 'command'; name: 'color-show' };
type ColorListCommand = { type: 'command'; name: 'color-list' };
type ColorSetCommand = { type: 'command'; name: 'color-set'; color: string };
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
    case '/start':
      return parseStartCommand(args);
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
    case '/invite-code':
      return { type: 'command', name: 'invite-code' };
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
      return requireArgument(args[0], 'Usage: /invite <nickname>', (displayName) => ({
        type: 'command',
        name: 'invite',
        displayName
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
    case '/color':
      return parseColorCommand(args);
    default:
      return { type: 'error', message: `Unknown command: ${command}` };
  }
}

function parseStartCommand(args: string[]): StartCommand | { type: 'error'; message: string } {
  if (args.length === 0) {
    return { type: 'command', name: 'start' };
  }

  if (args.length > 2) {
    return { type: 'error', message: 'Usage: /start [nickname] [invite-code]' };
  }

  return {
    type: 'command',
    name: 'start',
    displayName: args[0],
    inviteCode: args[1]
  };
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

function parseColorCommand(args: string[]): ParsedChatInput {
  const [action, color, ...extra] = args;

  if (!action) {
    return { type: 'command', name: 'color-show' };
  }

  if (action === 'list' && !color) {
    return { type: 'command', name: 'color-list' };
  }

  if (action === 'set') {
    if (!color || extra.length > 0) {
      return { type: 'error', message: 'Usage: /color set <color>' };
    }

    return { type: 'command', name: 'color-set', color };
  }

  return { type: 'error', message: 'Usage: /color [list|set <color>]' };
}

function requireArgument<T extends ParsedChatInput>(
  value: string | undefined,
  message: string,
  build: (value: string) => T
): T | { type: 'error'; message: string } {
  return value ? build(value) : { type: 'error', message };
}
