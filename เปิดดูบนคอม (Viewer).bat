@echo off
chcp 65001 >nul
title IP Camera Viewer
echo กำลังเปิดหน้าต่างดูสด (Viewer)...
python start_viewer.py
pause
