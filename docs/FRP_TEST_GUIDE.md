# frp 公网 API 测试指南

**前置条件**：
- frps 在 VPS 上运行（`systemctl status frps` 显示 active）
- frpc 在本机运行（看到 `start proxy success`）
- 本机 `npm run dev:headless` 已启动（端口 3100）

**替换变量**：把所有 `<VPS_IP>` 换成你的 VPS 公网 IP。

---

## 测试 1：基础连通性

验证公网能访问工作流列表：

```powershell
curl.exe -X GET "http://<VPS_IP>:3000/api/v1/workflows" -H "x-api-key: EC2D624DF25E"
```

**预期**：返回 JSON 数组，包含 9 个工作流对象，每个有 `id`/`name`/`description` 字段。

**失败排查**：
- 超时/连接拒绝 → 检查 VPS 防火墙是否放行 TCP 3000
- 401 Unauthorized → API Key 拼写错误
- 404 Not Found → frpc 的 `localPort` 可能写错（应该是 3100）

---

## 测试 2：端口隔离验证

确认内部路由**没有**暴露：

```powershell
curl.exe -X GET "http://<VPS_IP>:3000/api/settings"
```

**预期**：`404 Not Found` 或 `Cannot GET /api/settings`。

**❌ 严重错误**：如果返回 JSON 配置（包含 `cos.secretId` 等），说明 frpc 映射了错误端口。**立即停止 frpc**，修改 `frpc.toml` 的 `localPort = 3100`，重启后重测。

---

## 测试 3：COS 完整工作流

### 3.1 获取上传凭证

```powershell
$uploadResp = curl.exe -X POST "http://<VPS_IP>:3000/api/v1/uploads/presign" `
  -H "x-api-key: EC2D624DF25E" `
  -H "Content-Type: application/json" `
  -d '{"filename":"test-portrait.jpg","contentType":"image/jpeg"}' | ConvertFrom-Json

$uploadResp | ConvertTo-Json -Depth 3
```

**预期输出**：
```json
{
  "key": "pix2real/uploads/xxxxxxxx-test-portrait.jpg",
  "uploadUrl": "https://p2v-1316472087.cos.ap-guangzhou.myqcloud.com/pix2real/uploads/...?sign=..."
}
```

### 3.2 上传测试图片

找一张本地图片（任意 JPG/PNG，建议 < 10MB），记下完整路径。Windows 路径示例：`C:\Users\billy\Pictures\avatar.jpg`

```powershell
$imagePath = "替换为你的图片完整路径"

curl.exe -X PUT $uploadResp.uploadUrl `
  -H "Content-Type: image/jpeg" `
  --data-binary "@$imagePath"
```

**预期**：无输出或 200 OK（COS 不返回 body）。如果报错 `403 SignatureDoesNotMatch`，说明 `contentType` 和实际文件不匹配（PNG 要用 `image/png`）。

### 3.3 提交工作流任务

使用刚才上传的 `key`：

```powershell
$taskResp = curl.exe -X POST "http://<VPS_IP>:3000/api/v1/workflows/0/execute" `
  -H "x-api-key: EC2D624DF25E" `
  -H "Content-Type: application/json" `
  -d "{`"imageKey`":`"$($uploadResp.key)`",`"prompt`":`"1girl, solo, smile`",`"seed`":42}" | ConvertFrom-Json

echo "Task ID: $($taskResp.taskId)"
```

**预期**：
```json
{
  "taskId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "status": "queued"
}
```

### 3.4 轮询任务状态

每 3 秒查一次（ComfyUI 生成大约需要 30-60 秒）：

```powershell
$taskId = $taskResp.taskId

while ($true) {
  $status = curl.exe -X GET "http://<VPS_IP>:3000/api/v1/tasks/$taskId" `
    -H "x-api-key: EC2D624DF25E" | ConvertFrom-Json
  
  echo "[$(Get-Date -Format 'HH:mm:ss')] Status: $($status.status) | Progress: $($status.progress)%"
  
  if ($status.status -eq "completed") {
    $status | ConvertTo-Json -Depth 5
    break
  }
  
  if ($status.status -eq "error") {
    echo "❌ 任务失败: $($status.error)"
    break
  }
  
  Start-Sleep -Seconds 3
}
```

**预期流程**：
1. `queued` → `running` (几秒内)
2. `running` + progress 0% → 100%（30-60 秒）
3. `completed` + `resultUrls` 数组出现

### 3.5 下载结果

```powershell
$resultUrl = $status.resultUrls[0]

curl.exe -o "C:\Users\billy\Downloads\frp-test-result.png" $resultUrl

echo "已保存到: C:\Users\billy\Downloads\frp-test-result.png"
```

**验证**：
- 文件大小 > 0（通常 1-3 MB）
- 用图片查看器打开能正常显示
- **注意**：presigned URL 有效期 24 小时，过期后 403

---

## 测试 4：multipart 回退验证

确认不依赖 COS 也能工作（图片直接走 frp）：

```powershell
$imagePath = "替换为你的图片完整路径"

curl.exe -X POST "http://<VPS_IP>:3000/api/v1/workflows/0/execute" `
  -H "x-api-key: EC2D624DF25E" `
  -F "image=@$imagePath" `
  -F 'data={"prompt":"1girl, solo","seed":99}' | ConvertFrom-Json
```

**预期**：返回 `taskId`，轮询逻辑同上。

**流量对比**：
- 用 COS（测试 3）：上传阶段流量走腾讯云内网/直连，frp 仅传 ~500 字节 JSON
- 用 multipart（测试 4）：8MB 图片完整走 frp 隧道

---

## 测试 5：手机 4G 验证

**为什么需要**：本机测试可能走局域网抄近路（LAN IP 和公网 IP 相同时），导致防火墙/路由问题没暴露。

**步骤**：
1. 手机关闭 WiFi，切换到 4G/5G
2. 使用 Termux 或 HTTP 测试 App（如 HTTP Shortcuts）
3. 执行测试 1 的 curl 命令（替换 `<VPS_IP>` 为实际 IP）

**预期**：和本机测试完全一致。

---

## 故障排查速查表

| 现象 | 原因 | 解决 |
|---|---|---|
| `Connection refused` | frps 未运行或防火墙未放行 | `sudo systemctl status frps`；检查防火墙 TCP 17000/3000 |
| `404 Not Found` 所有路由 | frpc 未连上 frps | 检查 frpc 输出有无 `start proxy success`；token 是否一致 |
| `/api/settings` 返回 JSON | 端口映射错误 | 修改 `frpc.toml` 的 `localPort = 3100` |
| 任务卡在 `queued` | 本机后端未启动 | 检查 `npm run dev:headless` 是否在运行 |
| COS 上传 403 | `contentType` 不匹配 | JPG 用 `image/jpeg`，PNG 用 `image/png` |
| 结果 URL 下载 403 | presigned URL 过期 | 24 小时后需重新轮询（重新生成 URL）；任务终态不应发 ETag |

---

## 下一步

测试通过后：
1. **HTTPS 改造**（可选但强烈推荐）：API Key 目前明文传输，建议配置域名 + Caddy 自动证书（见 `REMOTE_APP_INTEGRATION.md` 附录 A.7）
2. **frpc 开机自启**：在 Windows 任务计划程序创建开机触发器，运行 `C:\frp\frpc.exe -c C:\frp\frpc.toml`
3. **生命周期验证**：24 小时后登录 COS 控制台，确认 `pix2real/` 目录下测试文件已自动删除
4. **App 集成**：把 `http://<VPS_IP>:3000` 填入你的移动 App 配置（如果用 HTTPS，改成 `https://your-domain.com`）

---

## 附：一键完整测试脚本

**需要手动替换的变量**：
- `$VPS_IP`：你的 VPS 公网 IP
- `$TEST_IMAGE`：本机测试图片路径

```powershell
# ===== 配置 =====
$VPS_IP = "替换为VPS IP"
$TEST_IMAGE = "C:\Users\billy\Pictures\test.jpg"  # 替换为实际路径
$API_KEY = "EC2D624DF25E"
$BASE_URL = "http://${VPS_IP}:3000"

# ===== 测试 1: 连通性 =====
Write-Host "`n[TEST 1] 基础连通性..." -ForegroundColor Cyan
$workflows = curl.exe -X GET "$BASE_URL/api/v1/workflows" -H "x-api-key: $API_KEY" 2>$null | ConvertFrom-Json
if ($workflows.Count -ge 9) {
  Write-Host "✓ PASS: 获取到 $($workflows.Count) 个工作流" -ForegroundColor Green
} else {
  Write-Host "✗ FAIL: 工作流数量异常" -ForegroundColor Red
  exit 1
}

# ===== 测试 2: 隔离验证 =====
Write-Host "`n[TEST 2] 端口隔离..." -ForegroundColor Cyan
$settingsResp = curl.exe -X GET "$BASE_URL/api/settings" -w "%{http_code}" -o $null -s 2>$null
if ($settingsResp -eq "404") {
  Write-Host "✓ PASS: 内部路由已隔离" -ForegroundColor Green
} else {
  Write-Host "✗ FAIL: /api/settings 返回 $settingsResp (应为 404)" -ForegroundColor Red
  Write-Host "  检查 frpc.toml 的 localPort 是否为 3100" -ForegroundColor Yellow
  exit 1
}

# ===== 测试 3: COS 工作流 =====
Write-Host "`n[TEST 3] COS 完整流程..." -ForegroundColor Cyan

# 3.1 Presign
Write-Host "  → 获取上传凭证..."
$uploadResp = curl.exe -X POST "$BASE_URL/api/v1/uploads/presign" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  -d '{"filename":"test.jpg","contentType":"image/jpeg"}' 2>$null | ConvertFrom-Json

if (-not $uploadResp.key) {
  Write-Host "✗ FAIL: 未获取到 uploadUrl" -ForegroundColor Red
  exit 1
}

# 3.2 Upload
Write-Host "  → 上传图片到 COS..."
curl.exe -X PUT $uploadResp.uploadUrl `
  -H "Content-Type: image/jpeg" `
  --data-binary "@$TEST_IMAGE" -s -o $null 2>$null

# 3.3 Execute
Write-Host "  → 提交任务..."
$taskResp = curl.exe -X POST "$BASE_URL/api/v1/workflows/0/execute" `
  -H "x-api-key: $API_KEY" `
  -H "Content-Type: application/json" `
  -d "{`"imageKey`":`"$($uploadResp.key)`",`"prompt`":`"1girl`",`"seed`":42}" 2>$null | ConvertFrom-Json

Write-Host "  Task ID: $($taskResp.taskId)" -ForegroundColor Gray

# 3.4 Poll
Write-Host "  → 等待完成..."
$timeout = 120  # 2 分钟超时
$elapsed = 0
while ($elapsed -lt $timeout) {
  $status = curl.exe -X GET "$BASE_URL/api/v1/tasks/$($taskResp.taskId)" `
    -H "x-api-key: $API_KEY" 2>$null | ConvertFrom-Json
  
  Write-Host "    [$($status.status)] $($status.progress)%" -NoNewline -ForegroundColor Gray
  
  if ($status.status -eq "completed") {
    Write-Host ""
    Write-Host "✓ PASS: 任务完成" -ForegroundColor Green
    
    # 3.5 Download
    if ($status.resultUrls -and $status.resultUrls.Count -gt 0) {
      $outPath = "$env:TEMP\frp-test-result-$(Get-Date -Format 'HHmmss').png"
      curl.exe -o $outPath $status.resultUrls[0] -s 2>$null
      $fileSize = (Get-Item $outPath).Length
      if ($fileSize -gt 1KB) {
        Write-Host "✓ PASS: 结果下载成功 ($([math]::Round($fileSize/1MB, 2)) MB)" -ForegroundColor Green
        Write-Host "  文件: $outPath" -ForegroundColor Gray
      } else {
        Write-Host "✗ FAIL: 结果文件异常 ($fileSize 字节)" -ForegroundColor Red
      }
    }
    break
  }
  
  if ($status.status -eq "error") {
    Write-Host ""
    Write-Host "✗ FAIL: $($status.error)" -ForegroundColor Red
    exit 1
  }
  
  Start-Sleep -Seconds 3
  $elapsed += 3
  Write-Host "`r" -NoNewline
}

if ($elapsed -ge $timeout) {
  Write-Host "`n✗ FAIL: 任务超时" -ForegroundColor Red
  exit 1
}

Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "所有测试通过 ✓" -ForegroundColor Green
Write-Host "frp 隧道工作正常，可以开始 App 集成" -ForegroundColor Green
```

**使用方法**：
1. 打开 PowerShell（管理员权限非必需）
2. 替换脚本顶部的 `$VPS_IP` 和 `$TEST_IMAGE`
3. 整段复制粘贴执行
4. 等待 1-2 分钟，看到 `所有测试通过 ✓` 即可

如果某步失败，根据输出信息对照「故障排查速查表」定位问题。
