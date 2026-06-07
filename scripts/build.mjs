#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

rmSync(resolve(rootDir, 'dist'), { recursive: true, force: true });
execFileSync('tsc', ['-p', 'tsconfig.build.json'], {
  cwd: rootDir,
  stdio: 'inherit'
});
