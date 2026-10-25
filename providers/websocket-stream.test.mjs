import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { readQuota } from './quota.mjs';

function fixture({ rejectUpgrade = false, silent = false, stdio = false } = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { child.killed = true; };
  const methods = [];
  let upgraded = false;
  let buffer = Buffer.alloc(0);
  const emitFrame = (text, opcode = 1, fin = true) => {
    const data = Buffer.from(text);
    child.stdout.write(Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | opcode, data.length]), data]));
  };
  const dispatch = text => {
    const message = JSON.parse(text);
    methods.push(message.method);
    let result;
    if (message.method === 'initialize') result = { userAgent: 'fixture' };
    else if (message.method === 'account/rateLimits/read') result = { rateLimits: { primary: { usedPercent: 37, windowDurationMins: 300 } } };
    else return;
    const response = JSON.stringify({ id: message.id, result });
    if (stdio) child.stdout.write(response + '\n');
    else {
      // Fragmentation plus a ping between fragments is valid WebSocket traffic.
      emitFrame(response.slice(0, 20), 1, false);
      emitFrame('ping', 9);
      emitFrame(response.slice(20), 0);
    }
  };
  child.stdin.on('data', data => {
    if (silent) return;
    buffer = Buffer.concat([buffer, data]);
    if (stdio) {
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const text = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 1); dispatch(text);
      }
      return;
    }
    if (!upgraded) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const request = buffer.subarray(0, end).toString();
      assert.match(request, /^GET \/ HTTP\/1\.1/);
      const key = request.match(/Sec-WebSocket-Key: (\S+)/)[1];
      const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      buffer = buffer.subarray(end + 4); upgraded = true;
      if (rejectUpgrade) child.stdout.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      else {
        const header = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`;
        child.stdout.write(header.slice(0, 25)); child.stdout.write(header.slice(25));
      }
    }
    while (buffer.length >= 2) {
      assert.ok(buffer[1] & 0x80, 'client frames must be masked');
      let size = buffer[1] & 0x7f;
      let offset = 2;
      if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
      if (buffer.length < offset + 4 + size) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + size));
      const opcode = buffer[0] & 0x0f;
      buffer = buffer.subarray(offset + 4 + size);
      for (let i = 0; i < size; i++) payload[i] ^= mask[i % 4];
      if (opcode === 1) dispatch(payload.toString());
      else assert.equal(opcode, 10, 'ping receives pong');
    }
  });
  return { child, methods, spawnProcess: () => child };
}

test('proxy uses HTTP upgrade, masked frames, ping/pong and fragmented RPC replies', async () => {
  const server = fixture();
  const result = await readQuota({ executable: 'fixture.exe', proxy: true, spawnProcess: server.spawnProcess });
  assert.deepEqual(server.methods, ['initialize', 'initialized', 'account/rateLimits/read']);
  assert.equal(result.buckets[0].windows[0].remaining, 63);
  assert.equal(server.child.killed, true);
});
test('standalone CLI still uses JSONL instead of WebSocket framing', async () => {
  const server = fixture({ stdio: true });
  const result = await readQuota({ executable: 'fixture.exe', spawnProcess: server.spawnProcess });
  assert.equal(result.buckets[0].windows[0].remaining, 63);
});
test('rejects failed upgrades and closes the helper', async () => {
  const server = fixture({ rejectUpgrade: true });
  await assert.rejects(readQuota({ executable: 'fixture.exe', proxy: true, spawnProcess: server.spawnProcess }), /upgrade rejected/);
  assert.equal(server.child.killed, true);
});
test('silent proxy has a bounded timeout with the failed phase', async () => {
  const server = fixture({ silent: true });
  await assert.rejects(readQuota({ executable: 'fixture.exe', proxy: true, spawnProcess: server.spawnProcess, timeoutMs: 30 }), error => error.code === 'QUOTA_TIMEOUT' && error.phase === 'websocket-handshake');
  assert.equal(server.child.killed, true);
});
