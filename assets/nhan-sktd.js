/* Nhãn STT khám SKTD: lưới 5 × 8 = 40 nhãn / trang A4 */
(function () {
  "use strict";
  var $ = BT.$, PER = 40, KEY = "nhan-sktd", MAX = 4000;
  var saved = BT.store.get(KEY, {});
  var st = { unit: saved.unit || "", from: saved.from || 1, qty: saved.qty || 40 };

  var el = {
    unit: $("#unit"), date: $("#date"), from: $("#from"), qty: $("#qty"), to: $("#to"),
    quick: $("#quick"), sheets: $("#sheets"), printLabel: $("#printLabel"), summary: $("#summary")
  };
  var date = BT.dateMask(el.date, render);
  BT.calendarButton($("#cal"), date, render);
  $("#today").addEventListener("click", function () { date.setToday(); render(); el.date.focus(); });

  function save() { BT.store.set(KEY, st); }

  function render() {
    var unit = BT.esc(st.unit.trim());
    var d = BT.esc(date.value());
    var end = st.from + st.qty - 1;
    var pages = Math.ceil(st.qty / PER);
    el.to.value = end;
    var html = "", n = st.from;
    for (var p = 0; p < pages; p++) {
      var cells = "";
      for (var i = 0; i < PER && n <= end; i++, n++) {
        cells += '<div class="lb"><span class="lb-unit">' + unit + '</span><span class="lb-date">' + d +
          '</span><span class="lb-no">' + n + "</span></div>";
      }
      html += BT.sheetHTML('<div class="labels">' + cells + "</div>", p, pages);
    }
    el.sheets.innerHTML = html;
    BT.fit(el.sheets);
    el.printLabel.textContent = "In " + pages + " trang A4";
    el.summary.textContent = "Nhãn số " + st.from + " đến " + end + ", tổng " + st.qty + " nhãn." +
      (d ? "" : " Chưa nhập ngày nên dòng ngày để trống.");
    BT.$$("button", el.quick).forEach(function (b) {
      b.setAttribute("aria-pressed", String(+b.getAttribute("data-q") === st.qty));
    });
    save();
  }

  el.unit.value = st.unit;
  el.from.value = st.from;
  el.qty.value = st.qty;
  date.setToday();

  el.unit.addEventListener("input", function () {
    var p = el.unit.selectionStart;
    el.unit.value = BT.upperVN(el.unit.value);
    try { el.unit.setSelectionRange(p, p); } catch (e) {}
    st.unit = el.unit.value; render();
  });
  el.from.addEventListener("input", function () { st.from = BT.clamp(BT.int(el.from, 1), 1, 99999); render(); });
  el.from.addEventListener("blur", function () { el.from.value = st.from; });
  el.qty.addEventListener("input", function () { st.qty = BT.clamp(BT.int(el.qty, 1), 1, MAX); render(); });
  el.qty.addEventListener("blur", function () { el.qty.value = st.qty; });
  el.to.addEventListener("change", function () {
    var to = Math.max(st.from, BT.int(el.to, st.from));
    st.qty = BT.clamp(to - st.from + 1, 1, MAX); el.qty.value = st.qty; render();
  });
  el.quick.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-q]"); if (!b) return;
    st.qty = +b.getAttribute("data-q"); el.qty.value = st.qty; render();
  });
  $("#print").addEventListener("click", function () { BT.print(); });

  BT.autoFit(el.sheets);
  render();
})();
