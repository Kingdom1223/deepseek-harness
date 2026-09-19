# 一键启动：双击就能打开桌面版
#
# 直接调 electron 可执行文件，不经过 npm（避免一个多余的控制台窗口和一层进程）。
# 窗口样式设为隐藏：启动瞬间不会闪一个黑框。

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'

if (-not (Test-Path $electron)) {
  Write-Host ''
  Write-Host '  未找到 Electron 运行时。' -ForegroundColor Yellow
  Write-Host '  请先在项目目录执行一次：' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '      npm install' -ForegroundColor Cyan
  Write-Host ''
  Read-Host '按回车退出'
  exit 1
}

Start-Process -FilePath $electron -ArgumentList '.' -WorkingDirectory $root -WindowStyle Hidden
