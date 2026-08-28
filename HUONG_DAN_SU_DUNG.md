# 📘 HƯỚNG DẪN THAO TÁC VÀ SỬ DỤNG CHI TIẾT
## HỆ THỐNG HIGGSFIELD AI VIDEO QUEUE AUTOMATION

---

### 📌 THÔNG TIN TRUY CẬP
* **Địa chỉ chạy trực tiếp trên máy chủ:** [http://localhost:3100](http://localhost:3100)
* **Địa chỉ dành cho các máy cùng mạng LAN:** Nhìn góc trên bên phải thanh tiêu đề (VD: `http://192.168.68.18:3100`)
* **Cổng gỡ lỗi Chrome CDP:** `http://127.0.0.1:9333`

---

## PHẦN 1: CÁC BƯỚC CHUẨN BỊ VÀ KHỞI ĐỘNG HỆ THỐNG

### 🔹 Bước 1: Khởi động trình duyệt tự động (Chrome CDP)
1. Mở thư mục chứa mã nguồn: `c:\Users\Admin\Downloads\higgfiled queue\higgfield-queue-fixed`
2. Nhấp đúp chuột vào tệp **`start-cdp.bat`** (hoặc nhấp chuột phải chọn *Run as administrator* nếu cần).
3. Một cửa sổ Google Chrome riêng biệt sẽ xuất hiện với cổng kết nối 9333.
   > **Lưu ý quan trọng:** Cửa sổ Chrome này chạy trên profile độc lập (`chrome_profile`), hoàn toàn không làm tắt hay ảnh hưởng đến các cửa sổ Chrome cá nhân khác của bạn.

### 🔹 Bước 2: Đăng nhập tài khoản Higgsfield AI
1. Trên cửa sổ Chrome vừa được mở ở Bước 1, truy cập vào: [https://higgsfield.ai/ai/video](https://higgsfield.ai/ai/video)
2. Tiến hành đăng nhập tài khoản Higgsfield của bạn (Google Login, Email, v.v.).
3. Đảm bảo bạn đã nhìn thấy giao diện làm việc **Studio Video** của Higgsfield. Bạn có thể để thu nhỏ hoặc để cửa sổ Chrome chạy nền.

### 🔹 Bước 3: Khởi động Dashboard Hàng Chờ
1. Mở Terminal / PowerShell tại thư mục dự án.
2. Gõ lệnh:
   ```bash
   npm start
   ```
   *(hoặc `node server.js`)*
3. Màn hình console sẽ hiển thị thông báo kết nối thành công tới Chrome CDP:
   ```text
   🚀 Higgsfield AI Queue Dashboard running on:
      🏠 Local: http://localhost:3100
      🌐 LAN:   http://192.168.68.18:3100
   📡 Connected to Chrome CDP at http://127.0.0.1:9333
   ```
4. Mở trình duyệt bất kỳ và truy cập vào địa chỉ: **[http://localhost:3100](http://localhost:3100)**

---

## PHẦN 2: HƯỚNG DẪN CHI TIẾT CÁC THAO TÁC TẠO TASK

### 🎯 THAO TÁC 1: Tạo Video Đơn Lẻ (Single Task)

1. **Điền Tên Người Tạo:**
   * Tại ô **"Tên người tạo"**, nhập tên của bạn (VD: *Dũng*, *An*, *Marketing Team*).
   * *Hệ thống sẽ tự động lưu tên này trên trình duyệt, các lần tạo video tiếp theo bạn không cần phải nhập lại.*

2. **Nhập Prompt Kịch Bản:**
   * Tại ô **"Mô tả video (Prompt)"**, nhập câu lệnh miêu tả chi tiết bối cảnh, hành động, góc máy (VD: *Một chú mèo máy nhảy múa trên đỉnh núi tuyết lúc hoàng hôn, góc quay cinematic 4K*).

3. **Đính Kèm Ảnh Tham Chiếu (Chọn 1 hoặc nhiều ảnh • Kéo thả đổi thứ tự):**
   * Bấm vào ô **"Ảnh tham chiếu"** hoặc kéo thả để nạp **1 hoặc nhiều ảnh** cùng lúc từ máy tính.
   * **✨ Tính năng tải nhiều ảnh & nhiều lượt:** Bạn có thể chọn nhiều ảnh một lúc hoặc nạp thêm nhiều lượt (tối đa 20 ảnh).
   * **🖐️ Kéo Thả (Drag & Drop) Đổi Thứ Tự:** Bạn có thể **kéo thả trực tiếp** các thẻ ảnh lên/xuống (hoặc bấm nút `▲` / `▼`) để sắp xếp lại thứ tự theo ý muốn. Các huy hiệu `#1`, `#2`... sẽ tự động cập nhật ngay lập tức.
   * **🎯 Quy tắc gán:** Các ảnh có số thứ tự `#1`, `#2`... sẽ được gán vào Higgsfield theo đúng thứ tự bạn đã sắp xếp.

4. **Đính Kèm Video Tham Chiếu (Chọn 1 hoặc nhiều video • Kéo thả đổi thứ tự • Luôn gán sau ảnh):**
   * Kéo thả hoặc chọn **1 hoặc nhiều video** vào ô **"Video tham chiếu"** (MP4, WEBM, MOV).
   * **🖐️ Kéo Thả (Drag & Drop) Đổi Thứ Tự Video:** Dễ dàng kéo thả các thẻ video lên/xuống hoặc bấm `▲` / `▼` để thay đổi thứ tự tải lên Higgsfield.
   * **🎯 Quy tắc gán:** Toàn bộ Video **LUÔN LUÔN được gán CUỐI CÙNG** (sau toàn bộ ảnh tham chiếu) theo đúng thứ tự `#1 Video`, `#2 Video`... bạn đã sắp xếp.

5. **Quy Trình Tự Động Hóa 11 Bước của Higgsfield:**
   * **Bước 1-3:** Reload & Kiểm tra đăng nhập, Chọn Model Seedance 2.5, Bật References Mode.
   * **Bước 4:** Xóa sạch toàn bộ ảnh/video tham chiếu cũ.
   * **Bước 5:** Nạp các tệp tham chiếu (Ảnh trước theo thứ tự sắp xếp, Video sau theo thứ tự sắp xếp) + Chờ 180s an toàn + Đối chiếu số lượng 100%.
   * **Bước 6:** **Nhập Prompt Kịch Bản** *(Đã được tối ưu đưa ra SAU bước nạp tham chiếu để giao diện ổn định nhất)*.
   * **Bước 7-11:** Chọn Duration, Tỉ lệ, Resolution & Unlimited, Bấm Generate và Thu thập Video MP4 hoàn thành.

5. **Chọn Cấu Hình Tạo Video:**
   * **AI Model:** Chọn `Seedance 2.5` (Khuyên dùng) để có chất lượng tốt nhất và hỗ trợ nhận diện chuyển động tham chiếu.
   * **Thời lượng (Duration):** Chọn từ **4s** đến **30s** theo nhu cầu.
   * **Tỉ lệ khung hình (Aspect Ratio):**
     * `16:9`: Video ngang chuẩn YouTube, Facebook TV.
     * `9:16`: Video dọc chuẩn TikTok, Facebook Reels, Shorts.
     * `1:1`: Video vuông chuẩn Instagram Post.
   * **Độ phân giải (Resolution):** Chọn `720p` (Chuẩn hỗ trợ Unlimited không tốn credits) hoặc `1080p`.
   * **Gạt công tắc "Unlimited Mode":** Bật màu xanh để tạo video miễn phí theo gói dịch vụ.

6. **Gửi Task vào Hàng Chờ:**
   * Bấm nút màu xanh **"➕ Thêm Vào Hàng Chờ"**.
   * Task sẽ ngay lập tức xuất hiện trong bảng danh sách phía dưới với trạng thái `⏳ Chờ xử lý (pending)`.

---

### 🎯 THAO TÁC 2: Nhập Hàng Loạt Video (Bulk Import)

1. Nhấp chuột chuyển sang tab **"Nhập Hàng Loạt"** (ngay cạnh tab "Tạo Task Mới").
2. **Dán Danh Sách Prompt:**
   * Bạn có thể dán danh sách nhiều dòng, mỗi dòng là một prompt tạo video riêng biệt.
   * Hoặc dán mảng JSON nếu xuất dữ liệu từ file Excel / Google Sheets.
3. **Thiết Lập Cấu Hình Chung:**
   * Điền Tên người tạo, Model, Duration, Tỉ lệ áp dụng cho toàn bộ danh sách.
4. **Nhấp Nút Thực Hiện:**
   * Bấm **"🚀 Import Hàng Loạt Vào Queue"**.
   * Toàn bộ các task sẽ được tự động tách nhỏ và thêm vào hàng chờ tuần tự.

---

## PHẦN 3: HƯỚNG DẪN ĐIỀU KHIỂN & THEO DÕI HÀNG CHỜ

### 🎮 1. Điều Khiển Trạng Thái Hàng Chờ (Queue Controls)
* **Bật / Tạm Dừng:**
  * Bấm nút **"▶ Bật Hàng Chờ"** để hệ thống bắt đầu tự động xử lý task đầu tiên.
  * Bấm nút **"⏸ Tạm Dừng"** nếu bạn muốn tạm hoãn sau khi task hiện tại hoàn thành.
* **Xóa Task Đã Hoàn Thành:**
  * Bấm nút **"🗑️ Dọn Dẹp Task Xong"** để làm sạch bảng điều khiển, chỉ giữ lại các task đang chờ hoặc bị lỗi.

### 👁️ 2. Giám Sát Màn Hình Trực Tiếp (Live Stream CDP)
* Khung hình Live Stream ở góc phải màn hình luôn truyền phát trực tiếp thao tác thực tế đang diễn ra trên trình duyệt Chrome của Higgsfield mỗi 3 giây.
* Bạn có thể quan sát hệ thống tự động gõ chữ, kéo thanh slider, tải ảnh lên và bấm nút tạo video theo thời gian thực.

### 📋 3. Quản Lý Từng Task Trong Bảng Danh Sách
* **Thu gọn / Mở rộng Prompt dài:**
  * Với những prompt kịch bản dài, hệ thống tự động rút gọn để bảng gọn gàng. Bạn bấm vào nút **"Xem thêm ▾"** hoặc **"Thu gọn ▴"** để đọc toàn bộ nội dung.
* **Xem & Tải Video Đã Tạo Xong:**
  * Khi task đạt **100% (Completed)**, hệ thống sẽ hiện nút màu xanh:
    * **"🎬 Xem Video"**: Mở video trực tiếp trong popup để xem trước.
    * **"⬇️ Tải về"**: Tải tệp MP4 chất lượng cao từ máy chủ CloudFront về máy tính.
* **Thử Lại Task Bị Lỗi (Retry):**
  * Nếu một task bị lỗi mạng hoặc đối chiếu chưa khớp, task sẽ có trạng thái màu đỏ `Failed`.
  * Bạn chỉ cần bấm nút **"🔄 Thử lại"** ở cột Hành động, task sẽ được nạp lại vào hàng chờ và tự động xử lý lại từ đầu.
* **Xóa Task Khỏi Hàng Chờ:**
  * Bấm nút **"❌ Xóa"** để hủy bỏ task không muốn tạo nữa.

---

## PHẦN 4: HƯỚNG DẪN SỬ DỤNG CHUNG QUA MẠNG NỘI BỘ (LAN)

Hệ thống đã được thiết kế sẵn để làm việc nhóm (Teamwork):
1. **Lấy Đường Link LAN:**
   * Nhìn lên góc trên thanh tiêu đề của trang Dashboard, bạn sẽ thấy huy hiệu:
     `🌐 LAN: 192.168.68.18:3100 (Click Copy)`
   * Nhấp chuột trực tiếp vào huy hiệu này để copy đường link vào bộ nhớ tạm.
2. **Gửi Cho Đồng Đội:**
   * Gửi link trên cho các máy tính khác, máy tính bảng hoặc điện thoại kết nối cùng mạng Wi-Fi công ty / phòng làm việc.
3. **Sử Dụng Độc Lập:**
   * Mỗi thành viên mở link trên trình duyệt riêng của mình, nhập tên của họ vào ô **"Tên người tạo"** và nạp task.
   * Bảng hàng chờ trung tâm sẽ tự động hiển thị tên của từng người tạo và tiến độ hoàn thành theo thời gian thực.

---

## PHẦN 5: CÁC LỖI THƯỜNG GẶP VÀ CÁCH XỬ LÝ NHANH

| Hiện Tượng | Nguyên Nhân | Cách Xử Lý Nhanh |
| :--- | :--- | :--- |
| **Huy hiệu CDP báo Disconnected (Đỏ)** | Cửa sổ Chrome CDP bị tắt hoặc chưa mở. | Nhấp đúp vào tệp `start-cdp.bat` để mở lại Chrome CDP. |
| **Task báo lỗi "Chưa đăng nhập Higgsfield"** | Session đăng nhập trên Chrome CDP bị hết hạn. | Mở cửa sổ Chrome CDP, truy cập higgsfield.ai và đăng nhập lại tài khoản. |
| **Live Stream màu đen** | Trình duyệt Chrome đang ở trạng thái ngủ hoặc tab bị ẩn. | Bấm F5 tải lại trang Dashboard, hệ thống tự động kích hoạt Idle Live Stream. |
| **Task báo lỗi đối chiếu tham chiếu** | Higgsfield mạng chậm chưa kịp tải xong ảnh/video. | Bấm nút **"🔄 Thử lại"** trên task đó. Hệ thống đã có cơ chế tự động mở lại modal bù slot thiếu. |
