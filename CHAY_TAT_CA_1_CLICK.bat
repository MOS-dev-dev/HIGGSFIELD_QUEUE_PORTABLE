@echo off
chcp 65001 >nul
title KHỞI ĐỘNG NHANH HIGGSFIELD QUEUE (1-CLICK ALL IN ONE)
color 0A

echo =======================================================================
echo          ⚡  KHỞI ĐỘNG TOÀN BỘ HỆ THỐNG HIGGSFIELD QUEUE (1-CLICK)
echo =======================================================================
echo.

:: 1. Khởi động Chrome CDP
echo [1/3] Đang mở Chrome CDP (Port 9333)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-cdp.ps1"

timeout /t 2 >nul

:: 2. Mở trình duyệt vào Dashboard
echo [2/3] Đang mở Dashboard tại http://localhost:3100...
start http://localhost:3100

:: 3. Khởi động Node server
echo [3/3] Đang khởi động Server Node.js...
echo.
echo =======================================================================
echo  🌐 Dashboard: http://localhost:3100
echo  📡 Chrome CDP: http://127.0.0.1:9333
echo  (Giữ cửa sổ này mở để duy trì hàng chờ. Nhấn Ctrl + C để dừng)
echo =======================================================================
echo.

node server.js

pause
