import { app, BrowserWindow, ipcMain, Menu, Tray, session, nativeImage, protocol, net, shell } from 'electron';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

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

  // 注册 F12 / Ctrl+Shift+I 打开 DevTools；Escape 转发给渲染进程
  // （焦点在 iframe 内部时页面收不到键盘事件，before-input-event 在主进程
  //  派发输入前捕获，任何焦点位置都有效）
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (
      input.key === 'F12' ||
      (input.control && input.shift && input.key.toLowerCase() === 'i')
    ) {
      mainWindow?.webContents.toggleDevTools();
    } else if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow?.webContents.send('app:escape');
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

// 注册外壳相关 IPC handlers
function registerShellHandlers() {
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

  registerShellHandlers();
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
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    mainWindow?.webContents.send('update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    mainWindow?.webContents.send('update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err);
  });

  // 启动后延迟 3 秒检查更新，避免影响窗口加载
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 3000);
}

// IPC: 渲染进程触发安装更新
ipcMain.handle('app:install-update', () => {
  autoUpdater.quitAndInstall();
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
