export const PROVIDERS = ['codex', 'antigravity', 'claude'];
const text = (value, max = 240) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, max) : undefined;
export function sanitizeSnapshot(raw) {
  if (!raw?.ok) return { ok: false, code: text(raw?.code, 60) || 'ADAPTER_ERROR', error: text(raw?.error) || 'Could not read quota.' };
  const buckets = (Array.isArray(raw.buckets) ? raw.buckets : []).slice(0, 200).flatMap(bucket => {
    const windows = (Array.isArray(bucket.windows) ? bucket.windows : []).slice(0, 12).filter(w => typeof w.remaining === 'number' && Number.isFinite(w.remaining) && w.remaining >= 0 && w.remaining <= 100).map(w => ({
      key: text(w.key, 100) || 'unknown', label: text(w.label, 100),
      minutes: Number.isFinite(w.minutes) && w.minutes > 0 ? w.minutes : null,
      remaining: w.remaining, resetsAt: Number.isFinite(w.resetsAt) && w.resetsAt > 0 && w.resetsAt <= 8640000000000 ? w.resetsAt : null,
    }));
    return windows.length ? [{ id: text(bucket.id, 160) || 'unknown', name: text(bucket.name, 160) || 'Quota', plan: text(bucket.plan, 80), windows }] : [];
  });
  if (!buckets.length) return { ok: false, code: 'QUOTA_UNAVAILABLE', error: 'No quota data is available.' };
  const measured = Date.parse(raw.updatedAt);
  return { ok: true, updatedAt: Number.isFinite(measured) ? new Date(measured).toISOString() : null,
    source: text(raw.source, 80), notice: text(raw.notice, 700), buckets };
}

export class Coordinator {
  constructor({ query, publish, now = Date.now, refreshMs = 180000 }) {
    this.query = query; this.publish = publish; this.now = now; this.refreshMs = refreshMs;
    this.states = Object.fromEntries(PROVIDERS.map(provider => [provider, { provider, running: null, loading: false, snapshot: null, error: null, session: '', lastAttempt: null }]));
    this.jobs = new Set();
  }
  emit(provider) { const { session, ...safe } = this.states[provider]; this.publish(safe); }
  observe(discovery) {
    for (const provider of PROVIDERS) {
      const observed = discovery?.[provider]; const current = this.states[provider];
      const known = observed?.known === true && Array.isArray(observed.pids);
      let session = known ? [...observed.pids].sort((a, b) => a - b).join(',') : 'unknown';
      // Temporary Codex proxy/app-server children must not invalidate their
      // parent's in-flight measurement. Retain identity while originals live.
      if (provider !== 'antigravity' && known && current.running && current.session.split(',').some(pid => observed.pids.includes(Number(pid)))) session = current.session;
      if (session !== current.session || current.running !== (known ? observed.pids.length > 0 : null)) {
        current.session = session; current.snapshot = null; current.lastAttempt = null; current.loading = false;
        current.running = known ? observed.pids.length > 0 : null;
        current.error = known ? null : { code: 'DISCOVERY_BLOCKED', error: 'This environment cannot check running processes.' };
        this.emit(provider);
      }
      if (current.running && !this.jobs.has(provider) && (current.lastAttempt === null || this.now() - current.lastAttempt >= this.refreshMs)) void this.refresh(provider);
    }
  }
  async refresh(provider) {
    if (!PROVIDERS.includes(provider) || this.jobs.has(provider)) return;
    const state = this.states[provider];
    if (!state.running) { this.emit(provider); return; }
    const session = state.session;
    this.jobs.add(provider); state.loading = true; state.lastAttempt = this.now(); this.emit(provider);
    try {
      const result = sanitizeSnapshot(await this.query(provider));
      if (state.session !== session) return;
      if (result.ok) { state.snapshot = result; state.error = null; }
      else if (result.code === 'NOT_RUNNING') { state.running = false; state.session = ''; state.snapshot = null; state.error = null; }
      else { state.error = { code: result.code, error: result.error }; }
    } catch {
      if (state.session === session) state.error = { code: 'ADAPTER_TIMEOUT', error: 'The quota request timed out.' };
    } finally { this.jobs.delete(provider); state.loading = false; this.emit(provider); }
  }
}
