const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spaluterApi", {
  setParam: (key, value) => ipcRenderer.invoke("sc:set-param", { key, value }),
  trigger: (action) => ipcRenderer.invoke("sc:trigger", action),
  setScope: (enabled, rate) => ipcRenderer.invoke("sc:set-scope", { enabled, rate }),
  listSamples: (dirPath) => ipcRenderer.invoke("samples:list", dirPath),
  loadSample: (samplePath) => ipcRenderer.invoke("samples:load", samplePath),
  getInitialState: () => ipcRenderer.invoke("sc:get-initial-state"),
  onStatus: (fn) => ipcRenderer.on("sc-status", (_e, msg) => fn(msg)),
  onLog: (fn) => ipcRenderer.on("sc-log", (_e, msg) => fn(msg)),
  onScope: (fn) => ipcRenderer.on("sc-scope", (_e, samples) => fn(samples))
});
