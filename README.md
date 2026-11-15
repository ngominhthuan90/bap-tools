# Bap Tools

Bộ công cụ in ấn cho phòng khám và khoa phòng, làm lại từ bộ công cụ BSDHA (bsdha.github.io).
Mọi thứ chạy trong trình duyệt: không có mã theo dõi, không gửi ảnh hay danh sách bệnh nhân đi đâu.
Riêng **Gọi số** khi chạy nhiều máy dùng máy chủ riêng của bạn (thư mục `may-chu-goi-so`) và chỉ gửi số thứ tự.

| Trang | Công cụ | Ghi chú |
|---|---|---|
| `cccd.html` | In CCCD 2 mặt | Khung đúng 85,6 × 54 mm, 4 người/trang hoặc 1 người/trang. Có **Nắn thẳng 4 góc** cho ảnh chụp nghiêng, chế độ in trắng đen / như photocopy, dán ảnh bằng Ctrl+V. |
| `phieu-stt.html` | Phiếu STT – sinh hiệu | 6 phiếu/tờ A4, chọn ô cần in (thêm SpO₂, chiều cao), chữ đứng trước số, kiểu số 001. |
| `nhan-sktd.html` | Nhãn STT khám SKTD | 40 nhãn/tờ (5 × 8), tên đơn vị, ngày khám, số thứ tự. |
| `di-buong.html` | Bảng sinh hiệu đi buồng | Dán danh sách hoặc tải PDF/Excel/Word xuất từ HIS, tự nhận họ tên + năm sinh, 20 người/trang, in bảng trắng khi chưa có danh sách. |
| `pdf.html` | Công cụ PDF | Ghép, tách, sắp xếp trang (xoay/xoá/đổi chỗ), ảnh sang PDF, nén dung lượng, nhận dạng chữ (OCR) tiếng Việt ra PDF tìm kiếm được, Word và .txt. |
| `goi-so.html` | Gọi số khám bệnh, bàn gọi | Mỗi máy gọi cho một quầy: Space gọi tiếp, R gọi lại, B vắng mặt, G gọi số cụ thể. Số chung một dãy hoặc mỗi quầy một dãy (có chữ đứng trước như A001), đếm người đang chờ, xuất lịch sử .csv. |
| `man-hinh-cho.html` | Gọi số khám bệnh, màn hình TV | Số đang mời thật lớn, bảng các quầy, đọc số bằng giọng tiếng Việt, xếp hàng đọc không chồng nhau. |

## Đưa lên GitHub Pages

1. Tạo repository mới trên GitHub, ví dụ `bap-tools` (hoặc `<tên-tài-khoản>.github.io` nếu muốn địa chỉ gọn).
2. Tải **toàn bộ nội dung thư mục này** lên repository (kể cả thư mục `assets`, `vendor` và file `.nojekyll`).
   - Cách nhanh: trên trang repository bấm **Add file → Upload files**, kéo thả cả thư mục vào.
   - Hoặc dùng git:
     ```bash
     git init
     git add .
     git commit -m "Bap Tools"
     git branch -M main
     git remote add origin https://github.com/<tên-tài-khoản>/bap-tools.git
     git push -u origin main
     ```
3. Vào **Settings → Pages**, mục *Build and deployment* chọn **Deploy from a branch**, nhánh `main`, thư mục `/ (root)`, bấm **Save**.
4. Sau 1–2 phút trang chạy ở `https://<tên-tài-khoản>.github.io/bap-tools/`.

Trang dùng đường dẫn tương đối nên chạy được ở cả địa chỉ gốc lẫn thư mục con, không cần file `404.html`.

## Chạy thử trên máy

- Mở thẳng `index.html` bằng Chrome/Edge là dùng được hầu hết công cụ.
- Riêng **Nhận dạng chữ (OCR)** cần mở qua web. Trên máy có Python thì chạy trong thư mục này:
  `python -m http.server 8000` rồi mở `http://localhost:8000`.

## Gọi số khám bệnh

- **Một máy** (không cần mạng): mở `goi-so.html`, bấm **Mở màn hình chờ**, kéo cửa sổ đó sang TV (màn hình thứ hai) rồi nhấn F.
- **Nhiều máy**: đưa máy chủ trong thư mục `may-chu-goi-so` lên Cloudflare (miễn phí) theo hướng dẫn trong `may-chu-goi-so/README.md`.
- TV nên mở bằng **Microsoft Edge** để có giọng đọc tiếng Việt tự nhiên.

## Khi in

Chọn khổ **A4**, lề **Mặc định**, tỷ lệ **100%** (không chọn "Vừa trang"), tắt **Đầu trang và chân trang**.
Tờ giấy trên màn hình có đúng kích thước khi in.

## Sửa nhanh

- **Tên trang**: tìm và thay chữ `Bap Tools` trong các file `.html`.
- **Màu sắc, phông chữ**: biến ở đầu `assets/app.css` (`--ink` mực, `--stamp` đỏ con dấu cho nút In, `--desk` mặt bàn).
- **Danh sách khoa mặc định** (bảng đi buồng): `DEFAULT_DEPTS` trong `assets/di-buong.js`. Người dùng cũng tự thêm/bớt khoa ngay trên trang.
- **Quy tắc nhận diện danh sách bệnh nhân**: `assets/ds-parser.js` (chạy được bằng Node để kiểm thử).

## Cấu trúc

```
index.html, cccd.html, phieu-stt.html, nhan-sktd.html, di-buong.html, pdf.html
assets/
  app.css, app.js        giao diện và tiện ích dùng chung
  cccd.js                In CCCD 2 mặt (kèm thuật toán nắn phối cảnh 4 góc)
  phieu-stt.js, nhan-sktd.js, di-buong.js, ds-parser.js
  pdf-tools.js, zip.js   Công cụ PDF, đóng gói .zip và .docx
  goi-so-*.js, man-hinh-cho.js   Gọi số: lõi hàng đợi, kết nối, giọng đọc, bàn gọi, màn hình TV
  goi-so-config.js       địa chỉ máy chủ Gọi số mặc định (sửa sau khi đưa máy chủ lên)
may-chu-goi-so/          máy chủ Gọi số (Cloudflare Worker), có hướng dẫn riêng
  fonts/                 Be Vietnam Pro (bản tiếng Việt + Latin)
vendor/                  thư viện tự lưu, không phụ thuộc CDN
  pdf-lib.min.js         ghép/tách/xoay trang (MIT)
  pdfjs/                 pdf.js 3.11.174, đọc và vẽ trang PDF (Apache-2.0)
  xlsx.full.min.js       SheetJS, đọc Excel (Apache-2.0)
  mammoth.browser.min.js đọc Word (BSD-2-Clause)
  tesseract/             tesseract.js 7, nhận dạng chữ + dữ liệu tiếng Việt, tiếng Anh (Apache-2.0)
  LICENSES/              giấy phép của các thư viện và phông chữ (OFL)
```

## Dữ liệu

- Ảnh CCCD, danh sách bệnh nhân, file PDF chỉ nằm trong bộ nhớ của tab trình duyệt và mất khi đóng tab.
- Trình duyệt chỉ nhớ cài đặt: tên đơn vị, số bắt đầu, khoa, kiểu in. Không lưu tên bệnh nhân.
- Bộ nhận dạng chữ được trình duyệt lưu đệm sau lần dùng đầu để lần sau nhanh hơn.
