const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  minimize:  () => ipcRenderer.send('window-minimize'),
  maximize:  () => ipcRenderer.send('window-maximize'),
  close:     () => ipcRenderer.send('window-close'),
  signalUrl: process.env.STORMIC_SIGNAL_URL || '',
  getSources:           ()    => ipcRenderer.invoke('desktop-capturer-sources'),
  setScreenShareConfig: cfg   => ipcRenderer.send('screen-share-config', cfg),
  installUpdate:        ()    => ipcRenderer.send('install-update'),
  onUpdateStatus:       (cb)  => ipcRenderer.on('update-status', (_, status) => cb(status)),
  openExternal:         (url) => ipcRenderer.send('open-external', url),
  fetchOg:              (url) => ipcRenderer.invoke('fetch-og', url),
  saveTempFile:         (name, buffer) => ipcRenderer.invoke('save-temp-file', { name, buffer }),
  saveFileDialog:       (name, buffer) => ipcRenderer.invoke('save-file-dialog', { name, buffer }),
});
