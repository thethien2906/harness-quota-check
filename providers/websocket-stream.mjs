import { createHash, randomBytes } from 'node:crypto';

// WebSocket over the raw duplex stream provided by `codex app-server proxy`.
// No TCP listener, third-party package, or credential is needed.
export function websocketStream(input, output, onMessage, onError) {
  const key = randomBytes(16).toString('base64');
  const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  let buffer = Buffer.alloc(0);
  let upgraded = false;
  let fragments = [];
  let fragmentSize = 0;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  let failed = false;
  const fail = error => {
    if (failed) return;
    failed = true;
    rejectReady(error);
    onError(error);
  };
  function sendFrame(payload, opcode = 1) {
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const ext = data.length < 126 ? 0 : data.length <= 65535 ? 2 : 8;
    const header = Buffer.alloc(2 + ext + 4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | (ext === 0 ? data.length : ext === 2 ? 126 : 127);
    if (ext === 2) header.writeUInt16BE(data.length, 2);
    if (ext === 8) header.writeBigUInt64BE(BigInt(data.length), 2);
    const mask = randomBytes(4);
    mask.copy(header, 2 + ext);
    const encoded = Buffer.from(data);
    for (let i = 0; i < encoded.length; i++) encoded[i] ^= mask[i % 4];
    output.write(Buffer.concat([header, encoded]));
  }
  function receive(chunk) {
    if (failed) return;
    try {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf('\r\n\r\n');
        if (end < 0) {
          if (buffer.length > 16384) throw new Error('Invalid WebSocket handshake');
          return;
        }
        const headers = buffer.subarray(0, end).toString('ascii');
        if (!/^HTTP\/1\.[01] 101\b/.test(headers)) throw new Error('WebSocket upgrade rejected');
        const actual = headers.match(/^Sec-WebSocket-Accept:\s*(\S+)/im)?.[1];
        if (actual !== accept || !/^Upgrade:\s*websocket\s*$/im.test(headers)) throw new Error('Invalid WebSocket handshake');
        buffer = buffer.subarray(end + 4);
        upgraded = true;
        resolveReady();
      }
      while (buffer.length >= 2) {
        const fin = Boolean(buffer[0] & 0x80);
        const opcode = buffer[0] & 0x0f;
        if ((buffer[0] & 0x70) || (buffer[1] & 0x80)) throw new Error('Invalid WebSocket frame');
        let size = buffer[1] & 0x7f;
        let offset = 2;
        if (size === 126) { if (buffer.length < 4) return; size = buffer.readUInt16BE(2); offset = 4; }
        else if (size === 127) {
          if (buffer.length < 10) return;
          const large = buffer.readBigUInt64BE(2);
          if (large > 8388608n) throw new Error('WebSocket message too large');
          size = Number(large); offset = 10;
        }
        if (size > 8388608) throw new Error('WebSocket message too large');
        if (opcode >= 8 && (!fin || size > 125)) throw new Error('Invalid WebSocket control frame');
        if (buffer.length < offset + size) return;
        const payload = buffer.subarray(offset, offset + size);
        buffer = buffer.subarray(offset + size);
        if (opcode === 8) throw new Error('Codex WebSocket closed');
        if (opcode === 9) { sendFrame(payload, 10); continue; }
        if (opcode === 10) continue;
        if (opcode !== 0 && opcode !== 1) throw new Error('Unsupported WebSocket message');
        if ((opcode === 0 && !fragments.length) || (opcode === 1 && fragments.length)) throw new Error('Invalid WebSocket continuation');
        fragments.push(payload);
        fragmentSize += payload.length;
        if (fragmentSize > 8388608) throw new Error('WebSocket message too large');
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = []; fragmentSize = 0;
          onMessage(text);
        }
      }
    } catch (error) { fail(error); }
  }
  input.on('data', receive);
  output.write(`GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  return {
    ready,
    send: text => sendFrame(text),
    abort: fail,
    dispose: () => input.off('data', receive),
  };
}
