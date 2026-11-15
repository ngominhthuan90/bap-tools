/* =====================================================================
   Gọi số khám bệnh — phần lõi dùng chung cho trình duyệt và máy chủ
   (Cloudflare Worker nhập chính file này, nên hai bên luôn tính giống nhau).
   - Trạng thái hàng đợi trong ngày, tự làm mới khi sang ngày (giờ Việt Nam).
   - Hai cách đánh số: "chung" (mọi quầy gọi chung một dãy số) hoặc
     "riêng" (mỗi quầy/phòng có dãy số riêng).
   - Đọc số tiếng Việt: "một trăm hai mươi lăm" hoặc từng chữ số.
   ===================================================================== */
(function (G) {
  "use strict";
  var MAX_HIST = 2000, MAX_ANN = 30, MAX_COUNTERS = 20, MAX_NUM = 9999;

  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // Ngày giờ theo múi giờ Việt Nam (UTC+7), không phụ thuộc giờ máy
  function vnNow(ms) {
    var d = new Date((ms == null ? Date.now() : ms) + 7 * 3600 * 1000);
    return {
      date: p2(d.getUTCDate()) + "/" + p2(d.getUTCMonth() + 1) + "/" + d.getUTCFullYear(),
      time: p2(d.getUTCHours()) + ":" + p2(d.getUTCMinutes()) + ":" + p2(d.getUTCSeconds())
    };
  }

  /* ---------------- Cấu hình phòng ---------------- */
  function cleanRoom(r) {
    r = r || {};
    var counters = (Array.isArray(r.counters) ? r.counters : []).map(function (c) {
      var name = String((c && c.name) != null ? c.name : c || "").replace(/\s+/g, " ").trim().slice(0, 40);
      var prefix = String((c && c.prefix) || "").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 2);
      return { name: name, prefix: prefix };
    }).filter(function (c) { return c.name; }).slice(0, MAX_COUNTERS);
    if (!counters.length) counters = [{ name: "Quầy số 1", prefix: "" }, { name: "Quầy số 2", prefix: "" }];
    return {
      name: String(r.name || "Phòng chờ khám bệnh").replace(/\s+/g, " ").trim().slice(0, 60),
      mode: r.mode === "separate" ? "separate" : "shared",
      digits: clamp(parseInt(r.digits, 10) || 3, 1, 4),
      counters: counters,
      notice: String(r.notice || "").replace(/\s+/g, " ").trim().slice(0, 200)
    };
  }

  /* ---------------- Trạng thái trong ngày ---------------- */
  function fresh(date, room, prev) {
    var lanes = [];
    for (var i = 0; i < room.counters.length; i++) lanes.push({ cur: 0, t: "", last: 0, issued: 0, served: 0 });
    return { date: date, last: 0, issued: 0, cur: null, lanes: lanes, hist: [], skipped: [], ann: [],
      aid: prev ? prev.aid || 0 : 0, ver: prev ? (prev.ver || 0) + 1 : 1 };
  }
  // Bảo đảm trạng thái đúng ngày và khớp số quầy hiện tại
  function normalize(S, room, now) {
    if (!S || S.date !== now.date || !Array.isArray(S.lanes)) return fresh(now.date, room, S);
    while (S.lanes.length < room.counters.length) S.lanes.push({ cur: 0, t: "", last: 0, issued: 0, served: 0 });
    if (S.lanes.length > room.counters.length) S.lanes.length = room.counters.length;
    if (S.cur && S.cur.q > room.counters.length) S.cur = null;
    return S;
  }
  function clone(S) { return S ? JSON.parse(JSON.stringify(S)) : S; }

  /* Áp dụng 1 thao tác. Trả về { S, err, annEnd }.
     a: { type: next|call|recall|skip|unskip|issued|reset, q (1..), n, d (thời lượng đọc, ms) }
     ctx: { ms: thời điểm máy chủ, annEnd: lúc đọc xong thông báo trước đó } */
  function apply(S0, a, room, ctx) {
    var ms = ctx && ctx.ms != null ? ctx.ms : Date.now();
    var now = vnNow(ms);
    var S = normalize(clone(S0), room, now);
    var annEnd = (ctx && ctx.annEnd) || 0;
    var shared = room.mode !== "separate";
    var nL = room.counters.length;
    var q = parseInt(a && a.q, 10);
    if (!(q >= 1 && q <= nL)) q = 1;
    var L = S.lanes[q - 1];
    var type = a && a.type;

    function announce(n) {
      var dur = clamp(parseInt(a.d, 10) || 6500, 2500, 20000);
      var at = Math.max(ms + 300, annEnd);
      S.ann.push({ id: (S.aid = (S.aid || 0) + 1), n: n, q: q, at: at });
      if (S.ann.length > MAX_ANN) S.ann.splice(0, S.ann.length - MAX_ANN);
      annEnd = at + dur;
    }
    function unskip(n) {
      S.skipped = S.skipped.filter(function (x) { return !(x.n === n && (shared || x.q === q)); });
    }
    function call(n, kind) {
      if (L.cur && L.cur !== n) L.served++;
      L.cur = n; L.t = now.time;
      if (shared) { if (n > S.last) S.last = n; } else if (n > L.last) L.last = n;
      S.cur = { n: n, q: q, t: now.time };
      S.hist.push({ n: n, q: q, t: now.time, k: kind });
      if (S.hist.length > MAX_HIST) S.hist.splice(0, S.hist.length - MAX_HIST);
      unskip(n);
      announce(n);
    }

    if (type === "next") {
      var n = (shared ? S.last : L.last) + 1;
      if (n > MAX_NUM) return { S: S0, err: "Đã hết dãy số trong ngày (" + MAX_NUM + ")." };
      call(n, "next");
    } else if (type === "call") {
      var m = parseInt(a.n, 10);
      if (!(m >= 1 && m <= MAX_NUM)) return { S: S0, err: "Số thứ tự phải từ 1 đến " + MAX_NUM + "." };
      call(m, "call");
    } else if (type === "recall") {
      if (!L.cur) return { S: S0, err: "Quầy này chưa gọi số nào." };
      S.cur = { n: L.cur, q: q, t: now.time };
      S.hist.push({ n: L.cur, q: q, t: now.time, k: "recall" });
      announce(L.cur);
    } else if (type === "skip") {
      if (!L.cur) return { S: S0, err: "Quầy này chưa gọi số nào." };
      var exists = S.skipped.some(function (x) { return x.n === L.cur && (shared || x.q === q); });
      if (!exists) S.skipped.push({ n: L.cur, q: q, t: now.time });
    } else if (type === "unskip") {
      unskip(parseInt(a.n, 10));
    } else if (type === "issued") {
      var v = clamp(parseInt(a.n, 10) || 0, 0, MAX_NUM);
      if (shared) S.issued = v; else L.issued = v;
    } else if (type === "reset") {
      S = fresh(now.date, room, S);
      annEnd = 0;
    } else {
      return { S: S0, err: "Thao tác không hợp lệ." };
    }
    S.ver = (S.ver || 0) + 1;
    return { S: S, annEnd: annEnd };
  }

  /* ---------------- Hiển thị ---------------- */
  function label(room, q, n) {
    if (!n) return "---";
    var c = room.counters[q - 1];
    return (c && room.mode === "separate" ? c.prefix : "") + pad(n, room.digits);
  }
  function waiting(S, room, q) {
    if (!S) return null;
    if (room.mode !== "separate") return S.issued ? Math.max(0, S.issued - S.last) : null;
    var L = S.lanes[q - 1];
    return L && L.issued ? Math.max(0, L.issued - L.last) : null;
  }
  function nextNumber(S, room, q) {
    if (!S) return 1;
    return (room.mode !== "separate" ? S.last : (S.lanes[q - 1] || {}).last || 0) + 1;
  }

  /* ---------------- Đọc số tiếng Việt ---------------- */
  var D = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
  function tens(x, hasHigher) {
    var t = Math.floor(x / 10), u = x % 10;
    if (t === 0) return hasHigher ? (u ? "linh " + D[u] : "") : D[u];
    if (t === 1) return "mười" + (u === 0 ? "" : u === 5 ? " lăm" : " " + D[u]);
    var s = D[t] + " mươi";
    if (u === 0) return s;
    if (u === 1) return s + " mốt";
    if (u === 4) return s + " tư";
    if (u === 5) return s + " lăm";
    return s + " " + D[u];
  }
  function readNumber(n) {
    n = Math.floor(Math.abs(n));
    if (n < 100) return tens(n, false);
    if (n < 1000) {
      var r = n % 100;
      return D[Math.floor(n / 100)] + " trăm" + (r ? " " + tens(r, true) : "");
    }
    if (n < 10000) {
      var k = Math.floor(n / 1000), rest = n % 1000, s = D[k] + " nghìn";
      if (!rest) return s;
      if (rest < 100) return s + " không trăm " + tens(rest, true);
      return s + " " + readNumber(rest);
    }
    return String(n);
  }
  function readDigits(str) {
    return String(str).split("").map(function (c) { return /\d/.test(c) ? D[+c] : c; }).join(" ");
  }
  // Câu đọc: "Mời bệnh nhân số một trăm hai mươi lăm, đến quầy số 2"
  function speech(room, q, n, opt) {
    opt = opt || {};
    var c = room.counters[q - 1] || { name: "quầy số " + q, prefix: "" };
    var shown = label(room, q, n);
    var pre = room.mode === "separate" && c.prefix ? c.prefix.split("").join(" ") + " " : "";
    var num = opt.digits ? readDigits(shown.replace(/^[A-Z]+/, "")) : readNumber(n);
    var lead = (opt.lead || "Mời bệnh nhân số").trim();
    var to = c.name.charAt(0).toLocaleLowerCase("vi-VN") + c.name.slice(1);
    return lead + " " + pre + num + ", đến " + to;
  }

  var api = {
    vnNow: vnNow, cleanRoom: cleanRoom, fresh: fresh, normalize: normalize, apply: apply,
    label: label, waiting: waiting, nextNumber: nextNumber,
    readNumber: readNumber, readDigits: readDigits, speech: speech, pad: pad, MAX_COUNTERS: MAX_COUNTERS
  };
  G.GoiSoQueue = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
