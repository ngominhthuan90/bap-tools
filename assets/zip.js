/* =====================================================================
   Đóng gói ZIP (không nén, chỉ gom file) và tạo file Word .docx đơn giản.
   Không cần thư viện ngoài. Dùng cho: tách PDF ra nhiều file, xuất chữ OCR.
   ===================================================================== */
(function (root) {
  "use strict";
  var TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function toBytes(d) {
    if (d instanceof Uint8Array) return d;
    if (typeof d === "string") return new TextEncoder().encode(d);
    return new Uint8Array(d);
  }

  // files: [{ name: "a.pdf", data: Uint8Array | ArrayBuffer | string }]
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = toBytes(f.data), crc = crc32(data);
      var lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      var ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  }

  function xmlEsc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; })
      // bỏ ký tự điều khiển không hợp lệ trong XML
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }
  // pages: mảng các trang, mỗi trang là mảng đoạn văn (chuỗi). Trả về Blob .docx
  function docx(pages, opts) {
    opts = opts || {};
    var font = opts.font || "Times New Roman", size = opts.size || 26; // nửa point: 26 = 13pt
    var rpr = '<w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:cs="' + font + '"/><w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr>';
    var body = "";
    pages.forEach(function (paras, i) {
      if (i > 0) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      paras.forEach(function (p) {
        body += '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>' + rpr + '<w:t xml:space="preserve">' + xmlEsc(p) + "</w:t></w:r></w:p>";
      });
    });
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      "</w:body></w:document>";
    var types = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    var blob = zip([
      { name: "[Content_Types].xml", data: types },
      { name: "_rels/.rels", data: rels },
      { name: "word/document.xml", data: doc }
    ]);
    return new Blob([blob], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  }

  var api = { zip: zip, docx: docx, crc32: crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BTZip = api;
})(typeof window !== "undefined" ? window : this);
