#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================="
echo "         🚀  KHỞI ĐỘNG MÁY CHỦ BẢNG ĐIỀU KHIỂN HÀNG CHỜ (PORT 3100)"
echo "======================================================================="
echo ""

# Kiểm tra và giải phóng port 3100 nếu tiến trình cũ chưa tắt hẳn
if command -v fuser >/dev/null 2>&1; then
    fuser -k 3100/tcp >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
    lsof -ti :3100 | xargs -r kill -9 >/dev/null 2>&1 || true
fi

echo "Máy chủ bảng điều khiển sẽ chạy tại: http://localhost:3100"
echo "Đang khởi động Server Node.js..."
echo "(Nhấn Ctrl + C để dừng máy chủ khi không sử dụng)"
echo ""

node server.js
