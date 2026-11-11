$wsh = New-Object -ComObject WScript.Shell
$desktop = [System.Environment]::GetFolderPath('Desktop')
$shortcutPath = [System.IO.Path]::Combine($desktop, "معرض DOUBLE FURNITURE.lnk")
$vbsPath = "D:\factory-accounting\showroom\open-showroom-desktop.vbs"
$iconPath = "D:\factory-accounting\app.ico"

$s = $wsh.CreateShortcut($shortcutPath)
$s.TargetPath = "wscript.exe"
$s.Arguments = "`"$vbsPath`""
$s.WorkingDirectory = "D:\factory-accounting\showroom"
if (Test-Path $iconPath) {
    $s.IconLocation = "$iconPath,0"
}
$s.Description = "معرض DOUBLE FURNITURE — لوحة الإدارة وكتالوج العملاء"
$s.Save()

Write-Host "Created shortcut successfully at: $shortcutPath"
