Option Explicit
Dim WshShell, fso, currentDir, chromePath, edgePath, cloudUrl

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

cloudUrl = "https://double-furniture-showroom-production.up.railway.app/admin"

chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

' فتح لوحة تحكم المعرض السحابية كنافذة برنامج مستقل على الديسكتوب
If fso.FileExists(chromePath) Then
  WshShell.Run """" & chromePath & """ --app=" & cloudUrl & " --window-size=1350,880", 1, False
ElseIf fso.FileExists(edgePath) Then
  WshShell.Run """" & edgePath & """ --app=" & cloudUrl & " --window-size=1350,880", 1, False
Else
  WshShell.Run cloudUrl
End If
