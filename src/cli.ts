export type RunCliOptions = {
  argv: string[];
};

export function getCliName(): string {
  return 'hychat';
}

export async function runCli(_options: RunCliOptions): Promise<void> {
  process.stdout.write(`${getCliName()}\n`);
}
