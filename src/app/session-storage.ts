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

export function getDefaultSessionPath(): string {
  return join(homedir(), '.hychat', 'session.json');
}
