/* =====================================================================
   Bảng sinh hiệu đi buồng
   1) Dán / tải danh sách -> 2) kiểm tra, sửa -> 3) tiêu đề khoa, ngày -> In
   20 bệnh nhân mỗi trang A4. Không có danh sách thì in bảng trắng.
   Danh sách bệnh nhân KHÔNG được lưu vào trình duyệt.
   ===================================================================== */
(function () {
  "use strict";
  var $ = BT.$, P = window.DSParser, PER = 20, KEY = "di-buong";
  var DEFAULT_DEPTS = ["Nội tổng hợp", "Ngoại tổng hợp", "Sản", "Nhi", "Hồi sức tích cực (ICU)", "Cấp cứu", "YHCT - PHCN"];
  var cfg = Object.assign({ depts: DEFAULT_DEPTS.slice(), dept: DEFAULT_DEPTS[0], spo2: true, dhmm: true, blank: 1 }, BT.store.get(KEY, {}));
  if (!Array.isArray(cfg.depts) || !cfg.depts.length) cfg.depts = DEFAULT_DEPTS.slice();
  var rows = [];

  var el = {
    paste: $("#paste"), status: $("#status"), file: $("#file"), list: $("#list"), nCount: $("#nCount"),
    dept: $("#dept"), sheets: $("#sheets"), printLabel: $("#printLabel"), blankOpt: $("#blankOpt"), print: $("#print")
  };
  var date = BT.dateMask($("#date"), schedule);
  BT.calendarButton($("#cal"), date, schedule);
  $("#today").addEventListener("click", function () { date.setToday(); render(); });
  date.setToday();

  function save() { BT.store.set(KEY, cfg); }
  function setStatus(msg, kind) { el.status.textContent = msg || ""; el.status.className = "status" + (kind ? " " + kind : ""); }

  /* ---------------- Danh sách để kiểm tra ---------------- */
  function renderList() {
    el.nCount.textContent = rows.length ? rows.length + " người" : "";
    if (!rows.length) {
      el.list.innerHTML = '<p class="list-empty">Chưa có ai. Dán danh sách ở bước 1, hoặc bấm Thêm dòng để gõ tay.</p>';
      return;
    }
    var h = '<div class="list-head"><span></span><span>#</span><span>Họ và tên</span><span>Năm sinh</span><span>Giường</span><span></span></div>';
    rows.forEach(function (r, i) {
      h += '<div class="li" data-i="' + i + '">' +
        '<span class="grip" title="Kéo để đổi thứ tự" aria-hidden="true">⋮⋮</span>' +
        '<span class="idx">' + (i + 1) + "</span>" +
        '<input type="text" class="nm" data-k="name" value="' + BT.esc(r.name) + '" aria-label="Họ và tên dòng ' + (i + 1) + '">' +
        '<input type="text" data-k="year" inputmode="numeric" maxlength="4" value="' + BT.esc(r.year) + '" aria-label="Năm sinh dòng ' + (i + 1) + '">' +
        '<input type="text" data-k="bed" maxlength="8" value="' + BT.esc(r.bed || "") + '" aria-label="Số giường dòng ' + (i + 1) + '">' +
        '<button type="button" class="del" title="Xoá dòng" aria-label="Xoá dòng ' + (i + 1) + '">✕</button></div>';
    });
    el.list.innerHTML = h;
  }
  el.list.addEventListener("input", function (e) {
    var li = e.target.closest(".li"), k = e.target.getAttribute("data-k");
    if (!li || !k) return;
    rows[+li.getAttribute("data-i")][k] = e.target.value;
    schedule();
  });
  el.list.addEventListener("blur", function (e) {
    if (e.target.getAttribute && e.target.getAttribute("data-k") === "name") {
      e.target.value = P.upper(e.target.value).replace(/\s+/g, " ").trim();
      var li = e.target.closest(".li");
      rows[+li.getAttribute("data-i")].name = e.target.value;
      schedule();
    }
  }, true);
  el.list.addEventListener("click", function (e) {
    if (!e.target.classList.contains("del")) return;
    var i = +e.target.closest(".li").getAttribute("data-i");
    rows.splice(i, 1);
    renderList(); render();
  });
  // Kéo thả để đổi thứ tự (chỉ kéo được khi nắm vào ⋮⋮)
  var dragFrom = null;
  el.list.addEventListener("pointerdown", function (e) {
    var g = e.target.closest(".grip");
    if (g) g.parentNode.draggable = true;
  });
  el.list.addEventListener("dragstart", function (e) {
    var li = e.target.closest && e.target.closest(".li");
    if (!li) return;
    dragFrom = +li.getAttribute("data-i");
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", ""); } catch (err) {}
  });
  el.list.addEventListener("dragover", function (e) {
    if (dragFrom === null) return;
    e.preventDefault();
    var li = e.target.closest(".li"), src = el.list.querySelector(".li.dragging");
    if (!li || !src || li === src) return;
    var r = li.getBoundingClientRect();
    li.parentNode.insertBefore(src, (e.clientY - r.top) / r.height > 0.5 ? li.nextSibling : li);
  });
  el.list.addEventListener("dragend", function () {
    if (dragFrom === null) return;
    var order = BT.$$(".li", el.list).map(function (li) { return rows[+li.getAttribute("data-i")]; });
    rows = order; dragFrom = null;
    renderList(); render();
  });

  $("#addRow").addEventListener("click", function () {
    rows.push({ name: "", year: "", bed: "" });
    renderList(); render();
    var inputs = el.list.querySelectorAll('input[data-k="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  $("#sortBed").addEventListener("click", function () {
    if (!rows.some(function (r) { return (r.bed || "").trim(); })) { setStatus("Chưa có số giường nào để xếp.", "err"); return; }
    rows.sort(function (a, b) {
      var x = (a.bed || "").trim(), y = (b.bed || "").trim();
      if (!x) return 1; if (!y) return -1;
      return x.localeCompare(y, "vi", { numeric: true });
    });
    renderList(); render(); setStatus("Đã xếp theo số giường.", "ok");
  });
  $("#clearList").addEventListener("click", function () {
    if (!rows.length) return;
    if (!confirm("Xoá toàn bộ danh sách đang có?")) return;
    rows = []; renderList(); render(); setStatus("");
  });

  /* ---------------- Bước 1: đọc danh sách ---------------- */
  function takeRows(found, source) {
    if (!found.length) {
      setStatus("Không nhận ra dòng nào có họ tên" + (source ? " trong " + source : "") + ". Kiểm tra lại nội dung, hoặc gõ tay ở bước 2.", "err");
      return;
    }
    rows = found.map(function (r) { return { name: r.name, year: r.year || "", bed: "" }; });
    renderList(); render();
    var noYear = rows.filter(function (r) { return !r.year; }).length;
    setStatus("Đã nhận " + rows.length + " người" + (noYear ? ", " + noYear + " người chưa có năm sinh" : "") + ". Kiểm tra lại ở bước 2.", "ok");
  }
  $("#parse").addEventListener("click", function () { takeRows(P.parseText(el.paste.value)); });
  el.paste.addEventListener("paste", function () { setTimeout(function () { takeRows(P.parseText(el.paste.value)); }, 0); });

  el.file.addEventListener("change", function () {
    var f = el.file.files && el.file.files[0];
    el.file.value = "";
    if (!f) return;
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    setStatus("Đang đọc " + f.name + "...", "busy");
    var job;
    if (ext === "txt" || ext === "csv") job = f.text();
    else if (ext === "xlsx" || ext === "xls") job = readExcel(f);
    else if (ext === "docx") job = readDocx(f);
    else if (ext === "pdf") job = readPdf(f);
    else { setStatus("Chưa hỗ trợ loại file này. Dùng PDF, Excel, Word, txt hoặc csv.", "err"); return; }
    job.then(function (text) {
      el.paste.value = text;
      takeRows(P.parseText(text), f.name);
    }).catch(function (err) {
      setStatus("Không đọc được " + f.name + ": " + (err && err.message ? err.message : err), "err");
    });
  });

  function readExcel(file) {
    return Promise.all([BT.loadScript("vendor/xlsx.full.min.js"), file.arrayBuffer()]).then(function (r) {
      var wb = XLSX.read(new Uint8Array(r[1]), { type: "array", cellDates: true });
      var sh = wb.Sheets[wb.SheetNames[0]];
      var data = XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, dateNF: "dd/mm/yyyy" });
      return data.map(function (row) {
        return (row || []).map(function (c) { return c == null ? "" : String(c); }).join("\t").trim();
      }).join("\n");
    });
  }
  function readDocx(file) {
    return Promise.all([BT.loadScript("vendor/mammoth.browser.min.js"), file.arrayBuffer()]).then(function (r) {
      // giữ bảng trong Word thành các cột cách nhau bằng Tab
      return mammoth.convertToHtml({ arrayBuffer: r[1] }).then(function (res) {
        var doc = new DOMParser().parseFromString(res.value, "text/html"), out = [];
        Array.prototype.forEach.call(doc.body.children, function (node) {
          if (node.tagName === "TABLE") {
            Array.prototype.forEach.call(node.querySelectorAll("tr"), function (tr) {
              out.push(Array.prototype.map.call(tr.children, function (td) { return td.textContent.trim(); }).join("\t"));
            });
          } else out.push(node.textContent);
        });
        return out.join("\n");
      });
    });
  }
  function readPdf(file) {
    return Promise.all([BT.loadScript("vendor/pdfjs/pdf.min.js"), file.arrayBuffer()]).then(function (r) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js";
      return pdfjsLib.getDocument({ data: r[1] }).promise;
    }).then(function (doc) {
      var chain = Promise.resolve(), all = [];
      for (var p = 1; p <= doc.numPages; p++) {
        (function (n) {
          chain = chain.then(function () { return doc.getPage(n); })
            .then(function (page) { return page.getTextContent(); })
            .then(function (tc) { all = all.concat(P.pdfPageLines(tc.items)); });
        })(p);
      }
      return chain.then(function () {
        if (!all.length) throw new Error("file PDF không có chữ (có thể là bản scan). Hãy dùng Công cụ PDF để nhận dạng chữ trước.");
        return all.join("\n");
      });
    });
  }

  /* ---------------- Khoa ---------------- */
  function renderDepts() {
    el.dept.innerHTML = cfg.depts.map(function (d) { return '<option value="' + BT.esc(d) + '">' + BT.esc(d) + "</option>"; }).join("");
    if (cfg.depts.indexOf(cfg.dept) < 0) cfg.dept = cfg.depts[0] || "";
    el.dept.value = cfg.dept;
  }
  el.dept.addEventListener("change", function () { cfg.dept = el.dept.value; save(); render(); });
  $("#addDept").addEventListener("click", function () {
    var name = (prompt("Tên khoa mới (VD: Nội tim mạch):") || "").replace(/^\s*khoa\s+/i, "").trim();
    if (!name) return;
    var i = cfg.depts.map(function (d) { return d.toLowerCase(); }).indexOf(name.toLowerCase());
    if (i >= 0) cfg.depts.splice(i, 1);
    cfg.depts.unshift(name); cfg.dept = name;
    save(); renderDepts(); render();
  });
  $("#delDept").addEventListener("click", function () {
    if (cfg.depts.length <= 1) return;
    if (!confirm('Bỏ "' + cfg.dept + '" khỏi danh sách khoa?')) return;
    cfg.depts.splice(cfg.depts.indexOf(cfg.dept), 1);
    cfg.dept = cfg.depts[0]; save(); renderDepts(); render();
  });

  /* ---------------- Tờ in ---------------- */
  function title() {
    var d = (cfg.dept || "").trim();
    return "DANH SÁCH BỆNH NHÂN" + (d ? " KHOA " + P.upper(d) : "");
  }
  function columns() {
    var vit = ["MẠCH", "NHIỆT ĐỘ", "HUYẾT ÁP", "NHỊP THỞ"];
    if (cfg.spo2) vit.push("SpO₂");
    if (cfg.dhmm) vit.push("ĐHMM");
    var fixed = { stt: 5, name: 28, year: 8, bed: 8.5 };
    var each = (100 - fixed.stt - fixed.name - fixed.year - fixed.bed) / vit.length;
    return { vit: vit, w: fixed, each: each };
  }
  function pageHTML(list, start, dateText) {
    var c = columns();
    var h = '<div class="ward"><h2>' + BT.esc(title()) + '</h2><p class="wd">NGÀY: ' + BT.esc(dateText) + "</p><table><colgroup>" +
      '<col style="width:' + c.w.stt + '%"><col style="width:' + c.w.name + '%"><col style="width:' + c.w.year + '%"><col style="width:' + c.w.bed + '%">' +
      c.vit.map(function () { return '<col style="width:' + c.each.toFixed(3) + '%">'; }).join("") +
      "</colgroup><thead><tr><th>STT</th><th>HỌ VÀ TÊN</th><th>NĂM<br>SINH</th><th>GIƯỜNG</th>" +
      c.vit.map(function (v) { return "<th>" + v + "</th>"; }).join("") + "</tr></thead><tbody>";
    var blanks = c.vit.map(function () { return "<td></td>"; }).join("");
    for (var i = 0; i < PER; i++) {
      var r = list[i];
      h += "<tr><td>" + (start + i + 1) + '</td><td class="nm">' + (r ? BT.esc(P.nameForPrint(r.name)) : "") + "</td><td>" +
        (r ? BT.esc(r.year) : "") + "</td><td>" + (r ? BT.esc(r.bed || "") : "") + "</td>" + blanks + "</tr>";
    }
    return h + "</tbody></table></div>";
  }
  function render() {
    var list = rows.filter(function (r) { return (r.name || "").trim(); });
    var html = "", pages;
    el.blankOpt.hidden = list.length > 0;
    if (list.length) {
      pages = Math.ceil(list.length / PER);
      var d = date.value() || "........../........../................";
      for (var p = 0; p < pages; p++) html += BT.sheetHTML(pageHTML(list.slice(p * PER, p * PER + PER), p * PER, d), p, pages);
    } else {
      pages = cfg.blank === 2 ? 2 : 1;
      for (var b = 0; b < pages; b++) html += BT.sheetHTML(pageHTML([], b * PER, "........../........../................"), b, pages);
    }
    el.sheets.innerHTML = html;
    BT.fit(el.sheets);
    el.printLabel.textContent = (list.length ? "In " : "In bảng trắng ") + pages + " trang A4";
    BT.$$("#blankSeg button").forEach(function (bt) { bt.setAttribute("aria-pressed", String(+bt.getAttribute("data-v") === cfg.blank)); });
  }
  var timer;
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 120); }

  $("#colSpo2").checked = !!cfg.spo2;
  $("#colDhmm").checked = !!cfg.dhmm;
  $("#colSpo2").addEventListener("change", function () { cfg.spo2 = this.checked; save(); render(); });
  $("#colDhmm").addEventListener("change", function () { cfg.dhmm = this.checked; save(); render(); });
  $("#blankSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (!b) return;
    cfg.blank = +b.getAttribute("data-v"); save(); render();
  });
  el.print.addEventListener("click", function () { BT.print(); });

  renderDepts();
  renderList();
  BT.autoFit(el.sheets);
  render();
})();
