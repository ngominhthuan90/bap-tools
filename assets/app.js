/* =====================================================================
   Bap Tools — tiện ích dùng chung cho mọi trang
   Không dùng thư viện ngoài, chạy được trên Chrome/Edge/Cốc Cốc đời cũ.
   ===================================================================== */
(function () {
  "use strict";
  var BT = (window.BT = {});

  BT.$ = function (sel, root) { return (root || document).querySelector(sel); };
  BT.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  BT.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  BT.pad = function (n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; };
  BT.int = function (el, def) { var v = parseInt(el.value, 10); return isNaN(v) ? def : v; };
  BT.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  BT.upperVN = function (s) { return String(s || "").toLocaleUpperCase("vi-VN"); };

  BT.today = function () {
    var d = new Date();
    return BT.pad(d.getDate(), 2) + "/" + BT.pad(d.getMonth() + 1, 2) + "/" + d.getFullYear();
  };

  /* ---------- Lưu cài đặt trên trình duyệt (không lưu dữ liệu bệnh nhân) ---------- */
  BT.store = {
    get: function (key, def) {
      try { var v = localStorage.getItem("bt:" + key); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set: function (key, val) {
      try { localStorage.setItem("bt:" + key, JSON.stringify(val)); } catch (e) {}
    }
  };

  /* ---------- Thu nhỏ tờ giấy cho vừa mặt bàn (khi in luôn là 100%) ---------- */
  var MM = 96 / 25.4;
  BT.mm = MM;
  BT.fit = function (sheetsEl) {
    if (!sheetsEl) return 1;
    var desk = sheetsEl.parentElement;
    var cs = getComputedStyle(desk);
    var avail = desk.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var natural = 210 * MM;
    var z = avail > 0 && avail < natural ? avail / natural : 1;
    sheetsEl.style.zoom = z;
    sheetsEl.setAttribute("data-zoom", z);
    return z;
  };
  BT.zoomOf = function (sheetsEl) { return parseFloat(sheetsEl.getAttribute("data-zoom")) || 1; };
  BT.autoFit = function (sheetsEl) {
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(function () { BT.fit(sheetsEl); }, 60); });
    BT.fit(sheetsEl);
  };

  /* ---------- Bọc 1 tờ giấy kèm nhãn "Trang x/y" chỉ hiện trên màn hình ---------- */
  BT.sheetHTML = function (inner, idx, total, cls) {
    return '<div class="sheet-wrap"><div class="sheet-label">Trang ' + (idx + 1) + "/" + total + "</div>" +
      '<div class="sheet ' + (cls || "") + '">' + inner + "</div></div>";
  };

  /* ---------- In ---------- */
  BT.print = function (tag) {
    document.body.classList.add("is-printing");
    void document.body.offsetHeight;
    setTimeout(function () { window.print(); }, 40);
  };
  window.addEventListener("afterprint", function () { document.body.classList.remove("is-printing"); });

  /* ---------- Tải script khi cần (thư viện PDF, Excel, OCR...) ---------- */
  var loaded = {};
  BT.loadScript = function (src) {
    if (loaded[src]) return loaded[src];
    loaded[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete loaded[src]; reject(new Error("Không tải được " + src.split("/").pop() + ". Kiểm tra lại thư mục vendor.")); };
      document.head.appendChild(s);
    });
    return loaded[src];
  };

  /* ---------- Tải file về máy ---------- */
  BT.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };
  BT.size = function (bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
    return (bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1).replace(".", ",") + " MB";
  };

  /* ---------- Ô ngày dd/mm/yyyy: gõ liền 8 chữ số, tự chèn dấu "/" ---------- */
  BT.dateMask = function (input, onChange) {
    var digits = "";
    var POS = [0, 1, 3, 4, 6, 7, 8, 9];
    function text() {
      var m = "__/__/____".split("");
      for (var i = 0; i < digits.length; i++) m[POS[i]] = digits[i];
      return m.join("");
    }
    function paint() {
      input.value = text();
      var caret = digits.length >= 8 ? 10 : POS[digits.length];
      try { if (document.activeElement === input) input.setSelectionRange(caret, caret); } catch (e) {}
    }
    function changed() { paint(); if (onChange) onChange(); }
    function allSelected() { return input.selectionStart === 0 && input.selectionEnd >= input.value.length; }
    input.setAttribute("inputmode", "numeric");
    input.setAttribute("autocomplete", "off");
    input.addEventListener("keydown", function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        if (allSelected() || digits.length >= 8) digits = "";
        digits += e.key; changed();
      } else if (e.key === "Backspace") {
        e.preventDefault(); digits = allSelected() ? "" : digits.slice(0, -1); changed();
      } else if (e.key === "Delete") {
        e.preventDefault(); digits = ""; changed();
      } else if (e.key.length === 1) { e.preventDefault(); }
    });
    input.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "").slice(0, 8);
      if (t) { digits = t; changed(); }
    });
    input.addEventListener("input", function () { // bàn phím ảo trên điện thoại
      digits = input.value.replace(/\D/g, "").slice(0, 8); changed();
    });
    input.addEventListener("focus", function () { setTimeout(function () { try { input.select(); } catch (e) {} }, 0); });
    var api = {
      value: function () {
        if (!digits) return "";
        return text().replace(/_/g, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
      },
      setDigits: function (d) { digits = String(d || "").replace(/\D/g, "").slice(0, 8); paint(); },
      setToday: function () {
        var d = new Date();
        api.setDigits(BT.pad(d.getDate(), 2) + BT.pad(d.getMonth() + 1, 2) + d.getFullYear());
      },
      setISO: function (iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
        if (m) api.setDigits(m[3] + m[2] + m[1]);
      },
      iso: function () {
        if (digits.length !== 8) return "";
        return digits.slice(4) + "-" + digits.slice(2, 4) + "-" + digits.slice(0, 2);
      }
    };
    paint();
    return api;
  };

  /* ---------- Nút "chọn ngày từ lịch" dùng hộp lịch có sẵn của trình duyệt ---------- */
  BT.calendarButton = function (btn, mask, onChange) {
    var picker = document.createElement("input");
    picker.type = "date";
    picker.tabIndex = -1;
    picker.setAttribute("aria-hidden", "true");
    picker.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;padding:0";
    btn.parentNode.style.position = "relative";
    btn.parentNode.appendChild(picker);
    btn.addEventListener("click", function () {
      picker.value = mask.iso() || new Date().toISOString().slice(0, 10);
      if (picker.showPicker) { try { picker.showPicker(); return; } catch (e) {} }
      picker.focus(); picker.click();
    });
    picker.addEventListener("change", function () { mask.setISO(picker.value); if (onChange) onChange(); });
  };

  /* ---------- Nút chọn file (label bọc input ẩn) bấm được bằng bàn phím ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var t = e.target;
    if (!t || !t.matches || !t.matches("label[tabindex]")) return;
    var inp = t.querySelector("input[type=file]") || (t.htmlFor && document.getElementById(t.htmlFor));
    if (inp) { e.preventDefault(); inp.click(); }
  });

  /* ---------- Đánh dấu mục đang xem trên thanh điều hướng ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    BT.$$(".nav a").forEach(function (a) {
      if (a.getAttribute("data-nav") === page) a.setAttribute("aria-current", "page");
    });
  });
})();
