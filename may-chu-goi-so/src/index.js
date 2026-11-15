/* =====================================================================
   Máy chủ Gọi số khám bệnh — Cloudflare Worker + Durable Object
   - Mỗi "phòng" (mã phòng, VD "kkb-tang1") là 1 Durable Object giữ trạng thái
     hàng đợi trong ngày, lưu bền trong SQLite của Cloudflare.
   - Máy gọi số và màn hình chờ nối bằng WebSocket (giữ kết nối, không hỏi
     liên tục), dùng WebSocket Hibernation nên nằm trong gói miễn phí.
   - Màn hình chờ chỉ cần mã phòng (chỉ xem). Muốn gọi số phải nhập PIN.
   - Tạo / sửa phòng cần ADMIN_KEY (đặt bằng: npx wrangler secret put ADMIN_KEY).
   Không lưu thông tin bệnh nhân: chỉ có số thứ tự và tên quầy.
   ===================================================================== */
import { DurableObject } from "cloudflare:workers";
import "../../assets/goi-so-queue.js"; // lõi dùng chung với trình duyệt
const Q = globalThis.GoiSoQueue;

const CODE_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const HIST_TAIL = 80;

function allowed(env) {
  return String(env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}
function corsHeaders(env, req) {
  const list = allowed(env), origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": list.includes("*") ? "*" : list.includes(origin) ? origin : list[0] || "",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
function originOk(env, req) {
  const list = allowed(env), origin = req.headers.get("Origin");
  return list.includes("*") || !origin || list.includes(origin);
}
function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, extra || {})
  });
}
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function safeEqual(a, b) {
  // so sánh qua băm để thời gian so sánh không lộ độ dài/nội dung
  const [x, y] = await Promise.all([sha256Hex("k:" + a), sha256Hex("k:" + b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
function randomHex(n) {
  return [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------ Worker ------------------------------ */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (url.pathname === "/" || url.pathname === "") {
      return new Response("Máy chủ Gọi số đang chạy.", { headers: Object.assign({ "content-type": "text/plain; charset=utf-8" }, cors) });
    }
    if (!originOk(env, req)) return json({ error: "Trang web này chưa được phép dùng máy chủ (xem ALLOWED_ORIGINS)." }, 403, cors);

    const m = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(ws|state|act|setup|info))?\/?$/);
    if (!m) return json({ error: "Không tìm thấy." }, 404, cors);
    const code = decodeURIComponent(m[1]).toLowerCase();
    if (!CODE_RE.test(code)) {
      return json({ error: "Mã phòng chỉ gồm chữ thường không dấu, số và dấu gạch ngang, dài 3–32 ký tự." }, 400, cors);
    }
    const op = m[2] || "info";
    const stub = env.QUEUE.get(env.QUEUE.idFromName(code));

    let forward = req;
    if (op === "setup") {
      if (req.method !== "POST") return json({ error: "Cần POST." }, 405, cors);
      if (!env.ADMIN_KEY) return json({ error: "Máy chủ chưa đặt ADMIN_KEY. Chạy: npx wrangler secret put ADMIN_KEY" }, 500, cors);
      const body = await req.json().catch(() => null);
      if (!body || !(await safeEqual(String(body.adminKey || ""), String(env.ADMIN_KEY)))) {
        return json({ error: "Mã quản trị không đúng." }, 401, cors);
      }
      delete body.adminKey;
      forward = new Request(req.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
    const res = await stub.fetch(forward);
    if (res.status === 101) return res; // WebSocket
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  }
};

/* --------------------------- Durable Object --------------------------- */
export class QueueRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.code = "";
    this.S = null;
    this.annEnd = 0;
    this.fails = [];
    this.lockUntil = 0;
    this.recent = [];
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get("room")) || null;
      this.code = (await ctx.storage.get("code")) || "";
      this.S = (await ctx.storage.get("state")) || null;
      this.annEnd = (await ctx.storage.get("annEnd")) || 0;
    });
    // "ping" từ trình duyệt được trả "pong" ngay, không đánh thức Durable Object
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  publicRoom() {
    const r = this.room;
    return r ? { code: this.code, name: r.name, mode: r.mode, digits: r.digits, counters: r.counters, notice: r.notice } : null;
  }
  today() {
    if (this.room) this.S = Q.normalize(this.S, this.room, Q.vnNow());
    return this.S;
  }
  payload(full) {
    const S = this.today();
    if (!S) return { s: null, now: Date.now() };
    const s = Object.assign({}, S, { hist: full ? S.hist : S.hist.slice(-HIST_TAIL), histTotal: S.hist.length });
    return { s, now: Date.now() };
  }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* kết nối đã đóng */ } }
  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch (e) { /* bỏ qua */ } }
  }

  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split("/");
    const code = decodeURIComponent(parts[3] || "").toLowerCase();
    const op = parts[4] || "info";

    if (op === "setup") return this.setup(await req.json(), code);
    if (!this.room) return json({ error: "Phòng \"" + code + "\" chưa được tạo trên máy chủ.", exists: false }, 404);

    if (op === "info") return json({ room: this.publicRoom() });
    if (op === "state") return json(Object.assign({ room: this.publicRoom() }, this.payload(url.searchParams.get("full") === "1")));
    if (op === "act") {
      if (req.method !== "POST") return json({ error: "Cần POST." }, 405);
      const body = await req.json().catch(() => null);
      if (!body) return json({ error: "Dữ liệu không hợp lệ." }, 400);
      const chk = await this.checkPin(body.pin);
      if (!chk.ok) return json({ error: chk.err }, 401);
      const r = await this.act(body.a);
      return json(Object.assign(r.err ? { error: r.err } : { ok: true }, this.payload()), r.err ? 400 : 200);
    }
    if (op === "ws") {
      if (req.headers.get("Upgrade") !== "websocket") return json({ error: "Cần kết nối WebSocket." }, 426);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ auth: false });
      this.send(server, Object.assign({ t: "hello", room: this.publicRoom() }, this.payload()));
      return new Response(null, { status: 101, webSocket: client });
    }
    return json({ error: "Không tìm thấy." }, 404);
  }

  async webSocketMessage(ws, message) {
    let m;
    try { m = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch (e) { return; }
    if (!m || !this.room) return;
    const att = ws.deserializeAttachment() || {};
    if (m.t === "auth") {
      const r = await this.checkPin(m.pin);
      if (r.ok) { att.auth = true; ws.serializeAttachment(att); }
      this.send(ws, { t: "auth", ok: r.ok, err: r.err || "" });
    } else if (m.t === "sync") {
      this.send(ws, Object.assign({ t: "state", room: this.publicRoom(), id: m.id }, this.payload(!!m.full)));
    } else if (m.t === "act") {
      if (!att.auth) { this.send(ws, { t: "err", id: m.id, err: "Máy này chưa nhập đúng PIN của phòng." }); return; }
      const r = await this.act(m.a);
      this.send(ws, r.err ? { t: "err", id: m.id, err: r.err } : { t: "ok", id: m.id });
    }
  }
  async webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, "bye"); } catch (e) { /* đã đóng */ } }
  async webSocketError(ws) { try { ws.close(1011, "error"); } catch (e) { /* đã đóng */ } }

  async checkPin(pin) {
    const now = Date.now();
    if (now < this.lockUntil) {
      return { ok: false, err: "Nhập sai PIN nhiều lần. Thử lại sau " + Math.ceil((this.lockUntil - now) / 60000) + " phút." };
    }
    const ok = this.room && this.room.pinHash && (await safeEqual(await sha256Hex(this.room.pinSalt + ":" + String(pin || "")), this.room.pinHash));
    if (ok) return { ok: true };
    this.fails = this.fails.filter((t) => now - t < 10 * 60000);
    this.fails.push(now);
    if (this.fails.length >= 8) { this.lockUntil = now + 10 * 60000; this.fails = []; }
    return { ok: false, err: "PIN chưa đúng." };
  }

  async act(a) {
    const now = Date.now();
    this.recent = this.recent.filter((t) => now - t < 10000);
    if (this.recent.length >= 40) return { err: "Thao tác quá nhanh, chờ vài giây rồi thử lại." };
    this.recent.push(now);
    const r = Q.apply(this.today(), a || {}, this.room, { ms: now, annEnd: this.annEnd });
    if (r.err) return r;
    this.S = r.S;
    this.annEnd = r.annEnd;
    await this.ctx.storage.put({ state: this.S, annEnd: this.annEnd });
    this.broadcast(Object.assign({ t: "state" }, this.payload()));
    return r;
  }

  async setup(body, code) {
    body = body || {};
    if (body.remove) {
      for (const ws of this.ctx.getWebSockets()) { try { ws.close(4004, "room removed"); } catch (e) { /* bỏ qua */ } }
      await this.ctx.storage.deleteAll();
      this.room = null; this.S = null; this.annEnd = 0;
      return json({ ok: true, removed: true });
    }
    const pin = String(body.pin || "").trim();
    if ((!this.room || pin) && !/^\d{4,8}$/.test(pin)) return json({ error: "PIN gọi số phải gồm 4 đến 8 chữ số." }, 400);
    const room = Q.cleanRoom(body.room);
    let salt = this.room ? this.room.pinSalt : "", hash = this.room ? this.room.pinHash : "";
    const pinChanged = !!pin;
    if (pinChanged) { salt = randomHex(16); hash = await sha256Hex(salt + ":" + pin); }
    this.room = Object.assign(room, { pinSalt: salt, pinHash: hash, updated: Date.now() });
    this.code = code;
    this.S = Q.normalize(this.S, this.room, Q.vnNow());
    await this.ctx.storage.put({ room: this.room, code: code, state: this.S });
    // đổi PIN thì mọi máy gọi số phải nhập lại
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (pinChanged && att.auth) { att.auth = false; ws.serializeAttachment(att); this.send(ws, { t: "auth", ok: false, err: "PIN của phòng vừa được đổi." }); }
    }
    this.broadcast(Object.assign({ t: "room", room: this.publicRoom() }, this.payload()));
    return json({ ok: true, room: this.publicRoom() });
  }
}
