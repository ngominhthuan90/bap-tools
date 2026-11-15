/* =====================================================================
   Gọi số — kết nối giữa các máy
   - Chế độ "Một máy": không cần máy chủ. Bàn gọi và màn hình chờ mở trên
     cùng một máy (VD màn hình thứ hai), đồng bộ qua BroadcastChannel.
   - Chế độ "Nhiều máy": WebSocket tới máy chủ riêng (Cloudflare Worker),
     tự nối lại khi rớt mạng; mạng chặn WebSocket thì chuyển sang hỏi định kỳ.
   ===================================================================== */
(function () {
  "use strict";
  var Q = window.GoiSoQueue;
  var LS_ROOM = "bt:goiso-local-room", LS_STATE = "bt:goiso-local-state", CH = "bt-goiso-local";

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function trimUrl(u) { return String(u || "").trim().replace(/\/+$/, ""); }

  function Client(opt) {
    this.o = opt || {};
    this.server = trimUrl(this.o.server);
    this.code = String(this.o.room || "").trim().toLowerCase();
    this.pin = this.o.pin || "";
    this.mode = this.server ? "server" : "local";
    this.room = null; this.S = null; this.offset = 0;
    this.authed = this.mode === "local";
    this.ws = null; this.seq = 0; this.pending = {};
    this.tries = 0; this.opened = false; this.stopped = false; this.polling = false;
  }
  var P = Client.prototype;
  P.emit = function (name) {
    var fn = this.o[name];
    if (fn) fn.apply(null, Array.prototype.slice.call(arguments, 1));
  };
  P.status = function (kind, text) { this.kind = kind; this.emit("onStatus", kind, text || ""); };
  P.serverNow = function () { return Date.now() + this.offset; };

  /* ------------------------- Một máy ------------------------- */
  Client.localRoom = function () { return Q.cleanRoom(lsGet(LS_ROOM) || { name: "Phòng chờ khám bệnh" }); };
  Client.saveLocalRoom = function (room) {
    room = Q.cleanRoom(room);
    lsSet(LS_ROOM, room);
    try { new BroadcastChannel(CH).postMessage({ t: "room", room: room }); } catch (e) {}
    return room;
  };
  P.startLocal = function () {
    var self = this;
    this.room = Client.localRoom();
    this.S = Q.normalize(lsGet(LS_STATE), this.room, Q.vnNow());
    try {
      this.bc = new BroadcastChannel(CH);
      this.bc.onmessage = function (e) {
        var m = e.data || {};
        if (m.t === "room") { self.room = Q.cleanRoom(m.room); self.S = Q.normalize(self.S, self.room, Q.vnNow()); self.emit("onState", self.room, self.S, { room: true }); }
        if (m.t === "state") { self.S = m.s; self.annEnd = m.annEnd || 0; self.emit("onState", self.room, self.S, {}); }
      };
    } catch (e) { /* trình duyệt quá cũ: dùng sự kiện storage bên dưới */ }
    this.onStorage = function (e) {
      if (e.key === LS_STATE && e.newValue && !self.bc) { try { self.S = JSON.parse(e.newValue); self.emit("onState", self.room, self.S, {}); } catch (x) {} }
    };
    window.addEventListener("storage", this.onStorage);
    this.status("local", "Một máy, không cần máy chủ");
    this.emit("onState", this.room, this.S, { first: true });
    // sang ngày mới khi trang mở qua đêm
    this.dayTimer = setInterval(function () {
      var d = Q.vnNow().date;
      if (self.S && self.S.date !== d) { self.S = Q.normalize(self.S, self.room, Q.vnNow()); self.emit("onState", self.room, self.S, {}); }
    }, 60000);
  };
  P.actLocal = function (a) {
    var r = Q.apply(this.S, a, this.room, { ms: Date.now(), annEnd: this.annEnd || 0 });
    if (r.err) return Promise.resolve({ ok: false, err: r.err });
    this.S = r.S; this.annEnd = r.annEnd;
    lsSet(LS_STATE, this.S);
    if (this.bc) this.bc.postMessage({ t: "state", s: this.S, annEnd: this.annEnd });
    this.emit("onState", this.room, this.S, { own: true });
    return Promise.resolve({ ok: true });
  };

  /* ------------------------- Nhiều máy ------------------------- */
  P.url = function (op) { return this.server + "/api/rooms/" + encodeURIComponent(this.code) + "/" + op; };
  P.startServer = function () {
    var self = this;
    if (!/^https?:\/\//i.test(this.server)) { this.status("error", "Địa chỉ máy chủ phải bắt đầu bằng https://"); return; }
    if (!this.code) { this.status("error", "Chưa nhập mã phòng."); return; }
    this.status("connecting", "Đang kết nối máy chủ...");
    fetch(this.url("info"), { cache: "no-store" }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { st: r.status, j: j }; });
    }).then(function (x) {
      if (self.stopped) return;
      if (x.st === 404) { self.status("noroom", x.j.error || "Phòng chưa được tạo trên máy chủ."); self.retry(30000); return; }
      if (x.st !== 200) { self.status("error", x.j.error || "Máy chủ trả lỗi " + x.st + "."); self.retry(15000); return; }
      self.room = Q.cleanRoom(x.j.room);
      self.openWs();
    }).catch(function () {
      if (self.stopped) return;
      self.status("offline", "Không kết nối được máy chủ. Đang thử lại...");
      self.retry();
    });
  };
  P.retry = function (ms) {
    var self = this;
    clearTimeout(this.rt);
    this.tries++;
    var wait = ms || Math.min(15000, 1000 * Math.pow(2, Math.min(this.tries, 4)));
    this.rt = setTimeout(function () { if (!self.stopped) self.startServer(); }, wait);
  };
  P.openWs = function () {
    var self = this, url = this.url("ws").replace(/^http/i, "ws");
    var ws;
    try { ws = new WebSocket(url); } catch (e) { this.startPolling(); return; }
    this.ws = ws;
    var opened = false;
    ws.onopen = function () {
      opened = true; self.opened = true; self.tries = 0; self.polling = false;
      clearInterval(self.pt);
      self.status("online", "Đã kết nối máy chủ");
      if (self.pin) ws.send(JSON.stringify({ t: "auth", pin: self.pin }));
      clearInterval(self.ping);
      self.ping = setInterval(function () { try { ws.send("ping"); } catch (e) {} }, 25000);
    };
    ws.onmessage = function (e) {
      if (e.data === "pong") return;
      var m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (m.now) self.offset = m.now - Date.now();
      if (m.t === "hello" || m.t === "state" || m.t === "room") {
        if (m.room) self.room = Q.cleanRoom(m.room);
        if (m.s) self.S = m.s;
        self.emit("onState", self.room, self.S, { first: m.t === "hello", room: m.t === "room" || m.t === "hello" });
        if (m.id && self.pending[m.id]) { self.pending[m.id]({ ok: true, s: m.s }); delete self.pending[m.id]; }
      } else if (m.t === "auth") {
        self.authed = !!m.ok;
        self.emit("onAuth", self.authed, m.err || "");
      } else if (m.t === "ok" || m.t === "err") {
        var cb = self.pending[m.id];
        if (cb) { delete self.pending[m.id]; cb(m.t === "ok" ? { ok: true } : { ok: false, err: m.err }); }
      }
    };
    ws.onclose = function (ev) {
      clearInterval(self.ping);
      if (self.ws !== ws || self.stopped) return;
      self.ws = null;
      if (ev.code === 4004) { self.status("noroom", "Phòng vừa bị xoá trên máy chủ."); return; }
      if (!opened && self.tries >= 2) { self.startPolling(); return; } // mạng chặn WebSocket
      self.status("offline", "Mất kết nối máy chủ, đang nối lại...");
      self.retry();
    };
  };
  // Dự phòng khi mạng bệnh viện chặn WebSocket: hỏi định kỳ (tốn lượt hơn)
  P.startPolling = function () {
    var self = this;
    if (this.polling) return;
    this.polling = true;
    this.status("polling", "Mạng chặn kết nối liên tục, đang hỏi máy chủ định kỳ");
    function tick() {
      if (self.stopped || !self.polling) return;
      if (document.hidden && !self.o.alwaysPoll) return;
      fetch(self.url("state"), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.now) self.offset = j.now - Date.now();
        if (j.room) self.room = Q.cleanRoom(j.room);
        if (j.s && (!self.S || j.s.ver !== self.S.ver || j.s.date !== self.S.date)) { self.S = j.s; self.emit("onState", self.room, self.S, {}); }
      }).catch(function () {});
    }
    tick();
    clearInterval(this.pt);
    this.pt = setInterval(tick, 4000);
    if (this.pin) this.checkPinHttp();
    // thử lại WebSocket mỗi 2 phút
    clearTimeout(this.wsRetry);
    this.wsRetry = setTimeout(function () { if (self.polling && !self.stopped) { self.tries = 0; self.openWs(); } }, 120000);
  };
  P.checkPinHttp = function () {
    var self = this;
    this.http({ type: "noop" }).then(function (r) {
      var ok = !(r && r.status === 401);
      self.authed = ok;
      self.emit("onAuth", ok, ok ? "" : (r.error || "PIN chưa đúng."));
    });
  };
  P.http = function (a) {
    var self = this;
    return fetch(this.url("act"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: this.pin, a: a }) })
      .then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); })
      .then(function (j) {
        if (j.now) self.offset = j.now - Date.now();
        if (j.s) { self.S = j.s; self.emit("onState", self.room, self.S, { own: true }); }
        return j;
      });
  };
  P.actServer = function (a) {
    var self = this;
    if (this.ws && this.ws.readyState === 1) {
      return new Promise(function (resolve) {
        var id = ++self.seq;
        self.pending[id] = resolve;
        self.ws.send(JSON.stringify({ t: "act", id: id, a: a }));
        setTimeout(function () {
          if (self.pending[id]) { delete self.pending[id]; resolve({ ok: false, err: "Máy chủ chưa phản hồi. Kiểm tra mạng rồi thử lại." }); }
        }, 8000);
      });
    }
    return this.http(a).then(function (j) {
      return j.status === 200 ? { ok: true } : { ok: false, err: j.error || "Không gửi được lên máy chủ." };
    }, function () { return { ok: false, err: "Không kết nối được máy chủ." }; });
  };

  /* ------------------------- Chung ------------------------- */
  P.start = function () { if (this.mode === "local") this.startLocal(); else this.startServer(); return this; };
  P.act = function (a) { return this.mode === "local" ? this.actLocal(a) : this.actServer(a); };
  P.setPin = function (pin) {
    this.pin = pin;
    if (this.mode !== "server") return;
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: "auth", pin: pin }));
    else if (this.polling) this.checkPinHttp();
  };
  // Lấy toàn bộ lịch sử trong ngày (để xuất CSV)
  P.fullState = function () {
    if (this.mode === "local") return Promise.resolve(this.S);
    return fetch(this.url("state") + "?full=1", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { return j.s; });
  };
  P.stop = function () {
    this.stopped = true;
    clearTimeout(this.rt); clearInterval(this.pt); clearInterval(this.ping); clearInterval(this.dayTimer); clearTimeout(this.wsRetry);
    if (this.ws) { try { this.ws.close(1000, "bye"); } catch (e) {} this.ws = null; }
    if (this.bc) { try { this.bc.close(); } catch (e) {} }
    if (this.onStorage) window.removeEventListener("storage", this.onStorage);
  };

  // Gửi thiết lập phòng lên máy chủ (cần mã quản trị)
  Client.setupRoom = function (server, code, body) {
    return fetch(trimUrl(server) + "/api/rooms/" + encodeURIComponent(String(code).trim().toLowerCase()) + "/setup", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); });
  };

  window.GoiSoClient = Client;
})();
