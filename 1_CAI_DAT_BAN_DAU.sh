#!/usr/bin/env bash
set -e

echo "======================================================================="
echo "         🛠️  CÀI ĐẶT VÀ KIỂM TRA MÔI TRƯỜNG CHO MÁY TÍNH MỚI"
echo "======================================================================="
echo ""

# 1. Kiểm tra Node.js
echo "[1/4] Kiểm tra Node.js..."
if ! command -v node >/dev/null 2>&1; then
    echo "[❌ LỖI] Máy tính chưa cài đặt Node.js!"
    echo "👉 Vui lòng cài đặt Node.js phiên bản LTS tại https://nodejs.org/"
    exit 1
fi
NODE_VER=$(node -v)
echo "[✅ OK] Đã tìm thấy Node.js ($NODE_VER)."
echo ""

# 2. Kiểm tra Google Chrome
echo "[2/4] Kiểm tra Google Chrome..."
CHROME_FOUND=0
for bin in google-chrome google-chrome-stable chromium chromium-browser /opt/google/chrome/chrome; do
    if command -v "$bin" >/dev/null 2>&1 || [ -x "$bin" ]; then
        CHROME_FOUND=1
        break
    fi
done
if [ $CHROME_FOUND -eq 0 ]; then
    echo "[⚠️ CẢNH BÁO] Chưa tìm thấy Google Chrome/Chromium."
else
    echo "[✅ OK] Đã tìm thấy Google Chrome."
fi
echo ""

# 3. Cài đặt thư viện Node modules
echo "[3/4] Cài đặt / Kiểm tra các thư viện cần thiết (npm install)..."
npm install --no-audit --no-fund
echo "[✅ OK] Thư viện đã sẵn sàng."
echo ""

# 4. Chạy kiểm tra tự động
echo "[4/4] Đang chạy kiểm thử hệ thống (Automated Tests)..."
node tests/runner.js
if [ $? -eq 0 ]; then
    echo ""
    echo "======================================================================="
    echo "   🎉 CHÚC MỪNG! HỆ THỐNG ĐÃ SẴN SÀNG 100% TRÊN MÁY TÍNH NÀY!"
    echo "======================================================================="
    echo ""
    echo "Các bước tiếp theo:"
    echo "  👉 Bước 2: Chạy './2_MO_CHROME_HIGGSFIELD.sh' để mở Chrome và đăng nhập."
    echo "  👉 Bước 3: Chạy './3_CHAY_DASHBOARD.sh' để mở giao diện web quản lý."
    echo "  (Hoặc chạy 1 lệnh './CHAY_TAT_CA_1_CLICK.sh')."
    echo ""
fi
