const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recorderBridge", {
  onStart: (callback) => ipcRenderer.on("rec:start", () => callback()),
  onStop: (callback) => ipcRenderer.on("rec:stop", () => callback()),
  sendData: (arrayBuffer) => ipcRenderer.send("rec:data", arrayBuffer),
  sendError: (message) => ipcRenderer.send("rec:error", message),
});
