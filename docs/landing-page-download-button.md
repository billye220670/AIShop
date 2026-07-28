# Landing Page 下载按钮对接逻辑说明

## 概述

Landing Page 需要实现一个"下载最新版本"按钮，点击后自动下载 PortAI 桌面端最新安装包。下载源为 GitHub Releases。

---

## GitHub Releases 信息

| 字段 | 值 |
|------|-----|
| 仓库地址 | `https://github.com/billye220670/AIShop` |
| Release 触发方式 | 推送 `v*` 格式的 Git Tag |
| 安装包格式 | Windows NSIS 安装程序（`.exe`） |
| 安装包命名规则 | `PortAI-Setup-{version}.exe`（如 `PortAI-Setup-1.0.4.exe`） |

---

## API 端点

### 获取最新 Release

```
GET https://api.github.com/repos/billye220670/AIShop/releases/latest
```

**无需认证**（公开仓库），但建议携带 `Accept` 头以确保 JSON 响应：

```http
Accept: application/vnd.github+json
```

### 响应结构（关键字段）

```json
{
  "tag_name": "v1.0.4",
  "name": "v1.0.4",
  "body": "Release notes content...",
  "assets": [
    {
      "name": "PortAI-Setup-1.0.4.exe",
      "browser_download_url": "https://github.com/billye220670/AIShop/releases/download/v1.0.4/PortAI-Setup-1.0.4.exe",
      "size": 85000000,
      "download_count": 42,
      "content_type": "application/x-msdownload"
    },
    {
      "name": "latest.yml",
      "browser_download_url": "...",
      "content_type": "text/yaml"
    }
  ],
  "published_at": "2026-06-01T12:00:00Z"
}
```

---

## 前端对接逻辑

### 核心流程

```
页面加载 → 调用 GitHub API → 解析 assets → 匹配 .exe 文件 → 设置按钮链接
用户点击 → 浏览器自动下载 .exe
```

### 参考实现

```javascript
const GITHUB_API = 'https://api.github.com/repos/billye220670/AIShop/releases/latest';

async function getLatestRelease() {
  try {
    const response = await fetch(GITHUB_API, {
      headers: { 'Accept': 'application/vnd.github+json' }
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const release = await response.json();

    // 查找 Windows 安装包（.exe 文件）
    const windowsAsset = release.assets.find(
      asset => asset.name.endsWith('.exe') && asset.name.includes('Setup')
    );

    if (!windowsAsset) {
      throw new Error('未找到 Windows 安装包');
    }

    return {
      version: release.tag_name,           // "v1.0.4"
      downloadUrl: windowsAsset.browser_download_url,
      fileName: windowsAsset.name,         // "PortAI-Setup-1.0.4.exe"
      fileSize: windowsAsset.size,         // 字节数
      publishedAt: release.published_at,
      releaseNotes: release.body,
      downloadCount: windowsAsset.download_count
    };
  } catch (error) {
    console.error('获取最新版本失败:', error);
    return null;
  }
}
```

### 按钮触发下载

```javascript
// 方式 1：设置 <a> 标签 href（推荐）
const downloadBtn = document.getElementById('download-btn');
const release = await getLatestRelease();

if (release) {
  downloadBtn.href = release.downloadUrl;
  downloadBtn.textContent = `下载 PortAI ${release.version}`;
} else {
  // 降级：直接跳转到 Releases 页面
  downloadBtn.href = 'https://github.com/billye220670/AIShop/releases/latest';
  downloadBtn.textContent = '前往下载页';
}

// 方式 2：编程式触发下载
function triggerDownload(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';  // 提示浏览器下载而非导航
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

---

## 降级与容错策略

| 场景 | 处理方式 |
|------|----------|
| GitHub API 请求失败（网络/限流） | 按钮链接降级为 Releases 页面地址 |
| 未找到 `.exe` 资产 | 显示"暂无可用版本"，链接指向 Releases 页面 |
| API 速率限制（60次/小时/IP） | 缓存结果到 `localStorage`，设置 10 分钟过期 |
| 用户网络无法访问 GitHub | 提供备用下载镜像链接（如有） |

### 缓存策略参考

```javascript
const CACHE_KEY = 'portai_latest_release';
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

function getCachedRelease() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  const { data, timestamp } = JSON.parse(cached);
  if (Date.now() - timestamp > CACHE_TTL) {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
  return data;
}

function setCachedRelease(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({
    data,
    timestamp: Date.now()
  }));
}
```

---

## UI 显示建议

按钮附近可展示以下辅助信息：

- **版本号**：`v1.0.4`
- **文件大小**：格式化为 MB（`(size / 1024 / 1024).toFixed(1) + ' MB'`）
- **发布日期**：格式化 `published_at`
- **下载次数**：`download_count`（可作为社会证明）
- **系统要求**：Windows 10+ 64-bit

---

## 直接下载链接（静态备选）

如果不想调用 API，可以使用 GitHub 的 `latest` 重定向特性：

```
https://github.com/billye220670/AIShop/releases/latest/download/PortAI-Setup-1.0.4.exe
```

> ⚠️ 注意：此方式需要精确的文件名，每次发布新版本后文件名会变化（版本号不同），因此**不推荐**作为主要方案。但可以作为当 API 不可用时的降级链接模板。

---

## 注意事项

1. **GitHub API 速率限制**：未认证请求为 60 次/小时/IP，Landing Page 访问量大时应加缓存
2. **跨域**：GitHub API 支持 CORS，前端可直接调用，无需后端代理
3. **文件命名一致性**：electron-builder 自动以 `productName` + `Setup` + `version` 命名，只要不修改 `package.json` 中的 `productName: "PortAI"`，命名规则不会变
4. **多平台扩展**：当前仅构建 Windows 版本，未来若增加 macOS/Linux，需在 `assets` 中按后缀（`.dmg`、`.AppImage`）分别匹配
