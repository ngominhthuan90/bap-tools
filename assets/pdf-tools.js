/* =====================================================================
   Công cụ PDF — chạy hoàn toàn trong trình duyệt
   Ghép, tách, xoay/xoá/sắp trang: pdf-lib (không đổi chất lượng).
   Ảnh sang PDF, nén: pdf.js vẽ trang + pdf-lib dựng file mới.
   Nhận dạng chữ (OCR): tesseract.js, giữ nguyên trang gốc và phủ thêm lớp chữ ẩn
   để tìm kiếm/bôi đen được; xuất thêm Word (.docx) và .txt.
   ===================================================================== */
(function () {
  "use strict";
  var $ = BT.$, KEY = "pdf-tools";
  var panel = $("#panel"), board = $("#board"), extra = $("#extra");
  var cfg = Object.assign({ op: "merge", splitMode: "each", imgSize: "a4", imgMargin: true, imgAutoRotate: true,
    level: "medium", gray: false, lang: "vie" }, BT.store.get(KEY, {}));
  var S = { merge: [], one: null, images: [], ocrImgs: [], busy: false, ocr: null, seq: 0 };
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  var OPS = {
    merge: { title: "Ghép PDF", accept: "application/pdf,.pdf", multiple: true, kind: "pdf" },
    split: { title: "Tách PDF", accept: "application/pdf,.pdf", multiple: false, kind: "pdf" },
    organize: { title: "Sắp xếp trang", accept: "application/pdf,.pdf", multiple: false, kind: "pdf" },
    images: { title: "Ảnh sang PDF", accept: "image/*", multiple: true, kind: "img" },
    compress: { title: "Nén dung lượng", accept: "application/pdf,.pdf", multiple: false, kind: "pdf" },
    ocr: { title: "Nhận dạng chữ (OCR)", accept: "application/pdf,.pdf,image/*", multiple: true, kind: "any" }
  };
  function save() { BT.store.set(KEY, cfg); }

  /* ------------------------------ Thư viện ------------------------------ */
  function pdfjs() {
    return BT.loadScript("vendor/pdfjs/pdf.min.js").then(function () {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
      return pdfjsLib;
    });
  }
  function pdflib() { return BT.loadScript("vendor/pdf-lib.min.js").then(function () { return PDFLib; }); }
  function abs(p) { return new URL(p, location.href).href; }

  /* ------------------------------ Tiện ích ------------------------------ */
  function base(n) { return String(n || "tai-lieu").replace(/\.[^.]+$/, ""); }
  function isPdf(f) { return /pdf$/i.test(f.type || "") || /\.pdf$/i.test(f.name || ""); }
  function isImg(f) { return /^image\//.test(f.type || "") || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name || ""); }
  function bytesOf(file) { return file.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function openPdf(bytes) { return pdfjs().then(function (lib) { return lib.getDocument({ data: bytes.slice() }).promise; }); }
  function pdfError(name) {
    return function (err) {
      var pw = err && (err.name === "PasswordException" || /password|encrypt/i.test(err.message || ""));
      status(pw ? name + " có mật khẩu, cần mở khoá trước khi dùng." : "Không mở được " + name + ". File có thể bị hỏng hoặc không phải PDF.", "err");
    };
  }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  // "1-3, 5, 8-10" -> [[1,2,3],[5],[8,9,10]]
  function parseGroups(spec, total) {
    var groups = [];
    String(spec || "").split(/[,;]/).forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
      if (m) {
        var a = Math.max(1, +m[1]), b = Math.min(total, +m[2]);
        if (a > b) { var t = a; a = b; b = t; }
        if (a <= total && b >= 1) groups.push(range(Math.max(1, a), Math.min(total, b)));
      } else if (/^\d+$/.test(part)) {
        var n = +part; if (n >= 1 && n <= total) groups.push([n]);
      }
    });
    return groups;
  }
  function flatPages(spec, total) {
    var seen = {}, out = [];
    parseGroups(spec, total).forEach(function (g) { g.forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } }); });
    return out;
  }
  function label(pages) {
    if (pages.length === 1) return String(pages[0]);
    var contiguous = pages.every(function (p, i) { return i === 0 || p === pages[i - 1] + 1; });
    return contiguous ? pages[0] + "-" + pages[pages.length - 1] : pages.slice(0, 6).join(",") + (pages.length > 6 ? "..." : "");
  }
  function pad3(n) { return BT.pad(n, 3); }

  /* ------------------------------ Trạng thái ------------------------------ */
  function status(msg, kind) {
    var el = $("#st"); if (!el) return;
    el.textContent = msg || ""; el.className = "status" + (kind ? " " + kind : "");
  }
  function progress(frac) {
    var bar = $("#prog"); if (!bar) return;
    bar.parentNode.hidden = frac == null;
    bar.style.width = Math.round(BT.clamp(frac || 0, 0, 1) * 100) + "%";
  }
  function busy(on) {
    S.busy = on;
    var b = $("#run"); if (b) b.disabled = on;
    BT.$$("#ops button").forEach(function (x) { x.disabled = on; });
  }
  function delivered(blob, name, msg) {
    BT.download(blob, name);
    var url = URL.createObjectURL(blob);
    var res = $("#res");
    if (res) res.innerHTML = '<a href="' + url + '" download="' + BT.esc(name) + '">Tải lại ' + BT.esc(name) + "</a>";
    status(msg + " Đã tải về " + name + " (" + BT.size(blob.size) + ").", "ok");
  }

  /* ------------------------------ Ảnh thu nhỏ ------------------------------ */
  var thumbQueue = Promise.resolve();
  function thumbInto(holder, pdf, n) {
    thumbQueue = thumbQueue.then(function () {
      if (!holder.isConnected) return;
      return pdf.getPage(n).then(function (page) {
        var v1 = page.getViewport({ scale: 1 });
        var k = Math.min(150 / v1.width, 212 / v1.height) * DPR;
        var vp = page.getViewport({ scale: k });
        var c = document.createElement("canvas");
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        return page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(function () {
          if (!holder.isConnected) return;
          holder.innerHTML = ""; holder.appendChild(c);
          var t = holder.closest(".tile");
          if (t) applyRot(t);
        });
      });
    }).catch(function () {});
  }
  function applyRot(tile) {
    var r = +(tile.getAttribute("data-rot") || 0), c = tile.querySelector(".pg canvas,.pg img");
    if (!c) return;
    c.style.transform = r ? "rotate(" + r + "deg)" + (r % 180 ? " scale(.72)" : "") : "";
  }

  /* ------------------------------ Kéo thả đổi chỗ ------------------------------ */
  function sortable(getList, setList) {
    var from = null;
    board.ondragstart = function (e) {
      var t = e.target.closest && e.target.closest(".tile"); if (!t) return;
      from = +t.getAttribute("data-i"); t.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", ""); } catch (err) {}
    };
    board.ondragover = function (e) {
      if (from === null) return;
      e.preventDefault();
      var t = e.target.closest && e.target.closest(".tile"), src = board.querySelector(".tile.dragging");
      if (!t || !src || t === src) return;
      var r = t.getBoundingClientRect();
      board.insertBefore(src, (e.clientX - r.left) / r.width > 0.5 ? t.nextSibling : t);
    };
    board.ondragend = function () {
      if (from === null) return;
      var list = getList();
      var order = BT.$$(".tile", board).map(function (t) { return list[+t.getAttribute("data-i")]; });
      from = null; setList(order); renderBoard();
    };
  }
  function noSort() { board.ondragstart = board.ondragover = board.ondragend = null; }

  /* ------------------------------ Nạp file ------------------------------ */
  function addFiles(files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length || S.busy) return;
    var op = cfg.op, spec = OPS[op];
    var pdfs = files.filter(isPdf), imgs = files.filter(isImg);
    if (spec.kind === "pdf" && !pdfs.length) return status("Hãy chọn file PDF.", "err");
    if (spec.kind === "img" && !imgs.length) return status("Hãy chọn file ảnh (JPG, PNG).", "err");
    if (op === "images") return addImages(imgs, S.images);
    if (op === "ocr" && !pdfs.length) { S.one = null; S.ocr = null; extra.innerHTML = ""; return addImages(imgs, S.ocrImgs); }
    if (op === "ocr") S.ocrImgs = [];
    busy(true);
    var job = op === "merge" ? addMerge(pdfs) : loadOne(pdfs[0]);
    return job.then(function () { busy(false); }, function () { busy(false); });
  }
  function addMerge(pdfs) {
    var chain = Promise.resolve();
    pdfs.forEach(function (f) {
      chain = chain.then(function () {
        status("Đang mở " + f.name + "...", "busy");
        return bytesOf(f).then(function (bytes) {
          return openPdf(bytes).then(function (pdf) {
            S.merge.push({ id: ++S.seq, name: f.name, size: f.size, bytes: bytes, pdf: pdf, pages: pdf.numPages });
          });
        }).catch(pdfError(f.name));
      });
    });
    return chain.then(function () {
      renderBoard();
      if (S.merge.length) status(S.merge.length + " file, tổng " + S.merge.reduce(function (a, f) { return a + f.pages; }, 0) + " trang.", "ok");
    });
  }
  function loadOne(file) {
    status("Đang mở " + file.name + "...", "busy");
    return bytesOf(file).then(function (bytes) {
      return openPdf(bytes).then(function (pdf) {
        S.one = { name: file.name, size: file.size, bytes: bytes, pdf: pdf, pages: range(1, pdf.numPages).map(function (n) { return { n: n, rot: 0, del: false, sel: false }; }) };
        S.ocr = null; extra.innerHTML = "";
        renderBoard();
        status(file.name + ": " + pdf.numPages + " trang, " + BT.size(file.size) + ".", "ok");
      });
    }).catch(pdfError(file.name));
  }
  function addImages(imgs, list) {
    imgs.forEach(function (f) { list.push({ id: ++S.seq, name: f.name, file: f, url: URL.createObjectURL(f) }); });
    renderBoard();
    status(list.length + " ảnh. Kéo trên mặt bàn để đổi thứ tự.", "ok");
  }

  /* ------------------------------ Mặt bàn ------------------------------ */
  function tile(i, inner, cap, acts, cls, draggable, rot) {
    return '<div class="tile ' + (cls || "") + '" data-i="' + i + '"' + (draggable ? ' draggable="true"' : "") +
      (rot ? ' data-rot="' + rot + '"' : "") + '><div class="pg">' + inner + "</div>" +
      (acts ? '<div class="acts">' + acts + "</div>" : "") + '<div class="cap">' + cap + "</div></div>";
  }
  function emptyBoard(text) {
    board.innerHTML = '<div class="desk-empty" style="grid-column:1/-1"><b>Mặt bàn đang trống</b>' + text + "</div>";
  }
  function renderBoard() {
    var op = cfg.op, h = "";
    noSort();
    if (op === "merge") {
      if (!S.merge.length) return emptyBoard("Kéo thả các file PDF vào đây, hoặc bấm Chọn file ở bên trái.");
      S.merge.forEach(function (f, i) {
        h += tile(i, '<span class="badge">' + (i + 1) + "</span>", "<b>" + BT.esc(f.name) + "</b><br>" + f.pages + " trang, " + BT.size(f.size),
          '<button type="button" data-a="left" title="Đưa lên trước" aria-label="Đưa lên trước">‹</button>' +
          '<button type="button" data-a="right" title="Đưa ra sau" aria-label="Đưa ra sau">›</button>' +
          '<button type="button" data-a="remove" title="Bỏ file này" aria-label="Bỏ file này">✕</button>', "", true);
      });
      board.innerHTML = h;
      BT.$$(".tile", board).forEach(function (t, i) {
        var holder = t.querySelector(".pg"), f = S.merge[i];
        var badge = holder.innerHTML; holder.innerHTML = badge;
        var slot = document.createElement("div"); slot.style.cssText = "display:contents"; holder.appendChild(slot);
        thumbInto(slot, f.pdf, 1);
      });
      sortable(function () { return S.merge; }, function (l) { S.merge = l; });
      return;
    }
    if (op === "images" || (op === "ocr" && !S.one && S.ocrImgs.length)) {
      var list = op === "images" ? S.images : S.ocrImgs;
      if (!list.length) return emptyBoard("Kéo thả ảnh vào đây, hoặc bấm Chọn ảnh ở bên trái.");
      list.forEach(function (im, i) {
        h += tile(i, '<img alt="" src="' + im.url + '"><span class="badge">' + (i + 1) + "</span>", BT.esc(im.name),
          '<button type="button" data-a="remove" title="Bỏ ảnh này" aria-label="Bỏ ảnh này">✕</button>', "", true);
      });
      board.innerHTML = h;
      sortable(function () { return list; }, function (l) { if (op === "images") S.images = l; else S.ocrImgs = l; });
      return;
    }
    // các việc làm trên 1 file PDF
    var one = S.one;
    if (!one) return emptyBoard(op === "ocr" ? "Kéo thả 1 file PDF bản scan hoặc các ảnh chụp tài liệu vào đây." : "Kéo thả 1 file PDF vào đây, hoặc bấm Chọn file ở bên trái.");
    one.pages.forEach(function (p, i) {
      var acts = "", cls = "";
      if (op === "organize") {
        acts = '<button type="button" data-a="rotl" title="Xoay trái" aria-label="Xoay trái trang ' + p.n + '">↺</button>' +
          '<button type="button" data-a="rotr" title="Xoay phải" aria-label="Xoay phải trang ' + p.n + '">↻</button>' +
          '<button type="button" data-a="del" title="Xoá / giữ trang" aria-label="Xoá hoặc giữ trang ' + p.n + '">✕</button>';
        cls = p.del ? "del" : "";
      }
      if (op === "split" && cfg.splitMode === "pick" && p.sel) cls = "sel";
      var cap = "Trang " + p.n + (op === "organize" && i + 1 !== p.n ? " (vị trí " + (i + 1) + ")" : "");
      if (op === "ocr" && S.ocr && S.ocr.done && S.ocr.done[i] != null) cap += S.ocr.done[i] ? ", đã đọc" : "";
      h += tile(i, "", cap, acts, cls, op === "organize", op === "organize" ? p.rot : 0);
    });
    board.innerHTML = h;
    BT.$$(".tile", board).forEach(function (t, i) { thumbInto(t.querySelector(".pg"), one.pdf, one.pages[i].n); });
    if (op === "organize") sortable(function () { return one.pages; }, function (l) { one.pages = l; });
  }
  board.addEventListener("click", function (e) {
    var t = e.target.closest(".tile"); if (!t || S.busy) return;
    var i = +t.getAttribute("data-i"), a = e.target.closest("button[data-a]");
    a = a && a.getAttribute("data-a");
    var op = cfg.op;
    if (op === "merge" && a) {
      if (a === "remove") S.merge.splice(i, 1);
      if (a === "left" && i > 0) S.merge.splice(i - 1, 0, S.merge.splice(i, 1)[0]);
      if (a === "right" && i < S.merge.length - 1) S.merge.splice(i + 1, 0, S.merge.splice(i, 1)[0]);
      return renderBoard();
    }
    if ((op === "images" || op === "ocr") && a === "remove") {
      var list = op === "images" ? S.images : S.ocrImgs;
      URL.revokeObjectURL(list[i].url); list.splice(i, 1); return renderBoard();
    }
    if (!S.one) return;
    var p = S.one.pages[i];
    if (op === "organize" && a) {
      if (a === "rotl") p.rot = (p.rot + 270) % 360;
      if (a === "rotr") p.rot = (p.rot + 90) % 360;
      if (a === "del") p.del = !p.del;
      t.setAttribute("data-rot", p.rot); applyRot(t); t.classList.toggle("del", p.del);
      return;
    }
    if (op === "split" && cfg.splitMode === "pick") {
      p.sel = !p.sel; t.classList.toggle("sel", p.sel);
      var inp = $("#pick"); if (inp) inp.value = S.one.pages.filter(function (x) { return x.sel; }).map(function (x) { return x.n; }).join(", ");
    }
  });

  /* ------------------------------ Bảng điều khiển ------------------------------ */
  function dropHTML(op) {
    var s = OPS[op];
    var what = s.kind === "img" ? "Chọn ảnh" : op === "ocr" ? "Chọn file PDF hoặc ảnh" : s.multiple ? "Chọn các file PDF" : "Chọn 1 file PDF";
    return '<label class="drop" id="drop" tabindex="0" role="button">' + what + '<small>hoặc kéo thả vào đây</small>' +
      '<input type="file" id="fin" accept="' + s.accept + '"' + (s.multiple ? " multiple" : "") + " hidden></label>";
  }
  function radio(name, val, cur, text, small) {
    return '<label class="radio"><input type="radio" name="' + name + '" value="' + val + '"' + (val === cur ? " checked" : "") + "><span>" + text +
      (small ? "<small>" + small + "</small>" : "") + "</span></label>";
  }
  var RUN = { merge: "Ghép và tải về", split: "Tách và tải về", organize: "Lưu và tải về", images: "Tạo PDF và tải về", compress: "Nén và tải về", ocr: "Nhận dạng chữ" };
  function renderPanel() {
    var op = cfg.op, h = "<h2>" + OPS[op].title + "</h2>" + dropHTML(op);
    if (op === "merge") h += '<p class="note">Thứ tự ghép là thứ tự trên mặt bàn. Kéo để đổi chỗ, hoặc dùng nút ‹ › trên từng tệp.</p>';
    if (op === "split") {
      h += '<div class="opt">' +
        radio("smode", "each", cfg.splitMode, "Mỗi trang thành một file", "Tải về một file .zip") +
        radio("smode", "ranges", cfg.splitMode, "Chia theo khoảng trang", "Mỗi khoảng thành một file") +
        '<input type="text" id="ranges" placeholder="VD: 1-3, 4-6, 7-10" style="margin:-2px 0 10px 25px;width:calc(100% - 25px)"' + (cfg.splitMode === "ranges" ? "" : " hidden") + ">" +
        radio("smode", "pick", cfg.splitMode, "Lấy một số trang thành một file", "Gõ số trang hoặc bấm chọn trang trên mặt bàn") +
        '<input type="text" id="pick" placeholder="VD: 1, 3, 5-7" style="margin:-2px 0 0 25px;width:calc(100% - 25px)"' + (cfg.splitMode === "pick" ? "" : " hidden") + ">" +
        "</div>";
    }
    if (op === "organize") {
      h += '<p class="note">Rê chuột vào trang trên mặt bàn để xoay hoặc đánh dấu xoá. Kéo trang để đổi chỗ.</p>' +
        '<div class="row" style="gap:6px;margin-top:10px"><button type="button" class="btn btn-sm" id="rotAll">Xoay tất cả 90°</button>' +
        '<button type="button" class="btn btn-sm" id="reverse">Đảo thứ tự</button><button type="button" class="btn btn-sm btn-quiet" id="resetPages">Đặt lại</button></div>';
    }
    if (op === "images") {
      h += '<div class="opt"><span class="label">Khổ giấy</span><div class="seg" id="imgSize" role="group" aria-label="Khổ giấy">' +
        '<button type="button" data-v="a4">A4</button><button type="button" data-v="fit">Theo ảnh</button></div></div>' +
        '<div class="opt"><label class="check"><input type="checkbox" id="imgMargin"> Chừa lề 10 mm</label>' +
        '<label class="check"><input type="checkbox" id="imgAuto"> Ảnh ngang thì xoay trang ngang</label></div>';
    }
    if (op === "compress") {
      h += '<div class="opt">' +
        radio("level", "light", cfg.level, "Nhẹ", "Giữ nguyên chữ và chất lượng, giảm được ít") +
        radio("level", "medium", cfg.level, "Vừa, 150 dpi", "Mỗi trang thành ảnh, hợp với bản scan. Chữ không bôi đen được nữa.") +
        radio("level", "strong", cfg.level, "Mạnh, 100 dpi", "Nhỏ nhất, vẫn đọc rõ trên điện thoại") +
        '<label class="check" style="margin-top:4px"><input type="checkbox" id="gray"> Chuyển sang trắng đen</label></div>';
    }
    if (op === "ocr") {
      h += '<div class="opt"><label class="field"><span>Ngôn ngữ trong tài liệu</span><select id="lang">' +
        '<option value="vie">Tiếng Việt</option><option value="vie+eng">Tiếng Việt và tiếng Anh</option><option value="eng">Tiếng Anh</option></select></label>' +
        '<p class="note" style="margin-top:0">Kết quả gồm PDF giữ nguyên trang gốc nhưng tìm kiếm, bôi đen được chữ, kèm bản Word và .txt. Lần đầu dùng trang tải bộ nhận dạng khoảng 5 MB, mỗi trang mất vài giây.</p></div>';
    }
    h += '<button type="button" class="btn btn-ink run" id="run">' + RUN[op] + "</button>" +
      '<div class="progress" hidden><i id="prog"></i></div><p class="status" id="st" role="status"></p><div class="result" id="res"></div>';
    panel.innerHTML = h;
    bindPanel();
  }
  function bindPanel() {
    var op = cfg.op, fin = $("#fin"), drop = $("#drop");
    fin.addEventListener("change", function () { addFiles(fin.files); fin.value = ""; });
    ["dragenter", "dragover"].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); }); });
    ["dragleave", "drop"].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove("over"); }); });
    drop.addEventListener("drop", function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
    $("#run").addEventListener("click", run);
    if (op === "split") {
      BT.$$('input[name="smode"]').forEach(function (r) {
        r.addEventListener("change", function () {
          cfg.splitMode = r.value; save();
          $("#ranges").hidden = cfg.splitMode !== "ranges";
          $("#pick").hidden = cfg.splitMode !== "pick";
          renderBoard();
        });
      });
      $("#pick").addEventListener("input", function () {
        if (!S.one) return;
        var sel = flatPages(this.value, S.one.pages.length);
        S.one.pages.forEach(function (p) { p.sel = sel.indexOf(p.n) >= 0; });
        BT.$$(".tile", board).forEach(function (t, i) { t.classList.toggle("sel", S.one.pages[i].sel); });
      });
    }
    if (op === "organize") {
      $("#rotAll").addEventListener("click", function () { if (!S.one) return; S.one.pages.forEach(function (p) { p.rot = (p.rot + 90) % 360; }); renderBoard(); });
      $("#reverse").addEventListener("click", function () { if (!S.one) return; S.one.pages.reverse(); renderBoard(); });
      $("#resetPages").addEventListener("click", function () {
        if (!S.one) return;
        S.one.pages = range(1, S.one.pdf.numPages).map(function (n) { return { n: n, rot: 0, del: false, sel: false }; });
        renderBoard();
      });
    }
    if (op === "images") {
      var seg = $("#imgSize");
      function syncSeg() { BT.$$("button", seg).forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-v") === cfg.imgSize)); }); }
      seg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; cfg.imgSize = b.getAttribute("data-v"); save(); syncSeg(); });
      syncSeg();
      $("#imgMargin").checked = cfg.imgMargin; $("#imgAuto").checked = cfg.imgAutoRotate;
      $("#imgMargin").addEventListener("change", function () { cfg.imgMargin = this.checked; save(); });
      $("#imgAuto").addEventListener("change", function () { cfg.imgAutoRotate = this.checked; save(); });
    }
    if (op === "compress") {
      BT.$$('input[name="level"]').forEach(function (r) { r.addEventListener("change", function () { cfg.level = r.value; save(); }); });
      $("#gray").checked = cfg.gray;
      $("#gray").addEventListener("change", function () { cfg.gray = this.checked; save(); });
    }
    if (op === "ocr") {
      $("#lang").value = cfg.lang;
      $("#lang").addEventListener("change", function () { cfg.lang = this.value; save(); });
    }
  }
  function setOp(op) {
    if (S.busy) return;
    cfg.op = op; save();
    BT.$$("#ops button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-op") === op)); });
    if (op !== "ocr") extra.innerHTML = "";
    else if (S.ocr && S.ocr.result) showOcr();
    renderPanel(); renderBoard();
    if (S.one && OPS[op].kind !== "img" && op !== "merge") status(S.one.name + ": " + S.one.pages.length + " trang.", "ok");
  }
  $("#ops").addEventListener("click", function (e) { var b = e.target.closest("button[data-op]"); if (b) setOp(b.getAttribute("data-op")); });
  // thả file lên cả mặt bàn
  var desk = board.parentElement;
  desk.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, "Files") >= 0) e.preventDefault(); });
  desk.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

  /* ------------------------------ Thực hiện ------------------------------ */
  function run() {
    if (S.busy) return;
    var op = cfg.op, job;
    $("#res").innerHTML = "";
    if (op === "merge") job = runMerge();
    else if (op === "images") job = runImages();
    else if (op === "ocr") job = runOcr();
    else if (!S.one) { status("Chọn 1 file PDF trước.", "err"); return; }
    else if (op === "split") job = runSplit();
    else if (op === "organize") job = runOrganize();
    else if (op === "compress") job = runCompress();
    if (!job) return;
    busy(true);
    job.catch(function (err) {
      console.error(err);
      status("Có lỗi: " + (err && err.message ? err.message : err), "err");
    }).then(function () { busy(false); progress(null); });
  }

  function loadSrc(L, bytes) { return L.PDFDocument.load(bytes, { ignoreEncryption: true }); }
  function pdfBlob(bytes) { return new Blob([bytes], { type: "application/pdf" }); }

  function runMerge() {
    if (S.merge.length < 2) { status("Cần ít nhất 2 file PDF để ghép.", "err"); return null; }
    return pdflib().then(function (L) {
      return L.PDFDocument.create().then(function (out) {
        var chain = Promise.resolve(), total = 0;
        S.merge.forEach(function (f, i) {
          chain = chain.then(function () {
            status("Đang ghép " + (i + 1) + "/" + S.merge.length + ": " + f.name, "busy");
            progress(i / S.merge.length);
            return loadSrc(L, f.bytes).then(function (src) {
              return out.copyPages(src, src.getPageIndices()).then(function (pages) { pages.forEach(function (p) { out.addPage(p); total++; }); });
            });
          });
        });
        return chain.then(function () { return out.save(); }).then(function (bytes) {
          delivered(pdfBlob(bytes), "ghep-" + S.merge.length + "-file.pdf", "Đã ghép " + S.merge.length + " file, " + total + " trang.");
        });
      });
    });
  }

  function runSplit() {
    var one = S.one, total = one.pdf.numPages, groups;
    if (cfg.splitMode === "each") groups = range(1, total).map(function (n) { return [n]; });
    else if (cfg.splitMode === "ranges") groups = parseGroups($("#ranges").value, total);
    else { var pg = flatPages($("#pick").value, total); groups = pg.length ? [pg] : []; }
    if (!groups.length) { status("Chưa có trang nào hợp lệ. File này có " + total + " trang.", "err"); return null; }
    return pdflib().then(function (L) {
      return loadSrc(L, one.bytes).then(function (src) {
        var files = [], chain = Promise.resolve();
        groups.forEach(function (g, i) {
          chain = chain.then(function () {
            progress(i / groups.length);
            status("Đang tách phần " + (i + 1) + "/" + groups.length + "...", "busy");
            return L.PDFDocument.create().then(function (doc) {
              return doc.copyPages(src, g.map(function (n) { return n - 1; })).then(function (pages) {
                pages.forEach(function (p) { doc.addPage(p); });
                return doc.save();
              }).then(function (bytes) {
                var name = base(one.name) + (g.length === 1 ? "-trang-" + pad3(g[0]) : "-trang-" + label(g).replace(/,/g, "_")) + ".pdf";
                files.push({ name: name, data: bytes });
              });
            });
          });
        });
        return chain.then(function () {
          if (files.length === 1) delivered(pdfBlob(files[0].data), files[0].name, "Đã lấy " + groups[0].length + " trang.");
          else delivered(BTZip.zip(files), base(one.name) + "-da-tach.zip", "Đã tách thành " + files.length + " file PDF.");
        });
      });
    });
  }

  function runOrganize() {
    var one = S.one, keep = one.pages.filter(function (p) { return !p.del; });
    if (!keep.length) { status("Bạn đang đánh dấu xoá tất cả các trang.", "err"); return null; }
    return pdflib().then(function (L) {
      return Promise.all([loadSrc(L, one.bytes), L.PDFDocument.create()]).then(function (r) {
        var src = r[0], out = r[1];
        return out.copyPages(src, keep.map(function (p) { return p.n - 1; })).then(function (pages) {
          pages.forEach(function (pg, i) {
            var add = keep[i].rot;
            if (add) pg.setRotation(L.degrees((pg.getRotation().angle + add) % 360));
            out.addPage(pg);
          });
          return out.save();
        }).then(function (bytes) {
          var removed = one.pages.length - keep.length;
          delivered(pdfBlob(bytes), base(one.name) + "-da-chinh.pdf", "Còn " + keep.length + " trang" + (removed ? ", đã xoá " + removed + " trang" : "") + ".");
        });
      });
    });
  }

  /* ---- Ảnh sang PDF ---- */
  function exifOrientation(u8) {
    if (u8[0] !== 0xFF || u8[1] !== 0xD8) return 0;
    var i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xFF) return 0;
      var mk = u8[i + 1], len = (u8[i + 2] << 8) | u8[i + 3];
      if (mk === 0xE1 && u8[i + 4] === 0x45 && u8[i + 5] === 0x78 && u8[i + 6] === 0x69 && u8[i + 7] === 0x66) {
        var t = i + 10, le = u8[t] === 0x49;
        var r16 = function (o) { return le ? u8[o] | (u8[o + 1] << 8) : (u8[o] << 8) | u8[o + 1]; };
        var r32 = function (o) { return le ? (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0 : ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0; };
        var ifd = t + r32(t + 4), n = r16(ifd);
        for (var k = 0; k < n; k++) { var e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8); }
        return 0;
      }
      if (mk === 0xDA) return 0;
      i += 2 + len;
    }
    return 0;
  }
  function loadImg(url) {
    return new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error("không đọc được ảnh")); }; im.src = url; });
  }
  function canvasJpeg(im, q, gray) {
    var c = document.createElement("canvas");
    c.width = im.naturalWidth || im.width; c.height = im.naturalHeight || im.height;
    var x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    if (gray) x.filter = "grayscale(1)";
    x.drawImage(im, 0, 0);
    return new Promise(function (res) { c.toBlob(res, "image/jpeg", q); }).then(function (b) { c.width = c.height = 0; return b.arrayBuffer(); })
      .then(function (ab) { return new Uint8Array(ab); });
  }
  // Nhúng 1 ảnh vào tài liệu pdf-lib, trả về { img, w, h } (w,h theo chiều hiển thị đúng)
  function embedImage(L, doc, item) {
    return bytesOf(item.file).then(function (u8) {
      return loadImg(item.url).then(function (im) {
        var isJpg = u8[0] === 0xFF && u8[1] === 0xD8, isPng = u8[0] === 0x89 && u8[1] === 0x50;
        var job;
        if (isJpg && exifOrientation(u8) <= 1) job = doc.embedJpg(u8);
        else if (isPng) job = doc.embedPng(u8);
        else job = canvasJpeg(im, 0.9).then(function (b) { return doc.embedJpg(b); });
        return job.then(function (img) { return { img: img, w: im.naturalWidth, h: im.naturalHeight }; });
      });
    });
  }
  var A4 = [595.28, 841.89], MM = 72 / 25.4;
  function runImages() {
    var list = S.images;
    if (!list.length) { status("Chọn ít nhất 1 ảnh.", "err"); return null; }
    return pdflib().then(function (L) {
      return L.PDFDocument.create().then(function (doc) {
        var chain = Promise.resolve();
        list.forEach(function (item, i) {
          chain = chain.then(function () {
            status("Đang thêm ảnh " + (i + 1) + "/" + list.length + "...", "busy");
            progress(i / list.length);
            return embedImage(L, doc, item).then(function (r) {
              var pw, ph, m = 0;
              if (cfg.imgSize === "a4") {
                pw = A4[0]; ph = A4[1];
                if (cfg.imgAutoRotate && r.w > r.h) { pw = A4[1]; ph = A4[0]; }
                m = cfg.imgMargin ? 10 * MM : 0;
              } else {
                var k = 841.89 / Math.max(r.w, r.h);
                pw = r.w * k; ph = r.h * k;
              }
              var s = Math.min((pw - 2 * m) / r.w, (ph - 2 * m) / r.h);
              var w = r.w * s, h = r.h * s;
              var page = doc.addPage([pw, ph]);
              page.drawImage(r.img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
            });
          });
        });
        return chain.then(function () { return doc.save(); }).then(function (bytes) {
          delivered(pdfBlob(bytes), (list.length === 1 ? base(list[0].name) : "anh-sang-pdf") + ".pdf", "Đã tạo PDF " + list.length + " trang.");
        });
      });
    });
  }

  /* ---- Nén ---- */
  function renderPage(pdf, n, dpi) {
    return pdf.getPage(n).then(function (page) {
      var v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: dpi / 72 });
      var c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      var x = c.getContext("2d");
      x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: x, viewport: vp }).promise.then(function () { return { canvas: c, w: v1.width, h: v1.height, page: page }; });
    });
  }
  function canvasToJpegBytes(c, q, gray) {
    var src = c;
    if (gray) {
      src = document.createElement("canvas"); src.width = c.width; src.height = c.height;
      var x = src.getContext("2d"); x.filter = "grayscale(1)"; x.drawImage(c, 0, 0);
    }
    return new Promise(function (res) { src.toBlob(res, "image/jpeg", q); }).then(function (b) {
      if (src !== c) src.width = src.height = 0;
      return b.arrayBuffer();
    }).then(function (ab) { return new Uint8Array(ab); });
  }
  function runCompress() {
    var one = S.one, before = one.bytes.length;
    return pdflib().then(function (L) {
      var job;
      if (cfg.level === "light") {
        status("Đang sắp xếp lại cấu trúc file...", "busy");
        job = loadSrc(L, one.bytes).then(function (doc) { return doc.save({ useObjectStreams: true }); });
      } else {
        var dpi = cfg.level === "strong" ? 100 : 150, q = cfg.level === "strong" ? 0.55 : 0.7;
        job = L.PDFDocument.create().then(function (doc) {
          var chain = Promise.resolve(), N = one.pdf.numPages;
          range(1, N).forEach(function (n) {
            chain = chain.then(function () {
              status("Đang nén trang " + n + "/" + N + "...", "busy");
              progress((n - 1) / N);
              return renderPage(one.pdf, n, dpi).then(function (r) {
                return canvasToJpegBytes(r.canvas, q, cfg.gray).then(function (jpg) {
                  r.canvas.width = r.canvas.height = 0;
                  return doc.embedJpg(jpg).then(function (img) {
                    doc.addPage([r.w, r.h]).drawImage(img, { x: 0, y: 0, width: r.w, height: r.h });
                  });
                });
              });
            });
          });
          return chain.then(function () { return doc.save({ useObjectStreams: true }); });
        });
      }
      return job.then(function (bytes) {
        var after = bytes.length, name = base(one.name) + "-da-nen.pdf";
        if (after >= before * 0.97) {
          var url = URL.createObjectURL(pdfBlob(bytes));
          $("#res").innerHTML = '<a href="' + url + '" download="' + BT.esc(name) + '">Vẫn tải bản đã nén (' + BT.size(after) + ")</a>";
          status("File gốc đã gọn sẵn: bản nén " + BT.size(after) + " không nhỏ hơn bản gốc " + BT.size(before) + ". Thử mức mạnh hơn hoặc giữ file gốc.", "err");
          return;
        }
        delivered(pdfBlob(bytes), name, "Từ " + BT.size(before) + " còn " + BT.size(after) + ", giảm " + Math.round((1 - after / before) * 100) + "%.");
      });
    });
  }

  /* ---- Nhận dạng chữ (OCR) ---- */
  var SIMD = (function () {
    try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
    catch (e) { return false; }
  })();
  function makeWorker(lang, onLog) {
    return BT.loadScript("vendor/tesseract/tesseract.min.js").then(function () {
      return Tesseract.createWorker(lang.split("+"), 1, {
        workerPath: abs("vendor/tesseract/worker.min.js"),
        corePath: abs("vendor/tesseract/" + (SIMD ? "tesseract-core-simd-lstm.wasm.js" : "tesseract-core-lstm.wasm.js")),
        langPath: abs("vendor/tesseract/lang"),
        logger: onLog
      });
    });
  }
  // Nối các dòng bị ngắt giữa câu (dòng sau viết thường, dòng trước không kết thúc bằng dấu câu)
  function paragraphs(text) {
    var out = [];
    String(text || "").split(/\n\s*\n/).forEach(function (block) {
      var cur = "";
      block.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean).forEach(function (line) {
        var first = line.charAt(0);
        var cont = cur && !/[.:;!?…]$/.test(cur) && first === first.toLocaleLowerCase("vi-VN") && first !== first.toLocaleUpperCase("vi-VN");
        if (cont) cur += " " + line;
        else { if (cur) out.push(cur); cur = line; }
      });
      if (cur) out.push(cur);
    });
    return out;
  }
  function runOcr() {
    if (location.protocol === "file:") {
      status("Nhận dạng chữ cần mở trang qua web (GitHub Pages) hoặc máy chủ trên máy. Khi mở thẳng file trên máy, trình duyệt chặn phần này.", "err");
      return null;
    }
    var fromPdf = !!S.one, imgs = S.ocrImgs;
    if (!fromPdf && !imgs.length) { status("Chọn 1 file PDF hoặc vài ảnh tài liệu trước.", "err"); return null; }
    var N = fromPdf ? S.one.pdf.numPages : imgs.length, DPI = 220, one = S.one;
    var cur = 0, texts = [], layers = [], worker;
    var job = S.ocr = { done: [], result: null };
    status("Đang tải bộ nhận dạng chữ...", "busy");
    progress(0);
    function onLog(m) {
      if (m.status === "recognizing text") {
        progress((cur + (m.progress || 0)) / N);
        status("Đang đọc trang " + (cur + 1) + "/" + N + " (" + Math.round((m.progress || 0) * 100) + "%)...", "busy");
      } else if (/loading|initializ/.test(m.status || "")) status("Đang tải bộ nhận dạng chữ...", "busy");
    }
    return Promise.all([makeWorker(cfg.lang, onLog), pdflib()]).then(function (r) {
      worker = r[0];
      var L = r[1];
      return worker.setParameters({ user_defined_dpi: String(DPI), preserve_interword_spaces: "1" }).then(function () {
        var chain = Promise.resolve();
        range(0, N - 1).forEach(function (i) {
          chain = chain.then(function () {
            cur = i;
            var getCanvas = fromPdf ? renderPage(one.pdf, i + 1, DPI).then(function (x) { return x.canvas; })
              : loadImg(imgs[i].url).then(function (im) {
                // ảnh quá lớn thì thu về cạnh dài 3000 px cho nhanh
                var k = Math.min(1, 3000 / Math.max(im.naturalWidth, im.naturalHeight));
                var c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
                c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); return c;
              });
            return getCanvas.then(function (c) {
              return worker.recognize(c, { pdfTitle: "OCR", pdfTextOnly: true }, { text: true, pdf: true }).then(function (res) {
                c.width = c.height = 0;
                texts.push(res.data.text || "");
                layers.push(res.data.pdf ? new Uint8Array(res.data.pdf) : null);
                job.done[i] = true;
              });
            });
          });
        });
        return chain.then(function () {
          status("Đang ghép lớp chữ vào PDF...", "busy");
          progress(1);
          return buildSearchable(L, fromPdf ? one : null, layers, imgs);
        }).then(function (pdfBytes) {
          var name = fromPdf ? base(one.name) : (imgs.length === 1 ? base(imgs[0].name) : "anh-tai-lieu");
          job.result = { pdf: pdfBytes, texts: texts, name: name };
          if (S.ocr !== job) return;
          showOcr();
          if (fromPdf) renderBoard();
          var chars = texts.join("").replace(/\s/g, "").length;
          status(chars ? "Đã đọc " + N + " trang. Kiểm tra chữ ở mặt bàn rồi tải bản bạn cần." : "Không tìm thấy chữ nào. Ảnh có thể quá mờ hoặc sai ngôn ngữ.", chars ? "ok" : "err");
        });
      });
    }).then(function () { if (worker) return worker.terminate(); }, function (err) {
      if (worker) worker.terminate();
      throw err;
    });
  }
  // Giữ nguyên trang gốc, phủ lớp chữ ẩn (do tesseract tạo) lên đúng vị trí
  function buildSearchable(L, one, layers, imgs) {
    var docJob = one ? loadSrc(L, one.bytes) : L.PDFDocument.create().then(function (doc) {
      var chain = Promise.resolve();
      imgs.forEach(function (item) {
        chain = chain.then(function () {
          return embedImage(L, doc, item).then(function (r) {
            var k = 841.89 / Math.max(r.w, r.h), w = r.w * k, h = r.h * k;
            doc.addPage([w, h]).drawImage(r.img, { x: 0, y: 0, width: w, height: h });
          });
        });
      });
      return chain.then(function () { return doc; });
    });
    return docJob.then(function (doc) {
      var chain = Promise.resolve();
      layers.forEach(function (layer, i) {
        if (!layer) return;
        chain = chain.then(function () {
          return doc.embedPdf(layer, [0]).then(function (emb) {
            var page = doc.getPage(i), cb = page.getCropBox(), rot = ((page.getRotation().angle % 360) + 360) % 360;
            var o = { x: cb.x, y: cb.y, width: cb.width, height: cb.height };
            if (rot === 90) o = { x: cb.x + cb.width, y: cb.y, width: cb.height, height: cb.width, rotate: L.degrees(90) };
            else if (rot === 180) o = { x: cb.x + cb.width, y: cb.y + cb.height, width: cb.width, height: cb.height, rotate: L.degrees(180) };
            else if (rot === 270) o = { x: cb.x, y: cb.y + cb.height, width: cb.height, height: cb.width, rotate: L.degrees(270) };
            page.drawPage(emb[0], o);
          });
        });
      });
      return chain.then(function () { return doc.save({ useObjectStreams: true }); });
    });
  }
  var SEP = /\n?─{3,} Trang \d+ ─{3,}\n?/;
  function showOcr() {
    var r = S.ocr && S.ocr.result; if (!r) return;
    var text = r.texts.map(function (t, i) { return (i ? "\n" : "") + "──── Trang " + (i + 1) + " ────\n" + t.trim(); }).join("\n");
    extra.innerHTML = '<div class="ocr-panel"><h2>Chữ nhận dạng được</h2>' +
      '<p class="note" style="margin:-4px 0 10px">Có thể sửa trực tiếp trước khi tải Word hoặc .txt. Bản PDF giữ nguyên hình trang gốc.</p>' +
      '<textarea class="ocr-text" id="ocrText" spellcheck="false"></textarea>' +
      '<div class="row" style="gap:8px"><button type="button" class="btn btn-ink" data-dl="pdf">Tải PDF có chữ</button>' +
      '<button type="button" class="btn" data-dl="docx">Tải Word (.docx)</button><button type="button" class="btn" data-dl="txt">Tải .txt</button>' +
      '<button type="button" class="btn btn-quiet" data-dl="copy">Sao chép chữ</button></div></div>';
    $("#ocrText").value = text;
  }
  extra.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-dl]"), r = S.ocr && S.ocr.result;
    if (!b || !r) return;
    var kind = b.getAttribute("data-dl"), text = $("#ocrText").value;
    if (kind === "pdf") BT.download(pdfBlob(r.pdf), r.name + "-co-chu.pdf");
    if (kind === "txt") BT.download(new Blob(["﻿" + text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" }), r.name + ".txt");
    if (kind === "docx") {
      var pages = text.split(SEP).filter(function (p, i) { return i > 0 || p.trim(); }).map(paragraphs);
      BT.download(BTZip.docx(pages), r.name + ".docx");
    }
    if (kind === "copy") {
      var done = function () { b.textContent = "Đã sao chép"; setTimeout(function () { b.textContent = "Sao chép chữ"; }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { $("#ocrText").select(); document.execCommand("copy"); done(); });
      else { $("#ocrText").select(); document.execCommand("copy"); done(); }
    }
  });

  /* ------------------------------ Khởi động ------------------------------ */
  if (!OPS[cfg.op]) cfg.op = "merge";
  setOp(cfg.op);
})();
