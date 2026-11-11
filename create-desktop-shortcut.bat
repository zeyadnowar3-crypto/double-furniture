@echo off
chcp 65001 >nul
powershell.exe -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"
pause
