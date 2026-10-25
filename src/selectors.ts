import type { Bucket, Provider, ProviderState, QuotaWindow, Snapshot } from './types.ts';

function version(bucket: Bucket): number[] | null {
  const match = `${bucket.id} ${bucket.name}`.match(/(?:gemini|argon)[\s_-]*(\d+(?:[._]\d+)*)/i);
  return match ? match[1].split(/[._]/).map(Number) : null;
}
export function compactQuota(provider: Provider, state?: ProviderState): QuotaWindow | null {
  if (!state?.running || !state.snapshot || isStale(state.snapshot) || state.error) return null;
  if (provider !== 'antigravity') return state.snapshot.buckets.flatMap(b => b.windows).find(w => w.minutes === 300) ?? null;
  const candidates = state.snapshot.buckets.map(bucket => ({ bucket, version: version(bucket) })).filter(item => item.version && item.bucket.windows.some(w => w.key === 'model'));
  candidates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.version!.length, b.version!.length); i++) {
      const delta = (b.version![i] || 0) - (a.version![i] || 0);
      if (delta) return delta;
    }
    const argon = Number(/argon/i.test(b.bucket.id + b.bucket.name)) - Number(/argon/i.test(a.bucket.id + a.bucket.name));
    return argon || a.bucket.id.localeCompare(b.bucket.id);
  });
  // Same release can have several variants. Use the most restrictive measured
  // value among that release/family, never choose by the largest percentage.
  if (!candidates.length) return null;
  const chosen = candidates[0];
  const argon = /argon/i.test(chosen.bucket.id + chosen.bucket.name);
  const windows = candidates.filter(item => JSON.stringify(item.version) === JSON.stringify(chosen.version) && /argon/i.test(item.bucket.id + item.bucket.name) === argon).flatMap(item => item.bucket.windows.filter(w => w.key === 'model'));
  return windows.sort((a, b) => a.remaining - b.remaining)[0] ?? null;
}
export function isStale(snapshot: Snapshot, now = Date.now()): boolean {
  const measured = Date.parse(snapshot.updatedAt || '');
  return !Number.isFinite(measured) || now - measured > 240000;
}
export function level(remaining: number): 'normal' | 'low' | 'critical' { return remaining <= 10 ? 'critical' : remaining <= 25 ? 'low' : 'normal'; }
export function windowLabel(window: QuotaWindow): string {
  return window.label || (window.minutes === 300 ? '5 hours' : window.minutes === 10080 ? '7 days' : window.minutes ? `${window.minutes / 60} hours` : 'Model quota');
}
