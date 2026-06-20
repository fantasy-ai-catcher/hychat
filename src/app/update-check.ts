// Startup version gate: confirm the locally installed HyChat is the latest
// released version before launching the chat UI. The client and the Supabase
// schema move together, so keeping our small circle of friends on one version
// avoids subtle schema-mismatch breakage. If we cannot confirm the version is
// current (offline, GitHub down, unexpected payload) we block rather than guess.

// Public source repo where `pnpm release` creates GitHub releases.
export const RELEASE_REPO = 'fantasy-ai-catcher/hychat';
// Two-step so the tap formula refreshes before the upgrade runs.
export const UPDATE_COMMAND = 'brew update && brew upgrade hychat';
export const SKIP_UPDATE_CHECK_ENV = 'HYCHAT_SKIP_UPDATE_CHECK';

const FETCH_TIMEOUT_MS = 4000;

export type UpdateGateResult = {
  allow: boolean;
  lines: string[];
};

type SemverTuple = [number, number, number];

export function parseSemver(value: string | undefined | null): SemverTuple | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a) ?? [0, 0, 0];
  const right = parseSemver(b) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] < right[index] ? -1 : 1;
    }
  }
  return 0;
}

export function isUpToDate(current: string, latest: string): boolean {
  // If either side is unparseable we refuse to claim the user is outdated;
  // the gate's failure path handles an unknown latest separately.
  if (parseSemver(latest) === null || parseSemver(current) === null) {
    return true;
  }
  return compareSemver(current, latest) >= 0;
}

export function parseLatestVersionFromTag(
  tag: string | undefined | null
): string | null {
  const parsed = parseSemver(tag);
  if (!parsed) {
    return null;
  }
  return parsed.join('.');
}

export function shouldSkipUpdateCheck(
  env: Record<string, string | undefined>
): boolean {
  const value = env[SKIP_UPDATE_CHECK_ENV];
  return typeof value === 'string' && value.trim() !== '' && value !== '0';
}

export function buildOutdatedLines(args: {
  current: string;
  latest: string;
}): string[] {
  return [
    `HyChat 有新版本：${args.current} → ${args.latest}`,
    '请先更新到最新版本再使用：',
    '',
    `    ${UPDATE_COMMAND}`,
    '',
    `（临时跳过检查：${SKIP_UPDATE_CHECK_ENV}=1 hychat）`
  ];
}

export function buildCheckFailedLines(): string[] {
  return [
    '无法确认 HyChat 是否为最新版本（网络或 GitHub 不可用）。',
    '为确保你使用最新版本，已暂停启动。请检查网络后重试，或直接更新：',
    '',
    `    ${UPDATE_COMMAND}`,
    '',
    `（临时跳过检查：${SKIP_UPDATE_CHECK_ENV}=1 hychat）`
  ];
}

export function evaluateUpdateGate(args: {
  current: string;
  latest: string;
}): UpdateGateResult {
  if (isUpToDate(args.current, args.latest)) {
    return { allow: true, lines: [] };
  }
  return { allow: false, lines: buildOutdatedLines(args) };
}

export async function fetchLatestVersion(): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`,
    {
      headers: {
        'User-Agent': 'hychat-update-check',
        Accept: 'application/vnd.github+json'
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    }
  );
  if (!response.ok) {
    return null;
  }
  const data = (await response.json()) as { tag_name?: string };
  return parseLatestVersionFromTag(data.tag_name);
}

export async function runUpdateGate(args: {
  currentVersion: string;
  env: Record<string, string | undefined>;
  fetcher?: () => Promise<string | null>;
}): Promise<UpdateGateResult> {
  if (shouldSkipUpdateCheck(args.env)) {
    return { allow: true, lines: [] };
  }

  let latest: string | null;
  try {
    latest = await (args.fetcher ?? fetchLatestVersion)();
  } catch {
    latest = null;
  }

  if (!latest || parseSemver(latest) === null) {
    return { allow: false, lines: buildCheckFailedLines() };
  }

  return evaluateUpdateGate({ current: args.currentVersion, latest });
}
