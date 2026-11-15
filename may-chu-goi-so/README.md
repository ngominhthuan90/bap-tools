# Máy chủ Gọi số khám bệnh

Máy chủ riêng của bạn để nhiều máy gọi số và nhiều màn hình chờ đồng bộ với nhau.
Chạy trên **Cloudflare Workers, gói miễn phí** (Durable Objects + WebSocket).
Máy chủ chỉ lưu tên phòng, tên quầy và số thứ tự trong ngày, **không có thông tin bệnh nhân**.

> Chỉ cần máy chủ khi bàn gọi và màn hình chờ ở **các máy khác nhau**.
> Nếu chỉ có một máy cắm thêm TV làm màn hình thứ hai, chọn chế độ **Một máy** trong trang Gọi số, không cần làm gì ở đây.

## 1. Chuẩn bị (làm một lần)

1. Tạo tài khoản Cloudflare miễn phí tại https://dash.cloudflare.com/sign-up
2. Vào mục **Workers & Pages** một lần để Cloudflare cấp tên miền phụ dạng `ten-ban.workers.dev`.
3. Cài **Node.js bản LTS** trên máy tính: https://nodejs.org

## 2. Đưa máy chủ lên

Mở PowerShell (hoặc Terminal) **trong thư mục `may-chu-goi-so` này** rồi chạy lần lượt:

```bash
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put ADMIN_KEY
```

- `wrangler login` mở trình duyệt, bấm **Allow** để cho phép.
- `wrangler deploy` in ra địa chỉ máy chủ, dạng `https://goi-so.ten-ban.workers.dev`. Ghi lại địa chỉ này.
- `wrangler secret put ADMIN_KEY` hỏi **mã quản trị**: tự đặt một chuỗi dài, khó đoán (VD 16 ký tự trở lên) và giữ kín.
  Mã này dùng để tạo/sửa phòng, khác với PIN gọi số.

Mở địa chỉ máy chủ trên trình duyệt, thấy dòng **"Máy chủ Gọi số đang chạy."** là xong.

## 3. Tạo phòng và kết nối các máy

1. Mở trang **Gọi số** trên Bap Tools, bấm **Thiết lập**, chọn **Nhiều máy**.
2. Nhập địa chỉ máy chủ và một **mã phòng** (chữ thường không dấu, số, gạch ngang. VD `kkb-tang1`).
3. Mở mục **Tạo hoặc sửa phòng**: điền tên hiện trên TV, cách đánh số, danh sách quầy, **mã quản trị** và **PIN gọi số** (4–8 chữ số), bấm **Lưu phòng lên máy chủ**.
4. Bấm **Lưu và kết nối**. Các máy gọi số khác chỉ cần nhập địa chỉ máy chủ, mã phòng và PIN.
5. Để mọi máy tự điền sẵn địa chỉ máy chủ, sửa file `assets/goi-so-config.js` rồi đẩy lại lên GitHub.

## 4. TV phòng chờ

- Trên bàn gọi bấm **Chép link màn hình chờ**, mở link đó trên máy nối TV bằng **Microsoft Edge** (có sẵn giọng đọc tiếng Việt HoaiMy, NamMinh).
- Bấm **"Bấm để bắt đầu và bật âm thanh"** (trình duyệt bắt buộc bấm một lần mới cho phát tiếng), rồi nhấn **F** để toàn màn hình.
- Máy chỉ dùng làm TV có thể mở thẳng ở chế độ kiosk, tự phát tiếng, không cần bấm:

  ```
  msedge --kiosk "LINK_MAN_HINH_CHO&auto=1" --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required
  ```

## 5. Nên làm thêm: chỉ cho trang của bạn dùng máy chủ

Mở `wrangler.jsonc`, đổi `"ALLOWED_ORIGINS": "*"` thành địa chỉ GitHub Pages của bạn, VD:

```jsonc
"ALLOWED_ORIGINS": "https://ten-tai-khoan.github.io"
```

rồi chạy lại `npx wrangler deploy`.

## Gói miễn phí có đủ không?

Gói miễn phí cho **100.000 lượt mỗi ngày** (tính lại lúc 7 giờ sáng giờ Việt Nam).
Mỗi máy mở trang tốn 2 lượt; mỗi lần bấm gọi số chỉ tốn 1/20 lượt vì dùng kết nối giữ liên tục.
Một ngày khám vài trăm lượt gọi chỉ dùng vài trăm lượt, rất xa giới hạn.

Nếu mạng bệnh viện **chặn WebSocket**, trang tự chuyển sang hỏi máy chủ 4 giây một lần (chấm trạng thái màu vàng).
Cách này vẫn chạy nhưng tốn khoảng 900 lượt mỗi giờ cho mỗi máy đang mở,
nên nhờ phòng CNTT cho phép WebSocket tới `*.workers.dev`.

## Lỗi thường gặp

| Thông báo | Cách xử lý |
|---|---|
| Phòng "..." chưa được tạo trên máy chủ | Làm bước 3 để tạo phòng. |
| Mã quản trị không đúng | Đặt lại bằng `npx wrangler secret put ADMIN_KEY`. |
| Máy chủ chưa đặt ADMIN_KEY | Chạy `npx wrangler secret put ADMIN_KEY`. |
| Trang web này chưa được phép dùng máy chủ | Thêm địa chỉ trang vào `ALLOWED_ORIGINS` (bước 5). |
| Nhập sai PIN nhiều lần | Máy chủ khoá nhập PIN 10 phút để chống dò mã. |
| TV chỉ có tiếng chuông | Máy chưa có giọng tiếng Việt: dùng Edge, hoặc cài giọng tiếng Việt trong Cài đặt Windows, mục Giọng nói. |

## Chạy thử trên máy (không cần Cloudflare)

```bash
npm install
copy .dev.vars.example .dev.vars   (macOS/Linux: cp .dev.vars.example .dev.vars)
npm run dev
```

Máy chủ thử chạy ở `http://127.0.0.1:8787`, mã quản trị lấy trong file `.dev.vars`.

## Cấu trúc

```
src/index.js        Worker + Durable Object (mỗi mã phòng là 1 Durable Object)
wrangler.jsonc      cấu hình Cloudflare
../assets/goi-so-queue.js   lõi tính hàng đợi, dùng chung với trang web
```

API cho ai muốn tích hợp: `GET /api/rooms/<mã>/info`, `GET /api/rooms/<mã>/state`,
`POST /api/rooms/<mã>/act` (`{pin, a:{type, q, n}}`), WebSocket `GET /api/rooms/<mã>/ws`,
`POST /api/rooms/<mã>/setup` (`{adminKey, pin, room}`).
