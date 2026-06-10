import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

type StoredValues = Record<string, string>;

export class JsonFileStorage {
  constructor(private readonly filePath: string) {}

  getItem(key: string): string | null {
    const values = this.readValues();
    return values[key] ?? null;
  }

  setItem(key: string, value: string): void {
    const values = this.readValues();
    values[key] = value;
    this.writeValues(values);
  }

  removeItem(key: string): void {
    const values = this.readValues();
    delete values[key];
    this.writeValues(values);
  }

  private readValues(): StoredValues {
    if (!existsSync(this.filePath)) {
      return {};
    }

    const raw = readFileSync(this.filePath, 'utf8');
    if (raw.trim().length === 0) {
      return {};
    }

    return JSON.parse(raw) as StoredValues;
  }

  private writeValues(values: StoredValues): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(values, null, 2));
  }
}

export function getDefaultSessionPath(homeDir = homedir()): string {
  return join(homeDir, '.hychat', 'session.json');
}

export function getProfileSessionPath(profileName: string, homeDir = homedir()): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileName)) {
    throw new Error('Invalid profile name. Use letters, numbers, "-" or "_".');
  }

  return join(homeDir, '.hychat', 'sessions', profileName, 'session.json');
}
