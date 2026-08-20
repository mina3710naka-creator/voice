const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("settingsBridge", {
  getState: () => ipcRenderer.invoke("settings:get"),
  save: (values) => ipcRenderer.invoke("settings:save", values),
  pickFile: (kind) => ipcRenderer.invoke("settings:pick-file", kind),
  close: () => ipcRenderer.send("settings:close"),
});
