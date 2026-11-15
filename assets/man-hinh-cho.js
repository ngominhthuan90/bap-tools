/* =====================================================================
   Gọi số — màn hình chờ (TV phòng chờ)
   Mở bằng: man-hinh-cho.html?server=<địa chỉ máy chủ>&room=<mã phòng>
   Không có tham số: chế độ một máy (cùng máy với bàn gọi, VD màn hình thứ hai).
   Thêm &auto=1 để bỏ qua màn "Bấm để bắt đầu" (khi trình duyệt cho tự phát tiếng).
   ===================================================================== */
(function () {
  "use strict";
  var $ = BT.$, Q = window.GoiSoQueue, V = window.GoiSoVoice, UI = window.GoiSoUI, C = window.GoiSoClient;
  var params = new URLSearchParams(location.search), CFG = window.GOISO_CONFIG || {};
  var server = params.get("server") || "", code = params.get("room") || "";
  if (!server && !params.has("local") && CFG.server && CFG.room) { server = CFG.server; code = CFG.room; }
  var KEY = "goiso-tv";
  var tv = Object.assign({ muted: false, light: false }, BT.store.get(KEY, {}));
  var client, room = null, S = null, floor = -1, showing = null, showTimer = 0, started = false;
  var DAYS = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

  function saveTv() { BT.store.set(KEY, tv); }
  function cname(i) { return room && room.counters[i - 1] ? room.counters[i - 1].name : "Quầy " + i; }

  /* ---------------- Đồng hồ ---------------- */
  function tick() {
    var ms = Date.now() + (client ? client.offset || 0 : 0), now = Q.vnNow(ms);
    $("#clock").textContent = now.time.slice(0, 5);
    var d = new Date(ms + 7 * 3600 * 1000);
    $("#date").textContent = DAYS[d.getUTCDay()] + ", " + now.date;
  }
  setInterval(tick, 1000); tick();

  /* ---------------- Hiển thị ---------------- */
  function render() {
    if (!room) return;
    $("#title").textContent = room.name;
    document.title = room.name + " · Màn hình chờ";
    $("#notice").textContent = room.notice || "";
    var cur = showing || (S && S.cur) || null;
    var call = $("#call");
    call.classList.toggle("idle", !cur);
    $("#lead").textContent = (UI.get().lead || "Mời bệnh nhân số");
    $("#num").textContent = cur ? Q.label(room, cur.q, cur.n) : "---";
    $("#to").textContent = cur ? "đến " + cname(cur.q) : "Chưa gọi số nào";
    // các quầy
    var n = room.counters.length, two = n > 6, rows = two ? Math.ceil(n / 2) : n;
    var board = $("#board");
    board.classList.toggle("two", two);
    board.classList.toggle("one", !two);
    board.style.setProperty("--rows", Math.max(rows, 4));
    board.style.setProperty("--fs", Math.max(2.2, Math.min(4.2, 24 / Math.max(rows, 4))).toFixed(2) + "vh");
    board.innerHTML = room.counters.map(function (c, k) {
      var L = S && S.lanes[k] ? S.lanes[k] : {};
      var hot = cur && cur.q === k + 1;
      return '<div class="lane' + (hot ? " hot" : "") + '"><span class="nm">' + BT.esc(c.name) + '</span><span class="n">' +
        (L.cur ? Q.label(room, k + 1, L.cur) : "---") + "</span></div>";
    }).join("");
    // vừa gọi
    var seen = {}, recent = [];
    if (S) for (var i = S.hist.length - 1; i >= 0 && recent.length < 3; i--) {
      var h = S.hist[i], key = h.q + ":" + h.n;
      if (seen[key] || (cur && cur.q === h.q && cur.n === h.n)) { seen[key] = 1; continue; }
      seen[key] = 1; recent.push(h);
    }
    $("#recent").innerHTML = recent.length ? "Vừa gọi " + recent.map(function (h) {
      return "<span><b>" + Q.label(room, h.q, h.n) + "</b> " + BT.esc(cname(h.q)) + "</span>";
    }).join("") : "";
  }
  function setShowing(a, holdMs) {
    showing = { n: a.n, q: a.q };
    clearTimeout(showTimer);
    if (holdMs) showTimer = setTimeout(function () { showing = null; render(); }, holdMs);
    var call = $("#call");
    call.classList.remove("hot"); void call.offsetWidth; call.classList.add("hot");
    render();
  }
  V.onStart = function (it) { if (it.meta) setShowing(it.meta); };
  V.onEnd = function (it) {
    if (!it.meta) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(function () { if (!V.busy()) { showing = null; render(); } }, 1500);
  };

  /* ---------------- Thông báo mới ---------------- */
  function handleAnn(info) {
    if (!S || !S.ann) return;
    var maxId = S.ann.reduce(function (m, a) { return Math.max(m, a.id); }, 0);
    if (floor < 0 || info.first) { floor = maxId; return; }
    var now = Date.now(), off = client.offset || 0;
    S.ann.slice().sort(function (a, b) { return a.id - b.id; }).forEach(function (a) {
      if (a.id <= floor) return;
      floor = Math.max(floor, a.id);
      var at = a.at - off;
      if (at < now - 20000) return; // thông báo đã quá cũ (VD vừa nối lại mạng)
      if (tv.muted || !started || !V.supported) { setShowing(a, 8000); return; }
      var o = UI.get();
      V.enqueue({ text: Q.speech(room, a.q, a.n, { digits: o.digits, lead: o.lead }), at: at, opt: o, meta: a });
    });
  }

  /* ---------------- Kết nối ---------------- */
  function onStatus(kind, text) {
    var bad = /offline|error|noroom/.test(kind);
    $("#dot").classList.toggle("bad", bad);
    $("#dot").title = text;
    $("#net").hidden = !bad;
    $("#net").textContent = text;
  }
  function freshDay() {
    if (!S || !room) return false;
    var now = Q.vnNow(Date.now() + (client ? client.offset || 0 : 0));
    if (S.date === now.date) return false;
    S = Q.normalize(S, room, now);
    return true;
  }
  function onState(r, s, info) { room = r; S = s; freshDay(); render(); handleAnn(info); }
  setInterval(function () { if (freshDay()) { showing = null; render(); } }, 30000);
  client = new C({ server: server, room: code, onState: onState, onStatus: onStatus, alwaysPoll: true }).start();

  /* ---------------- Bắt đầu, nút góc, phím tắt ---------------- */
  function voiceLine() {
    var list = V.voices(), o = UI.get();
    var v = list.filter(function (x) { return x.name === o.voice; })[0] || list[0];
    var el = $("#startVoice");
    el.textContent = v ? "Giọng đọc: " + v.name : UI.NO_VOICE;
    el.className = v ? "" : "warn";
  }
  $("#startRoom").textContent = server ? "Phòng " + code + " trên máy chủ " + server.replace(/^https?:\/\//, "") : "Chế độ một máy: nhận số từ bàn gọi mở trên cùng máy này.";
  if (V.supported) V.onVoices(voiceLine); else voiceLine();
  function fullscreen() {
    try {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
    } catch (e) {}
  }
  function start() {
    if (started) return;
    started = true;
    V.unlock();
    $("#start").hidden = true;
    try { document.documentElement.requestFullscreen(); } catch (e) {}
  }
  $("#start").addEventListener("click", start);
  $("#start").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); start(); } });
  if (params.get("auto") === "1") { started = true; $("#start").hidden = true; }

  function syncButtons() {
    document.body.classList.toggle("light", !!tv.light);
    $("#bMute").textContent = tv.muted ? "Bật tiếng" : "Tắt tiếng";
    $("#bTheme").textContent = tv.light ? "Nền tối" : "Nền sáng";
  }
  syncButtons();
  $("#bFull").addEventListener("click", fullscreen);
  $("#bMute").addEventListener("click", function () { tv.muted = !tv.muted; saveTv(); syncButtons(); if (tv.muted) V.stop(); });
  $("#bTheme").addEventListener("click", function () { tv.light = !tv.light; saveTv(); syncButtons(); });
  $("#bSet").addEventListener("click", function () {
    var d = $("#drawer");
    d.hidden = !d.hidden;
    if (!d.hidden) UI.voiceForm($("#voiceBox"), function () { return { room: room || Q.cleanRoom({}), q: 1, n: 125 }; });
  });
  $("#drawerClose").addEventListener("click", function () { $("#drawer").hidden = true; voiceLine(); render(); });
  document.addEventListener("keydown", function (e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    var k = e.key.toLowerCase();
    if (k === "f") fullscreen();
    else if (k === "m") $("#bMute").click();
  });
  // hiện nút khi rê chuột, ẩn cả con trỏ sau 3 giây đứng yên
  var mt = 0;
  document.addEventListener("mousemove", function () {
    document.body.classList.add("mouse"); document.body.classList.remove("nocursor");
    clearTimeout(mt);
    mt = setTimeout(function () {
      if (!$("#drawer").hidden) return;
      document.body.classList.remove("mouse"); document.body.classList.add("nocursor");
    }, 3000);
  });
})();
