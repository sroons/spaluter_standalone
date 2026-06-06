const statusEl = document.getElementById("status");
const cpuUsageEl = document.getElementById("cpuUsage");
const logEl = document.getElementById("log");
const logDrawerEl = document.getElementById("logDrawer");
const toggleLogBtn = document.getElementById("toggleLog");
const closeLogBtn = document.getElementById("closeLog");
const aboutDrawerEl = document.getElementById("aboutDrawer");
const toggleAboutBtn = document.getElementById("toggleAbout");
const closeAboutBtn = document.getElementById("closeAbout");
const presetSlotEl = document.getElementById("presetSlot");
const presetNameEl = document.getElementById("presetName");
const savePresetBtn = document.getElementById("savePreset");
const loadPresetBtn = document.getElementById("loadPreset");
const sampleDirectoryEl = document.getElementById("sampleDirectory");
const sampleFileEl = document.getElementById("sampleFile");
const refreshSamplesBtn = document.getElementById("refreshSamples");
const loadSampleBtn = document.getElementById("loadSample");
const synthToggleBtn = document.getElementById("synthToggle");
const outputScopeCanvas = document.getElementById("outputScopeView");
const pulsaretWaveCanvas = document.getElementById("pulsaretWaveView");
const windowWaveCanvas = document.getElementById("windowWaveView");
const dutyWaveCanvas = document.getElementById("dutyWaveView");
const formantWaveCanvas = document.getElementById("formantWaveView");
const formantActivityCanvas = document.getElementById("formantActivityView");
const maskScopeCanvas = document.getElementById("maskScopeView");
const outputScopeLabelEl = document.getElementById("outputScopeLabel");
const pulsaretWaveLabelEl = document.getElementById("pulsaretWaveLabel");
const windowWaveLabelEl = document.getElementById("windowWaveLabel");
const dutyWaveLabelEl = document.getElementById("dutyWaveLabel");
const formantWaveLabelEl = document.getElementById("formantWaveLabel");
const formantActivityLabelEl = document.getElementById("formantActivityLabel");
const maskScopeLabelEl = document.getElementById("maskScopeLabel");
const mainScreenSwitchEl = document.getElementById("mainScreenSwitch");
const mainScreenStageEl = document.getElementById("mainScreenStage");
const mainScreenButtons = Array.from(document.querySelectorAll(".main-screen-btn[data-view-index]"));
const mainScreenPanels = Array.from(document.querySelectorAll(".main-screen[data-screen]"));
const paramValueGridEl = document.getElementById("paramValueGrid");
const paramPagePrevBtn = document.getElementById("paramPagePrev");
const paramPageNextBtn = document.getElementById("paramPageNext");
const paramPageIndicatorEl = document.getElementById("paramPageIndicator");
const knobs = Array.from(document.querySelectorAll(".knob[data-param]"));
const rangeInputs = Array.from(document.querySelectorAll('input[data-param][type="range"]'));
const selectInputs = Array.from(document.querySelectorAll("select[data-param]"));
const knobByParam = new Map(knobs.map((knob) => [knob.dataset.param, knob]));
const rangeByParam = new Map(rangeInputs.map((input) => [input.dataset.param, input]));
const selectByParam = new Map(selectInputs.map((input) => [input.dataset.param, input]));
const knobVisualByParam = new Map(knobs.map((knob) => [
  knob.dataset.param,
  {
    pointer: knob.querySelector(".knob-pointer"),
    valueEl: knob.parentElement?.querySelector(".knob-value")
  }
]));

const PRESET_COUNT = 32;
const PRESET_STORAGE_KEY = "spaluter-presets-v1";
const MIDI_MAP_STORAGE_KEY = "spaluter-midi-map-v1";
const DEFAULT_SAMPLE_DIR = navigator.platform.toLowerCase().startsWith("win")
  ? "C:\\Users\\Public\\Music"
  : "/spaluter/samples/";
const LOG_LINE_LIMIT = 400;
const RESIZE_DEBOUNCE_MS = 120;
const MIN_SCOPE_RATE_HZ = 2;
const ACTIVE_SCOPE_RATE_HZ = 20;
const MAIN_SCREENS = ["scopes", "parameters"];
const SCREEN_SLIDE_MS = 240;
const SWIPE_MIN_DISTANCE_PX = 60;
const SWIPE_MAX_OFF_AXIS_PX = 45;
const SWIPE_MAX_DURATION_MS = 700;
const MIDI_REBIND_DEBOUNCE_MS = 120;
const MIDI_STATE_LOG_MIN_INTERVAL_MS = 250;
const RENDERER_HEARTBEAT_MS = 1000;
let sampleDefaultDir = DEFAULT_SAMPLE_DIR;
let currentSamplePath = "";
let midiAccess = null;
let midiMappings = {};
let midiParamsByCc = new Map();
let activeMidiNotes = [];
let synthRunning = false;
let waveformLayoutDirty = true;
let resizeDebounceTimer = null;
let midiRebindTimer = null;
let rendererHeartbeatTimer = null;
let activeKnobDrag = null;
let logLineCount = 0;
let scopeStreamingEnabled = true;
let currentMainScreen = "scopes";
let currentViewIndex = 0;
let screenTransitionTimer = null;
let screenTransitionToken = 0;
let currentParamPage = 0;
let lastMidiInputCount = -1;
let lastMidiStateLogAt = 0;
let lastMidiStateKey = "";
const controlMetaByParam = new Map();
const paramValueElByParam = new Map();
const paramSliderByParam = new Map();
const canvasMetricsByElement = new WeakMap();
const allParamNames = Array.from(new Set([
  ...knobByParam.keys(),
  ...rangeByParam.keys(),
  ...selectByParam.keys()
]));
const PARAM_PAGE_DEFINITIONS = Object.freeze([
  {
    title: "Core",
    params: ["amp", "drive", "pulsaret", "window", "duty", "dutyMode"]
  },
  {
    title: "Formants",
    params: ["formantCount", "formantTrack", "formant1", "formant2", "formant3"]
  },
  {
    title: "Stereo / Mask",
    params: ["pan1", "pan2", "pan3", "maskMode", "perFormantMask", "maskAmount"]
  },
  {
    title: "Texture",
    params: ["ampJitter", "timingJitter", "glisson", "burstOn", "burstOff"]
  },
  {
    title: "Voice",
    params: ["gateMode", "voiceCount", "chordType", "basePitch", "attackMs", "releaseMs", "glideMs"]
  },
  {
    title: "Sample",
    params: ["useSample", "sampleRate"]
  }
]);

function buildParameterPages() {
  const availableParams = new Set(allParamNames);
  const seen = new Set();
  const pages = PARAM_PAGE_DEFINITIONS
    .map((page) => {
      const pageParams = page.params.filter((param) => availableParams.has(param) && !seen.has(param));
      pageParams.forEach((param) => seen.add(param));
      return { title: page.title, params: pageParams };
    })
    .filter((page) => page.params.length > 0);

  const ungroupedParams = allParamNames.filter((param) => !seen.has(param));
  if (ungroupedParams.length > 0) {
    pages.push({ title: "Other", params: ungroupedParams });
  }

  return pages.length > 0 ? pages : [{ title: "Parameters", params: allParamNames.slice() }];
}

const PARAM_PAGES = buildParameterPages();
const MAIN_VIEW_COUNT = 1 + PARAM_PAGES.length;
const midiUiByParam = new Map();
// Phase 1.1: per-param last-sent value so we can early-out on no-op set-events
// (CCs at rest re-send the same 7-bit value many times/sec).
const lastSentValueByParam = new Map();
// Phase 1.2: dirty flag + rAF token for waveform redraws so we coalesce
// per-event redraws to at most one per animation frame.
let waveformViewsDirty = false;
let waveformViewsRafId = 0;
// Phase 2.3b: pending CC stream as an ordered array of [param, value] tuples.
// We preserve EVERY value (no per-param coalescing) so the synth receives the
// full resolution of the incoming MIDI stream. Batching is done at the
// event-loop tick boundary via a microtask, which groups events that arrived
// together in the same Web MIDI burst into a single fire-and-forget IPC, but
// does not throttle to the renderer's vsync cadence.
const pendingCcEvents = [];
let ccDrainScheduled = false;
// Phase 2.3: count raw incoming MIDI events between IPC reports so the
// main process can derive raw-vs-flushed compression. We coalesce the
// report to the same animation frame so the counter itself doesn't add
// per-event IPC traffic.
let midiRawCountWindow = 0;
let midiRawReportRafId = 0;
const PREFERRED_MIDI_CC_BY_PARAM = Object.freeze({
  amp: 7,
  drive: 71,
  pulsaret: 20,
  window: 21,
  duty: 22,
  dutyMode: 23,
  formantCount: 24,
  formantTrack: 25,
  formant1: 26,
  formant2: 27,
  formant3: 28,
  pan1: 29,
  pan2: 30,
  pan3: 31,
  maskMode: 32,
  perFormantMask: 33,
  maskAmount: 34,
  ampJitter: 35,
  timingJitter: 36,
  glisson: 37,
  burstOn: 38,
  burstOff: 39,
  gateMode: 40,
  voiceCount: 41,
  chordType: 42,
  basePitch: 43,
  attackMs: 44,
  releaseMs: 45,
  glideMs: 46,
  useSample: 47,
  sampleRate: 48
});
const PULSARET_WAVE_NAMES = [
  "sine",
  "sine x2",
  "sine x3",
  "sinc",
  "triangle",
  "saw",
  "square",
  "formant-ish",
  "pulse",
  "noise"
];
const WINDOW_WAVE_NAMES = [
  "rectangular",
  "gaussian",
  "hann",
  "exp decay",
  "linear decay",
  "tukey",
  "blackman-harris",
  "reverse exp",
  "triangle"
];
const TWO_PI = Math.PI * 2;
const OUTPUT_SCOPE_FRAME_SIZE = 96;
const OUTPUT_SCOPE_SMOOTHING_ALPHA = 0.35;
const OUTPUT_SCOPE_ZERO_CROSSING_MIN_SLOPE = 0.02;
const FORMANT_SCOPE_COLORS = ["rgb(235, 110, 79)", "rgb(114, 213, 142)", "rgb(199, 146, 234)"];
const MASK_MODE_NAMES = ["Off", "Stochastic", "Burst"];
const MIDI_STATUS_TYPE_MASK = 0xF0;
const MIDI_STATUS_NOTE_OFF = 0x80;
const MIDI_STATUS_NOTE_ON = 0x90;
const MIDI_STATUS_CC = 0xB0;
const scopeSampleBuffer = new Float64Array(OUTPUT_SCOPE_FRAME_SIZE);
const scopeAlignedBuffer = Array.from({ length: OUTPUT_SCOPE_FRAME_SIZE }, () => 0);
const scopeRenderBuffer = Array.from({ length: OUTPUT_SCOPE_FRAME_SIZE }, () => 0);
let outputScopeSamples = Array.from({ length: OUTPUT_SCOPE_FRAME_SIZE }, () => 0);

function appendLogLine(line) {
  if (!logEl) return;
  logEl.appendChild(document.createTextNode(`${line}\n`));
  logLineCount += 1;
  while (logLineCount > LOG_LINE_LIMIT && logEl.firstChild) {
    logEl.removeChild(logEl.firstChild);
    logLineCount -= 1;
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function resetLog(lines = []) {
  if (!logEl) return;
  logEl.textContent = "";
  logLineCount = 0;
  lines.forEach((line) => appendLogLine(line));
}

function appendLog(text) {
  appendLogLine(String(text ?? ""));
}

function setStatusState(state) {
  if (!statusEl) return;
  statusEl.classList.remove("status-starting", "status-ok", "status-error", "status-stopped");
  statusEl.classList.add(`status-${state}`);
}

function classifyStatus(text) {
  const s = String(text || "").toLowerCase();
  if (/(synth stopped|stopped by user|manual stop)/.test(s)) return "stopped";
  if (/(error|failed|not found|exited|missing)/.test(s)) return "error";
  if (/(synth started|runtime ready)/.test(s)) return "ok";
  if (/(starting|boot|waiting|listening|stopping|quitting)/.test(s)) return "starting";
  return "ok";
}

function setCpuUsage(percent) {
  if (!cpuUsageEl) return;
  const numeric = Number(percent);
  const safeValue = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  cpuUsageEl.textContent = `CPU: ${safeValue.toFixed(1)}%`;
}

function renderSynthToggle() {
  if (!synthToggleBtn) return;
  synthToggleBtn.dataset.action = synthRunning ? "stop" : "start";
  synthToggleBtn.textContent = synthRunning ? "Stop Synth" : "Start Synth";
  synthToggleBtn.setAttribute("aria-pressed", String(synthRunning));
}

function updateSynthRunningFromStatus(text) {
  const s = String(text || "").toLowerCase();
  if (/synth started/.test(s)) {
    synthRunning = true;
    renderSynthToggle();
    return;
  }
  if (/(synth stopped|stopped by user|manual stop)/.test(s)) {
    synthRunning = false;
    renderSynthToggle();
  }
}

function setLogOpen(open) {
  if (!logDrawerEl || !toggleLogBtn) return;
  logDrawerEl.classList.toggle("closed", !open);
  toggleLogBtn.textContent = open ? "Hide Log" : "Show Log";
  toggleLogBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    window.requestAnimationFrame(() => {
      logDrawerEl.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  }
}

function setAboutOpen(open) {
  if (!aboutDrawerEl || !toggleAboutBtn) return;
  aboutDrawerEl.classList.toggle("closed", !open);
  toggleAboutBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    window.requestAnimationFrame(() => {
      aboutDrawerEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function quantize(v, step) {
  return Math.round(v / step) * step;
}

function formatParamName(param) {
  return String(param || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function decimalsFromStep(step, fallback = 2) {
  if (!Number.isFinite(step) || step <= 0) return fallback;
  const text = String(step);
  if (!text.includes(".")) return 0;
  return Math.min(4, text.length - text.indexOf(".") - 1);
}

function knobAngleFromValue(v, min, max) {
  const t = (v - min) / (max - min);
  return -135 + (t * 270);
}

function updateRangeLabel(rangeEl, value) {
  const label = rangeEl.previousElementSibling;
  if (!label) return;
  label.textContent = `${label.textContent.split(":")[0]}: ${value}`;
}

function setKnobVisual(knob, value) {
  const param = knob?.dataset?.param;
  const visual = param ? knobVisualByParam.get(param) : null;
  const pointer = visual?.pointer || null;
  const valueEl = visual?.valueEl || null;
  const min = Number(knob.dataset.min);
  const max = Number(knob.dataset.max);
  const angle = knobAngleFromValue(value, min, max);
  if (pointer) pointer.style.transform = `translateX(-50%) rotate(${angle}deg)`;
  if (valueEl) valueEl.textContent = value.toFixed(2);
}

function hashUnit(seed) {
  const x = Math.sin((seed * 12.9898) + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function pulsaretWaveSample(index, t) {
  const phase = clamp(t, 0, 1);
  const x = phase * TWO_PI;
  switch (index) {
    case 0: return Math.sin(x);
    case 1: return Math.sin(x * 2);
    case 2: return Math.sin(x * 3);
    case 3: {
      const sx = (phase - 0.5) * (8 * Math.PI);
      return Math.abs(sx) < 0.0001 ? 1 : Math.sin(sx) / sx;
    }
    case 4: return clamp(1 - (4 * Math.abs(phase - 0.5)), -1, 1);
    case 5: return (phase * 2) - 1;
    case 6: return phase < 0.5 ? 1 : -1;
    case 7: return Math.sin(x * 3) * Math.exp(-(phase * 3));
    case 8: return (Math.exp(-Math.pow((phase - 0.5) * 20, 2)) * 2) - 1;
    case 9: return (hashUnit(Math.floor(phase * 96) + 1234.567) * 2) - 1;
    default: return 0;
  }
}

function windowWaveSample(index, t) {
  const phase = clamp(t, 0, 1);
  switch (index) {
    case 0: return 1;
    case 1: return Math.exp(-Math.pow((phase - 0.5) / 0.3, 2) * 0.5);
    case 2: return 0.5 * (1 - Math.cos(TWO_PI * phase));
    case 3: return Math.exp(-(phase * 4));
    case 4: return 1 - phase;
    case 5: {
      const a = 0.5;
      if (phase < (a * 0.5)) return 0.5 * (1 - Math.cos((TWO_PI * phase) / a));
      if (phase > (1 - (a * 0.5))) return 0.5 * (1 - Math.cos((TWO_PI * (1 - phase)) / a));
      return 1;
    }
    case 6:
      return 0.35875
        - (0.48829 * Math.cos(TWO_PI * phase))
        + (0.14128 * Math.cos(2 * TWO_PI * phase))
        - (0.01168 * Math.cos(3 * TWO_PI * phase));
    case 7: return Math.exp(-((1 - phase) * 4));
    case 8: return clamp(1 - (2 * Math.abs(phase - 0.5)), 0, 1);
    default: return 0;
  }
}

function interpolatedWaveSample(value, maxIndex, sampleByIndex, t) {
  const clampedValue = clamp(Number(value), 0, maxIndex);
  const lo = Math.floor(clampedValue);
  const hi = Math.min(maxIndex, lo + 1);
  const mix = clampedValue - lo;
  return (sampleByIndex(lo, t) * (1 - mix)) + (sampleByIndex(hi, t) * mix);
}

function interpolatedWaveLabel(value, names) {
  const maxIndex = names.length - 1;
  const clampedValue = clamp(Number(value), 0, maxIndex);
  const lo = Math.floor(clampedValue);
  const hi = Math.min(maxIndex, lo + 1);
  if (lo === hi) return names[lo];
  return `${names[lo]} <-> ${names[hi]}`;
}

function currentParamValue(param, fallback = 0) {
  const knob = knobByParam.get(param);
  if (knob) return Number(knob.dataset.value ?? fallback);
  const range = rangeByParam.get(param);
  if (range) return Number(range.value ?? fallback);
  const select = selectByParam.get(param);
  if (select) return Number(select.value ?? fallback);
  return fallback;
}

function measureCanvasMetrics(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, Math.round(canvas.clientWidth || Number(canvas.getAttribute("width")) || 320));
  const cssHeight = Math.max(1, Math.round(canvas.clientHeight || Number(canvas.getAttribute("height")) || 84));
  const drawWidth = Math.max(1, Math.round(cssWidth * dpr));
  const drawHeight = Math.max(1, Math.round(cssHeight * dpr));
  const metrics = {
    dpr,
    drawWidth,
    drawHeight,
    leftPad: 4 * dpr,
    rightPad: drawWidth - (4 * dpr),
    topPad: 6 * dpr,
    bottomPad: drawHeight - (6 * dpr)
  };
  canvasMetricsByElement.set(canvas, metrics);
  waveformLayoutDirty = false;
  return metrics;
}

function getCanvasMetrics(canvas) {
  const cached = canvasMetricsByElement.get(canvas);
  const dpr = window.devicePixelRatio || 1;
  if (cached && !waveformLayoutDirty && cached.dpr === dpr) return cached;
  return measureCanvasMetrics(canvas);
}

function drawWaveform(canvas, sampleFn, minValue = -1, maxValue = 1) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;

  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(169, 180, 208, 0.35)";
  ctx.beginPath();
  const centerY = drawHeight * 0.5;
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();

  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const range = maxValue - minValue || 1;

  ctx.strokeStyle = "rgb(91, 169, 246)";
  ctx.beginPath();
  const samples = Math.max(48, Math.floor(drawWidth / 2));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const sample = sampleFn(t);
    const normalized = clamp((sample - minValue) / range, 0, 1);
    const x = leftPad + (t * usableWidth);
    const y = topPad + ((1 - normalized) * usableHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawScopeFromSamples(canvas, samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    drawWaveform(canvas, () => 0, -1, 1);
    return;
  }
  const values = samples;
  drawWaveform(canvas, (t) => {
    const idx = t * (values.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(values.length - 1, lo + 1);
    const mix = idx - lo;
    return (values[lo] * (1 - mix)) + (values[hi] * mix);
  }, -1, 1);
}

function drawFormantWaves(canvas, formantHzValues, activeCount) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;

  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(169, 180, 208, 0.3)";
  ctx.beginPath();
  const centerY = drawHeight * 0.5;
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();

  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const samples = Math.max(48, Math.floor(drawWidth / 2));

  for (let formantIndex = 0; formantIndex < activeCount; formantIndex += 1) {
    const hz = clamp(Number(formantHzValues[formantIndex]) || 20, 20, 8000);
    const cycles = clamp(Math.log2((hz / 20) + 1), 0.5, 6.5);
    const amplitude = clamp(0.9 - (formantIndex * 0.12), 0.4, 0.95);
    ctx.strokeStyle = FORMANT_SCOPE_COLORS[formantIndex % FORMANT_SCOPE_COLORS.length];
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const sample = Math.sin(t * TWO_PI * cycles) * amplitude;
      const normalized = (sample + 1) * 0.5;
      const x = leftPad + (t * usableWidth);
      const y = topPad + ((1 - normalized) * usableHeight);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function maskGateState(maskMode, perFormantMask, maskAmount, burstOn, burstOff, laneIndex, step) {
  if (maskMode <= 0) return true;

  if (maskMode === 1) {
    const seed = perFormantMask ? (step + (laneIndex * 37) + 97.13) : (step + 97.13);
    return hashUnit(seed) > maskAmount;
  }

  const total = Math.max(1, burstOn + burstOff);
  const offset = perFormantMask ? 0 : (laneIndex * (total / 3));
  const burstIndex = ((step + offset) % total + total) % total;
  return burstIndex < burstOn;
}

function drawDutyScopeWithOverlay(canvas, duty, windowType) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;

  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const dutyStart = (1 - duty) * 0.5;
  const dutyEnd = dutyStart + duty;
  const dutyStartX = leftPad + (dutyStart * usableWidth);
  const dutyEndX = leftPad + (dutyEnd * usableWidth);

  ctx.clearRect(0, 0, drawWidth, drawHeight);

  ctx.fillStyle = "rgba(91, 169, 246, 0.16)";
  ctx.fillRect(dutyStartX, topPad, Math.max(dpr, dutyEndX - dutyStartX), usableHeight);

  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(169, 180, 208, 0.35)";
  ctx.beginPath();
  const centerY = drawHeight * 0.5;
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();

  ctx.strokeStyle = "rgb(91, 169, 246)";
  ctx.beginPath();
  const samples = Math.max(48, Math.floor(drawWidth / 2));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const gate = (t >= dutyStart && t < dutyEnd) ? 1 : -1;
    const normalized = (gate + 1) * 0.5;
    const x = leftPad + (t * usableWidth);
    const y = topPad + ((1 - normalized) * usableHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "rgb(235, 110, 79)";
  ctx.beginPath();
  const overlaySamples = Math.max(36, Math.floor(drawWidth / 3));
  for (let i = 0; i <= overlaySamples; i += 1) {
    const localT = i / overlaySamples;
    const env = clamp(interpolatedWaveSample(windowType, 8, windowWaveSample, localT), 0, 1);
    const x = dutyStartX + (localT * Math.max(dpr, dutyEndX - dutyStartX));
    const y = topPad + ((1 - env) * usableHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawMaskScope(canvas, maskMode, perFormantMask, maskAmount, burstOn, burstOff, activeCount) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;

  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const laneCount = 3;
  const laneGap = Math.max(1, 2 * dpr);
  const laneHeight = Math.max(2, (usableHeight - ((laneCount - 1) * laneGap)) / laneCount);
  const cols = Math.max(40, Math.floor(drawWidth / (4 * dpr)));
  const cellWidth = usableWidth / cols;

  for (let lane = 0; lane < laneCount; lane += 1) {
    const laneY = topPad + (lane * (laneHeight + laneGap));
    const laneActive = lane < activeCount;
    ctx.fillStyle = laneActive ? "rgba(26, 31, 53, 0.85)" : "rgba(18, 22, 38, 0.55)";
    ctx.fillRect(leftPad, laneY, usableWidth, laneHeight);
    for (let col = 0; col < cols; col += 1) {
      const gateOn = laneActive
        && maskGateState(maskMode, perFormantMask, maskAmount, burstOn, burstOff, lane, col);
      const color = FORMANT_SCOPE_COLORS[lane % FORMANT_SCOPE_COLORS.length];
      ctx.fillStyle = gateOn ? color : "rgba(80, 88, 120, 0.32)";
      ctx.globalAlpha = gateOn ? 0.95 : 0.45;
      ctx.fillRect(
        leftPad + (col * cellWidth),
        laneY,
        Math.max(dpr, cellWidth - dpr),
        laneHeight
      );
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(169, 180, 208, 0.2)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(leftPad, laneY, usableWidth, laneHeight);
  }
}

function drawFormantActivityHeatmap(
  canvas,
  formantHzValues,
  activeCount,
  formantTrackOn,
  maskMode,
  perFormantMask,
  maskAmount,
  burstOn,
  burstOff
) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;

  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const laneCount = 3;
  const laneGap = Math.max(1, 2 * dpr);
  const laneHeight = Math.max(2, (usableHeight - ((laneCount - 1) * laneGap)) / laneCount);
  const cols = Math.max(44, Math.floor(drawWidth / (4 * dpr)));
  const cellWidth = usableWidth / cols;

  for (let lane = 0; lane < laneCount; lane += 1) {
    const laneY = topPad + (lane * (laneHeight + laneGap));
    const laneActive = lane < activeCount;
    const hz = clamp(Number(formantHzValues[lane]) || 20, 20, 8000);
    const hzNorm = clamp(Math.log2(hz / 20) / Math.log2(8000 / 20), 0, 1);
    const cycleCount = 1.5 + (hzNorm * 8.5);
    const trackBoost = formantTrackOn ? 1.12 : 1.0;
    const laneColor = FORMANT_SCOPE_COLORS[lane % FORMANT_SCOPE_COLORS.length];

    for (let col = 0; col < cols; col += 1) {
      const phase = col / Math.max(1, cols - 1);
      const maskOn = laneActive
        && maskGateState(maskMode, perFormantMask, maskAmount, burstOn, burstOff, lane, col);
      const spectral = 0.45 + (0.55 * Math.sin(((phase * cycleCount) + (lane * 0.17)) * TWO_PI));
      const macro = 0.6 + (0.4 * Math.cos(((phase * 0.8) + (lane * 0.11)) * TWO_PI));
      const intensity = laneActive
        ? clamp((spectral * macro * trackBoost) * (maskOn ? 1 : 0.2), 0, 1)
        : 0.08;
      ctx.globalAlpha = 0.18 + (intensity * 0.82);
      ctx.fillStyle = laneActive ? laneColor : "rgba(80, 88, 120, 0.5)";
      ctx.fillRect(
        leftPad + (col * cellWidth),
        laneY,
        Math.max(dpr, cellWidth - dpr),
        laneHeight
      );
    }

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(169, 180, 208, 0.22)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(leftPad, laneY, usableWidth, laneHeight);
  }
}
function findScopeZeroCrossingOffset(values, length) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < length; i += 1) {
    const prev = Number(values[i - 1]);
    const curr = Number(values[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) continue;
    if (prev > 0 || curr < 0) continue;
    const slope = curr - prev;
    if (slope < OUTPUT_SCOPE_ZERO_CROSSING_MIN_SLOPE) continue;
    const distanceToZero = Math.abs(curr);
    if (distanceToZero < bestDistance) {
      bestDistance = distanceToZero;
      bestIndex = i;
    }
  }
  return bestIndex >= 0 ? bestIndex : 0;
}

function normalizeScopeSamples(samples) {
  if (!Array.isArray(samples)) return null;
  let sampleCount = 0;
  for (let i = 0; i < samples.length && sampleCount < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    const value = Number(samples[i]);
    if (!Number.isFinite(value)) continue;
    scopeSampleBuffer[sampleCount] = value;
    sampleCount += 1;
  }
  if (sampleCount === 0) return null;
  while (sampleCount < OUTPUT_SCOPE_FRAME_SIZE) {
    scopeSampleBuffer[sampleCount] = scopeSampleBuffer[sampleCount - 1] ?? 0;
    sampleCount += 1;
  }
  const offset = findScopeZeroCrossingOffset(scopeSampleBuffer, OUTPUT_SCOPE_FRAME_SIZE);
  for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    const sourceIndex = (i + offset) % OUTPUT_SCOPE_FRAME_SIZE;
    scopeAlignedBuffer[i] = scopeSampleBuffer[sourceIndex];
  }
  for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    const currentValue = Number(scopeRenderBuffer[i]) || 0;
    const targetValue = Number(scopeAlignedBuffer[i]) || 0;
    scopeRenderBuffer[i] = currentValue + ((targetValue - currentValue) * OUTPUT_SCOPE_SMOOTHING_ALPHA);
  }
  return scopeRenderBuffer;
}

function setOutputScopeSamples(samples, label = "Live output") {
  const normalized = normalizeScopeSamples(samples);
  if (!normalized) return;
  outputScopeSamples = normalized;
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  drawScopeFromSamples(outputScopeCanvas, outputScopeSamples);
}

function clearOutputScope(label = "Waiting for synth...") {
  for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    scopeRenderBuffer[i] = 0;
  }
  outputScopeSamples = scopeRenderBuffer;
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  drawScopeFromSamples(outputScopeCanvas, outputScopeSamples);
}

function updateWaveformViews() {
  const pulsaret = currentParamValue("pulsaret", 2.5);
  const windowType = currentParamValue("window", 0.5);
  const duty = clamp(currentParamValue("duty", 0.5), 0.01, 1);
  const dutyMode = currentParamValue("dutyMode", 0) > 0.5 ? "Formant" : "Manual";
  const formantCount = clamp(Math.round(currentParamValue("formantCount", 2)), 1, 3);
  const formantTrackOn = currentParamValue("formantTrack", 0) > 0.5;
  const maskMode = clamp(Math.round(currentParamValue("maskMode", 0)), 0, 2);
  const perFormantMask = currentParamValue("perFormantMask", 0) > 0.5;
  const maskAmount = clamp(currentParamValue("maskAmount", 0.5), 0, 1);
  const burstOn = Math.max(0, Math.round(currentParamValue("burstOn", 4)));
  const burstOff = Math.max(0, Math.round(currentParamValue("burstOff", 0)));
  const formantHzValues = [
    clamp(currentParamValue("formant1", 20), 20, 8000),
    clamp(currentParamValue("formant2", 200), 20, 8000),
    clamp(currentParamValue("formant3", 400), 20, 8000)
  ];

  if (pulsaretWaveLabelEl) {
    pulsaretWaveLabelEl.textContent = `${interpolatedWaveLabel(pulsaret, PULSARET_WAVE_NAMES)} (${pulsaret.toFixed(2)})`;
  }
  if (windowWaveLabelEl) {
    windowWaveLabelEl.textContent = `${interpolatedWaveLabel(windowType, WINDOW_WAVE_NAMES)} (${windowType.toFixed(2)})`;
  }
  if (dutyWaveLabelEl) {
    dutyWaveLabelEl.textContent = `${duty.toFixed(2)} • ${dutyMode}`;
  }
  if (formantWaveLabelEl) {
    const activeLabels = formantHzValues
      .slice(0, formantCount)
      .map((hz, index) => `F${index + 1} ${Math.round(hz)} Hz`);
    formantWaveLabelEl.textContent = activeLabels.join(" • ");
  }
  if (formantActivityLabelEl) {
    const trackText = formantTrackOn ? "Tracked" : "Static";
    formantActivityLabelEl.textContent = `${trackText} • Mask-aware`;
  }
  if (maskScopeLabelEl) {
    const mode = MASK_MODE_NAMES[maskMode] || MASK_MODE_NAMES[0];
    const perFormantState = perFormantMask ? "PF on" : "PF off";
    maskScopeLabelEl.textContent = `${mode} • ${perFormantState} • ${maskAmount.toFixed(2)}`;
  }

  drawWaveform(
    pulsaretWaveCanvas,
    (t) => interpolatedWaveSample(pulsaret, 9, pulsaretWaveSample, t),
    -1,
    1
  );
  drawWaveform(
    windowWaveCanvas,
    (t) => interpolatedWaveSample(windowType, 8, windowWaveSample, t),
    0,
    1
  );
  drawDutyScopeWithOverlay(
    dutyWaveCanvas,
    duty,
    windowType
  );
  drawFormantWaves(
    formantWaveCanvas,
    formantHzValues,
    formantCount
  );
  drawFormantActivityHeatmap(
    formantActivityCanvas,
    formantHzValues,
    formantCount,
    formantTrackOn,
    maskMode,
    perFormantMask,
    maskAmount,
    burstOn,
    burstOff
  );
  drawMaskScope(
    maskScopeCanvas,
    maskMode,
    perFormantMask,
    maskAmount,
    burstOn,
    burstOff,
    formantCount
  );
  drawScopeFromSamples(outputScopeCanvas, outputScopeSamples);
}

function defaultMidiMappingsForCurrentParams() {
  const mappings = {};
  const used = new Set();

  const reserveCc = (cc) => {
    if (!Number.isInteger(cc) || cc < 0 || cc > 127 || used.has(cc)) return false;
    used.add(cc);
    return true;
  };

  allParamNames.forEach((param) => {
    const preferredCc = PREFERRED_MIDI_CC_BY_PARAM[param];
    if (reserveCc(preferredCc)) {
      mappings[param] = preferredCc;
    }
  });

  let nextCc = 16;
  allParamNames.forEach((param) => {
    if (Number.isInteger(mappings[param])) return;
    while (nextCc <= 127 && used.has(nextCc)) nextCc += 1;
    if (nextCc <= 127) {
      mappings[param] = nextCc;
      used.add(nextCc);
      nextCc += 1;
    }
  });

  return mappings;
}

function loadMidiMappings() {
  const defaults = defaultMidiMappingsForCurrentParams();
  try {
    const raw = localStorage.getItem(MIDI_MAP_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaults;
    const sanitized = { ...defaults };
    allParamNames.forEach((param) => {
      if (!Object.prototype.hasOwnProperty.call(parsed, param)) return;
      if (parsed[param] === null) {
        sanitized[param] = null;
        return;
      }
      const cc = Number(parsed[param]);
      if (Number.isInteger(cc) && cc >= 0 && cc <= 127) {
        sanitized[param] = cc;
      }
    });
    return sanitized;
  } catch {
    appendLog("[MIDI] Failed to load MIDI mappings. Using defaults.");
    return defaults;
  }
}

function persistMidiMappings() {
  try {
    localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify(midiMappings));
  } catch {
    appendLog("[MIDI] Failed to persist MIDI mappings.");
  }
}

function rebuildMidiCcLookup() {
  const nextLookup = new Map();
  Object.entries(midiMappings).forEach(([param, mappedCc]) => {
    if (!Number.isInteger(mappedCc) || mappedCc < 0 || mappedCc > 127) return;
    if (!nextLookup.has(mappedCc)) nextLookup.set(mappedCc, []);
    nextLookup.get(mappedCc).push(param);
  });
  midiParamsByCc = nextLookup;
}

function rebuildControlMetaCache() {
  controlMetaByParam.clear();
  allParamNames.forEach((param) => {
    const knob = knobByParam.get(param);
    if (knob) {
      controlMetaByParam.set(param, {
        type: "continuous",
        min: Number(knob.dataset.min),
        max: Number(knob.dataset.max),
        step: Number(knob.dataset.step || "0.01")
      });
      return;
    }

    const range = rangeByParam.get(param);
    if (range) {
      controlMetaByParam.set(param, {
        type: "continuous",
        min: Number(range.min),
        max: Number(range.max),
        step: Number(range.step || "0.01")
      });
      return;
    }

    const select = selectByParam.get(param);
    if (select) {
      const values = Array.from(select.options).map((opt) => Number(opt.value));
      controlMetaByParam.set(param, {
        type: "discrete",
        values,
        valueSet: new Set(values),
        valueStringSet: new Set(values.map((value) => String(value)))
      });
    }
  });
}

function getControlMeta(param) {
  return controlMetaByParam.get(param) || null;
}

function formatParamValue(param, value) {
  if (!Number.isFinite(value)) return "--";

  const meta = getControlMeta(param);
  if (meta?.type === "continuous") {
    const decimals = decimalsFromStep(meta.step, 2);
    return Number(value).toFixed(decimals);
  }

  const discreteSelect = selectByParam.get(param);
  if (discreteSelect) {
    const valueStr = String(value);
    const selectedOption = Array.from(discreteSelect.options).find((option) => option.value === valueStr);
    const optionLabel = selectedOption?.textContent?.trim();
    if (optionLabel) return optionLabel;
  }

  if (Number.isInteger(value)) return String(value);
  return Number(value).toFixed(2);
}

function findParamLabel(param) {
  const knob = knobByParam.get(param);
  const knobLabel = knob?.closest(".knob-control")?.querySelector(".knob-label")?.textContent?.trim();
  if (knobLabel) return knobLabel;

  const range = rangeByParam.get(param);
  const rangeLabel = range?.closest(".control")?.querySelector(`label[for="${range.id}"]`)?.textContent?.trim();
  if (rangeLabel) return rangeLabel;

  const select = selectByParam.get(param);
  const selectLabel = select?.closest(".control")?.querySelector(`label[for="${select.id}"]`)?.textContent?.trim();
  if (selectLabel) return selectLabel;

  return formatParamName(param);
}

function updateRealtimeParamValue(param, value) {
  const valueEl = paramValueElByParam.get(param);
  const numericValue = Number(value);
  if (valueEl) {
    valueEl.textContent = formatParamValue(param, numericValue);
  }

  const sliderEl = paramSliderByParam.get(param);
  if (!sliderEl) return;

  const meta = getControlMeta(param);
  if (!meta) return;
  if (meta.type === "discrete") {
    const discreteIndex = meta.values.indexOf(numericValue);
    if (discreteIndex >= 0) sliderEl.value = String(discreteIndex);
    return;
  }

  sliderEl.value = String(numericValue);
}

function sliderValueToParamValue(param, sliderRawValue) {
  const meta = getControlMeta(param);
  const numeric = Number(sliderRawValue);
  if (!meta || !Number.isFinite(numeric)) return null;

  if (meta.type === "discrete") {
    const index = clamp(Math.round(numeric), 0, Math.max(0, meta.values.length - 1));
    const value = meta.values[index];
    return Number.isFinite(value) ? value : null;
  }

  return clamp(quantize(numeric, meta.step), meta.min, meta.max);
}

function parameterNamesForPage(pageIndex) {
  if (allParamNames.length === 0) return [];
  const totalPages = Math.max(1, PARAM_PAGES.length);
  const normalizedPage = clamp(Math.floor(Number(pageIndex) || 0), 0, totalPages - 1);
  return PARAM_PAGES[normalizedPage]?.params || [];
}

function parameterPageTitle(pageIndex) {
  const totalPages = Math.max(1, PARAM_PAGES.length);
  const normalizedPage = clamp(Math.floor(Number(pageIndex) || 0), 0, totalPages - 1);
  return PARAM_PAGES[normalizedPage]?.title || "Parameters";
}

function renderParamPageIndicator() {
  const totalPages = Math.max(1, PARAM_PAGES.length);
  if (paramPageIndicatorEl) {
    const title = parameterPageTitle(currentParamPage);
    paramPageIndicatorEl.textContent = `${title} (${currentParamPage + 1}/${totalPages})`;
  }
  if (paramPagePrevBtn) paramPagePrevBtn.disabled = currentParamPage <= 0;
  if (paramPageNextBtn) paramPageNextBtn.disabled = currentParamPage >= totalPages - 1;
}

function setParameterPage(pageIndex) {
  const totalPages = Math.max(1, PARAM_PAGES.length);
  const nextPage = clamp(Math.floor(Number(pageIndex) || 0), 0, totalPages - 1);
  if (nextPage === currentParamPage && paramValueElByParam.size > 0) {
    renderParamPageIndicator();
    return;
  }
  currentParamPage = nextPage;
  rebuildRealtimeParamGrid();
}

function rebuildRealtimeParamGrid() {
  if (!paramValueGridEl) return;
  paramValueGridEl.innerHTML = "";
  paramValueElByParam.clear();
  paramSliderByParam.clear();

  const visibleParamNames = parameterNamesForPage(currentParamPage);
  visibleParamNames.forEach((param) => {
    const row = document.createElement("div");
    row.className = "param-value-item";

    const labelEl = document.createElement("span");
    labelEl.className = "param-value-label";
    labelEl.textContent = findParamLabel(param);

    const valueEl = document.createElement("span");
    valueEl.className = "param-value-current";
    valueEl.textContent = "--";

    const sliderEl = document.createElement("input");
    sliderEl.type = "range";
    sliderEl.className = "param-value-slider";

    const meta = getControlMeta(param);
    const currentValue = currentParamValue(param, 0);
    if (meta?.type === "discrete") {
      sliderEl.min = "0";
      sliderEl.max = String(Math.max(0, meta.values.length - 1));
      sliderEl.step = "1";
      sliderEl.value = String(Math.max(0, meta.values.indexOf(Number(currentValue))));
    } else if (meta?.type === "continuous") {
      sliderEl.min = String(meta.min);
      sliderEl.max = String(meta.max);
      sliderEl.step = String(meta.step);
      sliderEl.value = String(currentValue);
    } else {
      sliderEl.min = "0";
      sliderEl.max = "1";
      sliderEl.step = "1";
      sliderEl.value = "0";
      sliderEl.disabled = true;
    }

    sliderEl.addEventListener("input", () => {
      const nextValue = sliderValueToParamValue(param, sliderEl.value);
      if (nextValue === null) return;
      setParamValue(param, nextValue, true);
    });

    row.append(labelEl, sliderEl, valueEl);
    paramValueGridEl.appendChild(row);
    paramValueElByParam.set(param, valueEl);
    paramSliderByParam.set(param, sliderEl);
  });

  visibleParamNames.forEach((param) => {
    updateRealtimeParamValue(param, currentParamValue(param, 0));
  });
  renderParamPageIndicator();
}

function valueFromMidiCc(param, ccValue) {
  const meta = getControlMeta(param);
  if (!meta) return null;
  const t = clamp(Number(ccValue) / 127, 0, 1);

  if (meta.type === "discrete") {
    if (!Array.isArray(meta.values) || meta.values.length === 0) return null;
    const idx = Math.round(t * (meta.values.length - 1));
    return meta.values[idx];
  }

  const v = meta.min + (t * (meta.max - meta.min));
  return clamp(quantize(v, meta.step), meta.min, meta.max);
}

function midiNoteToHz(noteNumber) {
  const note = clamp(Number(noteNumber), 0, 127);
  return 440 * (2 ** ((note - 69) / 12));
}

function releaseActiveMidiNote(noteNumber) {
  activeMidiNotes = activeMidiNotes.filter((note) => note !== noteNumber);
}

function applyMidiNotePitch(noteNumber) {
  // Phase 1.4: route note-derived basePitch through the same staging map as
  // gate/trigIn so all three land in the same coalesced batch on next rAF.
  // Per-note-event latency is bounded by one frame (~16 ms at 60 Hz) which
  // is well below perceptual attack-time thresholds and below scsynth's
  // own control-block granularity for typical envelopes.
  const value = normalizeParamValue("basePitch", midiNoteToHz(noteNumber));
  if (value === null) return;
  stagePendingParam("basePitch", value);
}

function updateGateFromMidiNotes() {
  // Phase 1.4: collapse the prior two ipcRenderer.invoke calls (one for
  // `gate`, one for `trigIn`) into staged entries that drain together on
  // the next rAF. Once Phase 2 lands, the drain will emit a single
  // setParamMany() IPC + OSC bundle, fully closing the 2x amplification.
  const gateValue = activeMidiNotes.length > 0 ? 1 : 0;
  stagePendingParam("gate", gateValue);
  stagePendingParam("trigIn", gateValue);
}

function ensureMidiNoteEnvelopeMode() {
  const gateMode = currentParamValue("gateMode", 1);
  if (gateMode !== 1) return;
  setParamValue("gateMode", 0, true);
  appendLog("[MIDI] Gate Mode set to MIDI-like so Note On/Off uses attack/release.");
}

function handleMidiNoteMessage(status, noteNumber, velocity) {
  const messageType = status & MIDI_STATUS_TYPE_MASK;
  const note = clamp(Math.round(Number(noteNumber)), 0, 127);
  const vel = clamp(Math.round(Number(velocity)), 0, 127);
  const isNoteOn = messageType === MIDI_STATUS_NOTE_ON && vel > 0;
  const isNoteOff = messageType === MIDI_STATUS_NOTE_OFF || (messageType === MIDI_STATUS_NOTE_ON && vel === 0);
  const wasActive = activeMidiNotes.includes(note);

  if (isNoteOn || (isNoteOff && wasActive)) ensureMidiNoteEnvelopeMode();

  if (isNoteOn) {
    releaseActiveMidiNote(note);
    activeMidiNotes.push(note);
    applyMidiNotePitch(note);
    updateGateFromMidiNotes();
    return;
  }

  if (!isNoteOff) return;

  releaseActiveMidiNote(note);
  const nextNote = activeMidiNotes[activeMidiNotes.length - 1];
  if (Number.isInteger(nextNote)) applyMidiNotePitch(nextNote);
  updateGateFromMidiNotes();
}

function closeMidiPanels(exceptParam = null) {
  midiUiByParam.forEach((ui, param) => {
    if (param !== exceptParam) ui.panel.classList.add("hidden");
  });
}

function refreshMidiMapControl(param) {
  const ui = midiUiByParam.get(param);
  if (!ui) return;
  const cc = midiMappings[param];
  ui.button.textContent = Number.isInteger(cc) ? `☰ CC ${cc}` : "☰ MIDI";
  ui.button.classList.toggle("mapped", Number.isInteger(cc));
  ui.button.title = Number.isInteger(cc)
    ? `Mapped to MIDI CC ${cc}`
    : "Assign MIDI CC";
  ui.input.value = Number.isInteger(cc) ? String(cc) : "";
}

function setupMidiMappingControls() {
  allParamNames.forEach((param) => {
    const knob = knobByParam.get(param);
    const range = rangeByParam.get(param);
    const select = selectByParam.get(param);
    const host = knob?.closest(".knob-control") || range?.closest(".control") || select?.closest(".control");
    if (!host) return;

    const row = document.createElement("div");
    row.className = "midi-map-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "midi-map-trigger";

    const panel = document.createElement("div");
    panel.className = "midi-map-panel hidden";

    const ccLabel = document.createElement("label");
    ccLabel.textContent = "CC";
    ccLabel.htmlFor = `midi-cc-${param}`;

    const ccInput = document.createElement("input");
    ccInput.id = `midi-cc-${param}`;
    ccInput.type = "number";
    ccInput.min = "0";
    ccInput.max = "127";
    ccInput.placeholder = "0-127";

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Clear";

    panel.append(ccLabel, ccInput, clearButton);
    row.append(button, panel);
    host.appendChild(row);

    midiUiByParam.set(param, { button, panel, input: ccInput });

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = panel.classList.contains("hidden");
      closeMidiPanels(willOpen ? param : null);
      panel.classList.toggle("hidden", !willOpen);
    });

    panel.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    ccInput.addEventListener("change", () => {
      const rawCc = String(ccInput.value || "").trim();
      const cc = Number(rawCc);
      if (Number.isInteger(cc) && cc >= 0 && cc <= 127) {
        midiMappings[param] = cc;
        appendLog(`[MIDI] ${param} mapped to CC ${cc}`);
      } else {
        midiMappings[param] = null;
        appendLog(`[MIDI] ${param} mapping cleared`);
      }
      rebuildMidiCcLookup();
      persistMidiMappings();
      refreshMidiMapControl(param);
    });

    clearButton.addEventListener("click", () => {
      midiMappings[param] = null;
      rebuildMidiCcLookup();
      persistMidiMappings();
      refreshMidiMapControl(param);
      appendLog(`[MIDI] ${param} mapping cleared`);
    });
  });

  allParamNames.forEach((param) => refreshMidiMapControl(param));

  document.addEventListener("click", () => closeMidiPanels(null));
}

function scheduleCcDrain() {
  if (ccDrainScheduled) return;
  ccDrainScheduled = true;
  queueMicrotask(() => {
    ccDrainScheduled = false;
    if (pendingCcEvents.length === 0) return;
    // Snapshot and clear so events that arrive during this drain stage in
    // a fresh batch.
    const events = pendingCcEvents.splice(0, pendingCcEvents.length);
    const flushBatch = [];
    for (let i = 0; i < events.length; i += 1) {
      const [param, value] = events[i];
      // Skip true no-ops (same value as previous) but never drop intermediate
      // distinct values: every CC step the controller emitted reaches sclang.
      const previousSent = lastSentValueByParam.get(param);
      if (previousSent === value) continue;
      const applied = setParamValue(param, value, false);
      if (!applied) continue;
      lastSentValueByParam.set(param, value);
      flushBatch.push([param, value]);
    }
    if (flushBatch.length > 0) {
      window.spaluterApi.setParamMany(flushBatch);
    }
  });
}

function stagePendingParam(param, value) {
  pendingCcEvents.push([param, value]);
  scheduleCcDrain();
}

function scheduleMidiRawReport() {
  if (midiRawReportRafId) return;
  midiRawReportRafId = window.requestAnimationFrame(() => {
    midiRawReportRafId = 0;
    if (midiRawCountWindow === 0) return;
    const n = midiRawCountWindow;
    midiRawCountWindow = 0;
    window.spaluterApi.reportMidiRawCount(n);
  });
}

function handleMidiMessage(event) {
  const data = event?.data;
  if (!data || data.length < 3) return;
  // Phase 2.3 telemetry: count every raw incoming MIDI message so main can
  // compute the (raw vs flushed) compression ratio. Coalesced via the same
  // rAF tick as the CC drain to avoid one IPC per event.
  midiRawCountWindow += 1;
  scheduleMidiRawReport();
  const status = data[0] | 0;
  const data1 = data[1] | 0;
  const data2 = data[2] | 0;
  const messageType = status & MIDI_STATUS_TYPE_MASK;

  if (messageType === MIDI_STATUS_CC) {
    const cc = data1;
    const ccValue = data2;
    const mappedParams = midiParamsByCc.get(cc);
    if (!Array.isArray(mappedParams) || mappedParams.length === 0) return;
    // Phase 1.3: stage latest-value-per-param; rAF drain applies them once
    // per frame. No CC value is dropped; the value at frame boundary is
    // whatever the controller sent most recently for that CC.
    for (let i = 0; i < mappedParams.length; i += 1) {
      const param = mappedParams[i];
      const value = valueFromMidiCc(param, ccValue);
      if (value === null) continue;
      stagePendingParam(param, value);
    }
    return;
  }

  if (messageType === MIDI_STATUS_NOTE_ON || messageType === MIDI_STATUS_NOTE_OFF) {
    // Notes are NOT coalesced. Per the plan, ordering and per-event timing
    // are preserved end-to-end.
    handleMidiNoteMessage(status, data1, data2);
  }
}

function bindMidiInputs() {
  if (!midiAccess) return;
  let inputCount = 0;
  midiAccess.inputs.forEach((input) => {
    if (!input) return;
    input.onmidimessage = handleMidiMessage;
    inputCount += 1;
  });
  if (inputCount === lastMidiInputCount) return;
  lastMidiInputCount = inputCount;
  appendLog(`[MIDI] Listening on ${inputCount} input${inputCount === 1 ? "" : "s"}.`);
}

function scheduleMidiInputRebind() {
  if (midiRebindTimer) clearTimeout(midiRebindTimer);
  midiRebindTimer = window.setTimeout(() => {
    midiRebindTimer = null;
    bindMidiInputs();
  }, MIDI_REBIND_DEBOUNCE_MS);
}

async function initMidiSupport() {
  if (!navigator.requestMIDIAccess) {
    appendLog("[MIDI] Web MIDI is unavailable in this environment.");
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    bindMidiInputs();
    midiAccess.onstatechange = (event) => {
      const port = event?.port;
      if (port?.type !== "input") return;
      scheduleMidiInputRebind();
      const portName = port.name || port.id || "MIDI input";
      const portState = port.state || "unknown";
      const stateKey = `${portName}:${portState}`;
      const now = Date.now();
      if (stateKey === lastMidiStateKey && (now - lastMidiStateLogAt) < MIDI_STATE_LOG_MIN_INTERVAL_MS) return;
      lastMidiStateKey = stateKey;
      lastMidiStateLogAt = now;
      appendLog(`[MIDI] ${portName} is ${portState}.`);
    };
  } catch (err) {
    appendLog(`[MIDI] Failed to initialize: ${err.message}`);
  }
}

function normalizeParamValue(param, rawValue) {
  const value = Number(rawValue);
  if (Number.isNaN(value)) return null;

  const meta = getControlMeta(param);
  if (!meta) return value;

  if (meta.type === "continuous") {
    return clamp(quantize(value, meta.step), meta.min, meta.max);
  }

  if (!meta.valueSet?.has(value)) return null;
  return value;
}

function scheduleWaveformViewsRedraw() {
  if (waveformViewsRafId) return;
  waveformViewsDirty = true;
  waveformViewsRafId = window.requestAnimationFrame(() => {
    waveformViewsRafId = 0;
    if (!waveformViewsDirty) return;
    waveformViewsDirty = false;
    updateWaveformViews();
  });
}

function setParamValue(param, rawValue, send = true) {
  const value = normalizeParamValue(param, rawValue);
  if (value === null) return false;

  // Phase 1.1: no-op early-out when the normalized value matches what we
  // last sent for this param. Skips DOM, IPC, and the waveform redraw.
  // Bypassed when send=false so external state-restore callers still update UI.
  if (send && lastSentValueByParam.get(param) === value) {
    return true;
  }

  const knob = knobByParam.get(param);
  if (knob) {
    knob.dataset.value = String(value);
    setKnobVisual(knob, value);
  }

  const range = rangeByParam.get(param);
  if (range) {
    range.value = String(value);
    updateRangeLabel(range, value);
  }

  const select = selectByParam.get(param);
  if (select) {
    const valueStr = String(value);
    const meta = getControlMeta(param);
    if (meta?.valueStringSet?.has(valueStr)) {
      select.value = valueStr;
    }
  }

  if (
    param === "pulsaret"
    || param === "window"
    || param === "duty"
    || param === "dutyMode"
    || param === "formantCount"
    || param === "formantTrack"
    || param === "formant1"
    || param === "formant2"
    || param === "formant3"
    || param === "maskMode"
    || param === "perFormantMask"
    || param === "maskAmount"
    || param === "burstOn"
    || param === "burstOff"
  ) {
    // Phase 1.2: was a synchronous updateWaveformViews() call per event.
    scheduleWaveformViewsRedraw();
  }

  updateRealtimeParamValue(param, value);
  if (send) {
    lastSentValueByParam.set(param, value);
    window.spaluterApi.setParam(param, value);
  }
  return true;
}

function defaultPresetName(index) {
  return `Preset ${index + 1}`;
}

function createDefaultPresets() {
  return Array.from({ length: PRESET_COUNT }, (_unused, index) => ({
    name: defaultPresetName(index),
    params: null,
    sampleDirectory: sampleDefaultDir,
    samplePath: ""
  }));
}

function loadPresets() {
  const defaults = createDefaultPresets();
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.slots)) return defaults;
    return defaults.map((slot, index) => {
      const loaded = parsed.slots[index];
      if (!loaded || typeof loaded !== "object") return slot;
      const name = typeof loaded.name === "string" && loaded.name.trim().length > 0
        ? loaded.name.trim()
        : slot.name;
      const params = loaded.params && typeof loaded.params === "object" ? loaded.params : null;
      const sampleDirectory = typeof loaded.sampleDirectory === "string" && loaded.sampleDirectory.trim().length > 0
        ? loaded.sampleDirectory.trim()
        : sampleDefaultDir;
      const samplePath = typeof loaded.samplePath === "string" ? loaded.samplePath : "";
      return { name, params, sampleDirectory, samplePath };
    });
  } catch {
    appendLog("[PRESET] Failed to load presets from local storage. Using defaults.");
    return defaults;
  }
}

function persistPresets(presets) {
  try {
    localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({ slots: presets }));
  } catch {
    appendLog("[PRESET] Failed to persist presets to local storage.");
  }
}

function selectedPresetIndex() {
  if (!presetSlotEl) return 0;
  const parsed = Number(presetSlotEl.value);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), PRESET_COUNT - 1);
}

function collectCurrentParams() {
  const params = {};

  knobs.forEach((knob) => {
    const param = knob.dataset.param;
    params[param] = Number(knob.dataset.value);
  });

  rangeInputs.forEach((range) => {
    const param = range.dataset.param;
    if (!(param in params)) params[param] = Number(range.value);
  });

  selectInputs.forEach((select) => {
    const param = select.dataset.param;
    params[param] = Number(select.value);
  });

  return params;
}

function applyPresetParams(params) {
  if (!params || typeof params !== "object") return;
  Object.entries(params).forEach(([param, value]) => {
    setParamValue(param, Number(value), true);
  });
}

function renderSampleOptions(files, preferredPath = "") {
  if (!sampleFileEl) return;
  sampleFileEl.innerHTML = "";
  if (!Array.isArray(files) || files.length === 0) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "(no samples found)";
    sampleFileEl.appendChild(empty);
    sampleFileEl.value = "";
    return;
  }

  files.forEach((file) => {
    const option = document.createElement("option");
    option.value = file.path;
    option.textContent = file.name;
    sampleFileEl.appendChild(option);
  });

  const desiredPath = preferredPath || currentSamplePath;
  const hasDesired = files.some((file) => file.path === desiredPath);
  sampleFileEl.value = hasDesired ? desiredPath : files[0].path;
}

async function refreshSampleList(preferredDir, preferredPath = "") {
  if (!sampleDirectoryEl) return;
  const dir = (preferredDir || sampleDirectoryEl.value || sampleDefaultDir).trim() || sampleDefaultDir;
  sampleDirectoryEl.value = dir;
  const result = await window.spaluterApi.listSamples(dir);
  if (!result?.ok) {
    renderSampleOptions([]);
    appendLog(`[SAMPLE] ${result?.error || "Unable to list sample files."}`);
    return;
  }
  sampleDirectoryEl.value = result.directory || dir;
  renderSampleOptions(result.files || [], preferredPath);
}

async function loadSelectedSample() {
  if (!sampleFileEl) return;
  const samplePath = sampleFileEl.value;
  if (!samplePath) {
    appendLog("[SAMPLE] No sample selected.");
    return;
  }
  const ok = await window.spaluterApi.loadSample(samplePath);
  if (!ok) {
    appendLog(`[SAMPLE] Failed to request sample load: ${samplePath}`);
    return;
  }
  currentSamplePath = samplePath;
  setParamValue("useSample", 1, true);
  appendLog(`[SAMPLE] Load requested: ${samplePath}`);
}

let presets = loadPresets();
midiMappings = loadMidiMappings();

function syncPresetNameField() {
  if (!presetNameEl || !presetSlotEl) return;
  const idx = selectedPresetIndex();
  presetNameEl.value = presets[idx].name;
}

function renderPresetOptions() {
  if (!presetSlotEl) return;
  const currentIndex = selectedPresetIndex();
  presetSlotEl.innerHTML = "";
  presets.forEach((preset, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${String(index + 1).padStart(2, "0")} ${preset.params ? "[saved]" : "[empty]"} ${preset.name}`;
    presetSlotEl.appendChild(option);
  });
  presetSlotEl.value = String(currentIndex);
  syncPresetNameField();
}

function scheduleWaveformResizeRefresh() {
  waveformLayoutDirty = true;
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = window.setTimeout(() => {
    updateWaveformViews();
  }, RESIZE_DEBOUNCE_MS);
}

function normalizedMainViewIndex(rawIndex) {
  return clamp(Math.floor(Number(rawIndex) || 0), 0, Math.max(0, MAIN_VIEW_COUNT - 1));
}

function screenForMainViewIndex(viewIndex) {
  return normalizedMainViewIndex(viewIndex) === 0 ? "scopes" : "parameters";
}

function parameterPageForMainViewIndex(viewIndex) {
  const normalized = normalizedMainViewIndex(viewIndex);
  if (normalized <= 0) return 0;
  return clamp(normalized - 1, 0, Math.max(0, PARAM_PAGES.length - 1));
}

function inferMainViewSwipeDirection(fromIndex, toIndex) {
  const from = normalizedMainViewIndex(fromIndex);
  const to = normalizedMainViewIndex(toIndex);
  if (from === to) return -1;
  return to > from ? -1 : 1;
}

function clearMainScreenTransitionState(panel) {
  if (!panel) return;
  panel.classList.remove("transitioning");
  panel.style.transitionDuration = "";
  panel.style.transform = "";
}

function updateMainScreenSwitchButtons(targetViewIndex) {
  mainScreenButtons.forEach((button) => {
    const buttonViewIndex = normalizedMainViewIndex(button.dataset.viewIndex);
    const isActive = buttonViewIndex === targetViewIndex;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function animateParameterPageTransition(panel, nextPage, swipeDirection, transitionToken) {
  if (!panel) return;
  const incomingStartX = swipeDirection < 0 ? "100%" : "-100%";
  const outgoingEndX = swipeDirection < 0 ? "-100%" : "100%";

  clearMainScreenTransitionState(panel);
  panel.classList.add("active", "transitioning");
  panel.style.transitionDuration = `${SCREEN_SLIDE_MS}ms`;
  panel.style.transform = "translate3d(0, 0, 0)";
  void panel.offsetWidth;

  window.requestAnimationFrame(() => {
    if (transitionToken !== screenTransitionToken) return;
    panel.style.transform = `translate3d(${outgoingEndX}, 0, 0)`;
  });

  screenTransitionTimer = window.setTimeout(() => {
    if (transitionToken !== screenTransitionToken) return;
    clearMainScreenTransitionState(panel);
    setParameterPage(nextPage);
    panel.classList.add("active", "transitioning");
    panel.style.transitionDuration = "0ms";
    panel.style.transform = `translate3d(${incomingStartX}, 0, 0)`;
    void panel.offsetWidth;
    panel.style.transitionDuration = `${SCREEN_SLIDE_MS}ms`;
    window.requestAnimationFrame(() => {
      if (transitionToken !== screenTransitionToken) return;
      panel.style.transform = "translate3d(0, 0, 0)";
    });
    screenTransitionTimer = window.setTimeout(() => {
      if (transitionToken !== screenTransitionToken) return;
      clearMainScreenTransitionState(panel);
      panel.classList.add("active");
      screenTransitionTimer = null;
    }, SCREEN_SLIDE_MS + 34);
  }, SCREEN_SLIDE_MS + 16);
}

function setMainView(targetViewIndex, options = {}) {
  const targetIndex = normalizedMainViewIndex(targetViewIndex);
  const targetScreen = screenForMainViewIndex(targetIndex);
  const targetParamPage = parameterPageForMainViewIndex(targetIndex);
  const animate = Boolean(options.animate);
  const swipeDirection = Number(options.swipeDirection) < 0 ? -1 : 1;
  const transitionToken = ++screenTransitionToken;

  if (screenTransitionTimer) {
    clearTimeout(screenTransitionTimer);
    screenTransitionTimer = null;
  }

  if (targetIndex === currentViewIndex && !options.force) return;

  const previousViewIndex = currentViewIndex;
  const previousScreen = currentMainScreen;
  const previousParamPage = currentParamPage;

  const nextPanel = mainScreenPanels.find((panel) => panel.dataset.screen === targetScreen) || null;
  const currentPanel = mainScreenPanels.find((panel) => panel.dataset.screen === previousScreen) || null;
  if (!nextPanel) return;

  updateMainScreenSwitchButtons(targetIndex);
  currentViewIndex = targetIndex;
  currentMainScreen = targetScreen;

  if (!animate) {
    if (targetScreen === "parameters") {
      setParameterPage(targetParamPage);
    }
    mainScreenPanels.forEach((panel) => {
      clearMainScreenTransitionState(panel);
      panel.classList.toggle("active", panel === nextPanel);
    });
    if (targetScreen === "scopes") scheduleWaveformResizeRefresh();
    return;
  }

  if (!currentPanel) {
    if (targetScreen === "parameters") {
      setParameterPage(targetParamPage);
    }
    nextPanel.classList.add("active");
    if (targetScreen === "scopes") scheduleWaveformResizeRefresh();
    return;
  }

  if (previousScreen === "parameters" && targetScreen === "parameters" && previousParamPage !== targetParamPage) {
    animateParameterPageTransition(nextPanel, targetParamPage, swipeDirection, transitionToken);
    return;
  }

  if (previousScreen === targetScreen) {
    if (targetScreen === "parameters") {
      setParameterPage(targetParamPage);
    }
    if (targetScreen === "scopes") scheduleWaveformResizeRefresh();
    return;
  }

  if (targetScreen === "parameters") {
    setParameterPage(targetParamPage);
  }

  const incomingStartX = swipeDirection < 0 ? "100%" : "-100%";
  const outgoingEndX = swipeDirection < 0 ? "-100%" : "100%";

  mainScreenPanels.forEach((panel) => {
    clearMainScreenTransitionState(panel);
    if (panel !== currentPanel && panel !== nextPanel) {
      panel.classList.remove("active");
    }
  });

  currentPanel.classList.add("active");
  nextPanel.classList.add("active");
  nextPanel.style.transform = `translate3d(${incomingStartX}, 0, 0)`;
  currentPanel.style.transform = "translate3d(0, 0, 0)";

  // Force layout before enabling transition to keep animation smooth.
  void nextPanel.offsetWidth;

  nextPanel.classList.add("transitioning");
  currentPanel.classList.add("transitioning");
  nextPanel.style.transitionDuration = `${SCREEN_SLIDE_MS}ms`;
  currentPanel.style.transitionDuration = `${SCREEN_SLIDE_MS}ms`;

  window.requestAnimationFrame(() => {
    if (transitionToken !== screenTransitionToken) return;
    nextPanel.style.transform = "translate3d(0, 0, 0)";
    currentPanel.style.transform = `translate3d(${outgoingEndX}, 0, 0)`;
  });

  screenTransitionTimer = window.setTimeout(() => {
    if (transitionToken !== screenTransitionToken) return;
    clearMainScreenTransitionState(currentPanel);
    clearMainScreenTransitionState(nextPanel);
    currentPanel.classList.remove("active");
    nextPanel.classList.add("active");
    if (targetScreen === "scopes") scheduleWaveformResizeRefresh();
    screenTransitionTimer = null;
  }, SCREEN_SLIDE_MS + 34);
}

function initMainScreenSwitcher() {
  if (!mainScreenSwitchEl) return;
  mainScreenSwitchEl.addEventListener("click", (event) => {
    const button = event.target.closest(".main-screen-btn[data-view-index]");
    if (!button) return;
    const targetViewIndex = normalizedMainViewIndex(button.dataset.viewIndex);
    const direction = inferMainViewSwipeDirection(currentViewIndex, targetViewIndex);
    setMainView(targetViewIndex, { animate: true, swipeDirection: direction });
  });
}

function shouldIgnoreSwipeStartTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest(
    "button,input,select,textarea,a,label,.tab-strip,.main-screen-switch,.log-footer,#aboutDrawer,.midi-map-panel,.midi-map-trigger"
  ));
}

function switchMainViewBySwipe(step) {
  const direction = step >= 0 ? 1 : -1;
  const nextViewIndex = clamp(currentViewIndex + direction, 0, Math.max(0, MAIN_VIEW_COUNT - 1));
  if (nextViewIndex === currentViewIndex) return;
  const swipeDirection = direction > 0 ? -1 : 1;
  setMainView(nextViewIndex, { animate: true, swipeDirection });
}

function initMainScreenSwipe() {
  if (!mainScreenStageEl) return;
  let swipeStart = null;

  mainScreenStageEl.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      swipeStart = null;
      return;
    }
    const touch = event.touches[0];
    if (!touch || shouldIgnoreSwipeStartTarget(event.target)) {
      swipeStart = null;
      return;
    }
    swipeStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now()
    };
  }, { passive: true });

  mainScreenStageEl.addEventListener("touchcancel", () => {
    swipeStart = null;
  }, { passive: true });

  mainScreenStageEl.addEventListener("touchend", (event) => {
    if (!swipeStart) return;
    const touch = event.changedTouches?.[0];
    if (!touch) {
      swipeStart = null;
      return;
    }

    const dx = touch.clientX - swipeStart.x;
    const dy = touch.clientY - swipeStart.y;
    const dt = Date.now() - swipeStart.time;
    swipeStart = null;

    if (dt > SWIPE_MAX_DURATION_MS) return;
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX) return;
    if (Math.abs(dy) > SWIPE_MAX_OFF_AXIS_PX) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;

    if (dx < 0) switchMainViewBySwipe(1);
    else switchMainViewBySwipe(-1);
  }, { passive: true });
}

function setScopeStreaming(enabled) {
  const nextEnabled = Boolean(enabled);
  if (scopeStreamingEnabled === nextEnabled) return;
  scopeStreamingEnabled = nextEnabled;
  const scopeRate = nextEnabled ? ACTIVE_SCOPE_RATE_HZ : MIN_SCOPE_RATE_HZ;
  window.spaluterApi.setScope(nextEnabled, scopeRate).catch(() => {
    appendLog("[SCOPE] Failed to update scope streaming state.");
  });
}

function refreshScopeStreamingState() {
  const visible = document.visibilityState !== "hidden" && document.hasFocus();
  setScopeStreaming(visible);
}

window.spaluterApi.onStatus((text) => {
  statusEl.textContent = text;
  const state = classifyStatus(text);
  const statusText = String(text || "").toLowerCase();
  setStatusState(state);
  updateSynthRunningFromStatus(text);
  if (/(synth stopped|stopped by user|manual stop|quitting runtime|sclang exited)/.test(statusText)) {
    activeMidiNotes = [];
    clearOutputScope("Waiting for synth...");
  }
  if (/synth started/.test(statusText) && outputScopeLabelEl) {
    outputScopeLabelEl.textContent = "Live output";
  }
});

window.spaluterApi.onCpuUsage((percent) => {
  setCpuUsage(percent);
});

window.spaluterApi.onLog((text) => {
  appendLog(text);
  if (/^\[ERR\]|ERROR:|FAILURE IN SERVER/i.test(String(text || ""))) {
    setStatusState("error");
  }
});

window.spaluterApi.onScope((samples) => {
  setOutputScopeSamples(samples, "Live output");
});

renderSynthToggle();
setCpuUsage(0);
initMainScreenSwitcher();
initMainScreenSwipe();
setMainView(mainScreenButtons.find((button) => button.classList.contains("active"))?.dataset.viewIndex || 0, { force: true });
updateWaveformViews();
clearOutputScope();
window.addEventListener("resize", scheduleWaveformResizeRefresh);
document.addEventListener("visibilitychange", refreshScopeStreamingState);
window.addEventListener("focus", refreshScopeStreamingState);
window.addEventListener("blur", refreshScopeStreamingState);
rendererHeartbeatTimer = window.setInterval(() => {
  window.spaluterApi.heartbeat();
}, RENDERER_HEARTBEAT_MS);
window.addEventListener("beforeunload", () => {
  if (midiRebindTimer) {
    clearTimeout(midiRebindTimer);
    midiRebindTimer = null;
  }
  if (rendererHeartbeatTimer) {
    clearInterval(rendererHeartbeatTimer);
    rendererHeartbeatTimer = null;
  }
  if (waveformViewsRafId) {
    window.cancelAnimationFrame(waveformViewsRafId);
    waveformViewsRafId = 0;
  }
  if (ccDrainScheduled) {
    // Microtask drain self-clears; just drop staged events so we don't
    // emit IPC during teardown.
    pendingCcEvents.length = 0;
    ccDrainScheduled = false;
  }
  if (midiRawReportRafId) {
    window.cancelAnimationFrame(midiRawReportRafId);
    midiRawReportRafId = 0;
  }
});

document.querySelectorAll("button[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => {
    let action = btn.dataset.action;
    if (btn === synthToggleBtn) {
      action = synthRunning ? "stop" : "start";
      synthRunning = action === "start";
      renderSynthToggle();
      setStatusState(action === "start" ? "starting" : "stopped");
    }
    if (!action) return;
    window.spaluterApi.trigger(action);
  });
});

setLogOpen(false);
if (toggleLogBtn) {
  toggleLogBtn.addEventListener("click", () => {
    const isOpen = !logDrawerEl.classList.contains("closed");
    setLogOpen(!isOpen);
  });
}
if (closeLogBtn) {
  closeLogBtn.addEventListener("click", () => setLogOpen(false));
}
setAboutOpen(false);
if (toggleAboutBtn) {
  toggleAboutBtn.addEventListener("click", () => {
    const isOpen = !aboutDrawerEl.classList.contains("closed");
    setAboutOpen(!isOpen);
  });
}
if (closeAboutBtn) {
  closeAboutBtn.addEventListener("click", () => setAboutOpen(false));
}

rangeInputs.forEach((el) => {
  updateRangeLabel(el, Number(el.value));
  el.addEventListener("input", () => {
    setParamValue(el.dataset.param, Number(el.value), true);
  });
});

selectInputs.forEach((el) => {
  el.addEventListener("change", () => {
    setParamValue(el.dataset.param, Number(el.value), true);
  });
});

rebuildControlMetaCache();
setParameterPage(0);

if (paramPagePrevBtn) {
  paramPagePrevBtn.addEventListener("click", () => {
    setParameterPage(currentParamPage - 1);
  });
}
if (paramPageNextBtn) {
  paramPageNextBtn.addEventListener("click", () => {
    setParameterPage(currentParamPage + 1);
  });
}

knobs.forEach((knob) => {
  const param = knob.dataset.param;
  const min = Number(knob.dataset.min);
  const max = Number(knob.dataset.max);
  let value = Number(knob.dataset.value ?? min);

  value = clamp(value, min, max);
  setParamValue(param, value, true);
  knob.addEventListener("mousedown", (e) => {
    activeKnobDrag = {
      param,
      min,
      max,
      startY: e.clientY,
      startValue: Number(knob.dataset.value)
    };
    e.preventDefault();
  });
});

window.addEventListener("mousemove", (e) => {
  if (!activeKnobDrag) return;
  const dy = activeKnobDrag.startY - e.clientY;
  const scale = (activeKnobDrag.max - activeKnobDrag.min) / 180;
  setParamValue(activeKnobDrag.param, activeKnobDrag.startValue + (dy * scale), true);
});

window.addEventListener("mouseup", () => {
  activeKnobDrag = null;
});

setupMidiMappingControls();
rebuildMidiCcLookup();
initMidiSupport();

if (presetSlotEl) {
  renderPresetOptions();
  presetSlotEl.addEventListener("change", syncPresetNameField);
}

if (savePresetBtn) {
  savePresetBtn.addEventListener("click", () => {
    const idx = selectedPresetIndex();
    const typed = String(presetNameEl?.value || "").trim();
    const name = typed.length > 0 ? typed : defaultPresetName(idx);
    presets[idx] = {
      name,
      params: collectCurrentParams(),
      sampleDirectory: String(sampleDirectoryEl?.value || "").trim() || sampleDefaultDir,
      samplePath: String(sampleFileEl?.value || "")
    };
    persistPresets(presets);
    renderPresetOptions();
    presetSlotEl.value = String(idx);
    syncPresetNameField();
    appendLog(`[PRESET] Saved ${String(idx + 1).padStart(2, "0")}: ${name}`);
  });
}

if (loadPresetBtn) {
  loadPresetBtn.addEventListener("click", async () => {
    const idx = selectedPresetIndex();
    const preset = presets[idx];
    if (!preset?.params) {
      appendLog(`[PRESET] Slot ${String(idx + 1).padStart(2, "0")} is empty.`);
      return;
    }
    if (presetNameEl) presetNameEl.value = preset.name;
    applyPresetParams(preset.params);
    await refreshSampleList(preset.sampleDirectory || sampleDefaultDir, preset.samplePath || "");
    if (preset.samplePath) {
      const hasPath = Array.from(sampleFileEl?.options || []).some((opt) => opt.value === preset.samplePath);
      if (hasPath) {
        sampleFileEl.value = preset.samplePath;
        await loadSelectedSample();
      } else {
        appendLog(`[PRESET] Saved sample not found: ${preset.samplePath}`);
      }
    }
    appendLog(`[PRESET] Recalled ${String(idx + 1).padStart(2, "0")}: ${preset.name}`);
  });
}

if (sampleFileEl) {
  sampleFileEl.addEventListener("change", () => {
    currentSamplePath = sampleFileEl.value;
  });
}

if (refreshSamplesBtn) {
  refreshSamplesBtn.addEventListener("click", () => {
    refreshSampleList(sampleDirectoryEl?.value || sampleDefaultDir, sampleFileEl?.value || "");
  });
}

if (loadSampleBtn) {
  loadSampleBtn.addEventListener("click", () => {
    loadSelectedSample();
  });
}

window.spaluterApi.getInitialState().then((state) => {
  if (!state) return;
  if (state.status) {
    statusEl.textContent = state.status;
    setStatusState(classifyStatus(state.status));
    updateSynthRunningFromStatus(state.status);
  } else {
    setStatusState("starting");
  }
  if (Array.isArray(state.logs) && state.logs.length > 0) {
    resetLog(state.logs);
  }
  const defaultDir = String(state.sampleDefaultDir || sampleDefaultDir);
  sampleDefaultDir = defaultDir || sampleDefaultDir;
  refreshSampleList(defaultDir, "");
  window.spaluterApi.setScope(true, ACTIVE_SCOPE_RATE_HZ).catch(() => {
    appendLog("[SCOPE] Failed to initialize scope streaming.");
  });
  refreshScopeStreamingState();
});
