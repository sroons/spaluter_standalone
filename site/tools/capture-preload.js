// Stand-in for preload.js used only by capture-screenshots.js: the real UI
// loads with a silent, fake engine so screenshots need no SuperCollider.
const listeners = {};
const on = (name) => (fn) => { listeners[name] = fn; };
const noop = () => {};
window.__capture = { listeners };
window.spaluterApi = {
  setParam: noop, setParamFast: noop, setParamMany: noop,
  reportMidiRawCount: noop, reportMidiNote: noop, reportFps: noop,
  setLfoCount: noop, setLfo: noop, setLfoMany: noop, clockSync: noop,
  retriggerLfos: noop, heartbeat: noop, setParamAnimActive: noop,
  trigger: () => Promise.resolve(true),
  setScope: () => Promise.resolve(true),
  setModScope: () => Promise.resolve(true),
  listSamples: () => Promise.resolve({ ok: true, dir: "/spaluter/samples/", files: [] }),
  loadSample: () => Promise.resolve(true),
  getInitialState: () => Promise.resolve({ status: "Synth started", logs: [], sampleDefaultDir: "/spaluter/samples/" }),
  onParamAnimTick: on("tick"), onStatus: on("status"), onCpuUsage: on("cpu"),
  onDspCpu: on("dsp"), onLog: on("log"), onScope: on("scope"), onModScope: on("modscope")
};
