Option Explicit
Dim WshShell, fso, currentDir

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' تشغيل الحارس الذكي في الخلفية (يمنع التكرار تلقائياً)
WshShell.CurrentDirectory = currentDir
WshShell.Run "wscript.exe """ & currentDir & "\showroom-watchdog.vbs""", 0, False

' فتح لوحة الإدارة في المتصفح
WScript.Sleep 1000
WshShell.Run "http://localhost:4000/admin"
