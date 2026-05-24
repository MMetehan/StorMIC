const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  minimize:  () => ipcRenderer.send('window-minimize'),
  maximize:  () => ipcRenderer.send('window-maximize'),
  close:     () => ipcRenderer.send('window-close'),
  signalUrl: process.env.STORMIC_SIGNAL_URL || '',
  getSources:          ()    => ipcRenderer.invoke('desktop-capturer-sources'),
  setScreenShareConfig: cfg  => ipcRenderer.send('screen-share-config', cfg),
});
