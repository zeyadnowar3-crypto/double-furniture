Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' 1) التأكد من تشغيل الحارس والسيرفر
WshShell.CurrentDirectory = currentDir
WshShell.Run "wscript.exe """ & currentDir & "\showroom-watchdog.vbs""", 0, False

WScript.Sleep 1000

' 2) فتح لوحة المعرض كنافذة برنامج مستقل على الديسكتوب (بدون أشرطة متصفح)
chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(chromePath) Then
  WshShell.Run """" & chromePath & """ --app=http://localhost:4000/admin --window-size=1300,850", 1, False
ElseIf fso.FileExists(edgePath) Then
  WshShell.Run """" & edgePath & """ --app=http://localhost:4000/admin --window-size=1300,850", 1, False
Else
  WshShell.Run "http://localhost:4000/admin"
End If
