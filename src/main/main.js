import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, session } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..', '..');
const IS_TEST = process.env.SOUND_FOSSIL_TEST === '1';

if (process.env.SOUND_FOSSIL_FAKE_MIC === '1') {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
}

app.setName('Sound Fossil');
app.setAppUserModelId('com.soundfossil.studio');
nativeTheme.themeSource = 'dark';

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0a0908',
    show: false,
    title: 'Sound Fossil',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0908',
      symbolColor: '#d9cbb4',
      height: 58,
    },
    icon: path.join(APP_ROOT, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });

  mainWindow.loadFile(path.join(APP_ROOT, 'dist', 'renderer', 'index.html'));

  if (IS_TEST) {
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.log(`[renderer:${level}] ${message}`);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function isTrustedWebContents(webContents) {
  return mainWindow && webContents === mainWindow.webContents;
}

function configurePermissions() {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (!isTrustedWebContents(webContents)) {
      callback(false);
      return;
    }
    if (permission === 'media') {
      const types = details?.mediaTypes;
      callback(!Array.isArray(types) || types.length === 0 || types.includes('audio'));
      return;
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (!isTrustedWebContents(webContents)) return false;
    if (permission === 'media') {
      return details?.mediaType === 'audio' || details?.mediaType === undefined;
    }
    return false;
  });
}

function sanitizePngName(value) {
  const fallback = 'sound-fossil.png';
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!cleaned) return fallback;
  return cleaned.toLowerCase().endsWith('.png') ? cleaned : `${cleaned}.png`;
}

ipcMain.handle('save-png', async (event, payload) => {
  if (!isTrustedWebContents(event.sender)) {
    return { saved: false, error: 'Unauthorized request.' };
  }
  const dataUrl = payload?.dataUrl;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    return { saved: false, error: 'Invalid PNG data.' };
  }
  if (dataUrl.length > 45 * 1024 * 1024) {
    return { saved: false, error: 'The PNG image is larger than expected.' };
  }

  let buffer;
  try {
    buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  } catch {
    return { saved: false, error: 'The PNG data could not be decoded.' };
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature)) {
    return { saved: false, error: 'The PNG signature could not be verified.' };
  }

  const filename = sanitizePngName(payload?.filename);
  let targetPath = process.env.SOUND_FOSSIL_EXPORT_PATH || '';

  if (!targetPath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save fossil as PNG',
      defaultPath: path.join(app.getPath('pictures'), filename),
      filters: [{ name: 'PNG image', extensions: ['png'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false, canceled: true };
    }
    targetPath = result.filePath;
  }

  targetPath = path.resolve(targetPath);
  try {
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, buffer);
    return { saved: true, path: targetPath, bytes: buffer.length };
  } catch (error) {
    return { saved: false, error: `The file could not be written: ${error.message}` };
  }
});

ipcMain.handle('app-info', (event) => {
  if (!isTrustedWebContents(event.sender)) return null;
  return {
    name: 'Sound Fossil',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    testMode: IS_TEST,
  };
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  configurePermissions();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
