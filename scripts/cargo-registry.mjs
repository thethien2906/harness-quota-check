// Build-time transport bridge: Cargo's Windows TLS can be unavailable in a
// restricted shell. Node performs normal verified HTTPS to fixed public hosts.
import http from 'node:http';
export async function registryBridge() {
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
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(38471, '127.0.0.1', resolve); });
  return { url: `sparse+http://127.0.0.1:${server.address().port}/index/`, close: () => server.close() };
}
