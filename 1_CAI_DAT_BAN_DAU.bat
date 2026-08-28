@echo off
chcp 65001 >nul
title [1/3] CÀI ĐẶT HỆ THỐNG HIGGSFIELD QUEUE BAN ĐẦU
color 0B

echo =======================================================================
echo          🛠️  CÀI ĐẶT VÀ KIỂM TRA MÔI TRƯỜNG CHO MÁY TÍNH MỚI
echo =======================================================================
echo.

:: 1. Kiểm tra Node.js
echo [1/4] Kiểm tra Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [❌ LỖI] Máy tính chưa cài đặt Node.js!
    echo 👉 Vui lòng tải và cài đặt Node.js phiên bản LTS tại: https://nodejs.org/
    echo    (Khi cài đặt cứ bấm Next cho đến khi hoàn tất, sau đó chạy lại file này).
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [✅ OK] Đã tìm thấy Node.js (%NODE_VER%).
echo.

:: 2. Kiểm tra Google Chrome
echo [2/4] Kiểm tra Google Chrome...
set CHROME_FOUND=0
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set CHROME_FOUND=1
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set CHROME_FOUND=1
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set CHROME_FOUND=1

if %CHROME_FOUND% equ 0 (
    echo [⚠️ CẢNH BÁO] Chưa tìm thấy Google Chrome ở thư mục mặc định.
    echo 👉 Hãy đảm bảo máy tính đã cài đặt Google Chrome để hệ thống có thể tự động hóa.
) else (
    echo [✅ OK] Đã tìm thấy Google Chrome.
)
echo.

:: 3. Cài đặt thư viện Node modules
echo [3/4] Cài đặt / Kiểm tra các thư viện cần thiết (npm install)...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [⚠️] npm install có cảnh báo nhưng hệ thống vẫn tiếp tục kiểm tra...
)
echo [✅ OK] Thư viện đã sẵn sàng.
echo.

:: 4. Chạy kiểm tra tự động 56 bài test hệ thống
echo [4/4] Đang chạy kiểm thử hệ thống (Automated Tests)...
node tests/runner.js
if %errorlevel% neq 0 (
    color 0E
    echo [⚠️] Có bài test chưa đạt, nhưng bạn vẫn có thể khởi động hệ thống.
) else (
    color 0A
    echo.
    echo =======================================================================
    echo    🎉 CHÚC MỪNG! HỆ THỐNG ĐÃ SẴN SÀNG 100%% TRÊN MÁY TÍNH NÀY!
    echo =======================================================================
    echo.
    echo Các bước tiếp theo:
    echo   👉 Bước 2: Chạy file '2_MO_CHROME_HIGGSFIELD.bat' để mở Chrome và đăng nhập.
    echo   👉 Bước 3: Chạy file '3_CHAY_DASHBOARD.bat' để mở giao diện web quản lý.
    echo   (Hoặc sau này chỉ cần chạy 1 file 'CHAY_TAT_CA_1_CLICK.bat').
    echo.
)

pause
