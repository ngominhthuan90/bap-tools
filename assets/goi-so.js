/* =====================================================================
   Gọi số khám bệnh — bàn gọi
   Phím tắt: Space gọi số tiếp, R gọi lại, B vắng mặt, G gọi số cụ thể.
   ===================================================================== */
(function () {
  "use strict";
  var $ = BT.$, Q = window.GoiSoQueue, V = window.GoiSoVoice, UI = window.GoiSoUI, C = window.GoiSoClient;
  var CFG = window.GOISO_CONFIG || {};
  var KEY = "goiso-conn";
  var conn = Object.assign({ mode: CFG.server ? "server" : "local", server: CFG.server || "", room: CFG.room || "", pin: "", speak: false, counter: 1 },
    BT.store.get(KEY, {}));
  if (!conn.server && CFG.server) conn.server = CFG.server;
  var client = null, room = null, S = null, filter = "all", floor = -1, authed = true, lastCur = {};

  function save() { BT.store.set(KEY, conn); }
  function q() { return BT.clamp(conn.counter || 1, 1, room ? room.counters.length : 1); }
  function cname(i) { return room && room.counters[i - 1] ? room.counters[i - 1].name : "Quầy " + i; }
  function lab(i, n) { return room ? Q.label(room, i, n) : String(n); }
  function status(msg, kind) { var e = $("#status"); e.textContent = msg || ""; e.className = "status" + (kind ? " " + kind : ""); }

  /* ------------------------- Kết nối ------------------------- */
  function connect() {
    if (client) client.stop();
    floor = -1; S = null;
    authed = conn.mode !== "server";
    client = new C({
      server: conn.mode === "server" ? conn.server : "", room: conn.room, pin: conn.pin,
      onState: onState, onStatus: onStatus, onAuth: onAuth
    }).start();
    $("#copyTv").hidden = conn.mode !== "server";
    lockUI();
  }
  var lastStatus = ["local", ""];
  function showConn() {
    var kind = lastStatus[0], text = lastStatus[1];
    $("#conn").className = "conn " + kind;
    $("#connText").textContent = conn.mode === "server" && kind === "online" ? text + ", phòng " + conn.room : text;
  }
  function onStatus(kind, text) {
    lastStatus = [kind, text];
    showConn();
    if (kind === "noroom" || kind === "error") status(text + (kind === "noroom" ? " Bấm Thiết lập để tạo phòng." : ""), "err");
    lockUI();
  }
  function onAuth(ok, err) {
    authed = ok;
    if (!ok && err) status(err === "PIN chưa đúng." ? "PIN chưa đúng. Máy này chỉ xem được cho đến khi nhập đúng PIN." : err, "err");
    if (ok) status("Đã mở khoá, máy này gọi số được.", "ok");
    lockUI();
  }
  function lockUI() {
    var need = conn.mode === "server" && client && client.kind !== "noroom";
    $("#lock").hidden = !(need && !authed && room);
    var off = !room || !S || (conn.mode === "server" && !authed);
    ["#next", "#recall", "#skip"].forEach(function (id) { $(id).disabled = off; });
    BT.$$("#callForm button, #issuedForm button, #reset").forEach(function (b) { b.disabled = off; });
  }
  function freshDay() {
    if (!S || !room) return false;
    var now = Q.vnNow(Date.now() + (client ? client.offset || 0 : 0));
    if (S.date === now.date) return false;
    S = Q.normalize(S, room, now);
    return true;
  }
  setInterval(function () { if (freshDay()) render(); }, 30000);
  function onState(r, s, info) {
    var roomChanged = !room || info.room || info.first;
    room = r; S = s;
    freshDay();
    if (roomChanged) renderCounters();
    render();
    handleAnn(info);
    lockUI();
  }

  /* ------------------------- Hiển thị ------------------------- */
  function renderCounters() {
    if (!room) return;
    $("#roomName").textContent = room.name;
    document.title = room.name + " · Gọi số";
    $("#counter").innerHTML = room.counters.map(function (c, i) { return '<option value="' + (i + 1) + '">' + BT.esc(c.name) + "</option>"; }).join("");
    $("#counter").value = String(q());
    $("#issuedLbl").textContent = room.mode === "separate" ? "Đã phát phiếu của quầy này đến số" : "Đã phát phiếu đến số";
  }
  function render() {
    if (!room || !S) return;
    var i = q(), L = S.lanes[i - 1] || {};
    var num = $("#num"), cur = L.cur ? lab(i, L.cur) : "---";
    if (num.textContent !== cur) {
      num.textContent = cur;
      if (L.cur && lastCur[i] !== undefined) { var t = $("#ticket"); t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop"); }
    }
    lastCur[i] = L.cur;
    $("#to").textContent = L.cur ? cname(i) + (L.t ? ", lúc " + L.t.slice(0, 5) : "") : "Chưa gọi số nào";
    $("#nextNo").textContent = "(số " + lab(i, Q.nextNumber(S, room, i)) + ")";
    // các quầy
    $("#lanes").innerHTML = room.counters.map(function (c, k) {
      var l = S.lanes[k] || {};
      return '<div class="lane' + (k + 1 === i ? " me" : "") + '"><span>' + BT.esc(c.name) + "</span><b>" + (l.cur ? lab(k + 1, l.cur) : "---") +
        "</b><span>" + (l.t ? "Gọi lúc " + l.t.slice(0, 5) : "Chưa gọi") + "</span></div>";
    }).join("");
    // đang chờ
    var w = Q.waiting(S, room, i), issued = room.mode === "separate" ? L.issued : S.issued;
    $("#issued").placeholder = issued ? String(issued) : "VD: 120";
    $("#waitText").innerHTML = w == null ? '<span class="note">Nhập số phiếu đã phát để biết còn bao nhiêu người chờ.</span>' : "Còn <b>" + w + "</b> người đang chờ.";
    renderHist();
  }
  function renderHist() {
    var absent = {}, shared = room.mode !== "separate";
    S.skipped.forEach(function (x) { absent[shared ? x.n : x.q + ":" + x.n] = 1; });
    $("#absN").textContent = S.skipped.length;
    var seen = {}, rows = [];
    for (var k = S.hist.length - 1; k >= 0; k--) {
      var h = S.hist[k], key = shared ? h.n : h.q + ":" + h.n;
      if (seen[key]) { seen[key].times++; continue; }
      seen[key] = { h: h, times: 1, absent: !!absent[key] };
      rows.push(seen[key]);
    }
    if (filter === "absent") rows = rows.filter(function (r) { return r.absent; });
    var me = q(), L = S.lanes[me - 1] || {};
    if (!rows.length) {
      $("#hist").innerHTML = '<li class="empty">' + (filter === "absent" ? "Không có ai vắng mặt." : "Chưa gọi số nào hôm nay.") + "</li>";
      return;
    }
    $("#hist").innerHTML = rows.slice(0, 120).map(function (r) {
      var h = r.h, serving = S.lanes[h.q - 1] && S.lanes[h.q - 1].cur === h.n;
      var badge = r.absent ? '<em class="absent">Vắng mặt</em>' : serving ? "<em>Đang mời</em>" : "Đã gọi";
      var canCall = !(serving && h.q === me && L.cur === h.n);
      return "<li><b>" + lab(h.q, h.n) + '</b><span class="meta">' + BT.esc(cname(h.q)) + ", " + h.t.slice(0, 5) +
        (r.times > 1 ? ", gọi " + r.times + " lần" : "") + "<br>" + badge + "</span>" +
        (canCall ? '<button type="button" class="btn btn-sm" data-call="' + h.n + '">Gọi lại</button>' : "<span></span>") + "</li>";
    }).join("");
    if (S.histTotal && S.histTotal > S.hist.length) {
      $("#hist").insertAdjacentHTML("beforeend", '<li class="empty">Đang hiện ' + S.hist.length + " lượt gần nhất. Tải .csv để xem đủ " + S.histTotal + " lượt.</li>");
    }
  }

  /* ------------------------- Đọc số trên máy gọi ------------------------- */
  function handleAnn(info) {
    if (!S || !S.ann) return;
    var maxId = S.ann.reduce(function (m, a) { return Math.max(m, a.id); }, 0);
    if (floor < 0 || info.first) { floor = maxId; return; }
    S.ann.forEach(function (a) {
      if (a.id <= floor) return;
      floor = Math.max(floor, a.id);
      if (!conn.speak || a.q !== q()) return;
      var o = UI.get();
      V.enqueue({ text: Q.speech(room, a.q, a.n, { digits: o.digits, lead: o.lead }), at: a.at - (client.offset || 0), opt: o });
    });
  }

  /* ------------------------- Thao tác ------------------------- */
  function dur(n) {
    var o = UI.get();
    return V.estimate(Q.speech(room, q(), n, { digits: o.digits, lead: o.lead }), o);
  }
  function act(a, okMsg) {
    if (!client || !room) return;
    if (conn.speak) V.unlock();
    return client.act(a).then(function (r) {
      if (!r.ok) { status(r.err || "Chưa thực hiện được.", "err"); return; }
      if (okMsg) status(okMsg(), "ok");
    });
  }
  function doNext() {
    var i = q(), n = Q.nextNumber(S, room, i);
    act({ type: "next", q: i, d: dur(n) }, function () { var L = S.lanes[i - 1]; return "Đã gọi số " + lab(i, L.cur) + " đến " + cname(i) + "."; });
  }
  function doRecall() {
    var i = q(), L = S.lanes[i - 1] || {};
    if (!L.cur) { status("Quầy này chưa gọi số nào.", "err"); return; }
    act({ type: "recall", q: i, d: dur(L.cur) }, function () { return "Đã gọi lại số " + lab(i, L.cur) + "."; });
  }
  function doSkip() {
    var i = q(), L = S.lanes[i - 1] || {};
    if (!L.cur) { status("Quầy này chưa gọi số nào.", "err"); return; }
    var n = L.cur;
    act({ type: "skip", q: i }, function () { return "Đã ghi số " + lab(i, n) + " vắng mặt. Bấm Gọi số tiếp theo, số này vẫn gọi lại được trong mục Vắng mặt."; });
  }
  function doCall(n) {
    var i = q();
    if (!(n >= 1 && n <= 9999)) { status("Nhập số thứ tự từ 1 đến 9999.", "err"); return; }
    act({ type: "call", q: i, n: n, d: dur(n) }, function () { return "Đã gọi số " + lab(i, n) + " đến " + cname(i) + "."; });
  }
  $("#next").addEventListener("click", doNext);
  $("#recall").addEventListener("click", doRecall);
  $("#skip").addEventListener("click", doSkip);
  $("#callForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = parseInt($("#callNo").value, 10);
    $("#callNo").value = "";
    doCall(n);
  });
  $("#issuedForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var n = parseInt($("#issued").value, 10);
    if (isNaN(n) || n < 0) { status("Nhập số phiếu đã phát (0 đến 9999).", "err"); return; }
    $("#issued").value = "";
    act({ type: "issued", q: q(), n: n }, function () { return "Đã lưu: đã phát phiếu đến số " + n + "."; });
  });
  $("#hist").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-call]");
    if (b) doCall(parseInt(b.getAttribute("data-call"), 10));
  });
  BT.$$(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.getAttribute("data-f");
      BT.$$(".tabs button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      if (S) renderHist();
    });
  });
  $("#counter").addEventListener("change", function () {
    conn.counter = +this.value; save(); lastCur = {}; render();
    this.blur(); // để phím tắt Space dùng được ngay
  });
  $("#reset").addEventListener("click", function () {
    if (!confirm("Xoá toàn bộ số đã gọi hôm nay? Mọi máy trong phòng đều bắt đầu lại từ số 1.")) return;
    act({ type: "reset" }, function () { return "Đã đặt lại danh sách hôm nay."; });
  });
  $("#csv").addEventListener("click", function () {
    if (!client) return;
    client.fullState().then(function (s) {
      if (!s || !s.hist.length) { status("Hôm nay chưa có lượt gọi nào.", "err"); return; }
      var kind = { next: "Gọi tiếp", call: "Gọi số cụ thể", recall: "Gọi lại" };
      var rows = ["STT,Số,Quầy,Giờ,Thao tác"];
      s.hist.forEach(function (h, i) { rows.push([i + 1, lab(h.q, h.n), '"' + cname(h.q).replace(/"/g, '""') + '"', h.t, kind[h.k] || ""].join(",")); });
      BT.download(new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" }), "goi-so-" + s.date.replace(/\//g, "-") + ".csv");
    }).catch(function () { status("Không lấy được lịch sử từ máy chủ.", "err"); });
  });
  $("#pinGo").addEventListener("click", function () {
    var p = $("#pinQuick").value.trim();
    if (!p) return;
    conn.pin = p; save(); client.setPin(p); $("#pinQuick").value = "";
  });
  $("#pinQuick").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#pinGo").click(); });

  function tvUrl(absolute) {
    var u = "man-hinh-cho.html" + (conn.mode === "server" ? "?server=" + encodeURIComponent(conn.server) + "&room=" + encodeURIComponent(conn.room) : "?local=1");
    return absolute ? new URL(u, location.href).href : u;
  }
  $("#openTv").addEventListener("click", function () { window.open(tvUrl(false), "goiso-tv", "width=1280,height=720"); });
  $("#copyTv").addEventListener("click", function () {
    var b = this, url = tvUrl(true);
    function ok() { b.textContent = "Đã chép link"; setTimeout(function () { b.textContent = "Chép link màn hình chờ"; }, 1600); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, function () { prompt("Chép link này:", url); });
    else prompt("Chép link này:", url);
  });

  // Phím tắt
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || $("#dlg").open) return;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    var k = e.key.toLowerCase();
    if (e.code === "Space") {
      // Space luôn là "Gọi số tiếp theo", kể cả khi đang chọn một nút khác (nút khác bấm bằng Enter)
      e.preventDefault();
      if (t && t !== document.body && t.blur) t.blur();
      if (!e.repeat && !$("#next").disabled) doNext();
    }
    else if (k === "r") { if (!$("#recall").disabled) doRecall(); }
    else if (k === "b") { if (!$("#skip").disabled) doSkip(); }
    else if (k === "g") { e.preventDefault(); $("#callNo").focus(); }
  });

  /* ------------------------- Thiết lập ------------------------- */
  var dlg = $("#dlg"), dMode = conn.mode, rMode = "shared";
  function seg(id, val) { BT.$$("#" + id + " button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === val)); }); }
  function syncMode() {
    seg("modeSeg", dMode);
    $("#srvFields").hidden = dMode !== "server";
    $("#adminFields").hidden = dMode !== "server";
    $("#rDelete").hidden = dMode !== "server";
    $("#modeHint").textContent = dMode === "server"
      ? "Các máy gọi số và màn hình chờ ở nhiều nơi nối với nhau qua máy chủ riêng của bạn (Cloudflare, gói miễn phí)."
      : "Bàn gọi và màn hình chờ mở trên cùng một máy, ví dụ máy có cắm thêm TV làm màn hình thứ hai. Không cần mạng.";
    $("#rSave").textContent = dMode === "server" ? "Lưu phòng lên máy chủ" : "Lưu phòng trên máy này";
  }
  function fillRoomForm(r) {
    r = r || Q.cleanRoom({});
    $("#rName").value = r.name;
    rMode = r.mode; seg("rModeSeg", rMode);
    $("#rCounters").value = r.counters.map(function (c) { return c.name + (c.prefix ? " | " + c.prefix : ""); }).join("\n");
    $("#rDigits").value = String(r.digits);
    $("#rNotice").value = r.notice || "";
    $("#prefixHint").hidden = rMode !== "separate";
  }
  function roomFromForm() {
    return Q.cleanRoom({
      name: $("#rName").value, mode: rMode, digits: $("#rDigits").value, notice: $("#rNotice").value,
      counters: $("#rCounters").value.split(/\n/).map(function (line) {
        var p = line.split("|");
        return { name: p[0], prefix: p[1] || "" };
      })
    });
  }
  function openSetup() {
    dMode = conn.mode;
    $("#fServer").value = conn.server || CFG.server || "";
    $("#fRoom").value = conn.room || "";
    $("#fPin").value = conn.pin || "";
    $("#fSpeak").checked = !!conn.speak;
    UI.voiceForm($("#voiceBox"), function () { return { room: room || Q.cleanRoom({}), q: q(), n: 125 }; });
    fillRoomForm(conn.mode === "local" ? C.localRoom() : room);
    $("#rStatus").textContent = "";
    $("#roomBox").open = conn.mode === "server" && client && client.kind === "noroom";
    syncMode();
    dlg.showModal();
  }
  $("#openSetup").addEventListener("click", openSetup);
  $("#dlgClose").addEventListener("click", function () { dlg.close(); });
  $("#modeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    dMode = b.getAttribute("data-v"); syncMode();
    fillRoomForm(dMode === "local" ? C.localRoom() : (conn.mode === "server" ? room : null));
  });
  $("#rModeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    rMode = b.getAttribute("data-v"); seg("rModeSeg", rMode); $("#prefixHint").hidden = rMode !== "separate";
  });
  $("#setupForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var server = $("#fServer").value.trim().replace(/\/+$/, ""), code = $("#fRoom").value.trim().toLowerCase();
    if (dMode === "server") {
      if (!/^https?:\/\/\S+$/i.test(server)) { $("#rStatus").textContent = ""; alert("Nhập địa chỉ máy chủ, bắt đầu bằng https://"); $("#fServer").focus(); return; }
      if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(code)) { alert("Mã phòng gồm chữ thường không dấu, số và dấu gạch ngang, dài 3–32 ký tự. VD: kkb-tang1"); $("#fRoom").focus(); return; }
    }
    conn.mode = dMode; conn.server = server; conn.room = code; conn.pin = $("#fPin").value.trim();
    conn.speak = $("#fSpeak").checked;
    save(); dlg.close(); connect();
    status(conn.mode === "server" ? "Đang kết nối phòng " + code + "..." : "Đang dùng chế độ một máy.", "busy");
  });
  $("#rSave").addEventListener("click", function () {
    var r = roomFromForm(), st = $("#rStatus");
    if (dMode === "local") {
      C.saveLocalRoom(r);
      st.textContent = "Đã lưu phòng trên máy này."; st.className = "status ok";
      if (conn.mode === "local") connect();
      return;
    }
    var server = $("#fServer").value.trim().replace(/\/+$/, ""), code = $("#fRoom").value.trim().toLowerCase();
    var admin = $("#rAdmin").value, pin = $("#rPin").value.trim();
    if (!server || !code) { st.textContent = "Nhập địa chỉ máy chủ và mã phòng ở phía trên trước."; st.className = "status err"; return; }
    if (!admin) { st.textContent = "Nhập mã quản trị (ADMIN_KEY) đã đặt khi đưa máy chủ lên."; st.className = "status err"; return; }
    if (pin && !/^\d{4,8}$/.test(pin)) { st.textContent = "PIN gồm 4 đến 8 chữ số."; st.className = "status err"; return; }
    st.textContent = "Đang lưu lên máy chủ..."; st.className = "status busy";
    C.setupRoom(server, code, { adminKey: admin, pin: pin, room: r }).then(function (j) {
      if (j.status !== 200) { st.textContent = j.error || "Máy chủ trả lỗi " + j.status + "."; st.className = "status err"; return; }
      st.textContent = "Đã lưu phòng " + code + " trên máy chủ." + (pin ? " Máy này sẽ dùng PIN mới." : ""); st.className = "status ok";
      if (pin) $("#fPin").value = pin;
      $("#rAdmin").value = ""; $("#rPin").value = "";
    }).catch(function () { st.textContent = "Không kết nối được máy chủ. Kiểm tra địa chỉ."; st.className = "status err"; });
  });
  $("#rDelete").addEventListener("click", function () {
    var server = $("#fServer").value.trim(), code = $("#fRoom").value.trim().toLowerCase(), admin = $("#rAdmin").value, st = $("#rStatus");
    if (!admin) { st.textContent = "Nhập mã quản trị để xoá phòng."; st.className = "status err"; return; }
    if (!confirm('Xoá phòng "' + code + '" và toàn bộ số đã gọi trên máy chủ?')) return;
    C.setupRoom(server, code, { adminKey: admin, remove: true }).then(function (j) {
      st.textContent = j.status === 200 ? "Đã xoá phòng." : (j.error || "Không xoá được."); st.className = "status " + (j.status === 200 ? "ok" : "err");
    });
  });

  /* ------------------------- Khởi động ------------------------- */
  connect();
  if (conn.mode === "server" && (!conn.server || !conn.room)) setTimeout(openSetup, 300);
})();
