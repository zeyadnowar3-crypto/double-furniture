$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "معرض الأثاث - لوحة الإدارة.lnk"
$vbsPath = "D:\factory-accounting\showroom\start-showroom-hidden.vbs"
$workingDir = "D:\factory-accounting\showroom"
$iconPath = "D:\factory-accounting\app.ico"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $workingDir
if (Test-Path $iconPath) {
    $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Description = "لوحة إدارة معرض الأثاث وكلمات مرور العملاء"
$shortcut.Save()

Write-Host "SUCCESS: Shortcut created at: $shortcutPath"
