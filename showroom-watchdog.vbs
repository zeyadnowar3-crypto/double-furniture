' الحارس الذكي الوحيد لمعرض DOUBLE FURNITURE
' يمنع تكرار النسخ ويعيد تشغيل الخادم فوراً في حال توقفه بدون استهلاك موارد
Option Explicit

Dim sh, fso, appDir, nodeExe, wmi, myPid, p, cmd, watchdogCount, nodeUp

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)

nodeExe = "node"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
End If

' 1. فحص النسخ السابقة من الحارس لمنع أي تكرار نهائياً (Single Instance Check)
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
watchdogCount = 0
For Each p In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='wscript.exe' OR Name='cscript.exe'")
  cmd = p.CommandLine & ""
  If InStr(cmd, "showroom-watchdog.vbs") > 0 Then
    watchdogCount = watchdogCount + 1
  End If
Next

If watchdogCount > 1 Then
  ' توجد نسخة أخرى تعمل بالفعل، نخرج فوراً لتجنب استهلاك موارد الجهاز
  WScript.Quit
End If

' 2. حلقة المراقبة الخفيفة
Do While True
  nodeUp = False
  For Each p In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name='node.exe'")
    cmd = p.CommandLine & ""
    If InStr(cmd, "showroom\server.js") > 0 Or InStr(cmd, "showroom/server.js") > 0 Then
      nodeUp = True
    End If
  Next

  If Not nodeUp Then
    sh.CurrentDirectory = appDir
    sh.Run """" & nodeExe & """ """ & appDir & "\server.js""", 0, False
    WScript.Sleep 3000
  End If

  WScript.Sleep 10000
Loop
