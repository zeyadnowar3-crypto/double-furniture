$startupFolder = [System.Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupFolder "showroom-server.lnk"
$vbsPath = "D:\factory-accounting\showroom\start-showroom-hidden.vbs"
$workingDir = "D:\factory-accounting\showroom"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $workingDir
$shortcut.Save()

Write-Host "Startup shortcut created at: $shortcutPath"
