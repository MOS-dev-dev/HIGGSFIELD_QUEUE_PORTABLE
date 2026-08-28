@echo off
chcp 65001 >nul
title [2/3] MỞ CHROME HIGGSFIELD (PORT 9333)
color 0E

echo =======================================================================
echo          🌐  KHỞI ĐỘNG GOOGLE CHROME CDP ĐIỀU KHIỂN TỰ ĐỘNG
echo =======================================================================
echo.
echo Đang mở Google Chrome với cổng điều khiển 9333...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cdp.ps1"

if %errorlevel% equ 0 (
    color 0A
    echo.
    echo =======================================================================
    echo  [✅ OK] Chrome CDP đã được khởi động thành công trên cổng 9333!
    echo =======================================================================
    echo.
    echo 📌 LƯU Ý QUAN TRỌNG:
    echo   1. Trên cửa sổ Chrome vừa mở ra, hãy ĐĂNG NHẬP tài khoản Higgsfield của bạn.
    echo   2. Đảm bảo trang web đang ở mục Studio: https://higgsfield.ai/ai/video
    echo   3. KHÔNG tắt cửa sổ Chrome này trong suốt quá trình chạy hàng chờ.
    echo.
) else (
    color 0C
    echo [❌ LỖI] Không thể khởi động Chrome CDP. Vui lòng kiểm tra lại Google Chrome trên máy.
)

pause
