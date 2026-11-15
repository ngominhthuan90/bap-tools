/* Phiếu STT – sinh hiệu: 6 phiếu / tờ A4 (2 cột × 3 hàng) */
(function () {
  "use strict";
  var $ = BT.$, PER = 6, KEY = "phieu-stt", MAX_PAGES = 300;

  var DEF = {
    unit: "", from: 1, pages: 1, digits: 3, prefix: "",
    f: { name: true, year: true, room: true, transfer: true, mt: true, hant: true, spo2: false, weight: true, height: false }
  };
  var saved = BT.store.get(KEY, {});
  var st = {
    unit: saved.unit != null ? saved.unit : DEF.unit,
    from: saved.from || DEF.from,
    pages: saved.pages || DEF.pages,
    digits: saved.digits || DEF.digits,
    prefix: saved.prefix || "",
    f: Object.assign({}, DEF.f, saved.f || {})
  };

  var el = {
    unit: $("#unit"), from: $("#from"), pages: $("#pages"), to: $("#to"),
    digits: $("#digits"), prefix: $("#prefix"), quick: $("#quick"),
    sheets: $("#sheets"), print: $("#print"), printLabel: $("#printLabel"), summary: $("#summary")
  };

  function save() { BT.store.set(KEY, st); }
  function toNumber() { return st.from + st.pages * PER - 1; }

  function fieldRow(items) {
    return '<div class="f-row">' + items.map(function (it) {
      return '<div class="f"><b>' + it + "</b><i></i></div>";
    }).join("") + "</div>";
  }

  function slipBody() {
    var f = st.f, rows = [];
    if (f.name) rows.push(["Họ và tên"]);
    if (f.year) rows.push(["Năm sinh"]);
    if (f.room) rows.push(["Khám phòng"]);
    if (f.transfer) rows.push(["Chuyển phòng"]);
    if (f.mt) rows.push(["Mạch", "T°"]);
    if (f.hant) rows.push(["HA", "NT"]);
    var tail = [];
    if (f.spo2) tail.push("SpO₂ <small>(%)</small>");
    if (f.weight) tail.push("Cân nặng <small>(kg)</small>");
    if (f.height) tail.push("Chiều cao <small>(cm)</small>");
    // gom các ô ngắn thành hàng đôi cho gọn
    while (tail.length) rows.push(tail.splice(0, 2));
    return rows.map(fieldRow).join("");
  }

  function render() {
    var to = toNumber();
    el.to.value = to;
    var body = slipBody();
    var unit = st.unit.trim() ? '<div class="slip-unit">' + BT.esc(st.unit.trim()) + "</div>" : "";
    var html = "", n = st.from;
    for (var p = 0; p < st.pages; p++) {
      var inner = '<div class="slips">';
      for (var i = 0; i < PER; i++, n++) {
        inner += '<div class="slip"><div class="slip-head">' + unit +
          '<div class="slip-no">' + BT.esc(st.prefix) + BT.pad(n, st.digits) + "</div></div>" +
          '<div class="slip-body">' + body + "</div></div>";
      }
      inner += "</div>";
      html += BT.sheetHTML(inner, p, st.pages);
    }
    el.sheets.innerHTML = html;
    BT.fit(el.sheets);

    el.printLabel.textContent = "In " + st.pages + " tờ A4";
    el.summary.textContent = "Phiếu số " + st.prefix + BT.pad(st.from, st.digits) + " đến " + st.prefix + BT.pad(to, st.digits) +
      " (" + (st.pages * PER) + " phiếu)." + (st.unit.trim() ? "" : " Chưa có tên đơn vị nên đầu phiếu chỉ có số.");
    BT.$$("button", el.quick).forEach(function (b) {
      b.setAttribute("aria-pressed", String(+b.getAttribute("data-n") === st.pages));
    });
    save();
  }

  // ---- Gắn giá trị ban đầu ----
  el.unit.value = st.unit;
  el.from.value = st.from;
  el.pages.value = st.pages;
  el.digits.value = String(st.digits);
  el.prefix.value = st.prefix;
  BT.$$("#fields input").forEach(function (cb) { cb.checked = !!st.f[cb.getAttribute("data-f")]; });

  // ---- Sự kiện ----
  el.unit.addEventListener("input", function () {
    var p = el.unit.selectionStart;
    el.unit.value = BT.upperVN(el.unit.value);
    try { el.unit.setSelectionRange(p, p); } catch (e) {}
    st.unit = el.unit.value; render();
  });
  el.from.addEventListener("input", function () {
    st.from = BT.clamp(BT.int(el.from, 1), 1, 99999); render();
  });
  el.from.addEventListener("blur", function () { el.from.value = st.from; });
  el.pages.addEventListener("input", function () {
    st.pages = BT.clamp(BT.int(el.pages, 1), 1, MAX_PAGES); render();
  });
  el.pages.addEventListener("blur", function () { el.pages.value = st.pages; });
  el.to.addEventListener("change", function () {
    var to = Math.max(st.from, BT.int(el.to, st.from));
    st.pages = BT.clamp(Math.ceil((to - st.from + 1) / PER), 1, MAX_PAGES);
    el.pages.value = st.pages; render();
  });
  el.quick.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-n]"); if (!b) return;
    st.pages = +b.getAttribute("data-n"); el.pages.value = st.pages; render();
  });
  el.digits.addEventListener("change", function () { st.digits = +el.digits.value; render(); });
  el.prefix.addEventListener("input", function () { st.prefix = el.prefix.value.trim(); render(); });
  BT.$("#fields").addEventListener("change", function (e) {
    var k = e.target.getAttribute("data-f"); if (!k) return;
    st.f[k] = e.target.checked; render();
  });
  el.print.addEventListener("click", function () { BT.print(); });

  BT.autoFit(el.sheets);
  render();
})();
