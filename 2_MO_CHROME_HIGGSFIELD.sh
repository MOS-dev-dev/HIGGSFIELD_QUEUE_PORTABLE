#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "======================================================================="
echo "         🌐  KHỞI ĐỘNG GOOGLE CHROME CDP ĐIỀU KHIỂN TỰ ĐỘNG"
echo "======================================================================="
echo ""
echo "Đang mở Google Chrome với cổng điều khiển 9333..."
echo ""

bash "$SCRIPT_DIR/start-cdp.sh"

if [ $? -eq 0 ]; then
    echo ""
    echo "======================================================================="
    echo " [✅ OK] Chrome CDP đã được khởi động thành công trên cổng 9333!"
    echo "======================================================================="
    echo ""
    echo "📌 LƯU Ý QUAN TRỌNG:"
    echo "  1. Trên cửa sổ Chrome vừa mở ra, hãy ĐĂNG NHẬP tài khoản Higgsfield của bạn."
    echo "  2. Đảm bảo trang web đang ở mục Studio: https://higgsfield.ai/ai/video"
    echo "  3. KHÔNG tắt cửa sổ Chrome này trong suốt quá trình chạy hàng chờ."
    echo ""
else
    echo "[❌ LỖI] Không thể khởi động Chrome CDP. Vui lòng kiểm tra lại Google Chrome trên máy."
fi
