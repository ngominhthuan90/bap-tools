/* =====================================================================
   In CCCD 2 mặt
   - Mỗi hàng = 1 người: mặt trước + mặt sau, khung đúng 85,6 × 54 mm.
   - Ảnh nạp bằng: bấm vào khung, kéo thả, dán Ctrl+V, hoặc chọn nhiều ảnh.
   - Chỉnh tay: kéo để dịch, lăn chuột/kéo 2 ngón để phóng to, xoay 90°, xoay nhẹ.
   - "Nắn thẳng 4 góc": chọn 4 góc thẻ trong ảnh chụp nghiêng, ảnh được nắn
     phối cảnh thành hình chữ nhật đúng tỷ lệ thẻ (tính toán ngay trên máy).
   Ảnh không được lưu lại và không gửi đi đâu.
   ===================================================================== */
(function () {
  "use strict";
  var $ = BT.$, KEY = "cccd";
  var CARD_W = 85.6, CARD_H = 54, ROWS_PER_PAGE = 4;
  var OUT_W = 1100, OUT_H = Math.round(OUT_W * CARD_H / CARD_W);

  var cfg = Object.assign({ layout: "row", swap: false, cut: true, tone: "color" }, BT.store.get(KEY, {}));
  var people = [];
  var selected = null;
  var seq = 0;
  var sheetsEl = $("#sheets");
  var editorEl = $("#editor");
  var SIDE = { front: "mặt trước", back: "mặt sau" };

  function saveCfg() { BT.store.set(KEY, cfg); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function slotName(s) { return "Người " + (people.indexOf(s.person) + 1) + ", " + SIDE[s.side]; }

  /* ------------------------------------------------------------------ */
  /* Khung ảnh                                                           */
  /* ------------------------------------------------------------------ */
  function newSlot(side) {
    var s = { id: ++seq, side: side, src: null, orig: null, origW: 0, origH: 0, nw: 0, nh: 0,
      r: 0, fine: 0, s: 1, x: 0, y: 0, corners: null, person: null, img: null };
    var el = document.createElement("div");
    el.className = "slot empty";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    s.el = el;
    s.tag = document.createElement("span"); s.tag.className = "slot-tag";
    s.ph = document.createElement("div"); s.ph.className = "ph";
    el.appendChild(s.ph); el.appendChild(s.tag);
    bindSlot(s);
    return s;
  }
  function newPerson() {
    var p = { front: newSlot("front"), back: newSlot("back") };
    p.front.person = p; p.back.person = p;
    people.push(p);
    return p;
  }
  function allSlots() {
    var out = [];
    people.forEach(function (p) { out.push(p.front, p.back); });
    return out;
  }
  function firstEmpty() {
    var list = allSlots();
    for (var i = 0; i < list.length; i++) if (!list[i].src) return list[i];
    return null;
  }

  function baseDims(s) {
    var a = s.nw / s.nh, odd = (s.r / 90) % 2 !== 0, W, H;
    if (!odd) { W = Math.max(CARD_W, CARD_H * a); H = W / a; }
    else { H = Math.max(CARD_W, CARD_H / a); W = H * a; }
    return { W: W, H: H };
  }
  function applyTf(s) {
    if (!s.img) return;
    var d = baseDims(s);
    s.img.style.width = d.W.toFixed(3) + "mm";
    s.img.style.height = d.H.toFixed(3) + "mm";
    s.img.style.transform = "translate(-50%,-50%) translate(" + s.x.toFixed(2) + "mm," + s.y.toFixed(2) + "mm) rotate(" +
      (s.r + s.fine).toFixed(2) + "deg) scale(" + s.s.toFixed(4) + ")";
  }
  function paintSlot(s) {
    var has = !!s.src;
    s.el.classList.toggle("has-img", has);
    s.el.classList.toggle("empty", !has);
    s.ph.style.display = has ? "none" : "";
    if (has) {
      if (!s.img) {
        s.img = document.createElement("img");
        s.img.alt = "";
        s.img.draggable = false;
        s.el.insertBefore(s.img, s.ph);
      }
      if (s.img.getAttribute("src") !== s.src) s.img.src = s.src;
      applyTf(s);
    } else if (s.img) { s.img.remove(); s.img = null; }
  }
  function labelSlot(s) {
    var name = slotName(s);
    s.tag.textContent = name;
    s.ph.innerHTML = "<b>" + cap(SIDE[s.side]) + "</b><span>Bấm để chọn ảnh<br>hoặc kéo thả ảnh vào đây</span>";
    s.el.setAttribute("aria-label", name + (s.src ? ", đã có ảnh" : ", chưa có ảnh"));
  }
  function releaseSlot(s) {
    if (s.src && s.src !== s.orig) URL.revokeObjectURL(s.src);
    if (s.orig) URL.revokeObjectURL(s.orig);
    s.src = s.orig = null; s.corners = null;
  }

  /* ------------------------------------------------------------------ */
  /* Nạp ảnh                                                             */
  /* ------------------------------------------------------------------ */
  function readImage(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () { reject(new Error("bad image")); };
      im.src = url;
    });
  }
  function loadFile(s, file) {
    if (!file || !/^image\//.test(file.type || "") && !/\.(jpe?g|png|webp|bmp|gif)$/i.test(file.name || "")) {
      notify("Tệp " + ((file && file.name) || "") + " không phải ảnh.");
      return Promise.resolve(false);
    }
    var url = URL.createObjectURL(file);
    return readImage(url).then(function (im) {
      releaseSlot(s);
      s.orig = s.src = url;
      s.origW = s.nw = im.naturalWidth;
      s.origH = s.nh = im.naturalHeight;
      s.r = 0; s.fine = 0; s.s = 1; s.x = 0; s.y = 0;
      paintSlot(s); labelSlot(s); updateCount();
      if (s === selected) renderEditor();
      return true;
    }).catch(function () {
      URL.revokeObjectURL(url);
      notify("Không đọc được ảnh " + (file.name || "") + ". Ảnh HEIC của iPhone cần đổi sang JPG trước.");
      return false;
    });
  }
  var picker = document.createElement("input");
  picker.type = "file"; picker.accept = "image/*"; picker.hidden = true;
  document.body.appendChild(picker);
  var pickTarget = null;
  function pickFor(s) { pickTarget = s; picker.value = ""; picker.click(); }
  picker.addEventListener("change", function () {
    var f = picker.files && picker.files[0];
    if (f && pickTarget) { var t = pickTarget; loadFile(t, f).then(function () { select(t); }); }
  });

  function fillSequential(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|bmp)$/i.test(f.name); });
    if (!files.length) return;
    var targets = [];
    files.forEach(function () {
      var list = allSlots().filter(function (s) { return !s.src && targets.indexOf(s) < 0; });
      if (!list.length) { newPerson(); list = allSlots().filter(function (s) { return !s.src && targets.indexOf(s) < 0; }); }
      targets.push(list[0]);
    });
    layout();
    var chain = Promise.resolve();
    files.forEach(function (f, i) { chain = chain.then(function () { return loadFile(targets[i], f); }); });
    chain.then(function () { select(targets[0]); });
  }

  /* ------------------------------------------------------------------ */
  /* Tương tác trên khung: chọn, kéo, phóng to, bàn phím, thả file       */
  /* ------------------------------------------------------------------ */
  function hasFiles(e) {
    var t = e.dataTransfer && e.dataTransfer.types;
    return t && Array.prototype.indexOf.call(t, "Files") >= 0;
  }
  function bindSlot(s) {
    var el = s.el, pts = {}, start = null, moved = false;
    function snapshot() {
      var c = {};
      Object.keys(pts).forEach(function (k) { c[k] = { x: pts[k].x, y: pts[k].y }; });
      start = { x: s.x, y: s.y, s: s.s, pts: c };
    }
    el.addEventListener("click", function () {
      if (moved) return;
      if (!s.src) pickFor(s);
      select(s);
    });
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!s.src) pickFor(s); select(s); return; }
      if (!s.src) return;
      var step = e.shiftKey ? 2 : 0.5;
      if (e.key === "ArrowLeft") s.x -= step;
      else if (e.key === "ArrowRight") s.x += step;
      else if (e.key === "ArrowUp") s.y -= step;
      else if (e.key === "ArrowDown") s.y += step;
      else if (e.key === "+" || e.key === "=") s.s = BT.clamp(s.s * 1.04, 0.2, 6);
      else if (e.key === "-") s.s = BT.clamp(s.s / 1.04, 0.2, 6);
      else return;
      e.preventDefault(); applyTf(s); select(s); syncEditor();
    });
    el.addEventListener("dragover", function (e) { if (hasFiles(e)) { e.preventDefault(); el.classList.add("drop"); } });
    el.addEventListener("dragleave", function () { el.classList.remove("drop"); });
    el.addEventListener("drop", function (e) {
      el.classList.remove("drop");
      var files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault(); e.stopPropagation();
      if (files.length > 1) { fillSequential(files); return; }
      loadFile(s, files[0]).then(function () { select(s); });
    });
    el.addEventListener("pointerdown", function (e) {
      if (!s.src || e.button > 0) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
      snapshot();
    });
    el.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !start) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts), k = BT.zoomOf(sheetsEl) * BT.mm;
      if (ids.length === 1) {
        var p0 = start.pts[ids[0]]; if (!p0) return;
        var dx = (e.clientX - p0.x) / k, dy = (e.clientY - p0.y) / k;
        if (!moved && Math.abs(dx) + Math.abs(dy) < 0.4) return;
        moved = true;
        s.x = start.x + dx; s.y = start.y + dy;
      } else {
        var a0 = start.pts[ids[0]], b0 = start.pts[ids[1]];
        if (!a0 || !b0) return;
        var d0 = dist(a0, b0), d1 = dist(pts[ids[0]], pts[ids[1]]);
        if (d0 < 10) return;
        moved = true;
        s.s = BT.clamp(start.s * d1 / d0, 0.2, 6);
      }
      applyTf(s);
      if (s === selected) syncEditor();
    });
    function end(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      snapshot();
      if (moved) { if (s !== selected) select(s); setTimeout(function () { moved = false; }, 0); }
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("wheel", function (e) {
      if (!s.src || s !== selected) return; // chỉ phóng to khi đã chọn khung, tránh cản cuộn trang
      e.preventDefault();
      s.s = BT.clamp(s.s * Math.exp(-e.deltaY * 0.0015), 0.2, 6);
      applyTf(s); syncEditor();
    }, { passive: false });
  }

  function select(s) {
    if (selected && selected.el) selected.el.classList.remove("sel");
    selected = s;
    if (s) s.el.classList.add("sel");
    renderEditor();
  }

  /* ------------------------------------------------------------------ */
  /* Sắp tờ giấy                                                         */
  /* ------------------------------------------------------------------ */
  function layout() {
    sheetsEl.className = "sheets" + (cfg.layout === "stack" ? " stack" : "") + (cfg.cut ? " cutlines" : "") + " tone-" + cfg.tone;
    var per = cfg.layout === "stack" ? 1 : ROWS_PER_PAGE;
    var pages = Math.max(1, Math.ceil(people.length / per));
    sheetsEl.innerHTML = "";
    for (var p = 0; p < pages; p++) {
      var wrap = document.createElement("div");
      wrap.className = "sheet-wrap";
      wrap.innerHTML = '<div class="sheet-label">Trang ' + (p + 1) + "/" + pages + '</div><div class="sheet"><div class="cd-page"></div></div>';
      var pageEl = wrap.querySelector(".cd-page");
      people.slice(p * per, p * per + per).forEach(function (person) {
        var row = document.createElement("div");
        row.className = "cd-row";
        row.appendChild(cfg.swap ? person.back.el : person.front.el);
        row.appendChild(cfg.swap ? person.front.el : person.back.el);
        person.row = row;
        pageEl.appendChild(row);
      });
      sheetsEl.appendChild(wrap);
    }
    allSlots().forEach(function (s) { labelSlot(s); paintSlot(s); });
    BT.fit(sheetsEl);
    updateCount();
    if (selected && people.indexOf(selected.person) < 0) select(null);
  }

  function updateCount() {
    var per = cfg.layout === "stack" ? 1 : ROWS_PER_PAGE;
    var pages = Math.max(1, Math.ceil(people.length / per));
    var imgs = allSlots().filter(function (s) { return s.src; }).length;
    people.forEach(function (p) { if (p.row) p.row.classList.toggle("row-empty", !p.front.src && !p.back.src); });
    $("#count").textContent = people.length + " người, đã có " + imgs + " ảnh, " + pages + " trang A4.";
    var btn = $("#print");
    btn.disabled = imgs === 0;
    $("#printLabel").textContent = imgs ? "In " + pages + " trang A4" : "Chưa có ảnh để in";
  }

  /* ------------------------------------------------------------------ */
  /* Bảng chỉnh ảnh đang chọn (cột bên trái)                             */
  /* ------------------------------------------------------------------ */
  function renderEditor() {
    var s = selected;
    if (!s) {
      editorEl.innerHTML = '<p class="editor-empty">Bấm vào một khung trên tờ giấy để chọn ảnh cần chỉnh.</p>';
      return;
    }
    var name = BT.esc(slotName(s));
    if (!s.src) {
      editorEl.innerHTML = "<h3>" + name + "</h3>" +
        '<div class="btns"><button type="button" class="btn btn-sm btn-ink" data-a="pick">Chọn ảnh</button>' +
        (people.length > 1 ? '<button type="button" class="btn btn-sm btn-quiet" data-a="delPerson">Xoá người này</button>' : "") + "</div>" +
        '<p class="editor-empty">Khung này chưa có ảnh.</p>';
      return;
    }
    editorEl.innerHTML = "<h3>" + name + "</h3>" +
      '<div class="btns">' +
      '<button type="button" class="btn btn-sm btn-ink" data-a="crop">Nắn thẳng 4 góc</button>' +
      '<button type="button" class="btn btn-sm" data-a="rot">Xoay 90°</button>' +
      '<button type="button" class="btn btn-sm" data-a="fit">Vừa khung</button>' +
      "</div>" +
      '<label class="slider"><span>Phóng to</span><input type="range" min="20" max="400" step="1" data-k="s"><output data-o="s"></output></label>' +
      '<label class="slider"><span>Xoay nhẹ</span><input type="range" min="-15" max="15" step="0.1" data-k="fine"><output data-o="fine"></output></label>' +
      '<div class="btns" style="margin:4px 0 0">' +
      '<button type="button" class="btn btn-sm" data-a="pick">Chọn ảnh khác</button>' +
      '<button type="button" class="btn btn-sm btn-quiet" data-a="delImg">Xoá ảnh</button>' +
      (people.length > 1 ? '<button type="button" class="btn btn-sm btn-quiet" data-a="delPerson">Xoá người này</button>' : "") +
      "</div>" +
      '<ul class="tips"><li>Kéo ảnh trong khung để dịch, lăn chuột để phóng to.</li>' +
      "<li>Ảnh chụp nghiêng hoặc còn nền bàn: dùng Nắn thẳng 4 góc.</li></ul>";
    syncEditor();
  }
  function syncEditor() {
    var s = selected;
    if (!s || !s.src) return;
    var zs = editorEl.querySelector('[data-k="s"]'), fs = editorEl.querySelector('[data-k="fine"]');
    if (!zs) return;
    if (document.activeElement !== zs) zs.value = Math.round(s.s * 100);
    if (document.activeElement !== fs) fs.value = s.fine;
    editorEl.querySelector('[data-o="s"]').textContent = Math.round(s.s * 100) + "%";
    editorEl.querySelector('[data-o="fine"]').textContent = (s.fine > 0 ? "+" : "") + s.fine.toFixed(1).replace(".", ",") + "°";
  }
  editorEl.addEventListener("input", function (e) {
    var k = e.target.getAttribute("data-k"), s = selected;
    if (!k || !s) return;
    if (k === "s") s.s = +e.target.value / 100;
    if (k === "fine") s.fine = +e.target.value;
    applyTf(s); syncEditor();
  });
  editorEl.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-a]"), s = selected;
    if (!b || !s) return;
    var a = b.getAttribute("data-a");
    if (a === "pick") pickFor(s);
    else if (a === "crop") openCrop(s);
    else if (a === "rot") { s.r = (s.r + 90) % 360; s.x = s.y = 0; s.s = 1; applyTf(s); syncEditor(); }
    else if (a === "fit") { s.x = s.y = 0; s.s = 1; s.fine = 0; applyTf(s); syncEditor(); }
    else if (a === "delImg") { releaseSlot(s); paintSlot(s); labelSlot(s); updateCount(); renderEditor(); }
    else if (a === "delPerson") {
      var p = s.person;
      releaseSlot(p.front); releaseSlot(p.back);
      people.splice(people.indexOf(p), 1);
      select(null); layout();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Nắn thẳng 4 góc (biến đổi phối cảnh)                                */
  /* ------------------------------------------------------------------ */
  var modal = $("#cropModal"), cropImg = $("#cropImg"), cropWrap = $("#cropWrap"), cropPoly = $("#cropPoly"), cropSvg = $("#cropSvg");
  var crop = { slot: null, pts: [], W: 0, H: 0, handles: [], lastFocus: null };
  for (var hi = 0; hi < 4; hi++) {
    var hb = document.createElement("button");
    hb.type = "button"; hb.className = "handle";
    hb.setAttribute("aria-label", "Góc " + (hi + 1) + ". Dùng phím mũi tên để dịch.");
    hb.setAttribute("data-i", hi);
    cropWrap.appendChild(hb);
    crop.handles.push(hb);
  }
  function defaultCorners() {
    var W = crop.W, H = crop.H, m = 0.1;
    return [{ x: W * m, y: H * m }, { x: W * (1 - m), y: H * m }, { x: W * (1 - m), y: H * (1 - m) }, { x: W * m, y: H * (1 - m) }];
  }
  function drawCrop() {
    crop.handles.forEach(function (h, i) {
      h.style.left = (crop.pts[i].x / crop.W * 100) + "%";
      h.style.top = (crop.pts[i].y / crop.H * 100) + "%";
    });
    cropSvg.setAttribute("viewBox", "0 0 " + crop.W + " " + crop.H);
    cropSvg.setAttribute("preserveAspectRatio", "none");
    cropPoly.setAttribute("vector-effect", "non-scaling-stroke");
    cropPoly.setAttribute("points", orderQuad(crop.pts, true).map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" "));
  }
  function sizeCropImg() {
    var stage = $("#cropStage");
    cropImg.style.maxHeight = Math.max(200, stage.clientHeight - 36) + "px";
    cropImg.style.maxWidth = Math.max(200, stage.clientWidth - 36) + "px";
  }
  function openCrop(s) {
    crop.slot = s;
    crop.lastFocus = document.activeElement;
    crop.W = s.origW; crop.H = s.origH;
    modal.hidden = false;
    document.body.style.overflow = "hidden";
    cropImg.onload = function () {
      sizeCropImg();
      crop.pts = s.corners ? s.corners.map(function (p) { return { x: p.x, y: p.y }; }) : defaultCorners();
      drawCrop();
      crop.handles[0].focus();
    };
    if (cropImg.getAttribute("src") === s.orig && cropImg.complete) cropImg.onload();
    else cropImg.src = s.orig;
  }
  function closeCrop() {
    modal.hidden = true;
    document.body.style.overflow = "";
    if (crop.lastFocus && crop.lastFocus.focus) crop.lastFocus.focus();
  }
  (function bindHandles() {
    var drag = null;
    crop.handles.forEach(function (h, i) {
      h.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { h.setPointerCapture(e.pointerId); } catch (err) {}
        drag = i; h.focus();
      });
      h.addEventListener("pointermove", function (e) {
        if (drag !== i) return;
        var r = cropImg.getBoundingClientRect();
        crop.pts[i] = {
          x: BT.clamp((e.clientX - r.left) / r.width, 0, 1) * crop.W,
          y: BT.clamp((e.clientY - r.top) / r.height, 0, 1) * crop.H
        };
        drawCrop();
      });
      h.addEventListener("pointerup", function () { drag = null; });
      h.addEventListener("pointercancel", function () { drag = null; });
      h.addEventListener("keydown", function (e) {
        var r = cropImg.getBoundingClientRect(), px = crop.W / Math.max(1, r.width) * (e.shiftKey ? 10 : 1);
        var p = crop.pts[i];
        if (e.key === "ArrowLeft") p.x -= px;
        else if (e.key === "ArrowRight") p.x += px;
        else if (e.key === "ArrowUp") p.y -= px;
        else if (e.key === "ArrowDown") p.y += px;
        else return;
        e.preventDefault();
        p.x = BT.clamp(p.x, 0, crop.W); p.y = BT.clamp(p.y, 0, crop.H);
        drawCrop();
      });
    });
  })();
  $("#cropReset").addEventListener("click", function () { crop.pts = defaultCorners(); drawCrop(); });
  $("#cropCancel").addEventListener("click", closeCrop);
  modal.addEventListener("keydown", function (e) { if (e.key === "Escape") closeCrop(); });
  window.addEventListener("resize", function () { if (!modal.hidden) { sizeCropImg(); } });
  $("#cropApply").addEventListener("click", function () {
    var s = crop.slot, btn = this;
    btn.disabled = true; btn.textContent = "Đang nắn...";
    readImage(s.orig).then(function (im) {
      var k = Math.min(1, 2600 / Math.max(im.naturalWidth, im.naturalHeight));
      var cw = Math.round(im.naturalWidth * k), ch = Math.round(im.naturalHeight * k);
      var c = document.createElement("canvas"); c.width = cw; c.height = ch;
      var cx = c.getContext("2d");
      cx.drawImage(im, 0, 0, cw, ch);
      var src = cx.getImageData(0, 0, cw, ch);
      var quad = orderQuad(crop.pts.map(function (p) { return { x: p.x * k, y: p.y * k }; }));
      var out = BT.warpQuad(src, quad, OUT_W, OUT_H);
      var oc = document.createElement("canvas"); oc.width = OUT_W; oc.height = OUT_H;
      oc.getContext("2d").putImageData(out, 0, 0);
      return new Promise(function (resolve) { oc.toBlob(resolve, "image/jpeg", 0.92); });
    }).then(function (blob) {
      if (s.src && s.src !== s.orig) URL.revokeObjectURL(s.src);
      s.src = URL.createObjectURL(blob);
      s.nw = OUT_W; s.nh = OUT_H;
      s.corners = crop.pts.map(function (p) { return { x: p.x, y: p.y }; });
      s.r = 0; s.fine = 0; s.s = 1; s.x = 0; s.y = 0;
      paintSlot(s); closeCrop(); renderEditor();
    }).catch(function () {
      notify("Không nắn được ảnh này. Thử chọn lại 4 góc.");
    }).then(function () { btn.disabled = false; btn.textContent = "Nắn thẳng"; });
  });

  /* Sắp 4 điểm theo chiều kim đồng hồ bắt đầu từ góc trên-trái.
     Nếu thẻ đang nằm dọc trong ảnh, đổi thứ tự để kết quả luôn nằm ngang. */
  function orderQuad(p, keepOrientation) {
    var cx = 0, cy = 0;
    p.forEach(function (q) { cx += q.x / 4; cy += q.y / 4; });
    var s = p.slice().sort(function (a, b) { return Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx); });
    var i0 = 0;
    for (var i = 1; i < 4; i++) if (s[i].x + s[i].y < s[i0].x + s[i0].y) i0 = i;
    var o = [s[i0], s[(i0 + 1) % 4], s[(i0 + 2) % 4], s[(i0 + 3) % 4]];
    if (!keepOrientation) {
      var top = dist(o[0], o[1]) + dist(o[3], o[2]), side = dist(o[0], o[3]) + dist(o[1], o[2]);
      if (side > top) o = [o[3], o[0], o[1], o[2]];
    }
    return o;
  }

  /* ------------------------------------------------------------------ */
  /* Thanh bên trái                                                      */
  /* ------------------------------------------------------------------ */
  function syncSeg(id, val) {
    BT.$$("#" + id + " button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === val)); });
  }
  $("#layoutSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    cfg.layout = b.getAttribute("data-v"); saveCfg(); syncSeg("layoutSeg", cfg.layout);
    if (cfg.layout === "stack") {
      // bỏ bớt những người trống ở cuối để khỏi in trang trắng
      while (people.length > 1) {
        var last = people[people.length - 1];
        if (last.front.src || last.back.src) break;
        people.pop();
      }
    } else {
      while (people.length < ROWS_PER_PAGE) newPerson();
    }
    layout();
  });
  $("#toneSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    cfg.tone = b.getAttribute("data-v"); saveCfg(); syncSeg("toneSeg", cfg.tone); layout();
  });
  $("#swap").addEventListener("change", function () { cfg.swap = this.checked; saveCfg(); layout(); });
  $("#cut").addEventListener("change", function () { cfg.cut = this.checked; saveCfg(); layout(); });
  $("#addRow").addEventListener("click", function () {
    var p = newPerson(); layout();
    p.front.el.scrollIntoView({ behavior: "smooth", block: "center" });
    select(p.front);
  });
  $("#clearAll").addEventListener("click", function () {
    if (!allSlots().some(function (s) { return s.src; })) return;
    if (!confirm("Xoá toàn bộ ảnh đã thêm?")) return;
    allSlots().forEach(releaseSlot);
    people = [];
    var n = cfg.layout === "stack" ? 1 : ROWS_PER_PAGE;
    for (var i = 0; i < n; i++) newPerson();
    select(null); layout();
  });
  $("#multi").addEventListener("change", function () { fillSequential(this.files); this.value = ""; });
  $("#print").addEventListener("click", function () { if (selected) select(null); BT.print(); });

  // Thả nhiều ảnh lên mặt bàn (ngoài khung) -> xếp lần lượt
  var desk = sheetsEl.parentElement;
  desk.addEventListener("dragover", function (e) { if (hasFiles(e)) e.preventDefault(); });
  desk.addEventListener("drop", function (e) {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault(); fillSequential(e.dataTransfer.files);
  });
  // Dán ảnh (Ctrl+V)
  document.addEventListener("paste", function (e) {
    if (e.target && e.target.closest && e.target.closest("input,textarea")) return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === "file" && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        var target = (selected && !selected.src ? selected : null) || selected || firstEmpty();
        if (!target) { newPerson(); layout(); target = firstEmpty(); }
        e.preventDefault();
        loadFile(target, f).then(function () { select(target); });
        return;
      }
    }
  });

  var noteTimer;
  function notify(msg) {
    var c = $("#count");
    c.textContent = msg; c.style.color = "var(--err)";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { c.style.color = ""; updateCount(); }, 5000);
  }

  /* ---- Khởi động ---- */
  $("#swap").checked = !!cfg.swap;
  $("#cut").checked = !!cfg.cut;
  syncSeg("layoutSeg", cfg.layout);
  syncSeg("toneSeg", cfg.tone);
  var n0 = cfg.layout === "stack" ? 1 : ROWS_PER_PAGE;
  for (var i0 = 0; i0 < n0; i0++) newPerson();
  layout();
  renderEditor();
  BT.autoFit(sheetsEl);
})();

/* ---------------------------------------------------------------------
   Biến đổi phối cảnh: kéo tứ giác `quad` (TL, TR, BR, BL) trong ảnh nguồn
   thành ảnh chữ nhật W × H. Dùng ma trận đồng nhất (homography) và nội suy
   song tuyến. Tách riêng để kiểm thử được.
   --------------------------------------------------------------------- */
(function () {
  "use strict";
  function solve(A, b) {
    var n = b.length, i, j, k;
    for (i = 0; i < n; i++) A[i] = A[i].concat([b[i]]);
    for (i = 0; i < n; i++) {
      var piv = i;
      for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var t = A[i]; A[i] = A[piv]; A[piv] = t;
      if (Math.abs(A[i][i]) < 1e-12) throw new Error("singular");
      for (j = i + 1; j < n; j++) {
        var f = A[j][i] / A[i][i];
        for (k = i; k <= n; k++) A[j][k] -= f * A[i][k];
      }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var sum = A[i][n];
      for (j = i + 1; j < n; j++) sum -= A[i][j] * x[j];
      x[i] = sum / A[i][i];
    }
    return x;
  }
  function homography(q, W, H) {
    var P = [[0, 0], [W, 0], [W, H], [0, H]], A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var u = P[i][0], v = P[i][1], x = q[i].x, y = q[i].y;
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    return solve(A, b);
  }
  function warpQuad(src, quad, W, H) {
    var h = homography(quad, W, H);
    var sw = src.width, sh = src.height, sd = src.data;
    var out = typeof ImageData !== "undefined" ? new ImageData(W, H) : { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
    var od = out.data, o = 0;
    for (var v = 0; v < H; v++) {
      var vv = v + 0.5;
      for (var u = 0; u < W; u++, o += 4) {
        var uu = u + 0.5;
        var den = h[6] * uu + h[7] * vv + 1;
        var x = (h[0] * uu + h[1] * vv + h[2]) / den - 0.5;
        var y = (h[3] * uu + h[4] * vv + h[5]) / den - 0.5;
        if (x < 0) x = 0; else if (x > sw - 1) x = sw - 1;
        if (y < 0) y = 0; else if (y > sh - 1) y = sh - 1;
        var x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < sw ? x0 + 1 : x0, y1 = y0 + 1 < sh ? y0 + 1 : y0;
        var fx = x - x0, fy = y - y0;
        var i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
        for (var c = 0; c < 3; c++) {
          var top = sd[i00 + c] + (sd[i10 + c] - sd[i00 + c]) * fx;
          var bot = sd[i01 + c] + (sd[i11 + c] - sd[i01 + c]) * fx;
          od[o + c] = top + (bot - top) * fy;
        }
        od[o + 3] = 255;
      }
    }
    return out;
  }
  var root = typeof window !== "undefined" ? (window.BT = window.BT || {}) : module.exports;
  root.warpQuad = warpQuad;
  root.homography = homography;
})();
