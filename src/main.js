const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');

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

// Pencere kontrolleri (frameless)
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// Ekran kaynağı listesi (pencere seçici için)
ipcMain.handle('desktop-capturer-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 280, height: 158 },
  });
  return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }));
});

// Renderer'ın seçtiği kaynak + ses ayarı
ipcMain.on('screen-share-config', (_, cfg) => {
  pendingScreenShare = cfg;
});
