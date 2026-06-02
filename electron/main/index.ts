import { app, BrowserWindow, ipcMain, Menu, globalShortcut, session, nativeImage, protocol, net } from 'electron';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import * as settingsStore from './settingsStore';

let mainWindow: BrowserWindow | null = null;
let imagesDir = '';

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

  // 保存图片到本地
  ipcMain.handle('image:save-local', async (_event, imageUrl: string, fileName: string) => {
    try {
      let buffer: Buffer;
      if (imageUrl.startsWith('data:')) {
        const base64Data = imageUrl.split(',')[1] || '';
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        const resp = await fetch(imageUrl);
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

  // 图片原生拖拽到桌面
  ipcMain.on('image:native-drag', (event, localPath: string, fileName: string) => {
    try {
      if (!existsSync(localPath)) return;
      const buffer = readFileSync(localPath);
      const icon = nativeImage.createFromBuffer(buffer).resize({ width: 128, height: 128 });
      event.sender.startDrag({ file: localPath, icon });
    } catch (err) {
      console.error('Native drag failed:', err);
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
