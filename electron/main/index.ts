import { app, BrowserWindow, ipcMain, Menu, globalShortcut, session } from 'electron';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import * as settingsStore from './settingsStore';

let mainWindow: BrowserWindow | null = null;

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
    return settingsStore.getAllSettings();
  });

  // 图片生成：通过主进程 Node.js fetch 发起，绕过 CORS 和浏览器网络限制
  ipcMain.handle('image:generate', async (_event, url: string, body: string, apiKey: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text();
      return { error: true, status: response.status, body: text };
    }

    const data = await response.json();
    return { error: false, data };
  });

  // 图片拖拽到桌面：下载图片到临时文件后启动原生拖拽
  const dragCacheDir = join(tmpdir(), 'aishop-drag-cache');
  if (!existsSync(dragCacheDir)) mkdirSync(dragCacheDir, { recursive: true });

  ipcMain.on('image:native-drag', async (event, imageUrl: string, fileName: string) => {
    try {
      let buffer: Buffer;

      if (imageUrl.startsWith('data:')) {
        // data URI → 解码 base64
        const base64Data = imageUrl.split(',')[1] || '';
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        // 远程 URL → 下载
        const resp = await fetch(imageUrl);
        if (!resp.ok) return;
        const arrayBuf = await resp.arrayBuffer();
        buffer = Buffer.from(arrayBuf);
      }

      const tempPath = join(dragCacheDir, fileName);
      writeFileSync(tempPath, buffer);

      event.sender.startDrag({
        file: tempPath,
        icon: tempPath,
      });
    } catch (err) {
      console.error('Native drag failed:', err);
    }
  });
}

app.whenReady().then(() => {
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
