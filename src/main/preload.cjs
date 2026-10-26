const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundFossil', {
  savePng: (dataUrl, filename) => ipcRenderer.invoke('save-png', { dataUrl, filename }),
  appInfo: () => ipcRenderer.invoke('app-info'),
});
