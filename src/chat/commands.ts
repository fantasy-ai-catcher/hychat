export type ParsedChatInput =
  | { type: 'empty' }
  | { type: 'message'; body: string }
  | { type: 'error'; message: string }
  | StartCommand
  | VerifyCommand
  | NameCommand
  | LogoutCommand
  | RoomsCommand
  | CreateRoomCommand
  | JoinCommand
  | LeaveCommand
  | InviteCodeCommand
  | InviteCodeListCommand
  | InviteCodeRevokeCommand
  | MembersCommand
  | WatchAddCommand
  | WatchRemoveCommand
  | WatchReorderCommand
  | StockCommand
  | RefreshCommand
  | ColorShowCommand
  | ColorListCommand
  | ColorSetCommand
  | NotifyShowCommand
  | NotifySetCommand
  | NotifyWhenCommand
  | NotifyTestCommand
  | HelpCommand
  | QuitCommand;

export type NotifyChannel = 'off' | 'bell' | 'sound' | 'banner';
export type NotifyWhen = 'always' | 'unfocused';

type StartCommand = {
  type: 'command';
  name: 'start';
  email?: string;
  inviteCode?: string;
};
type VerifyCommand = { type: 'command'; name: 'verify'; code: string };
type NameCommand = { type: 'command'; name: 'name'; displayName: string };
type LogoutCommand = { type: 'command'; name: 'logout'; confirmed?: boolean };
type RoomsCommand = { type: 'command'; name: 'rooms' };
type CreateRoomCommand = { type: 'command'; name: 'create-room'; nameText: string };
type JoinCommand = { type: 'command'; name: 'join'; room: string };
type LeaveCommand = { type: 'command'; name: 'leave' };
type InviteCodeCommand = { type: 'command'; name: 'invite-code' };
type InviteCodeListCommand = { type: 'command'; name: 'invite-code-list' };
type InviteCodeRevokeCommand = { type: 'command'; name: 'invite-code-revoke'; code: string };
type MembersCommand = { type: 'command'; name: 'members' };
type WatchAddCommand = { type: 'command'; name: 'watch-add'; symbol: string };
type WatchRemoveCommand = { type: 'command'; name: 'watch-remove'; symbol: string };
type WatchReorderCommand = { type: 'command'; name: 'watch-reorder' };
type StockCommand = { type: 'command'; name: 'stock'; symbol: string };
type RefreshCommand = { type: 'command'; name: 'refresh'; symbol?: string };
type ColorShowCommand = { type: 'command'; name: 'color-show' };
type ColorListCommand = { type: 'command'; name: 'color-list' };
type ColorSetCommand = { type: 'command'; name: 'color-set'; color: string };
type NotifyShowCommand = { type: 'command'; name: 'notify-show' };
type NotifySetCommand = { type: 'command'; name: 'notify-set'; channel: NotifyChannel };
type NotifyWhenCommand = { type: 'command'; name: 'notify-when'; when: NotifyWhen };
type NotifyTestCommand = { type: 'command'; name: 'notify-test' };
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
    case '/verify':
      return requireArgument(args[0], 'Usage: /verify <code>', (code) => ({
        type: 'command',
        name: 'verify',
        code
      }));
    case '/name':
    case '/nick':
      return requireRest(args, 'Usage: /name <new name>', (displayName) => ({
        type: 'command',
        name: 'name',
        displayName
      }));
    case '/logout':
      return args[0] === 'confirm'
        ? { type: 'command', name: 'logout', confirmed: true }
        : { type: 'command', name: 'logout' };
    case '/rooms':
      return { type: 'command', name: 'rooms' };
    case '/members':
      return { type: 'command', name: 'members' };
    case '/help':
      return { type: 'command', name: 'help' };
    case '/quit':
      return { type: 'command', name: 'quit' };
    case '/invite-code':
      return parseInviteCodeCommand(args);
    case '/join':
      return requireArgument(args[0], 'Usage: /join <room>', (room) => ({
        type: 'command',
        name: 'join',
        room
      }));
    case '/leave':
      return { type: 'command', name: 'leave' };
    case '/create':
      return requireRest(args, 'Usage: /create <room name>', (nameText) => ({
        type: 'command',
        name: 'create-room',
        nameText
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
    case '/notify':
      return parseNotifyCommand(args);
    default:
      return { type: 'error', message: `Unknown command: ${command}` };
  }
}

const startUsage = 'Usage: /start <email> [invite-code].';

function parseStartCommand(args: string[]): StartCommand | { type: 'error'; message: string } {
  if (args.length === 0) {
    return { type: 'command', name: 'start' };
  }

  const emails = args.filter((arg) => arg.includes('@'));
  const rest = args.filter((arg) => !arg.includes('@'));

  if (emails.length !== 1 || rest.length > 1) {
    return { type: 'error', message: startUsage };
  }

  return {
    type: 'command',
    name: 'start',
    email: emails[0],
    inviteCode: rest[0]
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

  if (action === 'reorder' && !symbol) {
    return { type: 'command', name: 'watch-reorder' };
  }

  return { type: 'error', message: 'Usage: /watch <add|remove> <symbol> | reorder' };
}

function parseInviteCodeCommand(args: string[]): ParsedChatInput {
  const [action, code, ...extra] = args;

  if (!action) {
    return { type: 'command', name: 'invite-code' };
  }

  if (action === 'list' && !code) {
    return { type: 'command', name: 'invite-code-list' };
  }

  if (action === 'revoke' && code && extra.length === 0) {
    return { type: 'command', name: 'invite-code-revoke', code };
  }

  return { type: 'error', message: 'Usage: /invite-code [list|revoke <code>]' };
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

const NOTIFY_CHANNELS = new Set<NotifyChannel>(['off', 'bell', 'sound', 'banner']);
const NOTIFY_WHENS = new Set<NotifyWhen>(['always', 'unfocused']);
const notifyUsage = 'Usage: /notify [off|bell|sound|banner] | when <always|unfocused> | test';

function parseNotifyCommand(args: string[]): ParsedChatInput {
  const [action, value, ...extra] = args;

  if (!action) {
    return { type: 'command', name: 'notify-show' };
  }

  if (action === 'test' && !value) {
    return { type: 'command', name: 'notify-test' };
  }

  if (action === 'when') {
    if (!value || extra.length > 0 || !NOTIFY_WHENS.has(value as NotifyWhen)) {
      return { type: 'error', message: 'Usage: /notify when <always|unfocused>' };
    }
    return { type: 'command', name: 'notify-when', when: value as NotifyWhen };
  }

  if (NOTIFY_CHANNELS.has(action as NotifyChannel) && !value) {
    return { type: 'command', name: 'notify-set', channel: action as NotifyChannel };
  }

  return { type: 'error', message: notifyUsage };
}

function requireArgument<T extends ParsedChatInput>(
  value: string | undefined,
  message: string,
  build: (value: string) => T
): T | { type: 'error'; message: string } {
  return value ? build(value) : { type: 'error', message };
}
