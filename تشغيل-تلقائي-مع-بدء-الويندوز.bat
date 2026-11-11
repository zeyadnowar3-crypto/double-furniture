@echo off
chcp 65001 >nul
echo ==========================================================
echo    تثبيت تشغيل المعرض تلقائياً مع تشغيل جهاز الكمبيوتر
echo ==========================================================

set "TARGET_DIR=%~dp0"
set "VBS_SCRIPT=%TARGET_DIR%start-showroom-hidden.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT=%STARTUP_FOLDER%\معرض الأثاث - تشغيل تلقائي.lnk"

powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$s = $ws.CreateShortcut('%SHORTCUT%'); " ^
  "$s.TargetPath = 'wscript.exe'; " ^
  "$s.Arguments = '\"%VBS_SCRIPT%\"'; " ^
  "$s.WorkingDirectory = '%TARGET_DIR%'; " ^
  "$s.Description = 'تشغيل خادم معرض الأثاث تلقائياً في الخلفية'; " ^
  "$s.Save()"

echo.
echo [تم بنجاح ✓] سيعمل خادم المعرض وحارس الاستقرار تلقائياً كلما فتحت الكمبيوتر!
echo.
pause
