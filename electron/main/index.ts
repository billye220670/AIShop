import { app, BrowserWindow, ipcMain, Menu, Tray, globalShortcut, session, nativeImage, protocol, net, dialog, shell } from 'electron';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, writeFile } from 'fs';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import * as settingsStore from './settingsStore';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let imagesDir = '';

function getIconPath(fileName: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'Icon', fileName);
  }
  return join(app.getAppPath(), 'Icon', fileName);
}

function createWindow() {
  // 移除默认菜单栏（File/Edit/View/Help）
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // 隐藏标题栏，保留原生窗口控制按钮（最小化/最大化/关闭）
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d0a1a',
      symbolColor: '#ffffff',
      height: 36,
    },
    backgroundColor: '#0d0a1a',
    icon: getIconPath('icon-256.png'),
  });

  // 开发模式加载 Vite dev server
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式加载打包后的文件
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // 注册 F12 / Ctrl+Shift+I 打开 DevTools
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    ) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  // 拦截关闭事件：最小化到托盘而非退出
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 注册设置相关 IPC handlers
function registerSettingsHandlers() {
  ipcMain.handle('settings:getProvider', (_event, category: string) => {
    return settingsStore.getProvider(category as keyof settingsStore.ProviderConfig);
  });

  ipcMain.handle('settings:setProvider', (_event, category: string, provider: string) => {
    settingsStore.setProvider(category as keyof settingsStore.ProviderConfig, provider);
    return true;
  });

  ipcMain.handle('settings:getApiKey', (_event, provider: string) => {
    return settingsStore.getApiKey(provider);
  });

  ipcMain.handle('settings:setApiKey', (_event, provider: string, key: string) => {
    settingsStore.setApiKey(provider, key);
    return true;
  });

  ipcMain.handle('settings:getAll', () => {
    const settings = settingsStore.getAllSettings();
    return settings;
  });

  // 图片生成：通过主进程 Node.js net.fetch 发起，绕过 CORS 和浏览器网络限制
  // GPT Image 2 生成通常需要 60-90 秒，超时设为 120 秒留足余量
  // 504 网关超时自动重试：最多 3 次请求（2 次重试），间隔 1s
  ipcMain.handle('image:generate', async (_event, url: string, body: string, apiKey: string) => {
    const MAX_ATTEMPTS = 3;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      try {
        const response = await net.fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        // 504 网关超时：可重试
        if (response.status === 504 && attempt < MAX_ATTEMPTS) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          return { error: true, status: response.status, body: text };
        }

        const data = await response.json();
        return { error: false, data };
      } catch (err: unknown) {
        clearTimeout(timeout);

        if (err instanceof Error && err.name === 'AbortError') {
          // 客户端超时也可重试
          if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          return { error: true, status: 408, body: JSON.stringify({ detail: '主进程请求超时(120s)，已重试仍失败，请稍后再试' }) };
        }

        // 非超时错误不重试，直接抛出
        throw err;
      }
    }
  });

  // 保存 Markdown 文件到本地（通过系统对话框选择路径）
  ipcMain.handle('file:save-markdown', async (_event, content: string, defaultName: string) => {
    if (!mainWindow) return { success: false, error: 'No active window' };
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存 Markdown 文件',
        defaultPath: defaultName,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      });
      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true };
      }
      return new Promise((resolve) => {
        writeFile(result.filePath!, content, 'utf-8', (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success: true, filePath: result.filePath });
          }
        });
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });

  // 保存图片到本地
  ipcMain.handle('image:save-local', async (_event, imageUrl: string, fileName: string) => {
    try {
      let buffer: Buffer;
      if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.split(',')[1] || '';
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        const resp = await net.fetch(imageUrl);
        if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
        buffer = Buffer.from(await resp.arrayBuffer());
      }
      const filePath = join(imagesDir, fileName);
      writeFileSync(filePath, buffer);
      return fileName;
    } catch (err) {
      console.error('Failed to save image locally:', err);
      return null;
    }
  });

  // 获取本地图片完整路径（供拖拽使用）
  ipcMain.handle('image:get-local-path', (_event, fileName: string) => {
    return join(imagesDir, fileName);
  });

  // 使用系统默认浏览器打开外部链接
  ipcMain.handle('open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // 更新标题栏颜色（主题切换时由渲染进程通知）
  ipcMain.handle('update-titlebar-color', (_event, bgColor: string, symbolColor: string) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.setTitleBarOverlay({
        color: bgColor,
        symbolColor: symbolColor,
      });
    }
  });

  // 图片原生拖拽到桌面：使用 sendSync / ipcMain.on 组合，在 dragstart 事件上下文
  // 仍然有效期间同步调用 event.sender.startDrag()。
  // 注意：sendSync 要求每条代码路径都必须设置 event.returnValue，否则渲染进程永久阻塞。

  // 拖拽缩略图缓存目录
  const dragThumbDir = join(imagesDir, '_drag_thumbs');
  if (!existsSync(dragThumbDir)) mkdirSync(dragThumbDir, { recursive: true });

  ipcMain.on('image:native-drag', (event, imageUrl: string) => {
    try {
      let filePath: string;

      if (imageUrl.startsWith('local-image://')) {
        const fileName = decodeURIComponent(imageUrl.replace('local-image://', ''));
        filePath = join(imagesDir, fileName);
      } else if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.split(',')[1] || '';
        const buffer = Buffer.from(base64Data, 'base64');
        const tempName = `drag_${Date.now()}.png`;
        filePath = join(imagesDir, tempName);
        writeFileSync(filePath, buffer);
      } else {
        console.warn('[Drag] Cannot drag HTTP URL synchronously:', imageUrl.slice(0, 80));
        event.returnValue = null;
        return;
      }

      if (!existsSync(filePath)) {
        console.warn('[Drag] File not found:', filePath);
        event.returnValue = null;
        return;
      }

      // 生成拖拽缩略图：用实际图片缩放到 200px 作为 drag visual
      const baseName = require('path').basename(filePath);
      const thumbPath = join(dragThumbDir, baseName);
      if (!existsSync(thumbPath)) {
        const fullImage = nativeImage.createFromPath(filePath);
        const thumb = fullImage.resize({ width: 200, quality: 'good' });
        writeFileSync(thumbPath, thumb.toPNG());
      }

      event.sender.startDrag({ file: filePath, icon: thumbPath });
    } catch (err) {
      console.error('[Drag] Native drag failed:', err);
    }
    event.returnValue = null;
  });
}

function createTrayIcon(): Electron.NativeImage {
  const iconPath = getIconPath('icon-32.png');
  if (existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  // Fallback: 尝试 16px 图标
  const fallbackPath = getIconPath('icon-16.png');
  if (existsSync(fallbackPath)) {
    return nativeImage.createFromPath(fallbackPath);
  }
  // 最终 fallback: 内嵌紫色 PNG
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAM0lEQVQ4T2P8////fwYKACMDFcCoAQzDxgWMjIz/GUYDkfhAxJFMRHIBIyMeF4wGIvEuAAC5Nw4R2GPOIAAAAABJRU5ErkJggg==';
  return nativeImage.createFromDataURL(`data:image/png;base64,${pngBase64}`);
}

function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('PortAI');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 点击托盘图标显示/聚焦窗口
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

app.whenReady().then(() => {
  // 图片本地缓存目录
  imagesDir = join(app.getPath('userData'), 'images');
  if (!existsSync(imagesDir)) mkdirSync(imagesDir, { recursive: true });

  // 注册自定义协议 local-image://
  protocol.handle('local-image', (request) => {
    const fileName = decodeURIComponent(request.url.replace('local-image://', ''));
    const filePath = join(imagesDir, fileName);
    return net.fetch(`file://${filePath}`);
  });

  // 绕过 CORS 限制：拦截 API 请求的响应头，添加跨域许可
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['access-control-allow-origin'] = ['*'];
    headers['access-control-allow-headers'] = ['*'];
    headers['access-control-allow-methods'] = ['GET, POST, PUT, DELETE, OPTIONS'];
    callback({ responseHeaders: headers });
  });

  registerSettingsHandlers();
  createWindow();
  createTray();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// ============ 自动更新 ============
function setupAutoUpdater() {
  autoUpdater.logger = console;
  autoUpdater.autoDownload = false;  // 不自动下载
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    // 发送版本号和 releaseNotes 给渲染进程
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,  // GitHub Release 的 body 内容
    });
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('[AutoUpdater] Update downloaded, installing...');
    autoUpdater.quitAndInstall();  // 用户已确认，直接安装重启
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err);
  });

  // 启动后延迟 3 秒检查更新，避免影响窗口加载
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3000);
}

// IPC: 渲染进程确认更新后开始下载
ipcMain.handle('app:start-download', async () => {
  await autoUpdater.downloadUpdate();
});

// IPC: 渲染进程手动检查更新
ipcMain.handle('app:check-update', () => {
  return autoUpdater.checkForUpdatesAndNotify();
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
