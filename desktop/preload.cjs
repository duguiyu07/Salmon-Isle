const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('salmonDesktop',Object.freeze({
  connectSite:input=>ipcRenderer.invoke('salmon:connect-site',input),
  disconnectSite:()=>ipcRenderer.invoke('salmon:disconnect-site'),
  chooseDirectory:()=>ipcRenderer.invoke('salmon:choose-directory'),
  defaultDirectory:()=>ipcRenderer.invoke('salmon:default-directory'),
  readRecovery:()=>ipcRenderer.invoke('salmon:read-recovery'),
  writeRecovery:value=>ipcRenderer.invoke('salmon:write-recovery',value),
  clearRecovery:()=>ipcRenderer.invoke('salmon:clear-recovery'),
  updateStatus:()=>ipcRenderer.invoke('salmon:update-status'),
  checkUpdate:url=>ipcRenderer.invoke('salmon:update-check',url),
  downloadUpdate:()=>ipcRenderer.invoke('salmon:update-download'),
  installUpdate:()=>ipcRenderer.invoke('salmon:update-install')
}));
