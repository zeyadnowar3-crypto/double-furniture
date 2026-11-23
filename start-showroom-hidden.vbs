Option Explicit
Dim WshShell, fso, currentDir

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' تشغيل الحارس الذكي في الخلفية بصمت تام (يمنع التكرار ويعمل بدون فتح أي متصفح)
WshShell.CurrentDirectory = currentDir
WshShell.Run "wscript.exe """ & currentDir & "\showroom-watchdog.vbs""", 0, False
