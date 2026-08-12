# PortAI APK 一键打包 + 安装脚本
# 流程：检查设备 → 构建 Web 产物 → 同步到 Android 工程 → Gradle 编译 APK → 安装到手机
# 用法：
#   默认       全流程（Web 有更新后双击即用）
#   -SkipBuild 跳过打包，仅安装现有 APK（同目录最新 .apk，或 gradle 输出目录的 debug 包）

param(
    [switch]$SkipBuild
)

Write-Host '======================================' -ForegroundColor Cyan
Write-Host '  PortAI APK 一键打包安装' -ForegroundColor Cyan
Write-Host '======================================' -ForegroundColor Cyan

# ---------- 交互菜单（stdin 重定向/带参数时跳过，默认全流程） ----------
if (-not $SkipBuild -and -not [Console]::IsInputRedirected) {
    Write-Host ''
    Write-Host '  请选择操作：' -ForegroundColor Yellow
    Write-Host '    [1] 重新打包并安装（Web 有更新时选这个）'
    Write-Host '    [2] 仅安装现有 APK（跳过打包）'
    $ans = Read-Host '  请输入 (1/2)，回车默认 1'
    if ($ans -match '^2$') { $SkipBuild = $true }
    Write-Host ''
}

# ---------- 工具函数 ----------
function Find-Adb {
    # 1) PATH 中已有 adb
    $cmd = Get-Command adb.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    # 2) ANDROID_HOME / ANDROID_SDK_ROOT 环境变量
    foreach ($envName in 'ANDROID_HOME', 'ANDROID_SDK_ROOT') {
        foreach ($s in [Environment]::GetEnvironmentVariable($envName, 'User'), [Environment]::GetEnvironmentVariable($envName, 'Machine')) {
            if ($s -and (Test-Path (Join-Path $s 'platform-tools\adb.exe'))) {
                return Join-Path $s 'platform-tools\adb.exe'
            }
        }
    }
    # 3) Android Studio 默认 SDK 安装位置
    $default = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
    if (Test-Path $default) { return $default }
    return $null
}

function Test-Jdk($path) {
    # 校验指定目录是否是可用的 JDK 21+（读 release 文件的 JAVA_VERSION）
    if (-not $path -or -not (Test-Path (Join-Path $path 'bin\java.exe'))) { return $false }
    $release = Join-Path $path 'release'
    if (Test-Path $release) {
        $line = Get-Content $release -ErrorAction SilentlyContinue | Where-Object { $_ -match '^JAVA_VERSION=' } | Select-Object -First 1
        if ($line -and $line -match '(\d+)') { return [int]$matches[1] -ge 21 }
    }
    return $false
}

function Find-Jdk21 {
    # 1) JAVA_HOME（须校验版本：Android Studio 的 JBR 17 不满足 Capacitor 8）
    if (Test-Jdk $env:JAVA_HOME) { return $env:JAVA_HOME }
    # 2) 常见安装位置（Temurin / Microsoft OpenJDK）
    foreach ($pattern in @(
        'C:\Program Files\Eclipse Adoptium\jdk-21*',
        'C:\Program Files\Microsoft\jdk-21*',
        "$env:LOCALAPPDATA\Programs\Eclipse Adoptium\jdk-21*"
    )) {
        $dir = Get-ChildItem $pattern -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Jdk $_.FullName } | Select-Object -First 1
        if ($dir) { return $dir.FullName }
    }
    return $null
}

function Assert-ExitOk($step, $exitCode) {
    if ($exitCode -ne 0) {
        Write-Host ("[错误] {0} 失败（退出码 {1}），请查看上方输出。" -f $step, $exitCode) -ForegroundColor Red
        exit 1
    }
}

# ---------- 1. 定位 adb ----------
$adb = Find-Adb
if (-not $adb) {
    Write-Host '[错误] 未找到 adb，请确认已安装 Android SDK Platform-Tools（Android Studio 自带）。' -ForegroundColor Red
    exit 1
}
Write-Host ("[adb] {0}" -f $adb) -ForegroundColor DarkGray

# ---------- 2. 检查设备（先确认有设备可装，再花时间打包） ----------
& $adb start-server | Out-Null
$devices = @((& $adb devices) | Where-Object { $_ -match '^\S+\s+device\s*$' })
if ($devices.Count -eq 0) {
    $unauthorized = (& $adb devices) | Where-Object { $_ -match 'unauthorized' }
    if ($unauthorized) {
        Write-Host '[错误] 检测到未授权的设备：请在手机上允许「USB 调试」授权弹窗。' -ForegroundColor Red
    } else {
        Write-Host '[错误] 未检测到已连接设备：请用 USB 连接手机，并开启「开发者选项 > USB 调试」。' -ForegroundColor Red
    }
    exit 1
}
if ($devices.Count -gt 1) {
    Write-Host '[错误] 检测到多台设备，请只保留一台后再试。当前设备：' -ForegroundColor Red
    $devices | ForEach-Object { Write-Host ('  - ' + (($_ -split '\s+')[0])) -ForegroundColor Yellow }
    exit 1
}
$deviceId = ($devices[0] -split '\s+')[0]
Write-Host ("[设备] {0}" -f $deviceId) -ForegroundColor Green

# ---------- 3. 打包（-SkipBuild 时跳过） ----------
if (-not $SkipBuild) {
    Write-Host ''
    Write-Host '-- 阶段 1/3：构建 Web 产物（npm run build） --' -ForegroundColor Yellow
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) {
        Write-Host '[错误] 未找到 npm，请确认已安装 Node.js。' -ForegroundColor Red
        exit 1
    }
    Push-Location $PSScriptRoot
    & $npm.Source run build
    Assert-ExitOk 'Web 构建' $LASTEXITCODE

    Write-Host '-- 阶段 2/3：同步 Web 产物到 Android 工程（cap sync） --' -ForegroundColor Yellow
    if (-not (Test-Path (Join-Path $PSScriptRoot 'android'))) {
        Write-Host '[错误] 缺少 android 工程，请先执行 npx cap add android。' -ForegroundColor Red
        exit 1
    }
    & $npm.Source exec cap sync android
    Assert-ExitOk 'cap sync' $LASTEXITCODE

    Write-Host '-- 阶段 3/3：Gradle 编译 APK（首次较慢，之后有缓存会快很多） --' -ForegroundColor Yellow
    $jdk = Find-Jdk21
    if (-not $jdk) {
        Write-Host '[错误] 未找到 JDK 21（Capacitor 8 编译要求）。请执行：winget install EclipseAdoptium.Temurin.21.JDK' -ForegroundColor Red
        exit 1
    }
    Write-Host ("[jdk] {0}" -f $jdk) -ForegroundColor DarkGray
    $env:JAVA_HOME = $jdk
    Push-Location (Join-Path $PSScriptRoot 'android')
    & .\gradlew.bat assembleDebug
    Assert-ExitOk 'Gradle 构建' $LASTEXITCODE
    Pop-Location
    Pop-Location

    $apk = Get-Item (Join-Path $PSScriptRoot 'android\app\build\outputs\apk\debug\app-debug.apk')
    Write-Host ''
    Write-Host ('[打包完成] {0}（{1:N1} MB）' -f $apk.Name, ($apk.Length / 1MB)) -ForegroundColor Green
} else {
    # 仅安装模式：优先取脚本同目录下最新的 .apk，其次取 gradle 输出目录的 debug 包
    $apks = @(Get-ChildItem $PSScriptRoot -Filter '*.apk' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    if ($apks.Count -eq 0) {
        $out = Join-Path $PSScriptRoot 'android\app\build\outputs\apk\debug\app-debug.apk'
        if (Test-Path $out) { $apks = @(Get-Item $out) }
    }
    if ($apks.Count -eq 0) {
        Write-Host '[错误] 未找到 APK 文件：请先执行打包，或把 APK 放到脚本同目录。' -ForegroundColor Red
        exit 1
    }
    $apk = $apks[0]
}
Write-Host ("[apk] {0}（{1:N1} MB）" -f $apk.Name, ($apk.Length / 1MB)) -ForegroundColor DarkGray

# ---------- 4. 安装 ----------
Write-Host '正在安装，请稍候...'
& $adb -s $deviceId install -r $apk.FullName
if ($LASTEXITCODE -ne 0) {
    Write-Host '[错误] 安装失败，请查看上方 adb 输出（常见原因：签名不一致需先卸载旧版）。' -ForegroundColor Red
    exit 1
}
Write-Host ('[成功] 已安装：{0}' -f $apk.Name) -ForegroundColor Green

# ---------- 5. 可选：立即启动 ----------
$ans = Read-Host '是否立即启动应用？(Y/N，默认 Y)'
if ($ans -eq '' -or $ans -match '^[Yy]') {
    & $adb -s $deviceId shell am start -n com.portai.app/.MainActivity | Out-Null
    Write-Host '[成功] 已启动 PortAI。' -ForegroundColor Green
}

exit 0
