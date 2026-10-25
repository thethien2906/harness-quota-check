export type Provider = 'codex' | 'antigravity' | 'claude';
export type Mode = 'hidden' | 'compact' | 'detail';
export interface QuotaWindow { key: string; label?: string; minutes: number | null; remaining: number; resetsAt: number | null }
export interface Bucket { id: string; name: string; plan?: string; windows: QuotaWindow[] }
export interface Snapshot { ok: true; updatedAt: string | null; source?: string; notice?: string; buckets: Bucket[] }
export interface ProviderState { provider: Provider; running: boolean | null; loading: boolean; snapshot: Snapshot | null; error: { code: string; error: string } | null; lastAttempt?: number | null }
export interface ViewState { mode: Mode; pinned: boolean }
export interface InitialState { providers: Partial<Record<Provider, ProviderState>>; view: ViewState }
