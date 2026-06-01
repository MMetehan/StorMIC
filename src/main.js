const { app, BrowserWindow, ipcMain, desktopCapturer, session, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { autoUpdater } = require('electron-updater');

const tempDir = path.join(os.tmpdir(), 'stormic-files');
const tempFiles = new Set(); // uygulama kapanınca silinecek dosyalar

let mainWindow;
let pendingScreenShare = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    backgroundColor: '#111318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  // Güncelleme kontrolü (sadece paketlenmiş build'de çalışır, dev'de görmezden gelir)
  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(err => console.warn('[updater]', err.message));
  }
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    const cfg = pendingScreenShare;
    pendingScreenShare = null;
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
      const src = (cfg?.sourceId && sources.find(s => s.id === cfg.sourceId))
        || sources.find(s => s.id.startsWith('screen:'))
        || sources[0];
      const cbObj = { video: src };
      if (cfg?.audio && process.platform === 'win32') cbObj.audio = 'loopback';
      callback(cbObj);
    });
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── Otomatik güncelleme ───────────────────────────────────────
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-available', () => {
  mainWindow?.webContents.send('update-status', 'downloading');
});

autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('update-status', 'ready');
});

ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Pencere kontrolleri (frameless)
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// Ekran kaynağı listesi (pencere seçici için)
// BUG-30: getSources timeout yok — IPC asılı kalabilir; 8 sn timeout eklendi
ipcMain.handle('desktop-capturer-sources', async () => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('getSources timeout')), 8000)
  );
  const sources = await Promise.race([
    desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 280, height: 158 } }),
    timeout,
  ]);
  return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

// Renderer'ın seçtiği kaynak + ses ayarı
ipcMain.on('screen-share-config', (_, cfg) => {
  pendingScreenShare = cfg;
});

// Harici link (sistem tarayıcısında aç)
ipcMain.on('open-external', (_, url) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

// Geçici dosya yaz (uygulama kapanınca silinir)
ipcMain.handle('save-temp-file', async (_, { name, buffer }) => {
  try {
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, Buffer.from(buffer));
    tempFiles.add(filePath);
    return filePath;
  } catch { return null; }
});

// Kalıcı kaydet: kullanıcı kayıt yeri seçer
ipcMain.handle('save-file-dialog', async (_, { name, buffer }) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: name,
    buttonLabel: 'Kaydet',
  });
  if (canceled || !filePath) return false;
  try {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return true;
  } catch { return false; }
});

// Uygulama kapanınca temp dosyaları temizle
app.on('before-quit', () => {
  for (const f of tempFiles) {
    try { fs.unlinkSync(f); } catch {}
  }
  try { fs.rmdirSync(tempDir); } catch {}
});

// Link OG önizleme verisi çek

ipcMain.handle('fetch-og', async (_, rawUrl) => {
  if (!/^https?:\/\//i.test(rawUrl)) return null;
  try {
    const res = await fetch(rawUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StorMIC/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const getMeta = prop => {
      const a = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']{1,400})["']`, 'i'));
      const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']{1,400})["'][^>]+property=["']og:${prop}["']`, 'i'));
      return (a || b)?.[1]?.trim() || null;
    };
    const title    = getMeta('title') || html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() || null;
    const description = getMeta('description');
    const image    = getMeta('image');
    const siteName = getMeta('site_name');
    if (!title && !image) return null;
    return { title, description, image, siteName };
  } catch {
    return null;
  }
});
