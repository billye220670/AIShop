import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import * as settingsStore from './settingsStore';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    // 无边框窗口可选，暂时用默认
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
  });

  // 开发模式加载 Vite dev server
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    // 生产模式加载打包后的文件
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

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
}

app.whenReady().then(() => {
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
