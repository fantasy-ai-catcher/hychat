import { homedir, userInfo } from 'node:os';
import { basename } from 'node:path';

export function getDefaultDisplayName(): string | undefined {
  const username = userInfo().username.trim();
  if (username) {
    return username;
  }

  const homeName = basename(homedir()).trim();
  return homeName || undefined;
}
