// Build-time transport bridge: Cargo's Windows TLS can be unavailable in a
// restricted shell. Node performs normal verified HTTPS to fixed public hosts.
import http from 'node:http';
export async function registryBridge(preferred = Number(process.env.QUOTA_PEEK_CARGO_PORT) || 38471) {
  const server = http.createServer(async (req, res) => {
    const path = req.url || '';
    if (path === '/index/config.json') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ dl: `http://127.0.0.1:${server.address().port}/crates/{crate}/{version}/download` })); return;
    }
    const crate = path.match(/^\/crates\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9.+_-]+)\/download$/);
    const index = path.match(/^\/index\/([a-zA-Z0-9_/-]+)$/);
    const url = crate ? `https://static.crates.io/crates/${crate[1]}/${crate[1]}-${crate[2]}.crate` : index ? `https://index.crates.io/${index[1]}` : null;
    if (!url) { res.writeHead(404).end(); return; }
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(60000) });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { res.writeHead(502).end(); }
  });
  // Prefer the fixed port so concurrent desktop builds can be told apart, but
  // fall back to an ephemeral port instead of failing when it is already busy.
  const listen = port => new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  try { await listen(preferred); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; await listen(0); }
  return { url: `sparse+http://127.0.0.1:${server.address().port}/index/`, close: () => server.close() };
}
