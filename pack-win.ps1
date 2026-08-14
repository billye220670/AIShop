# pack-win.ps1 - PortAI Windows 安装包一键打包脚本
#
# 设计目标：复用本地缓存的 electron 二进制与打包工具，全程不依赖 GitHub 下载，
# 避免 electron-builder 首次打包时的超时/慢速问题。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File pack-win.ps1        # 构建 + 打包
#   powershell -ExecutionPolicy Bypass -File pack-win.ps1 -SkipBuild   # 仅打包（跳过构建）
#
# 产物：release\PortAI Setup <版本>.exe

param(
  [switch]$SkipBuild # 跳过 electron-vite 构建，仅重新打包
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$local = $env:LOCALAPPDATA

# ---- 1. 读取版本 ----
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$electronPkg = Get-Content "$root\node_modules\electron\package.json" -Raw | ConvertFrom-Json
$electronVersion = $electronPkg.version
Write-Host "== PortAI $($pkg.version) / Electron $electronVersion =="

# ---- 2. 关闭正在运行的旧版应用（防止 win-unpacked 文件被占用导致 EPERM） ----
if (Get-Process -Name PortAI -ErrorAction SilentlyContinue) {
  Write-Host ">> 检测到 PortAI 正在运行，自动关闭..."
  taskkill /F /IM PortAI.exe /T 2>$null | Out-Null
  Start-Sleep -Seconds 2
}

# ---- 3. electron 二进制：优先复用已解压的 dist，缺失时从 npmmirror 获取 ----
$zipName = "electron-v$electronVersion-win32-x64.zip"
$distDir = "$local\electron\dist"
$zipPath = "$local\electron\Cache\$zipName"

if (-not (Test-Path "$distDir\electron.exe")) {
  Write-Host ">> 未找到 electron 二进制（$distDir），准备获取 v$electronVersion ..."
  if (-not (Test-Path $zipPath)) {
    Write-Host ">> 从 npmmirror 下载 electron 二进制（约 135MB）..."
    New-Item -ItemType Directory -Force -Path "$local\electron\Cache" | Out-Null
    curl.exe -L --connect-timeout 15 -o $zipPath "https://npmmirror.com/mirrors/electron/$electronVersion/$zipName"
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zipPath)) { throw "electron 二进制下载失败，请检查网络" }
  }
  Write-Host ">> 解压 electron 二进制到 $distDir ..."
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  tar -xf $zipPath -C $distDir
  if (-not (Test-Path "$distDir\electron.exe")) { throw "electron 解压失败" }
} else {
  Write-Host ">> 复用已解压的 electron 二进制（$distDir）"
}

# ---- 4. winCodeSign 工具：缺失时从 npmmirror 下载并解压到 electron-builder 缓存 ----
$wcsDir = "$local\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0"
if (-not (Test-Path "$wcsDir\windows-10") -and -not (Test-Path "$wcsDir\rcedit-x64.exe")) {
  Write-Host ">> 准备 winCodeSign 工具..."
  $wcsZip = "$env:TEMP\winCodeSign-2.6.0.7z"
  curl.exe -L --connect-timeout 15 -o $wcsZip "https://npmmirror.com/mirrors/electron-builder-binaries/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
  if ($LASTEXITCODE -ne 0) { throw "winCodeSign 下载失败，请检查网络" }
  $z = Get-ChildItem "$local\electron-builder\Cache\7zip@1.0.0\7zip-win-x64-*\bin\7za.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $z) { throw "未找到 7za.exe，请先运行一次 electron-builder 生成 7zip 缓存" }
  New-Item -ItemType Directory -Force -Path $wcsDir | Out-Null
  & $z.FullName x $wcsZip "-o$wcsDir" -y 2>$null | Out-Null
  if (-not (Test-Path "$wcsDir\windows-10")) { throw "winCodeSign 解压失败" }
} else {
  Write-Host ">> 复用已缓存的 winCodeSign 工具"
}

# ---- 5. 构建 electron 产物 ----
if (-not $SkipBuild) {
  Write-Host ">> electron-vite 构建中..."
  Push-Location $root
  npm run build:electron
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw "electron-vite 构建失败" }
  Pop-Location
}

# ---- 6. electron-builder 打 NSIS 安装包（镜像环境变量 + 本地 electronDist） ----
Write-Host ">> electron-builder 打包 NSIS 安装包..."
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
Push-Location $root
npx electron-builder --win nsis "-c.electronDist=$distDir"
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "electron-builder 打包失败（exit=$code）" }

# ---- 7. 完成提示 ----
$exe = Get-ChildItem "$root\release\PortAI Setup $($pkg.version).exe" -ErrorAction SilentlyContinue
if ($exe) {
  Write-Host ""
  Write-Host "== 打包完成：$($exe.FullName)（$([math]::Round($exe.Length / 1MB, 1))MB）=="
} else {
  throw "打包完成但未找到安装包，请检查 release 目录"
}
