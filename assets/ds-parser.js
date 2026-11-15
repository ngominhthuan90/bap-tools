/* =====================================================================
   Nhận diện danh sách bệnh nhân (Họ tên + Năm sinh) từ văn bản dán vào
   hoặc từ file PDF/Excel/Word xuất từ HIS.
   Phần lớn quy tắc được kế thừa từ bộ công cụ BSDHA, đã chạy thực tế với
   danh sách nội trú của phần mềm Helix. Chạy được cả trên trình duyệt
   (window.DSParser) lẫn Node (để kiểm thử).
   ===================================================================== */
(function (root) {
  "use strict";

  function upper(s) { return String(s || "").toLocaleUpperCase("vi-VN"); }

  // Họ tên từ 5 chữ trở lên: rút gọn chữ đầu (bỏ nguyên âm) và chữ thứ hai (viết tắt),
  // riêng TÊN (chữ cuối) không bao giờ rút gọn. VD: NGUYỄN THỊ THANH HƯƠNG MAI -> NGYN T. THANH HƯƠNG MAI
  var VOWELS = /[AĂÂEÊIOÔƠUƯYÁẮẤÉẾÍÓỐỚÚỨÝÀẰẦÈỀÌÒỒỜÙỪỲẢẲẨẺỂỈỎỔỞỦỬỶÃẴẪẼỄĨÕỖỠŨỮỸẠẶẬẸỆỊỌỘỢỤỰỴ]/g;
  function nameForPrint(raw) {
    var words = upper(raw).trim().split(/\s+/).filter(Boolean);
    if (words.length < 5) return words.join(" ");
    var last = words.pop();
    var out = words.map(function (w, i) {
      if (i === 0 && w.length > 2) {
        var abb = w[0] + w.slice(1).replace(VOWELS, "");
        return abb.length < w.length ? abb : w;
      }
      if (i === 1) return w[0] + ".";
      return w;
    });
    out.push(last);
    return out.join(" ");
  }

  var FULL_DATE_RE = /\b(0?[1-9]|[12][0-9]|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](19[0-9]{2}|20[0-2][0-9])\b/;
  var STATUS_CELL_RE = /^(\[?TT\]?|CHỜ(\s+\S+)*|HOÀN\s*THÀNH|THỰC\s*HIỆN|KẾT\s*QUẢ|ĐANG\s+\S+)$/i;
  var GENDER_CELL_RE = /^(NAM|N[ỮU])$/i;
  var YEAR_ONLY_CELL_RE = /^(19[0-9]{2}|20[0-2][0-9])$/;
  var HEADER_WORDS = ["stt", "họ tên", "họ và tên", "giới tính", "năm sinh", "ngày sinh", "địa chỉ", "số thẻ", "bảo hiểm",
    "y tế", "mã", "bệnh án", "khoa", "phòng", "giường", "số", "ngày vào", "ngày vào khoa", "nam nữ", "nam", "nữ", "chẩn đoán",
    "danh sách", "tổng cộng", "trang"];

  // Dòng đầu trang, tiêu đề, chữ ký... không phải tên người
  var NOT_NAME_START = /^(BỆNH VIỆN|BV\s|DANH SÁCH|KHOA\s|PHÒNG\s|SỞ\s|TRUNG TÂM|TTYT|CỘNG HÒA|CỘNG HOÀ|ĐỘC LẬP|NGÀY\s|THÁNG\s|TRANG\s|TỔNG|BÁO CÁO|ĐỊA CHỈ|ĐIỆN THOẠI|ĐT\s|NGƯỜI\s|BÁC SĨ|ĐIỀU DƯỠNG|KÝ\s|GHI CHÚ|THỐNG KÊ|PHIẾU|MẪU\s|IN LÚC|STT)/;
  function isNoise(name) {
    var n = String(name || "").trim();
    if (!n) return true;
    if (NOT_NAME_START.test(upper(n) + " ")) return true;
    if (/\d/.test(n)) return true;               // có số: địa chỉ, SĐT, ngày tháng...
    if (/[:;@#\/\\=<>]/.test(n)) return true;
    if (HEADER_WORDS.indexOf(n.toLowerCase()) >= 0) return true;
    var words = n.split(/\s+/).filter(Boolean);
    if (words.length > 6) return true;          // họ tên hiếm khi quá 6 chữ
    if (words.length === 1 && n.length < 2) return true;
    return false;
  }

  // Bỏ mã hồ sơ "[26NT00121]" ở đầu và ghi chú "Ghi chú: ..." ở cuối ô tên
  function cleanName(raw) {
    return String(raw || "")
      .replace(/^\[[^\]]*\]\s*/, "")
      .replace(/\s*ghi\s*ch[uú]\s*:.*$/i, "")
      .replace(/^[\s\-–•*.]+|[\s,.\-–(]+$/g, "")
      .trim();
  }

  // Từ cột ngày/năm sinh (idx), lùi về đầu dòng để tìm ô họ tên gần nhất.
  // Bỏ qua ô toàn số (STT, PID, mã BN), nhãn trạng thái, giới tính, và ô có chữ
  // nhưng không phải tên (VD cột chẩn đoán "R50.9-Sốt"). Dừng khi gặp ô lạ.
  // Mỗi chữ đều viết hoa chữ cái đầu (Nguyễn Văn An / NGUYỄN VĂN AN) -> giống tên người
  function looksLikeName(n) {
    return n.split(/\s+/).every(function (w) {
      var c = w.charAt(0);
      return c !== c.toLocaleLowerCase("vi-VN") && c === c.toLocaleUpperCase("vi-VN");
    });
  }
  // Ô dính cả mã hồ sơ với tên ("26NT00101 Bùi Thanh Bình"): lấy phần chữ sau mã cuối cùng
  function tailName(c) {
    var toks = cleanName(c).split(/\s+/), last = -1;
    toks.forEach(function (t, i) { if (/\d/.test(t)) last = i; });
    return last >= 0 ? toks.slice(last + 1).join(" ") : "";
  }
  function nameBefore(cells, idx) {
    for (var strict = 1; strict >= 0; strict--) {
      for (var i = idx - 1; i >= 0; i--) {
        var c = cells[i];
        if (/^\d+$/.test(c)) continue;
        if (STATUS_CELL_RE.test(c)) continue;
        if (GENDER_CELL_RE.test(c)) continue;
        if (/[A-Za-zÀ-ỹ]/.test(c)) {
          var name = cleanName(c);
          if (name && !isNoise(name) && (!strict || looksLikeName(name))) return name;
          var tail = tailName(c);
          if (tail.split(" ").length >= 2 && !isNoise(tail) && looksLikeName(tail)) return tail;
          continue;
        }
        break;
      }
    }
    return null;
  }

  function splitCells(line) {
    var sep;
    if (line.indexOf("\t") >= 0) sep = /\t|\s{2,}/;
    else if ((line.match(/;/g) || []).length >= 2) sep = /;/;
    else if ((line.match(/,/g) || []).length >= 2) sep = /,/;
    else if (line.indexOf("|") >= 0) sep = /\s*\|\s*/;
    else sep = /\s{2,}/;
    return line.split(sep).map(function (c) { return c.trim().replace(/^"|"$/g, ""); }).filter(Boolean);
  }

  // Dòng tiêu đề bảng: tìm vị trí cột "Họ tên" và cột "Ngày/Năm sinh"
  function headerOf(line) {
    var cells = splitCells(line), nameIdx = -1, birthIdx = -1;
    cells.forEach(function (c, i) {
      if (nameIdx < 0 && /^(họ\s*(và\s*)?tên|tên\s*(bệnh\s*nhân|người\s*bệnh|bn)|họ\s*tên\s*(bệnh\s*nhân|người\s*bệnh))$/i.test(c)) nameIdx = i;
      if (birthIdx < 0 && /^(ngày\s*sinh|năm\s*sinh|ns|ngày\/?tháng\/?năm\s*sinh)$/i.test(c)) birthIdx = i;
    });
    return nameIdx >= 0 && birthIdx >= 0 ? { n: cells.length, name: nameIdx, birth: birthIdx } : null;
  }
  function rowByHeader(line, h) {
    var cells = splitCells(line);
    if (!h || cells.length !== h.n) return null;
    var name = cleanName(cells[h.name]), b = cells[h.birth], m = b.match(FULL_DATE_RE), year = m ? m[3] : (YEAR_ONLY_CELL_RE.test(b) ? b : "");
    if (!year || !name || isNoise(name) || !/[A-Za-zÀ-ỹ]/.test(name)) return null;
    return { name: upper(name), year: year };
  }

  function parseTableRow(line) {
    var cells = splitCells(line);
    if (cells.length < 2) return null;
    var i, name;
    // Có thể có nhiều cột dạng ngày (ngày vào viện, ngày sinh...): thử lần lượt
    // Lượt 1: ô chỉ chứa ngày (có thể kèm giờ). Lượt 2: ô có chứa ngày ở bất kỳ đâu.
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < cells.length; i++) {
        var m = cells[i].match(FULL_DATE_RE);
        if (!m) continue;
        var pure = cells[i].replace(FULL_DATE_RE, "").replace(/[\d:\s]/g, "") === "";
        if (pass === 0 ? !pure : pure) continue;
        name = nameBefore(cells, i);
        if (name) return { name: upper(name), year: m[3] };
      }
    }
    for (i = 0; i < cells.length; i++) {
      if (YEAR_ONLY_CELL_RE.test(cells[i])) {
        name = nameBefore(cells, i);
        if (name) return { name: upper(name), year: cells[i] };
      }
    }
    return null;
  }

  function parseText(text) {
    var rows = [], header = null;
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      if (!raw.trim()) return;
      var h = headerOf(raw);
      if (h) { header = h; return; }
      var t = rowByHeader(raw, header) || parseTableRow(raw);
      if (t) { rows.push(t); return; }
      var line = raw.trim().replace(/^\s*(?!(19|20)\d{2}(?!\d))(\d{1,4}\s*[.)\-:]|\d{1,3}\s+|[-•*+])\s*/, "");
      if (!line) return;
      var name, year = "";
      var full = line.match(FULL_DATE_RE);
      var m = full ? { index: full.index, y: full[3] } : null;
      if (!m) {
        var ym = line.match(/(?:^|[^\d])(19[0-9]{2}|20[0-2][0-9])(?!\d)/);
        if (ym) m = { index: ym.index + (ym[0].length - ym[1].length), y: ym[1] };
      }
      if (m) {
        year = m.y;
        name = line.slice(0, m.index).replace(/(\s+(sinh|năm|ns|sn|ngày|n\.s\.?))+[\s:.]*$/i, "");
        name = name.replace(/[.,\-–(\s:]+$/, "").trim();
        if (!name) {
          // dạng "1990 Nguyễn Văn A"
          name = line.slice(m.index + 4).replace(/^[\s.,\-–:)]+/, "").trim();
        }
      } else {
        name = line.trim();
      }
      name = cleanName(name);
      if (!/[A-Za-zÀ-ỹ]/.test(name)) return;
      if (isNoise(name)) return;
      if (name.split(/\s+/).length < 2) return;   // họ tên luôn có từ 2 chữ trở lên
      rows.push({ name: upper(name), year: year });
    });
    return rows;
  }

  // Trong bảng PDF, ô nhiều chữ hay bị ngắt xuống 2–3 dòng. Gộp lại theo quy tắc:
  // dòng bắt đầu bằng STT (1–3 chữ số) là bệnh nhân mới, các dòng khác nối vào dòng trước.
  function mergeWrapped(lines) {
    var STT_ONLY = /^\d{1,3}$/;
    var STT_START = /^\d{1,3}(\t|\s{2,}|$)/;
    var YEAR_START = /^((19[0-9]{2}|20[0-2][0-9])|(0?[1-9]|[12][0-9]|3[01])\/(0?[1-9]|1[0-2])\/(19[0-9]{2}|20[0-2][0-9]))(\t|\s{2,}|$)/;
    var out = [], inRow = false, tabNext = false;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (STT_START.test(line)) {
        out.push(line); inRow = true; tabNext = STT_ONLY.test(line);
      } else if (inRow && out.length) {
        out[out.length - 1] += (tabNext || YEAR_START.test(line) ? "\t" : " ") + line;
        tabNext = false;
      }
    });
    return out;
  }

  // Ghép các mảnh chữ của 1 trang PDF (pdf.js getTextContent) thành dòng,
  // chèn Tab ở khoảng trống lớn (ranh giới cột).
  function pdfItemsToLines(items) {
    var GAP = 8, lines = [], cur = [], lastY = null;
    function flush() {
      if (!cur.length) return;
      cur.sort(function (a, b) { return a.x - b.x; });
      var s = "", right = null;
      cur.forEach(function (it) {
        if (right !== null) s += it.x - right > GAP ? "\t" : (/\s$/.test(s) ? "" : " ");
        s += it.str;
        right = it.x + (it.w || 0);
      });
      lines.push(s.trim());
      cur = [];
    }
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5]), x = it.transform[4];
      if (lastY !== null && Math.abs(y - lastY) > 3) flush();
      cur.push({ str: it.str, x: x, w: it.width || 0 });
      lastY = y;
    });
    flush();
    return lines;
  }

  /* Đọc 1 trang PDF theo hình học: lấy cột STT làm mốc từng hàng, gom mọi mảnh chữ
     (kể cả ô bị ngắt nhiều dòng, căn giữa hay căn trên) về đúng hàng, rồi tách cột
     theo vị trí ngang. Không tìm thấy cột STT thì dùng cách đọc theo dòng ở trên. */
  function pdfPageLines(rawItems) {
    var items = [];
    rawItems.forEach(function (it) {
      var t = (it.str || "").replace(/\s+/g, " ").trim();
      if (!t) return;
      var x = it.transform[4], y = it.transform[5];
      items.push({ t: t, x0: x, x1: x + (it.width || t.length * 4), y: y, h: Math.abs(it.height || it.transform[3] || 10) || 10 });
    });
    if (!items.length) return [];
    var hs = items.map(function (i) { return i.h; }).sort(function (a, b) { return a - b; });
    var h = hs[Math.floor(hs.length / 2)] || 10;

    // Mốc hàng: ưu tiên cột STT (số 1–3 chữ số thẳng cột, tăng dần);
    // không có thì dùng cột ngày sinh (các ô có ngày cùng thẳng một cột).
    function column(list) {
      var byX = {}, best = [];
      list.forEach(function (it) { var k = Math.round(it.x0 / 4); (byX[k] = byX[k] || []).push(it); });
      Object.keys(byX).forEach(function (k) {
        var g = (byX[k - 1] || []).concat(byX[k], byX[+k + 1] || []);
        if (g.length > best.length) best = g;
      });
      return best.slice().sort(function (a, b) { return b.y - a.y; });
    }
    var anchors = column(items.filter(function (it) { return /^\d{1,3}$/.test(it.t); }));
    var inc = 0, i;
    for (i = 1; i < anchors.length; i++) if (+anchors[i].t === +anchors[i - 1].t + 1) inc++;
    if (anchors.length < 2 || inc < (anchors.length - 1) * 0.6) {
      anchors = column(items.filter(function (it) { return FULL_DATE_RE.test(it.t) && !/^(ngày|in|lúc)/i.test(it.t); }));
      if (anchors.length < 2) return mergeWrapped(pdfItemsToLines(rawItems));
    }

    var gaps = [];
    for (i = 1; i < anchors.length; i++) gaps.push(anchors[i - 1].y - anchors[i].y);
    gaps.sort(function (a, b) { return a - b; });
    var step = gaps[Math.floor(gaps.length / 2)];
    var isAnchor = function (it) { return anchors.indexOf(it) >= 0; };
    var top = anchors[0].y + step * 0.6, bottom = anchors[anchors.length - 1].y - step * 0.75;

    // Bảng căn giữa hay căn trên? Có chữ nằm cao hơn mốc của hàng -> căn giữa.
    var body = items.filter(function (it) { return !isAnchor(it) && it.y <= top && it.y >= bottom; });
    var above = 0;
    body.forEach(function (it) {
      var near = anchors.reduce(function (a, b) { return Math.abs(b.y - it.y) < Math.abs(a.y - it.y) ? b : a; });
      if (it.y - near.y > h * 0.35) above++;
    });
    var centered = above >= Math.max(2, body.length * 0.05);
    var rowsOf = anchors.map(function (a) { return [a]; });
    var footer = [], headExtra = [];
    body.forEach(function (it) {
      var idx = -1;
      if (centered) {
        var bestD = Infinity;
        anchors.forEach(function (a, k) { var d = Math.abs(a.y - it.y); if (d < bestD) { bestD = d; idx = k; } });
        if (bestD > step * 0.75) idx = -1;
      } else {
        for (var k = 0; k < anchors.length; k++) {
          if (anchors[k].y >= it.y - h * 0.35) idx = k; else break;
        }
        if (idx >= 0 && anchors[idx].y - it.y > step * 1.5) idx = -1;
      }
      if (idx >= 0) rowsOf[idx].push(it);
      else if (it.y >= anchors[0].y) headExtra.push(it);
      else footer.push(it);
    });

    function cellsOf(list) {
      var sorted = list.slice().sort(function (a, b) { return a.x0 - b.x0; }), cells = [];
      sorted.forEach(function (it) {
        var c = null;
        for (var k = cells.length - 1; k >= 0 && k >= cells.length - 3; k--) {
          var ov = Math.min(cells[k].x1, it.x1) - Math.max(cells[k].x0, it.x0);
          if (ov > 1) { c = cells[k]; break; }
        }
        if (!c) { c = { x0: it.x0, x1: it.x1, items: [] }; cells.push(c); }
        c.items.push(it); c.x0 = Math.min(c.x0, it.x0); c.x1 = Math.max(c.x1, it.x1);
      });
      return cells.map(function (c) {
        return c.items.sort(function (a, b) { return Math.abs(a.y - b.y) > h * 0.35 ? b.y - a.y : a.x0 - b.x0; })
          .map(function (it) { return it.t; }).join(" ");
      }).join("\t");
    }
    function plainLines(list) {
      var sorted = list.slice().sort(function (a, b) { return b.y - a.y || a.x0 - b.x0; }), out = [], cur = [], ly = null;
      sorted.forEach(function (it) {
        if (ly !== null && Math.abs(it.y - ly) > h * 0.35) { out.push(cellsOf(cur)); cur = []; }
        cur.push(it); ly = it.y;
      });
      if (cur.length) out.push(cellsOf(cur));
      return out;
    }
    // Phần trên bảng: tiêu đề cột nằm quanh chữ "STT", phía trên nữa là tên trang
    var headItems = items.filter(function (it) { return it.y > top; }).concat(headExtra);
    var sttHead = headItems.filter(function (it) { return /^(stt|họ\s*(và\s*)?tên)$/i.test(it.t); })[0];
    var out = [];
    if (sttHead) {
      var band = headItems.filter(function (it) { return Math.abs(it.y - sttHead.y) <= h * 1.3; });
      out = out.concat(plainLines(headItems.filter(function (it) { return band.indexOf(it) < 0; })));
      out.push(cellsOf(band));
    } else out = out.concat(plainLines(headItems));
    rowsOf.forEach(function (r) { out.push(cellsOf(r)); });
    out = out.concat(plainLines(footer.concat(items.filter(function (it) { return it.y < bottom; }))));
    return out;
  }

  var api = { parseText: parseText, pdfPageLines: pdfPageLines, parseTableRow: parseTableRow, mergeWrapped: mergeWrapped,
    pdfItemsToLines: pdfItemsToLines, nameForPrint: nameForPrint, upper: upper };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DSParser = api;
})(typeof window !== "undefined" ? window : this);
