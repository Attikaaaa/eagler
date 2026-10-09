// Minimal Wisp v1 server: a WebSocket that carries TCP streams. It ONLY ever connects to the local game server
// (whatever host the client asks for is ignored), so it is not an open proxy.
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";

const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4, WINDOW = 128;
const wsFrame = (op, p) => {
  const n = p.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]); else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); } else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
};
const pkt = (type, id, payload = Buffer.alloc(0)) => { const h = Buffer.alloc(5); h[0] = type; h.writeUInt32LE(id, 1); return Buffer.concat([h, payload]); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

export function wispServer(port, targetPort, log = () => {}) {
  const srv = http.createServer((q, s) => { s.writeHead(200, { "Access-Control-Allow-Origin": "*" }); s.end("ok"); });
  srv.on("upgrade", (req, sock) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) return sock.destroy();
    const acc = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
    sock.setNoDelay(true);
    const streams = new Map();
    const send = (b) => { try { sock.write(wsFrame(2, b)); } catch {} };
    send(pkt(CONTINUE, 0, u32(WINDOW)));
    const onPacket = (m) => {
      if (m.length < 5) return;
      const type = m[0], id = m.readUInt32LE(1), pl = m.subarray(5);
      if (type === CONNECT) {
        if (pl[0] !== 1) return send(pkt(CLOSE, id, Buffer.from([0x41]))); // only TCP
        const s = net.connect(targetPort, "127.0.0.1");
        s.setNoDelay(true); streams.set(id, s);
        s.on("data", (d) => { for (let o = 0; o < d.length; o += 65000) send(pkt(DATA, id, d.subarray(o, o + 65000))); });
        s.on("close", () => { if (streams.delete(id)) send(pkt(CLOSE, id, Buffer.from([0x02]))); });
        s.on("error", () => {});
      } else if (type === DATA) {
        const s = streams.get(id); if (s) s.write(pl, () => send(pkt(CONTINUE, id, u32(WINDOW))));
      } else if (type === CLOSE) {
        const s = streams.get(id); if (s) { streams.delete(id); s.destroy(); }
      }
    };
    let buf = Buffer.alloc(0), frag = [];
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 15; let len = buf[1] & 127, p = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); p = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); p = 10; }
        if (buf.length < p + 4 + len) return;
        const mask = buf.subarray(p, p + 4), pl = Buffer.from(buf.subarray(p + 4, p + 4 + len));
        for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];
        buf = buf.subarray(p + 4 + len);
        if (op === 8) return sock.end();
        if (op === 9) { sock.write(wsFrame(10, pl)); continue; }
        if (op === 0 || op === 1 || op === 2) { frag.push(pl); if (fin) { onPacket(Buffer.concat(frag)); frag = []; } }
      }
    });
    const off = () => { for (const s of streams.values()) s.destroy(); streams.clear(); };
    sock.on("close", off); sock.on("error", off);
  });
  srv.listen(port);
  log("wisp listening on", port);
  return srv;
}
