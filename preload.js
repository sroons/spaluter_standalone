const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spaluterApi", {
  setParam: (key, value) => ipcRenderer.invoke("sc:set-param", { key, value }),
  // Phase 2.1: fire-and-forget single param (no Promise plumbing).
  setParamFast: (key, value) => ipcRenderer.send("sc:set-param-fast", { key, value }),
  // Phase 2.1: batched fire-and-forget. entries = [[key, value], ...]
  setParamMany: (entries) => ipcRenderer.send("sc:set-param-many", entries),
  // Phase 2.3 telemetry: report raw incoming MIDI event count so main can
  // compute (raw vs flushed) compression ratio.
  reportMidiRawCount: (count) => ipcRenderer.send("midi:raw-count", count),
  // Internal LFO modulation control (fire-and-forget; config changes are
  // low-rate, human-driven, so no Promise round-trip is needed).
  setLfoCount: (n) => ipcRenderer.send("sc:lfo-count", n),
  setLfo: (idx, cfg) => ipcRenderer.send("sc:lfo-set", { idx, ...cfg }),
  setLfoMany: (list) => ipcRenderer.send("sc:lfo-set-many", list),
  trigger: (action) => ipcRenderer.invoke("sc:trigger", action),
  setScope: (enabled, rate) => ipcRenderer.invoke("sc:set-scope", { enabled, rate }),
  listSamples: (dirPath) => ipcRenderer.invoke("samples:list", dirPath),
  loadSample: (samplePath) => ipcRenderer.invoke("samples:load", samplePath),
  getInitialState: () => ipcRenderer.invoke("sc:get-initial-state"),
  heartbeat: () => ipcRenderer.send("sc:heartbeat"),
  onStatus: (fn) => ipcRenderer.on("sc-status", (_e, msg) => fn(msg)),
  onCpuUsage: (fn) => ipcRenderer.on("app-cpu-usage", (_e, percent) => fn(percent)),
  onLog: (fn) => ipcRenderer.on("sc-log", (_e, msg) => fn(msg)),
  onScope: (fn) => ipcRenderer.on("sc-scope", (_e, samples) => fn(samples))
});
