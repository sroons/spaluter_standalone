const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spaluterApi", {
  setParam: (key, value) => ipcRenderer.send("sc:set-param", { key, value }),
  // Phase 2.1: fire-and-forget single param (no Promise plumbing).
  setParamFast: (key, value) => ipcRenderer.send("sc:set-param-fast", { key, value }),
  // Phase 2.1: batched fire-and-forget. entries = [[key, value], ...]
  setParamMany: (entries) => ipcRenderer.send("sc:set-param-many", entries),
  // Phase 2.3 telemetry: report raw incoming MIDI event count so main can
  // compute (raw vs flushed) compression ratio.
  reportMidiRawCount: (count) => ipcRenderer.send("midi:raw-count", count),
  // Diagnostic: report MIDI note on/off events (and the resulting gate) so
  // main can log them to start.log for on-device troubleshooting.
  reportMidiNote: (info) => ipcRenderer.send("midi:note", info),
  // Diagnostic: report measured requestAnimationFrame FPS so main can log whether
  // the renderer is being occlusion-throttled.
  reportFps: (fps) => ipcRenderer.send("diag:fps", fps),
  // Internal LFO modulation control (fire-and-forget; config changes are
  // low-rate, human-driven, so no Promise round-trip is needed).
  setLfoCount: (n) => ipcRenderer.send("sc:lfo-count", n),
  setLfo: (idx, cfg) => ipcRenderer.send("sc:lfo-set", { idx, ...cfg }),
  setLfoMany: (list) => ipcRenderer.send("sc:lfo-set-many", list),
  clockSync: (pos, hz, reset) => ipcRenderer.send("sc:clock-sync", { pos, hz, reset }),
  retriggerLfos: () => ipcRenderer.send("sc:lfo-retrigger"),
  trigger: (action) => ipcRenderer.invoke("sc:trigger", action),
  setScope: (enabled, rate) => ipcRenderer.invoke("sc:set-scope", { enabled, rate }),
  // Mods-screen monitor stream: 16 LFO outputs + 20 mod-bus channels + beat position.
  setModScope: (enabled, rate) => ipcRenderer.invoke("sc:set-modscope", { enabled, rate }),
  listSamples: (dirPath) => ipcRenderer.invoke("samples:list", dirPath),
  loadSample: (samplePath) => ipcRenderer.invoke("samples:load", samplePath),
  getInitialState: () => ipcRenderer.invoke("sc:get-initial-state"),
  heartbeat: () => ipcRenderer.send("sc:heartbeat"),
  // Synthetic scope preview animation: ask main to start/stop the tick stream
  // and optionally set tick period (ms). Renderer-side timers are throttled on
  // the Pi kiosk, so the animation clock comes from main.
  setParamAnimActive: (active, tickMs) => ipcRenderer.send("paramAnim:active", { active, tickMs }),
  onParamAnimTick: (fn) => ipcRenderer.on("param-anim-tick", () => fn()),
  onStatus: (fn) => ipcRenderer.on("sc-status", (_e, msg) => fn(msg)),
  onCpuUsage: (fn) => ipcRenderer.on("app-cpu-usage", (_e, percent) => fn(percent)),
  // Engine load: scsynth /status avg/peak CPU + UGen/synth counts, 1 Hz.
  onDspCpu: (fn) => ipcRenderer.on("sc-cpu", (_e, info) => fn(info)),
  onLog: (fn) => ipcRenderer.on("sc-log", (_e, msg) => fn(msg)),
  onScope: (fn) => ipcRenderer.on("sc-scope", (_e, samples) => fn(samples)),
  onModScope: (fn) => ipcRenderer.on("sc-modscope", (_e, values) => fn(values))
});
