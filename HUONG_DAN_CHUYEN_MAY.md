# 📦 HƯỚNG DẪN ĐÓNG GÓI & CHUYỂN TOÀN BỘ HỆ THỐNG SANG MÁY TÍNH MỚI

Tài liệu này hướng dẫn chi tiết cách di chuyển, cài đặt và vận hành hệ thống **Higgsfield AI Video Queue Automation** sang bất kỳ máy tính Windows nào khác một cách nhanh chóng và ổn định 100%.

---

## 🖥️ 1. Yêu Cầu Cần Có Trên Máy Tính Mới

Trước khi bắt đầu, đảm bảo máy tính mới đã cài đặt:
1. **Hệ điều hành:** Windows 10 hoặc Windows 11 (64-bit).
2. **Google Chrome:** Trình duyệt Google Chrome bản mới nhất.
3. **Node.js (Bắt buộc):** Phiên bản **v18, v20 hoặc v22 LTS**.
   - Nếu chưa có: Tải và cài đặt tại 👉 [https://nodejs.org/](https://nodejs.org/) (Chọn bản **LTS**, khi cài cứ bấm *Next* liên tục đến khi hoàn tất).

---

## 🚀 2. Các Bước Cài Đặt Trên Máy Mới (3 Bước Đơn Giản)

### 📁 Bước 1: Copy Thư Mục / File Nén Sang Máy Mới
- Sao chép toàn bộ thư mục này (hoặc giải nén file `HIGGSFIELD_QUEUE_PORTABLE.zip`) vào một vị trí thuận tiện trên máy mới (Ví dụ: `D:\HiggsfieldQueue` hoặc `C:\Users\<Tên_Bạn>\Downloads\HiggsfieldQueue`).

---

### 🛠️ Bước 2: Chạy Cài Đặt Ban Đầu
- Nhấp đúp chuột vào file:
  👉 **`1_CAI_DAT_BAN_DAU.bat`**
- File này sẽ tự động:
  1. Kiểm tra Node.js & Google Chrome trên máy mới.
  2. Tự động cài đặt/kiểm tra các thư viện phụ thuộc (`npm install`).
  3. Tự động chạy **56 bài kiểm thử hệ thống (Automated Tests)** để đảm bảo mọi tính năng sẵn sàng 100%.

---

### 🌐 Bước 3: Mở Chrome & Đăng Nhập Tài Khoản Higgsfield (Chỉ cần làm lần đầu)
- Nhấp đúp chuột vào file:
  👉 **`2_MO_CHROME_HIGGSFIELD.bat`**
- Một cửa sổ Google Chrome điều khiển tự động (cổng 9333) sẽ mở ra và tự chuyển đến trang `https://higgsfield.ai/ai/video`.
- **Thao tác của bạn:**
  1. Đăng nhập tài khoản Higgsfield của bạn trên cửa sổ Chrome này.
  2. Sau khi đăng nhập xong, giữ cửa sổ Chrome này mở (hệ thống đã tích hợp cơ chế tự động phóng to toàn màn hình chống che nút).

---

### 🎮 Bước 4: Khởi Động Dashboard & Bắt Đầu Chạy Hàng Chờ
- Nhấp đúp chuột vào file:
  👉 **`3_CHAY_DASHBOARD.bat`**
- Trình duyệt sẽ tự động mở giao diện quản lý tại:
  🔗 **`http://localhost:3100`**
- *(Hoặc từ các lần sau, bạn chỉ cần nhấp đúp vào **`CHAY_TAT_CA_1_CLICK.bat`** là hệ thống sẽ tự động bật toàn bộ từ Chrome đến Dashboard).*

---

## ✨ 3. Tóm Tắt Các Tính Năng Đã Được Tối Ưu Hoàn Hảo

| Tính Năng | Mô Tả & Cách Hoạt Động |
| :--- | :--- |
| **Đính Kèm Đa Ảnh / Video** | Cho phép upload nhiều ảnh và nhiều video cùng lúc, không bị mất các tệp đã chọn ở lượt trước. |
| **Kéo Thả Sắp Xếp Thứ Tự (Drag & Drop)** | Dễ dàng kéo thả chuột hoặc bấm nút mũi tên `▲`/`▼` để thay đổi thứ tự ảnh và video nạp lên Higgsfield. |
| **Đảo Thứ Tự Prompt** | Hệ thống tự động nạp toàn bộ ảnh và video tham chiếu vào Higgsfield trước, sau đó mới điền Prompt. |
| **Unlimited Mode 100%** | Khóa đúng công tắc gạt `role="switch"`, xác thực kép chữ `GenerateUnlimited`, ngăn chặn trừ credit. |
| **Chống Thu Nhỏ (Anti-Minimize)** | Cưỡng chế mở rộng toàn màn hình (`1920x1080 maximized`) qua giao thức CDP, loại bỏ viền trắng. |
| **Tự Động Chờ Khi Trùng Luồng** | Khi gặp giới hạn `concurrent_jobs_limit: 1`, hệ thống tự động chờ 20s và thử lại thông minh (tối đa 8 lần). |
| **Thu Thập Link Video Tự Động** | Tự động bóc tách link MP4 CloudFront từ thumbnail Cloudflare CDN; Tăng thời gian chờ lên 25 phút. |
| **Nút `[🔄 Đồng Bộ Link]`** | Quét ngầm mỗi 15s và có nút bấm thủ công để tự động lấy link cho các task đã xong. |
| **Chia Sẻ Mạng LAN** | Cung cấp đường dẫn mạng LAN (`http://<IP_LAN>:3100`) để các máy tính khác trong cùng phòng/công ty cùng tạo task. |

---

## ❓ 4. Xử Lý Các Tình Huống Thường Gặp (FAQ)

#### 1. Bật Dashboard nhưng báo `Mất kết nối Chrome CDP` (Chấm Đỏ)?
- **Cách xử lý:** Chạy file `2_MO_CHROME_HIGGSFIELD.bat` để mở lại Chrome CDP trên cổng 9333.

#### 2. Muốn chạy hệ thống trên một máy tính khác trong mạng nội bộ (LAN)?
- Trên máy chạy server, nhìn vào góc trên bên phải của Dashboard sẽ thấy ô màu xanh `🌐 LAN: http://192.168.x.x:3100`.
- Nhấp vào ô đó để copy đường link và gửi cho đồng nghiệp trong cùng mạng Wi-Fi/LAN để họ mở trên máy của họ và gửi prompt/ảnh vào hàng chờ.

#### 3. Video đã render xong trên web Higgsfield nhưng trên Dashboard chưa hiện link?
- Bấm nút **`[🔄 Đồng Bộ Link]`** trên thanh điều khiển Dashboard, hệ thống sẽ quét feed và cập nhật ngay.
