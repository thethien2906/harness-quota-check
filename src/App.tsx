import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Bucket, Mode, Provider, ProviderState, QuotaWindow, ViewState } from './types';
import * as bridge from './bridge';
import { compactQuota, isStale, level, windowLabel } from './selectors';

const providers: Provider[] = ['codex', 'antigravity', 'claude'];
const names: Record<Provider, string> = { codex: 'Codex', antigravity: 'Antigravity', claude: 'Claude Code' };
const icons = { codex: 'codex', antigravity: 'antigravity', claude: 'claude' };
const empty = (provider: Provider): ProviderState => ({ provider, running: null, loading: false, snapshot: null, error: null });
const previewEnabled = !bridge.desktop && new URLSearchParams(location.search).get('preview') === '1';
function sample(provider: Provider): ProviderState {
  const windows: QuotaWindow[] = [{ key: '5h', minutes: 300, remaining: provider === 'claude' ? 84 : 72, resetsAt: Date.now() / 1000 + 7200 }, { key: 'weekly', minutes: 10080, remaining: 46, resetsAt: Date.now() / 1000 + 267000 }];
  const buckets: Bucket[] = provider === 'antigravity' ? [
    { id: 'gemini-3.5-pro', name: 'API · Gemini 3.5 Pro', windows: [{ key: 'model', minutes: null, remaining: 64, resetsAt: null }] },
    { id: 'gemini-4-argon', name: 'API · Gemini 4 Argon', windows: [{ key: 'model', minutes: null, remaining: 38, resetsAt: null }] },
    { id: 'api-group', name: 'Claude & GPT', windows },
  ] : [{ id: provider, name: names[provider], windows }];
  return { provider, running: true, loading: false, error: null, snapshot: { ok: true, updatedAt: new Date().toISOString(), buckets, notice: 'Sample data · no account connected.' } };
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = { back: 'm14 6-6 6 6 6', close: 'm6 6 12 12M6 18 18 6', refresh: 'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1', pin: 'm15 3 6 6-3 1-4 4v4l-3-3-6 6m6-6-5-5h4l4-4z', more: 'M5 12h.01M12 12h.01M19 12h.01', terminal: 'm7 9 4 3-4 3m7 0h4M4 4h16v16H4z', sun: 'M12 3v2m0 14v2M3 12h2m14 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0' };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function ageLabel(date: string | null) {
  if (!date) return 'No measurement time';
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1 ? 'Just updated' : `${minutes} minutes ago`;
}
function QuotaCard({ window }: { window: QuotaWindow }) {
  const reset = window.resetsAt ? new Date(window.resetsAt * 1000) : null;
  const percentage = Math.round(window.remaining * 10) / 10;
  return <section className={`quota-card ${level(percentage)}`}>
    <div className="card-top"><span>{windowLabel(window)}</span><small>{percentage <= 10 ? 'Almost depleted' : percentage <= 25 ? 'Low quota' : 'Remaining'}</small></div>
    <div className="amount"><strong>{percentage}<span>%</span></strong><span>available</span></div>
    <div className="track" role="progressbar" aria-label={`${windowLabel(window)} remaining`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage}><div style={{ width: `${percentage}%` }} /></div>
    <div className="reset"><span>{reset ? 'Reset' : 'No reset time available'}</span>{reset && <time dateTime={reset.toISOString()}>{reset.toLocaleString('en-US', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>}</div>
  </section>;
}
export default function App() {
  const [states, setStates] = useState<Record<Provider, ProviderState>>(() => Object.fromEntries(providers.map(p => [p, previewEnabled ? sample(p) : empty(p)])) as Record<Provider, ProviderState>);
  const [view, setView] = useState<ViewState>({ mode: bridge.desktop ? 'hidden' : 'compact', pinned: false });
  const [selected, setSelected] = useState<Provider>('codex');
  const [menu, setMenu] = useState(false);
  const [light, setLight] = useState(() => localStorage.getItem('quota-peek-theme') === 'light');
  const [uiError, setUiError] = useState('');
  const [demoState, setDemoState] = useState('normal');
  const [, tick] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const edgeHover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewLeave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active = states[selected];
  useEffect(() => {
    let disposed = false; const cleanups: (() => void)[] = [];
    void (async () => {
      try {
        // Subscribe first so a slow bootstrap cannot lose an initial snapshot.
        const unProvider = await bridge.onProvider(state => { if (!disposed) setStates(previous => ({ ...previous, [state.provider]: state })); });
        const unView = await bridge.onView(state => { if (!disposed) setView(state); });
        if (disposed) { unProvider(); unView(); return; }
        cleanups.push(unProvider, unView);
        const initial = await bridge.initialState();
        if (!disposed && bridge.desktop) { setStates(previous => ({ ...previous, ...initial.providers })); setView(initial.view); }
      } catch { if (!disposed) setUiError('Could not connect to the quota reader.'); }
    })();
    const timer = setInterval(() => tick(value => value + 1), 15000);
    return () => { disposed = true; cleanups.forEach(fn => fn()); clearInterval(timer); clearTimeout(edgeHover.current); clearTimeout(previewLeave.current); };
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = light ? 'light' : 'dark'; localStorage.setItem('quota-peek-theme', light ? 'light' : 'dark'); }, [light]);
  useEffect(() => {
    if (view.mode === 'detail') document.getElementById(`tab-${selected}`)?.focus({ preventScroll: true });
  }, [view.mode, selected]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('.menu-wrap')) setMenu(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, []);
  async function mode(next: Mode) {
    setUiError(''); setMenu(false);
    try { await bridge.changeMode(next); if (!bridge.desktop) setView(previous => ({ ...previous, mode: next })); }
    catch { setUiError('Could not change the window mode.'); }
  }
  async function open(provider: Provider) { setSelected(provider); await mode('detail'); }
  async function refresh() {
    setUiError('');
    try { await bridge.refreshProvider(selected); }
    catch { setUiError('The quota reader is unavailable. Try again.'); }
  }
  const inactiveMessage = active.running === false ? `${names[selected]} not running` : active.error?.error || 'Checking tools…';
  function setDemo(value: string) {
    setDemoState(value);
    setStates(Object.fromEntries(providers.map(provider => {
      const state = sample(provider);
      if (value === 'off') return [provider, { ...state, running: false, snapshot: null }];
      if (value === 'error') state.error = { code: 'NETWORK_ERROR', error: 'Could not connect. Showing the last measurement.' };
      if (value === 'low') state.snapshot!.buckets.forEach(b => b.windows.forEach((w, i) => w.remaining = i ? 7.5 : 21));
      return [provider, state];
    })) as Record<Provider, ProviderState>);
  }
  const body = <>
    {view.mode !== 'detail' && <button className="edge" data-visible={view.mode === 'hidden'} aria-hidden={view.mode !== 'hidden'} tabIndex={view.mode === 'hidden' ? 0 : -1} aria-label="Open Quota Peek" onClick={() => void mode('compact')}
      onPointerEnter={() => { if (!bridge.desktop) edgeHover.current = setTimeout(() => void mode('compact'), 180); }}
      onPointerLeave={() => clearTimeout(edgeHover.current)} />}
    {view.mode !== 'detail' && <nav className="compact-rail" data-visible={view.mode === 'compact'} aria-hidden={view.mode !== 'compact'} inert={view.mode !== 'compact'} aria-label="Tool quotas"
      onPointerEnter={() => clearTimeout(previewLeave.current)}
      onPointerLeave={event => { if (!bridge.desktop && !view.pinned && !event.currentTarget.contains(document.activeElement)) previewLeave.current = setTimeout(() => void mode('hidden'), 650); }}
      onKeyDown={event => { if (event.key === 'Escape') void mode('hidden'); }}>
      {providers.map(provider => {
        const quota = compactQuota(provider, states[provider]);
        return <button key={provider} className={`harness-icon ${quota ? level(quota.remaining) : 'unavailable'}`} aria-label={`${names[provider]}, ${quota ? `quota remaining ${Math.round(quota.remaining)}%` : states[provider].running === false ? 'not running' : 'quota unavailable'}. Open details`} onClick={() => void open(provider)}>
          <svg className="gauge" viewBox="0 0 64 64" aria-hidden="true"><path className="gauge-track" d="M15.03 48.97A24 24 0 1 1 48.97 48.97" pathLength="100" /><path className="gauge-value" d="M15.03 48.97A24 24 0 1 1 48.97 48.97" pathLength="100" strokeDasharray={`${quota?.remaining || 0} 100`} /></svg>
          <img src={`/assets/${icons[provider]}.svg`} className={`harness-glyph ${provider}`} alt="" aria-hidden="true" />
        </button>;
      })}
    </nav>}
    {view.mode === 'detail' && <article ref={panel} className="panel" onKeyDown={event => { if (event.key === 'Escape') { if (menu) setMenu(false); else void mode('compact'); } }}>
      <header className="panel-head">
        <div className="head-row"><button className="icon-button" aria-label="Back to compact" onClick={() => void mode('compact')}><Icon name="back" /></button><span className="panel-brand">Quota Peek</span><button className="icon-button" aria-label={view.pinned ? 'Unpin' : 'Pin panel'} aria-pressed={view.pinned} onClick={() => {
          const pinned = !view.pinned;
          void bridge.pinWindow(pinned).then(() => { if (!bridge.desktop) setView(previous => ({ ...previous, pinned })); }).catch(() => setUiError('Could not change the pin setting.'));
        }}><Icon name="pin" /></button><div className="menu-wrap"><button className="icon-button" aria-label="Options" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="more" /></button>{menu && <div className="menu"><button onClick={() => setLight(!light)}><Icon name="sun" />Theme: {light ? 'dark' : 'light'}</button><button onClick={() => void mode('hidden')}>Hide to screen edge</button>{bridge.desktop && <button onClick={() => void bridge.quit()}>Quit Quota Peek</button>}</div>}</div><button className="icon-button" aria-label="Hide panel" onClick={() => void mode('hidden')}><Icon name="close" /></button></div>
        <nav className="tabs" role="tablist" aria-label="Select tool">{providers.map((p, index) => <button key={p} role="tab" id={`tab-${p}`} aria-controls="quota-content" aria-selected={selected === p} tabIndex={selected === p ? 0 : -1} onClick={() => setSelected(p)} onKeyDown={event => {
          let next: number | undefined;
          if (event.key === 'ArrowRight') next = (index + 1) % providers.length;
          if (event.key === 'ArrowLeft') next = (index + providers.length - 1) % providers.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = providers.length - 1;
          if (next !== undefined) { event.preventDefault(); setSelected(providers[next]); document.getElementById(`tab-${providers[next]}`)?.focus(); }
        }}>{p === 'claude' ? 'Claude' : names[p]}</button>)}</nav>
        <div className="provider"><h1>{names[selected]}</h1><span className={`status ${active.error ? 'warning' : ''}`}>{active.running === false ? 'Not running' : active.running === null ? 'Checking' : active.loading ? 'Updating' : active.error ? 'Disconnected' : 'Running'}</span></div>
        <div className="account">{active.snapshot?.buckets.find(b => b.plan)?.plan || 'Using existing local credentials'}</div>
      </header>
      <div className="content" id="quota-content" role="tabpanel" aria-labelledby={`tab-${selected}`}>
        {(uiError || active.error) && <div className="notice warning" role="status">{uiError || active.error?.error}{active.snapshot && ' Showing the last successful measurement.'}</div>}
        {!active.snapshot ? <div className="empty"><Icon name="terminal" /><h2>{active.loading ? 'Reading quota…' : inactiveMessage}</h2><p>{active.running === false ? 'Open the tool as usual. Its quota will appear here automatically.' : !bridge.desktop ? 'Open the desktop app to read live quota.' : 'No Quota Peek sign-in required.'}</p></div> : <>
          {active.snapshot.buckets.filter(b => b.windows.some(w => w.key !== 'model')).map(bucket => <section key={bucket.id}><div className="section-label">{bucket.name.replace(/^API · /, '')}</div>{bucket.windows.map(w => <QuotaCard key={w.key} window={w} />)}</section>)}
          {active.snapshot.buckets.some(b => b.windows.some(w => w.key === 'model')) && <details className="models"><summary>Model quotas <span>{active.snapshot.buckets.filter(b => b.windows.some(w => w.key === 'model')).length}</span></summary>{active.snapshot.buckets.filter(b => b.windows.some(w => w.key === 'model')).map(b => <div key={b.id} className="model-row"><span>{b.name.replace(/^API · /, '')}</span>{b.windows.filter(w => w.key === 'model').map(w => <span key={w.key} className={level(w.remaining)}>{Math.round(w.remaining * 10) / 10}%</span>)}</div>)}<p className="notice">Model quota; no weekly or 5-hour window is inferred.</p></details>}
          {active.snapshot.notice && <p className="notice">{active.snapshot.notice}</p>}
        </>}
      </div>
      <footer className="foot"><span className={`updated ${active.snapshot && isStale(active.snapshot) ? 'stale' : ''}`} role="status"><i />{active.loading ? 'Updating…' : active.snapshot ? `${isStale(active.snapshot) ? 'Outdated data · ' : ''}${ageLabel(active.snapshot.updatedAt)}` : active.running === false ? 'Waiting for the tool to start' : 'No data yet'}</span><button className={`refresh ${active.loading ? 'spin' : ''}`} disabled={active.loading || active.running !== true} onClick={() => void refresh()}><Icon name="refresh" />Refresh</button></footer>
    </article>}
  </>;
  if (!bridge.desktop) return <main className="preview-shell"><header><span>Quota Peek <small>Desktop UI</small></span><span className="preview-badge">{previewEnabled ? 'Sample data' : 'Desktop not connected'}</span></header><div className="preview-body"><aside><h1>Geist.<br />At the edge.</h1><p>Black canvas. Three tools.<br />Your quota, right beside you.</p><div className="preview-switch">{(['compact', 'detail', 'hidden'] as Mode[]).map(m => <button key={m} aria-pressed={view.mode === m} onClick={() => void mode(m)}>{m === 'compact' ? 'Compact' : m === 'detail' ? 'Details' : 'Hide'}</button>)}</div>{previewEnabled && <select aria-label="Sample state" value={demoState} onChange={e => setDemo(e.target.value)}><option value="normal">Running</option><option value="low">Low quota</option><option value="off">Not running</option><option value="error">Connection lost</option></select>}<button className="theme-preview" onClick={() => setLight(!light)}><Icon name="sun" /> Switch theme</button></aside><div className="preview-stage" data-mode={view.mode} style={{ '--frame-width': view.mode === 'detail' ? '354px' : view.mode === 'compact' ? '54px' : '5px' } as CSSProperties}>{body}</div></div></main>;
  return <main className="desktop-root" data-mode={view.mode}>{body}</main>;
}
