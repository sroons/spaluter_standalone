const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText") || statusEl;
const cpuUsageEl = document.getElementById("cpuUsage");
const cpuValEl = document.getElementById("cpuVal");
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
const peakMeterCanvas = document.getElementById("peakMeterView");
const pulsaretWaveCanvas = document.getElementById("pulsaretWaveView");
const windowWaveCanvas = document.getElementById("windowWaveView");
const dutyWaveCanvas = document.getElementById("dutyWaveView");
const formantWaveCanvas = document.getElementById("formantWaveView");
const formantActivityCanvas = document.getElementById("formantActivityView");
const maskScopeCanvas = document.getElementById("maskScopeView");
const outputScopeLabelEl = document.getElementById("outputScopeLabel");
const peakMeterLabelEl = document.getElementById("peakMeterLabel");
const pulsaretWaveLabelEl = document.getElementById("pulsaretWaveLabel");
const windowWaveLabelEl = document.getElementById("windowWaveLabel");
const dutyWaveLabelEl = document.getElementById("dutyWaveLabel");
const formantWaveLabelEl = document.getElementById("formantWaveLabel");
const formantActivityLabelEl = document.getElementById("formantActivityLabel");
const maskScopeLabelEl = document.getElementById("maskScopeLabel");
const mainScreenSwitchEl = document.getElementById("mainScreenSwitch");
const mainScreenStageEl = document.getElementById("mainScreenStage");
const mainScreenButtons = Array.from(document.querySelectorAll(".nav-btn[data-screen]"));
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
const PARAM_ANIM_TICK_MS_DEFAULT = 33;
const PARAM_ANIM_TICK_MS_RESPONSIVE = 22;
const RESPONSIVE_PREVIEW_MODE_STORAGE_KEY = "spaluter-responsive-preview-v1";
const DEFAULT_RESPONSIVE_PREVIEW_MODE = true;
const MAIN_SCREENS = ["perform", "edit", "mods", "reverb", "presets"];
const SCREEN_SLIDE_MS = 240;
const SWIPE_MIN_DISTANCE_PX = 60;
const SWIPE_MAX_OFF_AXIS_PX = 45;
const SWIPE_MAX_DURATION_MS = 700;
const MIDI_REBIND_DEBOUNCE_MS = 120;
const MIDI_STATE_LOG_MIN_INTERVAL_MS = 250;
const MIDI_CLOCK_TICKS_PER_QUARTER = 24;
const MIDI_CLOCK_SMOOTHING_TICKS = 96;
const MIDI_CLOCK_SYNC_MIN_INTERVAL_MS = 120;
const MIDI_CLOCK_RATE_EPSILON = 0.0005;
const DELAY_CLOCK_HZ_EPSILON = 0.0005;
const RENDERER_HEARTBEAT_MS = 1000;
const DEBUG_FPS = false;
const DEBUG_MIDI_NOTE_REPORTS = false;
let sampleDefaultDir = DEFAULT_SAMPLE_DIR;
let currentSamplePath = "";
let midiAccess = null;
let midiMappings = {};
let midiParamsByCc = new Map();
let activeMidiNotes = [];
let activeMidiNoteNumber = null;
let activeMidiBasePitchValue = null;
let midiClockBpm = null;
let midiClockHz = null;
const midiClockTickTimesMs = [];
let midiClockLastSyncAtMs = 0;
let lastLoggedMidiGate = -1;
let synthRunning = false;
let waveformLayoutDirty = true;
let resizeDebounceTimer = null;
let midiRebindTimer = null;
let rendererHeartbeatTimer = null;
let activeKnobDrag = null;
let logLineCount = 0;
let scopeStreamingEnabled = true;
let scopeStreamingRateHz = ACTIVE_SCOPE_RATE_HZ;
let currentMainScreen = "perform";
let currentViewIndex = 0;
let screenTransitionTimer = null;
let screenTransitionToken = 0;
let currentParamPage = 0;
let lastMidiInputCount = -1;
let lastMidiStateLogAt = 0;
let lastMidiStateKey = "";
let responsivePreviewMode = DEFAULT_RESPONSIVE_PREVIEW_MODE;
const controlMetaByParam = new Map();
const paramValueElByParam = new Map();
const paramSliderByParam = new Map();
const editLfoMarkerByParam = new Map();
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
    params: ["formantCount", "formantTrack", "formant1", "formant2", "formant3", "pan1", "pan2", "pan3"]
  },
  {
    title: "Mask",
    params: ["maskMode", "perFormantMask", "maskAmount", "burstOn", "burstOff"]
  },
  {
    title: "Texture",
    params: ["ampJitter", "timingJitter", "glisson"]
  },
  {
    title: "Voice",
    params: ["gateMode", "voiceCount", "chordType", "basePitch", "attackMs", "releaseMs", "glideMs"]
  },
  {
    title: "EFFECTS",
    params: [
      "revWet", "revTime", "revDamp", "revDiff", "revShimmer", "revMod", "revPreDelay", "revLowCut",
      "dlyWet", "dlyFeedback", "dlySpread", "dlyTimeMs", "dlySyncMode", "dlyClockRatio"
    ]
  },
  {
    title: "Sample",
    params: ["useSample", "sampleRate"]
  }
]);

function loadResponsivePreviewMode() {
  try {
    const raw = localStorage.getItem(RESPONSIVE_PREVIEW_MODE_STORAGE_KEY);
    if (raw === null) return DEFAULT_RESPONSIVE_PREVIEW_MODE;
    return raw === "1" || raw === "true";
  } catch {
    return DEFAULT_RESPONSIVE_PREVIEW_MODE;
  }
}

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
const MAIN_VIEW_COUNT = 1 + PARAM_PAGES.length + 1;
const MODULATION_VIEW_INDEX = MAIN_VIEW_COUNT - 1;
const midiUiByParam = new Map();
// Phase 1.1: per-param last-sent value so we can early-out on no-op set-events
// (CCs at rest re-send the same 7-bit value many times/sec).
const lastSentValueByParam = new Map();
// Phase 1.2: dirty flag + rAF token for waveform redraws so we coalesce
// per-event redraws to at most one per animation frame.
let waveformViewsDirty = false;
let waveformViewsRafId = 0;
let outputScopeDirty = false;
let outputScopeRafId = 0;
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
  sampleRate: 48,
  revWet: 49,
  revTime: 50,
  revDamp: 51,
  revDiff: 52,
  revMod: 53,
  revPreDelay: 54,
  revLowCut: 55,
  revShimmer: 56,
  dlyWet: 57,
  dlyFeedback: 58,
  dlySpread: 59,
  dlyTimeMs: 60,
  dlySyncMode: 61,
  dlyClockRatio: 62
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
// Per-channel scope frame size. MUST match `scopeFrames` in
// spaluter_supercollider.scd: the patch emits scopeFrames L samples followed by
// scopeFrames R samples in one /spaluter/scope payload, and the renderer splits
// the payload into L/R on this boundary. If these drift apart, the R (white)
// trace silently drops and the L trace reads both channels concatenated.
const OUTPUT_SCOPE_FRAME_SIZE = 64;
const OUTPUT_SCOPE_SMOOTHING_ALPHA = 0.35;
const OUTPUT_SCOPE_ZERO_CROSSING_MIN_SLOPE = 0.02;
const OUTPUT_SCOPE_COMPAND_GAMMA = 0.45;
const OUTPUT_SCOPE_COMPAND_MIX = 0.75;
const STEREO_PEAK_HOLD_FRAMES = 14;
const STEREO_PEAK_DECAY_PER_FRAME = 0.03;
const STEREO_HOLD_DECAY_PER_FRAME = 0.012;
const FORMANT_SCOPE_COLORS = ["rgb(235, 110, 79)", "rgb(114, 213, 142)", "rgb(199, 146, 234)"];
const MASK_MODE_NAMES = ["Off", "Stochastic", "Burst"];
const MIDI_STATUS_TYPE_MASK = 0xF0;
const MIDI_STATUS_CHANNEL_MASK = 0x0F;
const MIDI_STATUS_NOTE_OFF = 0x80;
const MIDI_STATUS_NOTE_ON = 0x90;
const MIDI_STATUS_CC = 0xB0;
const MIDI_STATUS_CLOCK = 0xF8;
const MIDI_STATUS_START = 0xFA;
const MIDI_STATUS_CONTINUE = 0xFB;
const MIDI_STATUS_STOP = 0xFC;
const MIDI_INPUT_CHANNEL_ZERO_BASED = 0; // MIDI channel 1
const scopeSampleBuffers = [
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE),
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE)
];
const scopeAlignedBuffers = [
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE),
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE)
];
const scopeRenderBuffers = [
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE),
  new Float64Array(OUTPUT_SCOPE_FRAME_SIZE)
];
let outputScopeSamples = {
  left: scopeRenderBuffers[0],
  right: null
};
let stereoPeakDisplayL = 0;
let stereoPeakDisplayR = 0;
let stereoPeakHoldL = 0;
let stereoPeakHoldR = 0;
let stereoPeakHoldAgeL = 0;
let stereoPeakHoldAgeR = 0;

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
  if (cpuValEl) {
    cpuValEl.textContent = `${safeValue.toFixed(1)}%`;
  } else {
    cpuUsageEl.textContent = `CPU: ${safeValue.toFixed(1)}%`;
  }
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
  // Legacy "Name: value" sibling-label pattern is gone in the card UI; the
  // value readouts are now driven by updateRealtimeParamValue. Kept as a guarded
  // no-op so existing callers (setParamValue, init) don't corrupt the new labels.
  const label = rangeEl.previousElementSibling;
  if (!label || !label.classList.contains("range-readout")) return;
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

// Bipolar [-1, 1] LFO shape sampler matched 1:1 to the SC `\spaluterLfo`
// Select.kr enum (sine, triangle, saw up, saw down, square, S&H, smooth random).
// For the two random shapes the preview is seeded by the LFO index so it is
// stable frame-to-frame; it communicates character, not phase-locked samples.
function lfoShapeSample(shape, phase01, seed = 0) {
  const p = phase01 - Math.floor(phase01);
  switch (shape | 0) {
    case 0:
      return Math.sin(TWO_PI * p);
    case 1: {
      const q = (p + 0.25) - Math.floor(p + 0.25);
      return 1 - (4 * Math.abs(q - 0.5));
    }
    case 2:
      return (2 * p) - 1;
    case 3:
      return 1 - (2 * p);
    case 4:
      return p < 0.5 ? 1 : -1;
    case 5: {
      const steps = 8;
      const step = Math.floor(p * steps);
      return (hashUnit((seed * 131.7) + step + 1) * 2) - 1;
    }
    case 6: {
      const steps = 8;
      const f = p * steps;
      const i0 = Math.floor(f);
      const frac = f - i0;
      const a = (hashUnit((seed * 131.7) + i0 + 1) * 2) - 1;
      const b = (hashUnit((seed * 131.7) + i0 + 2) * 2) - 1;
      const smooth = (1 - Math.cos(frac * Math.PI)) * 0.5;
      return a + ((b - a) * smooth);
    }
    default:
      return 0;
  }
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

function canvasDevicePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 1);
}

function measureCanvasMetrics(canvas) {
  const dpr = canvasDevicePixelRatio();
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
  const dpr = canvasDevicePixelRatio();
  if (cached && !waveformLayoutDirty && cached.dpr === dpr) return cached;
  return measureCanvasMetrics(canvas);
}

function drawWaveform(canvas, sampleFn, minValue = -1, maxValue = 1, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const color = opts.color || "rgb(91, 169, 246)";
  const lineScale = opts.lineWidth || 1.6;
  const glow = opts.glow !== false;

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
  ctx.strokeStyle = "rgba(169, 180, 208, 0.18)";
  ctx.beginPath();
  const centerY = drawHeight * 0.5;
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();

  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const range = maxValue - minValue || 1;

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, dpr * lineScale);
  ctx.strokeStyle = color;
  if (glow) {
    ctx.shadowBlur = dpr * 5;
    ctx.shadowColor = color;
  }
  ctx.beginPath();
  const requestedSamples = Number(opts.sampleCount);
  const samples = Number.isFinite(requestedSamples) && requestedSamples > 0
    ? Math.max(16, Math.floor(requestedSamples))
    : Math.max(48, Math.floor(drawWidth / 2));
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
  ctx.shadowBlur = 0;
}

function drawScopeTrace(ctx, values, metrics, color) {
  if (!values || values.length === 0) return;
  const {
    dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad
  } = metrics;
  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  const sampleAt = (t) => {
    const idx = t * (values.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(values.length - 1, lo + 1);
    const mix = idx - lo;
    return (values[lo] * (1 - mix)) + (values[hi] * mix);
  };
  const shapeScopeSample = (sample) => {
    const dry = clamp(Number(sample) || 0, -1, 1);
    const mag = Math.abs(dry);
    const wet = Math.sign(dry) * Math.pow(mag, OUTPUT_SCOPE_COMPAND_GAMMA);
    return (dry * (1 - OUTPUT_SCOPE_COMPAND_MIX)) + (wet * OUTPUT_SCOPE_COMPAND_MIX);
  };
  ctx.beginPath();
  const samples = Math.max(48, Math.floor(drawWidth / 2));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const sample = shapeScopeSample(sampleAt(t));
    const normalized = clamp((sample + 1) * 0.5, 0, 1);
    const x = leftPad + (t * usableWidth);
    const y = topPad + ((1 - normalized) * usableHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Cheap bloom: a wide, translucent underlay stroke (with the caller's
  // "lighter" compositing) reads as a glow without the heavy offscreen
  // Gaussian pass ctx.shadowBlur triggers — that pass on the large hero
  // canvas at 20Hz was a measurable CPU cost on the Pi.
  const baseAlpha = ctx.globalAlpha;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = baseAlpha * 0.22;
  ctx.lineWidth = Math.max(1, dpr) * 4;
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;
  ctx.lineWidth = Math.max(1, dpr);
  ctx.stroke();
}

function drawOutputScope(canvas, left, right = null) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const metrics = getCanvasMetrics(canvas);
  const {
    dpr, drawWidth, drawHeight
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

  // Use additive ("lighter") compositing so that when L and R are identical
  // (e.g. mono signal at centre pan) the overlapping blue + green strokes
  // sum to a bright cyan that's clearly visible. Without this, the second
  // trace would fully paint over the first and the user would think one
  // channel had disappeared. Alpha < 1 lets the colours mix instead of
  // saturating to white.
  const prevComposite = ctx.globalCompositeOperation;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.85;
  drawScopeTrace(ctx, left, metrics, "#ff6f24");
  if (right && right.length > 0) {
    drawScopeTrace(ctx, right, metrics, "#cfe6ff");
  }
  ctx.globalAlpha = prevAlpha;
  ctx.globalCompositeOperation = prevComposite;
}

function computeScopePeaksFromPayload(samples) {
  if (!Array.isArray(samples) || samples.length === 0) return { leftPeak: 0, rightPeak: 0 };
  let leftPeak = 0;
  let rightPeak = 0;
  let rightCount = 0;
  const leftLimit = Math.min(samples.length, OUTPUT_SCOPE_FRAME_SIZE);
  for (let i = 0; i < leftLimit; i += 1) {
    const l = Math.abs(Number(samples[i]) || 0);
    leftPeak = Math.max(leftPeak, l);
  }
  const rightStart = OUTPUT_SCOPE_FRAME_SIZE;
  const rightLimit = Math.min(samples.length, rightStart + OUTPUT_SCOPE_FRAME_SIZE);
  for (let i = rightStart; i < rightLimit; i += 1) {
    const r = Math.abs(Number(samples[i]) || 0);
    rightPeak = Math.max(rightPeak, r);
    rightCount += 1;
  }
  if (rightCount === 0) rightPeak = leftPeak;
  return { leftPeak: clamp(leftPeak, 0, 1), rightPeak: clamp(rightPeak, 0, 1) };
}

function updateStereoPeakState(leftPeak, rightPeak) {
  stereoPeakDisplayL = Math.max(leftPeak, stereoPeakDisplayL - STEREO_PEAK_DECAY_PER_FRAME);
  stereoPeakDisplayR = Math.max(rightPeak, stereoPeakDisplayR - STEREO_PEAK_DECAY_PER_FRAME);

  if (leftPeak >= stereoPeakHoldL) {
    stereoPeakHoldL = leftPeak;
    stereoPeakHoldAgeL = 0;
  } else {
    stereoPeakHoldAgeL += 1;
    if (stereoPeakHoldAgeL > STEREO_PEAK_HOLD_FRAMES) {
      stereoPeakHoldL = Math.max(stereoPeakDisplayL, stereoPeakHoldL - STEREO_HOLD_DECAY_PER_FRAME);
    }
  }

  if (rightPeak >= stereoPeakHoldR) {
    stereoPeakHoldR = rightPeak;
    stereoPeakHoldAgeR = 0;
  } else {
    stereoPeakHoldAgeR += 1;
    if (stereoPeakHoldAgeR > STEREO_PEAK_HOLD_FRAMES) {
      stereoPeakHoldR = Math.max(stereoPeakDisplayR, stereoPeakHoldR - STEREO_HOLD_DECAY_PER_FRAME);
    }
  }
}

function linearToDb(level) {
  const v = Math.max(1e-4, Number(level) || 0);
  return 20 * Math.log10(v);
}

function drawStereoPeakMeter(canvas) {
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
  const laneGap = Math.max(3 * dpr, usableHeight * 0.08);
  const laneHeight = Math.max(6 * dpr, (usableHeight - laneGap) * 0.5);
  const laneY = [topPad, topPad + laneHeight + laneGap];
  const levels = [stereoPeakDisplayL, stereoPeakDisplayR];
  const holds = [stereoPeakHoldL, stereoPeakHoldR];
  const laneColors = ["#ff6f24", "#cfe6ff"];
  const labels = ["L", "R"];

  for (let i = 0; i < 2; i += 1) {
    const y = laneY[i];
    const level = clamp(levels[i], 0, 1);
    const hold = clamp(holds[i], 0, 1);
    const fillW = level * usableWidth;

    ctx.fillStyle = "rgba(233, 227, 214, 0.05)";
    ctx.fillRect(leftPad, y, usableWidth, laneHeight);

    ctx.fillStyle = laneColors[i];
    ctx.fillRect(leftPad, y, fillW, laneHeight);

    const holdX = leftPad + (hold * usableWidth);
    ctx.strokeStyle = "rgba(240, 245, 255, 0.9)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(holdX, y);
    ctx.lineTo(holdX, y + laneHeight);
    ctx.stroke();

    ctx.fillStyle = "rgba(220, 228, 250, 0.9)";
    ctx.font = `${Math.max(9, Math.round(9 * dpr))}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(labels[i], leftPad + (3 * dpr), y + (laneHeight * 0.5));
  }
}

function drawOutputAnalysisScopes() {
  drawStereoPeakMeter(peakMeterCanvas);
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

function normalizeScopeSamples(samples, channelIndex = 0, sourceOffset = 0) {
  if (!Array.isArray(samples)) return null;
  const sampleBuffer = scopeSampleBuffers[channelIndex];
  const alignedBuffer = scopeAlignedBuffers[channelIndex];
  const renderBuffer = scopeRenderBuffers[channelIndex];
  let sampleCount = 0;
  for (
    let i = sourceOffset;
    i < samples.length && sampleCount < OUTPUT_SCOPE_FRAME_SIZE;
    i += 1
  ) {
    const value = Number(samples[i]);
    if (!Number.isFinite(value)) continue;
    sampleBuffer[sampleCount] = value;
    sampleCount += 1;
  }
  if (sampleCount === 0) return null;
  while (sampleCount < OUTPUT_SCOPE_FRAME_SIZE) {
    sampleBuffer[sampleCount] = sampleBuffer[sampleCount - 1] ?? 0;
    sampleCount += 1;
  }
  const offset = findScopeZeroCrossingOffset(sampleBuffer, OUTPUT_SCOPE_FRAME_SIZE);
  for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    const sourceIndex = (i + offset) % OUTPUT_SCOPE_FRAME_SIZE;
    alignedBuffer[i] = sampleBuffer[sourceIndex];
  }
  for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
    const currentValue = Number(renderBuffer[i]) || 0;
    const targetValue = Number(alignedBuffer[i]) || 0;
    renderBuffer[i] = currentValue + ((targetValue - currentValue) * OUTPUT_SCOPE_SMOOTHING_ALPHA);
  }
  return renderBuffer;
}

function scheduleOutputScopeRedraw() {
  outputScopeDirty = true;
  if (outputScopeRafId) return;
  outputScopeRafId = window.requestAnimationFrame(() => {
    outputScopeRafId = 0;
    if (!outputScopeDirty) return;
    outputScopeDirty = false;
    if (currentMainScreen !== "perform") return;
    drawOutputScope(outputScopeCanvas, outputScopeSamples.left, outputScopeSamples.right);
    drawOutputAnalysisScopes();
  });
}

function setOutputScopeSamples(samples, label = "Live output") {
  const peaks = computeScopePeaksFromPayload(samples);
  const left = normalizeScopeSamples(samples, 0, 0);
  if (!left) return;
  const right = samples.length >= (OUTPUT_SCOPE_FRAME_SIZE * 2)
    ? normalizeScopeSamples(samples, 1, OUTPUT_SCOPE_FRAME_SIZE)
    : null;
  outputScopeSamples = { left, right };
  updateStereoPeakState(peaks.leftPeak, peaks.rightPeak);
  if (peakMeterLabelEl) {
    peakMeterLabelEl.textContent = `L ${linearToDb(peaks.leftPeak).toFixed(1)} dB • R ${linearToDb(peaks.rightPeak).toFixed(1)} dB`;
  }
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  // Only paint the scope/peak canvases when Perform is on screen. The scope
  // payload still streams at 20Hz to keep peak state and labels current, but
  // canvas drawing is coalesced to one paint per animation frame. The canvases
  // are repainted on screen entry by handleMainScreenEntered().
  if (currentMainScreen === "perform") {
    scheduleOutputScopeRedraw();
  }
}

function clearOutputScope(label = "Waiting for synth...") {
  for (let ch = 0; ch < scopeRenderBuffers.length; ch += 1) {
    for (let i = 0; i < OUTPUT_SCOPE_FRAME_SIZE; i += 1) {
      scopeRenderBuffers[ch][i] = 0;
    }
  }
  stereoPeakDisplayL = 0;
  stereoPeakDisplayR = 0;
  stereoPeakHoldL = 0;
  stereoPeakHoldR = 0;
  stereoPeakHoldAgeL = 0;
  stereoPeakHoldAgeR = 0;
  outputScopeSamples = { left: scopeRenderBuffers[0], right: scopeRenderBuffers[1] };
  if (peakMeterLabelEl) peakMeterLabelEl.textContent = "L -inf dB • R -inf dB";
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  drawOutputScope(outputScopeCanvas, outputScopeSamples.left, outputScopeSamples.right);
  drawOutputAnalysisScopes();
}

function computeWaveformValues(nowSec) {
  return {
    pulsaret: currentParamValue("pulsaret", 2.5) + lfoModOffset("pulsaret", nowSec),
    windowType: currentParamValue("window", 0.5) + lfoModOffset("window", nowSec),
    duty: clamp(currentParamValue("duty", 0.5) + lfoModOffset("duty", nowSec), 0.01, 1),
    dutyMode: currentParamValue("dutyMode", 0) > 0.5 ? "Formant" : "Manual",
    formantCount: clamp(Math.round(currentParamValue("formantCount", 2)), 1, 3),
    formantTrackOn: currentParamValue("formantTrack", 0) > 0.5,
    maskMode: clamp(Math.round(currentParamValue("maskMode", 0)), 0, 2),
    perFormantMask: currentParamValue("perFormantMask", 0) > 0.5,
    maskAmount: clamp(currentParamValue("maskAmount", 0.5) + lfoModOffset("maskAmount", nowSec), 0, 1),
    burstOn: Math.max(0, Math.round(currentParamValue("burstOn", 4))),
    burstOff: Math.max(0, Math.round(currentParamValue("burstOff", 0))),
    formantHzValues: [
      clamp(currentParamValue("formant1", 20) + lfoModOffset("formant1", nowSec), 20, 8000),
      clamp(currentParamValue("formant2", 200) + lfoModOffset("formant2", nowSec), 20, 8000),
      clamp(currentParamValue("formant3", 400) + lfoModOffset("formant3", nowSec), 20, 8000)
    ]
  };
}

function drawPulsaretView(v) {
  if (!pulsaretWaveCanvas) return;
  if (pulsaretWaveLabelEl) {
    pulsaretWaveLabelEl.textContent = `PULSARET · ${interpolatedWaveLabel(v.pulsaret, PULSARET_WAVE_NAMES)}`;
  }
  drawWaveform(
    pulsaretWaveCanvas,
    (t) => interpolatedWaveSample(v.pulsaret, 9, pulsaretWaveSample, t),
    -1,
    1,
    { color: "#ff6f24", lineWidth: 1.9 }
  );
}

function drawWindowView(v) {
  if (!windowWaveCanvas) return;
  if (windowWaveLabelEl) {
    windowWaveLabelEl.textContent = `WINDOW · ${interpolatedWaveLabel(v.windowType, WINDOW_WAVE_NAMES)}`;
  }
  drawWaveform(
    windowWaveCanvas,
    (t) => interpolatedWaveSample(v.windowType, 8, windowWaveSample, t),
    0,
    1,
    { color: "#1f8bff", lineWidth: 1.9 }
  );
}

function drawDutyView(v) {
  if (!dutyWaveCanvas) return;
  if (dutyWaveLabelEl) {
    dutyWaveLabelEl.textContent = `DUTY · ${v.duty.toFixed(2)} • ${v.dutyMode}`;
  }
  drawDutyScopeWithOverlay(dutyWaveCanvas, v.duty, v.windowType);
}

function drawFormantViews(v) {
  if (!formantWaveCanvas && !formantActivityCanvas) return;
  if (formantWaveLabelEl) {
    const activeLabels = v.formantHzValues
      .slice(0, v.formantCount)
      .map((hz, index) => `F${index + 1} ${Math.round(hz)} Hz`);
    formantWaveLabelEl.textContent = activeLabels.join(" • ");
  }
  if (formantActivityLabelEl) {
    const trackText = v.formantTrackOn ? "Tracked" : "Static";
    formantActivityLabelEl.textContent = `${trackText} • Mask-aware`;
  }
  drawFormantWaves(formantWaveCanvas, v.formantHzValues, v.formantCount);
  drawFormantActivityHeatmap(
    formantActivityCanvas,
    v.formantHzValues,
    v.formantCount,
    v.formantTrackOn,
    v.maskMode,
    v.perFormantMask,
    v.maskAmount,
    v.burstOn,
    v.burstOff
  );
}

function drawMaskView(v) {
  if (!maskScopeCanvas) return;
  if (maskScopeLabelEl) {
    const mode = MASK_MODE_NAMES[v.maskMode] || MASK_MODE_NAMES[0];
    const perFormantState = v.perFormantMask ? "PF on" : "PF off";
    maskScopeLabelEl.textContent = `${mode} • ${perFormantState} • ${v.maskAmount.toFixed(2)}`;
  }
  drawMaskScope(
    maskScopeCanvas,
    v.maskMode,
    v.perFormantMask,
    v.maskAmount,
    v.burstOn,
    v.burstOff,
    v.formantCount
  );
}

function updateWaveformViews() {
  const v = computeWaveformValues(performance.now() / 1000);
  drawPulsaretView(v);
  drawWindowView(v);
  drawDutyView(v);
  drawFormantViews(v);
  drawMaskView(v);
  if (currentMainScreen === "perform") {
    drawOutputScope(outputScopeCanvas, outputScopeSamples.left, outputScopeSamples.right);
    drawOutputAnalysisScopes();
  }
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
    const unit = valueEl.dataset ? valueEl.dataset.unit : "";
    valueEl.textContent = formatParamValue(param, numericValue) + (unit || "");
  }

  const sliderEl = paramSliderByParam.get(param);
  if (!sliderEl) return;

  const meta = getControlMeta(param);
  if (!meta) return;
  if (meta.type === "discrete") {
    const discreteIndex = meta.values.indexOf(numericValue);
    if (discreteIndex >= 0 && sliderEl.classList.contains("param-value-slider")) {
      sliderEl.value = String(discreteIndex);
    }
    return;
  }

  if (sliderEl.classList.contains("edit-slider")) {
    sliderEl.value = String(numericValue);
    refreshSliderFill(sliderEl);
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
  // The Edit screen now uses static grouped cards (see initEditCards). The old
  // auto-generated, paged param grid has been retired; this is intentionally a
  // no-op so it never clears the value/slider maps that initEditCards populates.
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

function midiClockRateHz() {
  if (!Number.isFinite(midiClockHz)) return null;
  return clamp(midiClockHz, LFO_RATE_MIN, LFO_RATE_MAX);
}

function effectiveDelayClockHz() {
  if (!Number.isFinite(midiClockHz) || midiClockHz <= 0) return 0;
  return midiClockHz;
}

function syncDelayClockParam(force = false) {
  const nextHz = effectiveDelayClockHz();
  const previousHz = lastSentValueByParam.get("dlyClockHz");
  if (!force && Number.isFinite(previousHz) && Math.abs(previousHz - nextHz) <= DELAY_CLOCK_HZ_EPSILON) return;
  setParamValue("dlyClockHz", nextHz, true);
}

// Base Time is ignored by the engine in MIDI Clock mode (the delay follows the
// incoming tempo × Clock Ratio), so disable its slider to make that clear.
function updateDelayBaseTimeEnabled(syncModeValue) {
  const slider = paramSliderByParam.get("dlyTimeMs");
  if (!slider) return;
  const mode = Number.isFinite(syncModeValue) ? syncModeValue : currentParamValue("dlySyncMode", 0);
  const clockMode = mode > 0.5;
  slider.disabled = clockMode;
  const ctl = slider.closest(".ctl");
  if (ctl) ctl.classList.toggle("ctl-disabled", clockMode);
}

function syncMidiClockLockedLfos(nowMs = performance.now(), force = false) {
  const clockRate = midiClockRateHz();
  if (clockRate === null) return;
  if (!force && (nowMs - midiClockLastSyncAtMs) < MIDI_CLOCK_SYNC_MIN_INTERVAL_MS) return;

  const changed = [];
  for (let i = 0; i < LFO_MAX; i += 1) {
    const cfg = lfoConfigs[i];
    if (!cfg?.useMidiClock) continue;
    const nextRate = clamp(clockRate * lfoClockRatioValue(cfg), LFO_RATE_MIN, LFO_RATE_MAX);
    if (Math.abs(cfg.rate - nextRate) <= MIDI_CLOCK_RATE_EPSILON) continue;
    cfg.rate = nextRate;
    changed.push(i);
  }
  midiClockLastSyncAtMs = nowMs;
  if (changed.length === 0) return;

  changed.forEach((idx) => {
    if (lfoStripEls[idx]) refreshLfoStrip(idx);
  });

  const payload = changed.map((idx) => lfoToIpc(idx));
  if (payload.length === 1) {
    window.spaluterApi.setLfo(payload[0].idx, payload[0]);
  } else if (payload.length > 1) {
    window.spaluterApi.setLfoMany(payload);
  }

  if (currentMainScreen === "edit") scheduleWaveformViewsRedraw();
}

function resetMidiClockTracking() {
  midiClockTickTimesMs.length = 0;
  midiClockLastSyncAtMs = 0;
  midiClockBpm = null;
  midiClockHz = null;
}

function handleMidiRealtimeMessage(status) {
  if (status === MIDI_STATUS_START || status === MIDI_STATUS_CONTINUE || status === MIDI_STATUS_STOP) {
    resetMidiClockTracking();
    syncDelayClockParam(true);
    return;
  }
  if (status !== MIDI_STATUS_CLOCK) return;

  const nowMs = performance.now();
  midiClockTickTimesMs.push(nowMs);
  if (midiClockTickTimesMs.length > MIDI_CLOCK_SMOOTHING_TICKS) midiClockTickTimesMs.shift();
  if (midiClockTickTimesMs.length < 8) return;

  const first = midiClockTickTimesMs[0];
  const last = midiClockTickTimesMs[midiClockTickTimesMs.length - 1];
  const intervals = midiClockTickTimesMs.length - 1;
  if (last <= first || intervals <= 0) return;

  const avgTickMs = (last - first) / intervals;
  if (!Number.isFinite(avgTickMs) || avgTickMs <= 0) return;

  const bpm = 60000 / (avgTickMs * MIDI_CLOCK_TICKS_PER_QUARTER);
  if (!Number.isFinite(bpm) || bpm <= 0) return;

  midiClockBpm = bpm;
  midiClockHz = bpm / 60;
  syncMidiClockLockedLfos(nowMs);
  syncDelayClockParam();
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
  activeMidiNoteNumber = clamp(Math.round(Number(noteNumber)), 0, 127);
  activeMidiBasePitchValue = value;
  stagePendingParam("basePitch", value);
}

function midiNoteMatchesActiveBasePitch(noteNumber) {
  const note = clamp(Math.round(Number(noteNumber)), 0, 127);
  if (activeMidiNoteNumber !== null && note === activeMidiNoteNumber) return true;
  if (activeMidiBasePitchValue === null) return false;
  const noteBasePitch = normalizeParamValue("basePitch", midiNoteToHz(note));
  if (noteBasePitch === null) return false;
  return Math.abs(noteBasePitch - activeMidiBasePitchValue) <= 1e-6;
}

function updateGateFromMidiNotes(forcedGateValue = null) {
  // Phase 1.4: collapse the prior two ipcRenderer.invoke calls (one for
  // `gate`, one for `trigIn`) into staged entries that drain together on
  // the next rAF. Once Phase 2 lands, the drain will emit a single
  // setParamMany() IPC + OSC bundle, fully closing the 2x amplification.
  const gateValue = forcedGateValue === null
    ? (activeMidiNotes.length > 0 ? 1 : 0)
    : (forcedGateValue ? 1 : 0);
  stagePendingParam("gate", gateValue);
  stagePendingParam("trigIn", gateValue);
  if (DEBUG_MIDI_NOTE_REPORTS && gateValue !== lastLoggedMidiGate) {
    lastLoggedMidiGate = gateValue;
    try {
      window.spaluterApi.reportMidiNote(
        `gate ${gateValue} (held=${activeMidiNotes.length} gateMode=${currentParamValue("gateMode", 1)})`
      );
    } catch (_e) { /* diagnostic only */ }
  }
}

function handleMidiNoteMessage(status, noteNumber, velocity) {
  const messageType = status & MIDI_STATUS_TYPE_MASK;
  const note = clamp(Math.round(Number(noteNumber)), 0, 127);
  const vel = clamp(Math.round(Number(velocity)), 0, 127);
  const isNoteOn = messageType === MIDI_STATUS_NOTE_ON && vel > 0;
  const isNoteOff = messageType === MIDI_STATUS_NOTE_OFF || (messageType === MIDI_STATUS_NOTE_ON && vel === 0);
  const wasActive = activeMidiNotes.includes(note);

  if (isNoteOn) {
    releaseActiveMidiNote(note);
    activeMidiNotes.push(note);
    applyMidiNotePitch(note);
    updateGateFromMidiNotes();
    retriggerLfosForMidiNote();
    return;
  }

  if (!isNoteOff) return;

  const noteMatchesActivePitch = midiNoteMatchesActiveBasePitch(note);
  releaseActiveMidiNote(note);
  if (!noteMatchesActivePitch) return;
  activeMidiNoteNumber = null;
  activeMidiBasePitchValue = null;
  // On Note Off in MIDI note mode, always release and stay silent until a
  // subsequent Note On. Do not retune/reconfigure the note being released.
  updateGateFromMidiNotes(0);
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
  if (!data || data.length < 1) return;
  // Phase 2.3 telemetry: count every raw incoming MIDI message so main can
  // compute the (raw vs flushed) compression ratio. Coalesced via the same
  // rAF tick as the CC drain to avoid one IPC per event.
  midiRawCountWindow += 1;
  scheduleMidiRawReport();
  const status = data[0] | 0;
  if (status >= MIDI_STATUS_CLOCK) {
    handleMidiRealtimeMessage(status);
    return;
  }
  if (data.length < 3) return;
  const data1 = data[1] | 0;
  const data2 = data[2] | 0;
  const messageType = status & MIDI_STATUS_TYPE_MASK;
  const channel = status & MIDI_STATUS_CHANNEL_MASK;

  if ((messageType === MIDI_STATUS_CC
      || messageType === MIDI_STATUS_NOTE_ON
      || messageType === MIDI_STATUS_NOTE_OFF)
    && channel !== MIDI_INPUT_CHANNEL_ZERO_BASED) {
    return;
  }

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
    // Phase D: MIDI note-on/off are handled by sclang (MIDIdef on the language
    // thread), not here, so note timing is immune to renderer/UI load (view
    // switches, repaint bursts). The renderer still receives these messages on
    // the same ALSA port but intentionally ignores them to avoid double-driving
    // gate/basePitch. CC + clock continue to be handled in the renderer.
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

function balancedPanDefaultsForFormantCount(formantCountRaw) {
  const count = clamp(Math.round(Number(formantCountRaw) || 3), 1, 3);
  if (count <= 1) {
    return { pan1: 0, pan2: 0, pan3: 0 };
  }
  if (count === 2) {
    return { pan1: 0, pan2: 0, pan3: 0 };
  }
  return { pan1: 0, pan2: 0.5, pan3: -0.5 };
}

function applyBalancedPansForFormantCount(formantCount, send = true) {
  const defaults = balancedPanDefaultsForFormantCount(formantCount);
  setParamValue("pan1", defaults.pan1, send);
  setParamValue("pan2", defaults.pan2, send);
  setParamValue("pan3", defaults.pan3, send);
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
      const previousValue = select.value;
      select.value = valueStr;
      if (select.value !== previousValue) {
        select.dispatchEvent(new Event("spaluter:param-sync"));
      }
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

  if (param === "formantCount") {
    applyBalancedPansForFormantCount(value, send);
  }

  if (param === "dlySyncMode") {
    updateDelayBaseTimeEnabled(value);
  }

  updateRealtimeParamValue(param, value);
  if (currentMainScreen === "edit" && editLfoMarkerByParam.has(param)) {
    updateEditLfoMarkers();
  }
  if (send) {
    lastSentValueByParam.set(param, value);
    window.spaluterApi.setParam(param, value);
    if (param === "dlySyncMode" || param === "dlyClockRatio" || param === "dlyTimeMs") {
      syncDelayClockParam(true);
    }
  }
  return true;
}

// ─────────────────────────── Internal LFO modulation ───────────────────────
// Client-side model + UI for the engine's 16 assignable LFOs. All shape
// previews are synthesized from each LFO's config (no SC streaming), matching
// the "don't stream modulated values back" rule. Config order + depth caps
// mirror sc/runtime.scd (modParams / modDepthCap) exactly.
const LFO_MAX = 16;
const LFO_RATE_MIN = 0.01;
const LFO_RATE_MAX = 20;
// When free-running (not MIDI clock), the rate slider position 0..1 maps to Hz on an
// exponential curve so slow rates get more of the slider travel: rate = MIN*(MAX/MIN)^pos.
const LFO_RATE_LOG_SPAN = Math.log(LFO_RATE_MAX / LFO_RATE_MIN);
function lfoRateToSliderPos(rate) {
  const r = clamp(Number(rate) || LFO_RATE_MIN, LFO_RATE_MIN, LFO_RATE_MAX);
  return clamp(Math.log(r / LFO_RATE_MIN) / LFO_RATE_LOG_SPAN, 0, 1);
}
function lfoSliderPosToRate(pos) {
  const p = clamp(Number(pos) || 0, 0, 1);
  return clamp(LFO_RATE_MIN * Math.exp(LFO_RATE_LOG_SPAN * p), LFO_RATE_MIN, LFO_RATE_MAX);
}
const LFO_CONFIG_VERSION = 3;
const LFO_SHAPE_NAMES = ["Sine", "Triangle", "Saw Up", "Saw Down", "Square", "S&H", "Smooth Rnd"];
const LFO_CLOCK_RATIO_OPTIONS = (() => {
  const options = [];
  for (let d = 16; d >= 2; d -= 1) {
    options.push({ label: `/${d}`, value: 1 / d });
  }
  options.push({ label: "x1", value: 1 });
  for (let m = 2; m <= 16; m += 1) {
    options.push({ label: `x${m}`, value: m });
  }
  return options;
})();
const LFO_TARGETS = [
  { name: "none", label: "— none —", cap: 0 },
  { name: "amp", label: "Amplitude", cap: 0.5 },
  { name: "drive", label: "Drive", cap: 0.5 },
  { name: "pulsaret", label: "Pulsaret", cap: 2.0 },
  { name: "window", label: "Window", cap: 0.5 },
  { name: "duty", label: "Duty", cap: 0.5 },
  { name: "formant1", label: "Formant 1", cap: 1000 },
  { name: "formant2", label: "Formant 2", cap: 1000 },
  { name: "formant3", label: "Formant 3", cap: 1000 },
  { name: "maskAmount", label: "Mask Amount", cap: 0.5 },
  { name: "pan1", label: "Pan 1", cap: 1.0 },
  { name: "pan2", label: "Pan 2", cap: 1.0 },
  { name: "pan3", label: "Pan 3", cap: 1.0 },
  { name: "ampJitter", label: "Amp Jitter", cap: 0.5 },
  { name: "timingJitter", label: "Timing Jitter", cap: 0.5 },
  { name: "glisson", label: "Glisson", cap: 0.5 },
  { name: "basePitch", label: "Base Pitch (st)", cap: 12 },
  { name: "attackMs", label: "Attack (ms)", cap: 500 },
  { name: "releaseMs", label: "Release (ms)", cap: 800 },
  { name: "glideMs", label: "Glide (ms)", cap: 500 },
  { name: "sampleRate", label: "Sample Rate", cap: 0.25 }
];
const LFO_TARGET_BY_NAME = new Map(LFO_TARGETS.map((t) => [t.name, t]));

function defaultLfoConfig() {
  return {
    target: "none",
    rate: 1,
    depth: 0,
    shape: 0,
    enabled: false,
    phase: 0,
    useMidiClock: false,
    clockRatio: 1
  };
}

let lfoConfigs = Array.from({ length: LFO_MAX }, defaultLfoConfig);
const lfoRetriggerEpochSec = Array.from({ length: LFO_MAX }, () => 0);
// All 16 LFOs are always presented and always live on the engine; each one's
// `enabled` flag (not the count) decides whether it actually runs.
let lfoCount = LFO_MAX;
let lfoCursorRafId = 0;
let lfoCursorLast = 0;

const lfoOverviewEl = document.getElementById("lfoOverview");
const lfoStripListEl = document.getElementById("lfoStripList");
const lfoImpactMatrixEl = document.getElementById("lfoImpactMatrix");
const lfoCountHintEl = document.getElementById("lfoCountHint");
const lfoStripEls = [];
const lfoImpactMatrixRows = [];
const lfoThumbCacheByCanvas = new WeakMap();
let lfoImpactMatrixLastUpdate = 0;

function lfoCapFor(targetName) {
  const t = LFO_TARGET_BY_NAME.get(targetName);
  return t ? t.cap : 0;
}

function lfoHue(index) {
  return (index * 47) % 360;
}

function lfoAccent(index) {
  return `hsl(${lfoHue(index)}, 70%, 62%)`;
}

function lfoDepthFractionSigned(cfg) {
  const cap = lfoCapFor(cfg.target);
  if (cap <= 0) return 0;
  return clamp(cfg.depth / cap, -1, 1);
}

function lfoClockRatioIndexFromValue(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return LFO_CLOCK_RATIO_OPTIONS.findIndex((opt) => opt.value === 1);
  let bestIndex = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < LFO_CLOCK_RATIO_OPTIONS.length; i += 1) {
    const dist = Math.abs(LFO_CLOCK_RATIO_OPTIONS[i].value - v);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function lfoClockRatioFromIndex(index) {
  const idx = clamp(Math.round(Number(index) || 0), 0, LFO_CLOCK_RATIO_OPTIONS.length - 1);
  return LFO_CLOCK_RATIO_OPTIONS[idx].value;
}

function lfoClockRatioLabel(value) {
  const idx = lfoClockRatioIndexFromValue(value);
  return LFO_CLOCK_RATIO_OPTIONS[idx].label;
}

function lfoClockRatioValue(cfg) {
  return lfoClockRatioFromIndex(lfoClockRatioIndexFromValue(cfg?.clockRatio));
}

function lfoIsActive(cfg) {
  return Boolean(cfg.enabled) && cfg.target !== "none" && Math.abs(cfg.depth) > 0;
}

function hasAnyRunningLfo() {
  for (let i = 0; i < LFO_MAX; i += 1) {
    if (lfoIsActive(lfoConfigs[i])) return true;
  }
  return false;
}

// Parameters that have a synthetic (client-rendered) scope preview which is
// computed from the knob value rather than live audio. These previews must add
// the LFO offset so the modulation is visible. amp/drive/pan/jitter etc. show
// up in the real audio output scope already, so they are intentionally absent.
const LFO_SYNTH_VIEW_TARGETS = new Set([
  "pulsaret", "window", "duty", "formant1", "formant2", "formant3", "maskAmount"
]);
const LFO_EDIT_MARKER_TARGETS = new Set(
  LFO_TARGETS.filter((target) => target.name !== "none").map((target) => target.name)
);

// Live modulation offset (native units) applied to `param` at time nowSec,
// summing every enabled LFO that targets it. Mirrors the engine: each LFO adds
// depth * shape(phase) to its target's mod-bus channel. Random shapes are
// seeded by LFO index for a stable-looking preview (character, not phase-lock).
function lfoModOffset(param, nowSec) {
  let sum = 0;
  for (let i = 0; i < LFO_MAX; i += 1) {
    const c = lfoConfigs[i];
    if (!c.enabled || c.target !== param || c.depth === 0) continue;
    const phase01 = lfoRuntimePhase01(i, c, nowSec);
    sum += c.depth * lfoShapeSample(c.shape, phase01, i);
  }
  return sum;
}

function lfoRuntimePhase01(index, cfg, nowSec) {
  const epoch = lfoRetriggerEpochSec[index] || 0;
  return ((((((nowSec - epoch) * cfg.rate) + cfg.phase) % 1) + 1) % 1);
}

function hasRunningLfoTarget(param) {
  for (let i = 0; i < LFO_MAX; i += 1) {
    const cfg = lfoConfigs[i];
    if (lfoIsActive(cfg) && cfg.target === param) return true;
  }
  return false;
}

function lfoInstantContribution(cfg, index, nowSec) {
  if (!lfoIsActive(cfg)) return 0;
  const phase01 = lfoRuntimePhase01(index, cfg, nowSec);
  return cfg.depth * lfoShapeSample(cfg.shape, phase01, index);
}

function retriggerLfosForMidiNote(nowSec = performance.now() / 1000) {
  const gateMode = clamp(Math.round(currentParamValue("gateMode", 1)), 0, 2);
  if (gateMode !== 0) return;

  let retriggered = 0;
  for (let i = 0; i < LFO_MAX; i += 1) {
    if (!lfoIsActive(lfoConfigs[i])) continue;
    lfoRetriggerEpochSec[i] = nowSec;
    retriggered += 1;
  }
  if (retriggered === 0) return;

  window.spaluterApi.retriggerLfos();
  if (currentMainScreen === "mods") {
    refreshLfoImpactMatrix(nowSec, true);
    for (let i = 0; i < LFO_MAX; i += 1) {
      if (lfoStripEls[i]) refreshLfoStripImpact(i, nowSec);
    }
    scheduleLfoCursor();
  }
  if (currentMainScreen === "edit") updateEditLfoMarkers(nowSec);
}

function clampToParamMeta(param, value) {
  const meta = getControlMeta(param);
  if (!meta || meta.type !== "continuous") return value;
  return clamp(value, meta.min, meta.max);
}

function formatParamDelta(param, value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return "0";
  const meta = getControlMeta(param);
  if (meta?.type === "continuous") {
    return v.toFixed(decimalsFromStep(meta.step, 2));
  }
  return v.toFixed(2);
}

function updateEditLfoMarkers(nowSec = performance.now() / 1000) {
  editLfoMarkerByParam.forEach((marker, param) => {
    const slider = paramSliderByParam.get(param);
    const meta = getControlMeta(param);
    if (!marker || !slider || !meta || meta.type !== "continuous") {
      if (marker) marker.classList.remove("on");
      if (slider) slider.classList.remove("lfo-targeted");
      return;
    }
    const base = currentParamValue(param, Number(slider.value));
    const live = clamp(base + lfoModOffset(param, nowSec), meta.min, meta.max);
    const frac = meta.max > meta.min ? clamp((live - meta.min) / (meta.max - meta.min), 0, 1) : 0.5;
    marker.style.left = `${(frac * 100).toFixed(2)}%`;
    const active = hasRunningLfoTarget(param);
    marker.classList.toggle("on", active);
    slider.classList.toggle("lfo-targeted", active);
  });
}

function anyActiveLfoTargetsSynthView() {
  for (let i = 0; i < LFO_MAX; i += 1) {
    const c = lfoConfigs[i];
    if (lfoIsActive(c) && LFO_SYNTH_VIEW_TARGETS.has(c.target)) return true;
  }
  return false;
}

// True if any enabled LFO targets one of `params`.
function anyActiveLfoTargets(params) {
  for (let i = 0; i < LFO_MAX; i += 1) {
    const c = lfoConfigs[i];
    if (lfoIsActive(c) && params.has(c.target)) return true;
  }
  return false;
}

const FORMANT_MOD_TARGETS = new Set(["formant1", "formant2", "formant3"]);
const PULSARET_MOD = new Set(["pulsaret"]);
const WINDOW_MOD = new Set(["window"]);
const DUTY_MOD = new Set(["duty"]);
const MASK_MOD = new Set(["maskAmount"]);

// Redraw ONLY the synthetic-view canvases whose params are currently being
// modulated, keeping per-frame cost proportional to what's actually moving
// (the formant heatmap is the only heavy draw and is skipped unless a
// formant/mask LFO is active). The live audio output scope/analysis are driven
// separately by incoming scope data, so they're not touched here.
function redrawModulatedParamViews(nowSec = performance.now() / 1000) {
  const v = computeWaveformValues(nowSec);
  const formantActive = anyActiveLfoTargets(FORMANT_MOD_TARGETS);
  const maskActive = anyActiveLfoTargets(MASK_MOD);
  if (anyActiveLfoTargets(PULSARET_MOD)) drawPulsaretView(v);
  if (anyActiveLfoTargets(WINDOW_MOD)) {
    drawWindowView(v);
    drawDutyView(v); // duty overlay renders the window curve
  }
  if (anyActiveLfoTargets(DUTY_MOD)) drawDutyView(v);
  if (formantActive) drawFormantViews(v);
  if (maskActive) {
    drawMaskView(v);
    if (!formantActive) drawFormantViews(v); // heatmap is mask-aware
  }
}

// Animation driver for the synthetic scope previews while an LFO sweeps a
// synthetic-view param. The clock comes from the MAIN process over IPC
// ("param-anim-tick"): the renderer's own setInterval/requestAnimationFrame are
// throttled to ~1 Hz on the Pi's occluded Xorg kiosk window, but IPC-receipt
// callbacks paint at the full push rate (the live output scope proves this).
// Self-gates on the active screen + LFO state and stops (after one settling
// redraw) otherwise.
let paramModActive = false;

function paramModNeedsAnim() {
  return currentMainScreen === "edit"
    && (anyActiveLfoTargetsSynthView() || anyActiveLfoTargets(LFO_EDIT_MARKER_TARGETS));
}

function desiredParamAnimTickMs() {
  return responsivePreviewMode ? PARAM_ANIM_TICK_MS_RESPONSIVE : PARAM_ANIM_TICK_MS_DEFAULT;
}

function scheduleParamModAnim() {
  refreshScopeStreamingState();
  if (!paramModNeedsAnim()) return;
  const tickMs = desiredParamAnimTickMs();
  if (paramModActive) {
    window.spaluterApi.setParamAnimActive(true, tickMs);
    return;
  }
  paramModActive = true;
  window.spaluterApi.setParamAnimActive(true, tickMs);
}

function stopParamModAnim() {
  if (!paramModActive) return;
  paramModActive = false;
  window.spaluterApi.setParamAnimActive(false);
  updateEditLfoMarkers();
  refreshScopeStreamingState();
}

window.spaluterApi.onParamAnimTick(() => {
  if (!paramModNeedsAnim()) {
    stopParamModAnim();
    updateWaveformViews(); // settle scopes back to their static value
    updateEditLfoMarkers();
    return;
  }
  const nowSec = performance.now() / 1000;
  if (anyActiveLfoTargetsSynthView()) redrawModulatedParamViews(nowSec);
  updateEditLfoMarkers(nowSec);
});

function drawLfoCursor(canvas, cursorT) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const metrics = getCanvasMetrics(canvas);
  const { leftPad, rightPad, drawHeight, dpr } = metrics;
  const usableWidth = Math.max(1, rightPad - leftPad);
  const x = leftPad + ((cursorT - Math.floor(cursorT)) * usableWidth);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, drawHeight);
  ctx.stroke();
}

function lfoThumbCacheKey(metrics, cfg, seed) {
  const depthFrac = lfoDepthFractionSigned(cfg);
  const active = lfoIsActive(cfg) ? 1 : 0;
  return `${metrics.drawWidth}x${metrics.drawHeight}|${seed}|${cfg.shape}|${cfg.phase.toFixed(4)}|${depthFrac.toFixed(4)}|${cfg.depth.toFixed(4)}|${active}`;
}

function renderLfoThumbBase(canvas, cfg, seed) {
  const active = lfoIsActive(cfg);
  const amp = active ? Math.max(0.08, Math.abs(lfoDepthFractionSigned(cfg))) : 0.55;
  const sign = cfg.depth < 0 ? -1 : 1;
  const accent = lfoCardAccent(seed || 0);
  drawWaveform(
    canvas,
    (t) => sign * amp * lfoShapeSample(cfg.shape, t + cfg.phase, seed),
    -1,
    1,
    { color: accent, lineWidth: 1.9, glow: false, sampleCount: 96 }
  );
}

function ensureLfoThumbCache(canvas, cfg, seed) {
  if (!canvas) return null;
  const metrics = getCanvasMetrics(canvas);
  const key = lfoThumbCacheKey(metrics, cfg, seed);
  let cache = lfoThumbCacheByCanvas.get(canvas);
  if (cache && cache.key === key && cache.baseCanvas) return cache;

  renderLfoThumbBase(canvas, cfg, seed);
  const baseCanvas = cache?.baseCanvas || document.createElement("canvas");
  if (baseCanvas.width !== canvas.width || baseCanvas.height !== canvas.height) {
    baseCanvas.width = canvas.width;
    baseCanvas.height = canvas.height;
  }
  const baseCtx = baseCanvas.getContext("2d");
  if (!baseCtx) return null;
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.drawImage(canvas, 0, 0);
  cache = { key, baseCanvas };
  lfoThumbCacheByCanvas.set(canvas, cache);
  return cache;
}

function drawLfoThumb(canvas, cfg, seed, cursorT = null) {
  if (!canvas) return;
  const cache = ensureLfoThumbCache(canvas, cfg, seed);
  if (!cache?.baseCanvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cache.baseCanvas, 0, 0);
  if (lfoIsActive(cfg) && cursorT !== null) drawLfoCursor(canvas, cursorT);
}

function lfoField(labelText) {
  const field = document.createElement("div");
  field.className = "lfo-field";
  const label = document.createElement("label");
  const text = document.createElement("span");
  text.textContent = labelText;
  const val = document.createElement("span");
  val.className = "lfo-field-val";
  label.appendChild(text);
  label.appendChild(val);
  field.appendChild(label);
  return field;
}

const LFO_CARD_ACCENTS = ["#1f8bff", "#ff6f24", "#cfe6ff", "#8fe39b"];
const LFO_PRIMARY_ACCENT = "#ff6f24";

function lfoCardAccent(index) {
  return LFO_CARD_ACCENTS[index % LFO_CARD_ACCENTS.length];
}

function applyCenteredMeterFill(fillEl, normalized) {
  if (!fillEl) return;
  const n = clamp(Number(normalized) || 0, -1, 1);
  const widthPct = Math.abs(n) * 50;
  fillEl.style.width = `${widthPct.toFixed(1)}%`;
  fillEl.classList.toggle("neg", n < 0);
  fillEl.style.left = n < 0 ? `${(50 - widthPct).toFixed(1)}%` : "50%";
}

function refreshLfoStripImpact(index, nowSec = performance.now() / 1000) {
  const refs = lfoStripEls[index];
  if (!refs?.impactLiveEl || !refs?.impactDeltaEl || !refs?.impactFillEl) return;
  const cfg = lfoConfigs[index];
  const target = cfg.target;
  const cap = lfoCapFor(target);
  if (!lfoIsActive(cfg) || cap <= 0) {
    refs.impactLiveEl.textContent = "No active modulation";
    refs.impactDeltaEl.textContent = "ΔLFO 0 · Σ 0";
    applyCenteredMeterFill(refs.impactFillEl, 0);
    return;
  }
  const base = currentParamValue(target, 0);
  const total = lfoModOffset(target, nowSec);
  const live = clampToParamMeta(target, base + total);
  const own = lfoInstantContribution(cfg, index, nowSec);
  refs.impactLiveEl.textContent = `${formatParamValue(target, base)} → ${formatParamValue(target, live)}`;
  refs.impactDeltaEl.textContent = `ΔLFO ${own >= 0 ? "+" : ""}${formatParamDelta(target, own)} · Σ ${total >= 0 ? "+" : ""}${formatParamDelta(target, total)}`;
  applyCenteredMeterFill(refs.impactFillEl, own / cap);
}

function ensureLfoImpactMatrixRows() {
  if (!lfoImpactMatrixEl || lfoImpactMatrixRows.length > 0) return;
  for (let i = 0; i < LFO_MAX; i += 1) {
    const row = document.createElement("div");
    row.className = "lfo-impact-row";
    const lfoEl = document.createElement("span");
    lfoEl.className = "lfo-impact-lfo";
    lfoEl.textContent = `L${String(i + 1).padStart(2, "0")}`;
    const targetEl = document.createElement("span");
    targetEl.className = "lfo-impact-target";
    const deltaEl = document.createElement("span");
    deltaEl.className = "lfo-impact-delta";
    const bar = document.createElement("div");
    bar.className = "lfo-impact-bar";
    const fill = document.createElement("span");
    fill.className = "lfo-impact-bar-fill";
    bar.appendChild(fill);
    row.append(lfoEl, targetEl, deltaEl, bar);
    lfoImpactMatrixEl.appendChild(row);
    lfoImpactMatrixRows.push({
      row, targetEl, deltaEl, fillEl: fill, index: i
    });
  }
}

function refreshLfoImpactMatrix(nowSec = performance.now() / 1000, force = false) {
  if (!lfoImpactMatrixEl || currentMainScreen !== "mods") return;
  const nowMs = performance.now();
  if (!force && (nowMs - lfoImpactMatrixLastUpdate) < 120) return;
  lfoImpactMatrixLastUpdate = nowMs;
  ensureLfoImpactMatrixRows();
  lfoImpactMatrixRows.forEach((entry) => {
    const cfg = lfoConfigs[entry.index];
    const target = cfg.target;
    const targetLabel = LFO_TARGET_BY_NAME.get(target)?.label || "—";
    entry.targetEl.textContent = targetLabel;
    if (!lfoIsActive(cfg) || lfoCapFor(target) <= 0) {
      entry.row.classList.add("is-off");
      entry.deltaEl.textContent = "0";
      applyCenteredMeterFill(entry.fillEl, 0);
      return;
    }
    entry.row.classList.remove("is-off");
    const own = lfoInstantContribution(cfg, entry.index, nowSec);
    entry.deltaEl.textContent = `${own >= 0 ? "+" : ""}${formatParamDelta(target, own)}`;
    applyCenteredMeterFill(entry.fillEl, own / lfoCapFor(target));
  });
}

function createLfoStrip(index) {
  const cfg = lfoConfigs[index];
  const accent = lfoCardAccent(index);

  const card = document.createElement("div");
  card.className = "lfo-card";
  card.dataset.lfoIndex = String(index);
  card.style.setProperty("--lfo-accent", accent);

  const ghost = document.createElement("span");
  ghost.className = "lfo-ghost";
  ghost.textContent = String(index + 1).padStart(2, "0");

  const head = document.createElement("div");
  head.className = "lfo-card-head";
  const idEl = document.createElement("span");
  idEl.className = "lfo-id";
  idEl.textContent = `LFO·${String(index + 1).padStart(2, "0")}`;
  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "lfo-run";
  runBtn.textContent = "OFF";
  head.append(idEl, runBtn);

  const waveBox = document.createElement("div");
  waveBox.className = "lfo-wv-box";
  const canvas = document.createElement("canvas");
  canvas.className = "lfo-wv";
  canvas.width = 240;
  canvas.height = 56;
  waveBox.appendChild(canvas);

  const body = document.createElement("div");
  body.className = "lfo-card-body";

  // Shape field — value styled select
  const shapeRow = document.createElement("div");
  shapeRow.className = "lfo-field";
  const shapeKey = document.createElement("span");
  shapeKey.className = "k";
  shapeKey.textContent = "Shape";
  const shapeSel = document.createElement("select");
  shapeSel.className = "lfo-shape";
  LFO_SHAPE_NAMES.forEach((shapeName, shapeIdx) => {
    const option = document.createElement("option");
    option.value = String(shapeIdx);
    option.textContent = shapeName;
    shapeSel.appendChild(option);
  });
  shapeSel.value = String(cfg.shape);
  shapeRow.append(shapeKey, shapeSel);

  const clockRow = document.createElement("div");
  clockRow.className = "lfo-field lfo-clock-row";
  const clockKey = document.createElement("span");
  clockKey.className = "k";
  clockKey.textContent = "Rate Source";
  const clockToggle = document.createElement("label");
  clockToggle.className = "lfo-clock-toggle";
  const clockCheck = document.createElement("input");
  clockCheck.type = "checkbox";
  clockCheck.className = "lfo-clock-check";
  clockCheck.checked = Boolean(cfg.useMidiClock);
  const clockText = document.createElement("span");
  clockText.textContent = "Use MIDI Clock";
  clockToggle.append(clockCheck, clockText);
  clockRow.append(clockKey, clockToggle);

  // Rate field — big value + thin slider
  const rateRow = document.createElement("div");
  rateRow.className = "lfo-field lfo-field-slider";
  const rateTop = document.createElement("div");
  rateTop.className = "lfo-field-top";
  const rateKey = document.createElement("span");
  rateKey.className = "k";
  rateKey.textContent = "Rate";
  const rateVal = document.createElement("span");
  rateVal.className = "v is-accent";
  rateTop.append(rateKey, rateVal);
  const rateEl = document.createElement("input");
  rateEl.type = "range";
  rateEl.className = "lfo-range";
  rateEl.min = "0";
  rateEl.max = "1";
  rateEl.step = "0.001";
  rateEl.value = String(lfoRateToSliderPos(cfg.rate));
  rateRow.append(rateTop, rateEl);

  const ratioRow = document.createElement("div");
  ratioRow.className = "lfo-field lfo-field-slider";
  const ratioTop = document.createElement("div");
  ratioTop.className = "lfo-field-top";
  const ratioKey = document.createElement("span");
  ratioKey.className = "k";
  ratioKey.textContent = "Clock Div/Mult";
  const ratioVal = document.createElement("span");
  ratioVal.className = "v is-accent";
  ratioTop.append(ratioKey, ratioVal);
  const ratioEl = document.createElement("input");
  ratioEl.type = "range";
  ratioEl.className = "lfo-range lfo-clock-ratio-range";
  ratioEl.min = "0";
  ratioEl.max = String(LFO_CLOCK_RATIO_OPTIONS.length - 1);
  ratioEl.step = "1";
  ratioEl.value = String(lfoClockRatioIndexFromValue(cfg.clockRatio));
  ratioRow.append(ratioTop, ratioEl);

  // Depth field — big value + thin slider
  const depthRow = document.createElement("div");
  depthRow.className = "lfo-field lfo-field-slider lfo-field-slider-depth";
  const depthTop = document.createElement("div");
  depthTop.className = "lfo-field-top";
  const depthKey = document.createElement("span");
  depthKey.className = "k";
  depthKey.textContent = "Depth";
  const depthVal = document.createElement("span");
  depthVal.className = "v is-accent";
  depthTop.append(depthKey, depthVal);
  const depthEl = document.createElement("input");
  depthEl.type = "range";
  depthEl.className = "lfo-range";
  depthEl.dataset.bipolar = "1";
  depthEl.min = "-1";
  depthEl.max = "1";
  depthEl.step = "0.01";
  depthEl.value = String(lfoDepthFractionSigned(cfg));
  depthRow.append(depthTop, depthEl);

  // Bus target — routed box
  const targetBox = document.createElement("div");
  targetBox.className = "lfo-route";
  const targetKey = document.createElement("div");
  targetKey.className = "k";
  targetKey.textContent = "BUS TARGET";
  const targetVal = document.createElement("div");
  targetVal.className = "lfo-route-v";
  const targetSel = document.createElement("select");
  targetSel.className = "lfo-target-sel";
  LFO_TARGETS.forEach((t) => {
    const option = document.createElement("option");
    option.value = t.name;
    option.textContent = t.label;
    targetSel.appendChild(option);
  });
  targetSel.value = cfg.target;
  targetVal.appendChild(targetSel);

  const impact = document.createElement("div");
  impact.className = "lfo-target-impact";
  const impactKey = document.createElement("div");
  impactKey.className = "k";
  impactKey.textContent = "Target Delta";
  const impactLive = document.createElement("div");
  impactLive.className = "lfo-target-impact-live";
  const impactDelta = document.createElement("div");
  impactDelta.className = "lfo-target-impact-delta";
  const impactBar = document.createElement("div");
  impactBar.className = "lfo-target-impact-bar";
  const impactFill = document.createElement("span");
  impactFill.className = "lfo-target-impact-fill";
  impactBar.appendChild(impactFill);
  impact.append(impactKey, impactLive, impactDelta, impactBar);

  targetBox.append(targetKey, targetVal, impact);

  // Hidden enable mirror keeps syncLfoStripFromConfig() working unchanged.
  const enableInput = document.createElement("input");
  enableInput.type = "checkbox";
  enableInput.style.display = "none";
  enableInput.checked = cfg.enabled;

  body.append(shapeRow, clockRow, rateRow, ratioRow, depthRow, targetBox, enableInput);
  card.append(ghost, head, waveBox, body);
  lfoStripListEl.appendChild(card);

  const refs = {
    index,
    strip: card,
    canvas,
    metaEl: null,
    idEl,
    runBtn,
    targetSel,
    shapeSel,
    clockCheck,
    rateEl,
    clockRatioEl: ratioEl,
    depthEl,
    enableInput,
    rateLabelVal: rateVal,
    clockRatioLabelVal: ratioVal,
    depthLabelVal: depthVal,
    accent,
    impactLiveEl: impactLive,
    impactDeltaEl: impactDelta,
    impactFillEl: impactFill
  };

  const onChange = () => {
    const c = lfoConfigs[index];
    c.target = LFO_TARGET_BY_NAME.has(targetSel.value) ? targetSel.value : "none";
    c.shape = clamp(parseInt(shapeSel.value, 10) || 0, 0, 6);
    c.useMidiClock = Boolean(clockCheck.checked);
    c.clockRatio = lfoClockRatioFromIndex(ratioEl.value);
    const clockRate = midiClockRateHz();
    if (c.useMidiClock) {
      if (clockRate !== null) c.rate = clamp(clockRate * c.clockRatio, LFO_RATE_MIN, LFO_RATE_MAX);
    } else {
      c.rate = lfoSliderPosToRate(rateEl.value);
    }
    c.depth = clamp(Number(depthEl.value) || 0, -1, 1) * lfoCapFor(c.target);
    c.enabled = enableInput.checked;
    const depthFrac = lfoDepthFractionSigned(c);
    if (String(depthFrac) !== depthEl.value) depthEl.value = String(depthFrac);
    refreshLfoStrip(index);
    updateLfoHint();
    sendLfo(index);
  };

  runBtn.addEventListener("click", () => {
    enableInput.checked = !enableInput.checked;
    onChange();
  });
  targetSel.addEventListener("change", onChange);
  shapeSel.addEventListener("change", onChange);
  clockCheck.addEventListener("change", onChange);
  rateEl.addEventListener("input", onChange);
  ratioEl.addEventListener("input", onChange);
  depthEl.addEventListener("input", onChange);

  return refs;
}

function buildLfoStrips() {
  if (!lfoStripListEl) return;
  lfoStripListEl.innerHTML = "";
  lfoStripEls.length = 0;
  for (let i = 0; i < LFO_MAX; i += 1) {
    lfoStripEls.push(createLfoStrip(i));
  }
}

function refreshLfoStrip(index) {
  const r = lfoStripEls[index];
  if (!r) return;
  const c = lfoConfigs[index];
  const clockRatio = lfoClockRatioValue(c);
  const hasClockTempo = Number.isFinite(midiClockHz);
  const displayedRate = (c.useMidiClock && hasClockTempo)
    ? clamp(midiClockHz * clockRatio, LFO_RATE_MIN, LFO_RATE_MAX)
    : c.rate;
  const running = lfoIsActive(c);
  r.strip.classList.toggle("lfo-disabled", !c.enabled);
  r.strip.classList.toggle("lfo-running", running);
  if (r.metaEl) {
    const tgt = LFO_TARGET_BY_NAME.get(c.target);
    r.metaEl.textContent = `${tgt ? tgt.label : "none"} • ${LFO_SHAPE_NAMES[c.shape]} • ${c.rate.toFixed(2)} Hz`;
  }
  if (r.runBtn) {
    r.runBtn.textContent = c.enabled ? "RUNNING" : "OFF";
    r.runBtn.classList.toggle("on", c.enabled);
  }
  if (r.clockCheck) r.clockCheck.checked = Boolean(c.useMidiClock);
  if (r.rateLabelVal) {
    r.rateLabelVal.textContent = c.useMidiClock && !hasClockTempo
      ? "CLOCK —"
      : `${displayedRate.toFixed(2)} Hz`;
  }
  if (r.clockRatioLabelVal) r.clockRatioLabelVal.textContent = lfoClockRatioLabel(clockRatio);
  if (r.clockRatioEl) {
    r.clockRatioEl.value = String(lfoClockRatioIndexFromValue(clockRatio));
    r.clockRatioEl.disabled = !c.useMidiClock;
    r.clockRatioEl.classList.toggle("is-locked", !c.useMidiClock);
    refreshSliderFill(r.clockRatioEl, LFO_PRIMARY_ACCENT);
  }
  if (r.depthLabelVal) r.depthLabelVal.textContent = `${Math.round(lfoDepthFractionSigned(c) * 100)}%`;
  if (r.rateEl) {
    r.rateEl.disabled = Boolean(c.useMidiClock);
    r.rateEl.classList.toggle("is-locked", Boolean(c.useMidiClock));
    r.rateEl.value = String(lfoRateToSliderPos(displayedRate));
    refreshSliderFill(r.rateEl, LFO_PRIMARY_ACCENT);
  }
  if (r.depthEl) refreshSliderFill(r.depthEl, LFO_PRIMARY_ACCENT);
  drawLfoThumb(r.canvas, c, index);
  refreshLfoStripImpact(index);
  refreshLfoImpactMatrix(undefined, true);
}

function lfoActiveCount() {
  let n = 0;
  for (let i = 0; i < LFO_MAX; i += 1) if (lfoConfigs[i].enabled) n += 1;
  return n;
}

const lfoActiveCountEl = document.getElementById("lfoActiveCount");

function updateLfoHint() {
  const active = lfoActiveCount();
  if (lfoActiveCountEl) lfoActiveCountEl.textContent = String(active);
  if (lfoCountHintEl) {
    const tempoText = Number.isFinite(midiClockBpm) ? ` · MIDI ${midiClockBpm.toFixed(1)} BPM` : "";
    lfoCountHintEl.textContent = `${active} running · tap controls to edit shape, depth, and target${tempoText}`;
  }
}

function syncLfoStripFromConfig(index) {
  const r = lfoStripEls[index];
  if (!r) return;
  const c = lfoConfigs[index];
  r.targetSel.value = c.target;
  r.shapeSel.value = String(c.shape);
  r.rateEl.value = String(lfoRateToSliderPos(c.rate));
  r.depthEl.value = String(lfoDepthFractionSigned(c));
  r.enableInput.checked = c.enabled;
  refreshLfoStrip(index);
}

function rebuildLfoOverview() {
  if (!lfoOverviewEl) return;
  lfoOverviewEl.innerHTML = "";
  for (let i = 0; i < LFO_MAX; i += 1) {
    const c = lfoConfigs[i];
    if (!c.enabled) continue;
    const tgt = LFO_TARGET_BY_NAME.get(c.target);
    const card = document.createElement("div");
    card.className = "lfo-overview-card";
    if (!lfoIsActive(c)) card.classList.add("lfo-disabled");
    card.style.borderLeftColor = lfoAccent(i);
    const title = document.createElement("div");
    title.className = "lfo-overview-title";
    const left = document.createElement("span");
    left.textContent = `L${i + 1}`;
    const right = document.createElement("span");
    right.textContent = tgt ? tgt.label : "—";
    title.append(left, right);
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 38;
    card.append(title, canvas);
    lfoOverviewEl.appendChild(card);
    drawLfoThumb(canvas, c, i);
  }
}

function redrawAllLfoViews() {
  for (let i = 0; i < LFO_MAX; i += 1) {
    if (lfoStripEls[i]) refreshLfoStrip(i);
  }
  rebuildLfoOverview();
}

function lfoToIpc(index) {
  const c = lfoConfigs[index];
  return {
    idx: index,
    target: c.target,
    rate: c.rate,
    depth: c.depth,
    shape: c.shape,
    enabled: c.enabled,
    phase: c.phase
  };
}

function sendLfo(index) {
  window.spaluterApi.setLfo(index, lfoToIpc(index));
  updateLfoHint();
  rebuildLfoOverview();
  refreshLfoImpactMatrix(undefined, true);
  updateEditLfoMarkers();
  if (isModulationScreenActive()) scheduleLfoCursor();
  // Re-evaluate synthetic scope-preview animation: starts it when a synthetic-view
  // target becomes active, and lets it settle the static scope when it stops.
  scheduleParamModAnim();
  if (currentMainScreen === "edit") scheduleWaveformViewsRedraw();
}

function sendAllLfos() {
  const list = [];
  for (let i = 0; i < LFO_MAX; i += 1) list.push(lfoToIpc(i));
  if (list.length > 0) window.spaluterApi.setLfoMany(list);
}

function syncLfosToEngine() {
  window.spaluterApi.setLfoCount(lfoCount);
  sendAllLfos();
}

function collectLfoState() {
  return {
    version: LFO_CONFIG_VERSION,
    count: lfoCount,
    configs: lfoConfigs.map((c) => ({
      target: c.target,
      rate: c.rate,
      depth: c.depth,
      shape: c.shape,
      enabled: c.enabled,
      phase: c.phase,
      useMidiClock: Boolean(c.useMidiClock),
      clockRatio: lfoClockRatioValue(c)
    }))
  };
}

function applyLfoState(state) {
  const configs = state && Array.isArray(state.configs) ? state.configs : [];
  for (let i = 0; i < LFO_MAX; i += 1) {
    const src = configs[i];
    const c = lfoConfigs[i];
    if (src && typeof src === "object") {
      c.target = LFO_TARGET_BY_NAME.has(src.target) ? src.target : "none";
      c.rate = clamp(Number(src.rate) || 1, LFO_RATE_MIN, LFO_RATE_MAX);
      c.shape = clamp(parseInt(src.shape, 10) || 0, 0, 6);
      const cap = lfoCapFor(c.target);
      c.depth = clamp(Number(src.depth) || 0, -cap, cap);
      c.enabled = Boolean(src.enabled);
      c.phase = (((Number(src.phase) || 0) % 1) + 1) % 1;
      c.useMidiClock = Boolean(src.useMidiClock);
      c.clockRatio = lfoClockRatioValue(src);
    } else {
      Object.assign(c, defaultLfoConfig());
    }
    lfoRetriggerEpochSec[i] = 0;
    syncLfoStripFromConfig(i);
  }
  syncMidiClockLockedLfos(performance.now(), true);
  updateLfoHint();
  rebuildLfoOverview();
  refreshLfoImpactMatrix(undefined, true);
  updateEditLfoMarkers();
  syncLfosToEngine();
  scheduleParamModAnim();
  if (currentMainScreen === "edit") scheduleWaveformViewsRedraw();
}

function isModulationScreenActive() {
  return currentMainScreen === "mods";
}

function isLfoStripVisible(stripEl) {
  if (!stripEl || !lfoStripListEl) return false;
  const viewTop = lfoStripListEl.scrollTop;
  const viewBottom = viewTop + lfoStripListEl.clientHeight;
  const top = stripEl.offsetTop;
  const bottom = top + stripEl.offsetHeight;
  return bottom >= (viewTop - 8) && top <= (viewBottom + 8);
}

function lfoCursorTick(timestamp) {
  lfoCursorRafId = 0;
  if (!isModulationScreenActive() || !hasAnyRunningLfo()) return;
  if (timestamp - lfoCursorLast >= 50) {
    lfoCursorLast = timestamp;
    const now = performance.now() / 1000;
    for (let i = 0; i < LFO_MAX; i += 1) {
      const r = lfoStripEls[i];
      const c = lfoConfigs[i];
      if (!r || !isLfoStripVisible(r.strip)) continue;
      refreshLfoStripImpact(i, now);
      if (!lfoIsActive(c)) continue;
      const cursorT = lfoRuntimePhase01(i, c, now);
      drawLfoThumb(r.canvas, c, i, cursorT);
    }
    refreshLfoImpactMatrix(now);
  }
  scheduleLfoCursor();
}

function scheduleLfoCursor() {
  if (lfoCursorRafId || !isModulationScreenActive() || !hasAnyRunningLfo()) return;
  lfoCursorRafId = window.requestAnimationFrame(lfoCursorTick);
}

function handleMainScreenEntered(targetScreen) {
  if (targetScreen === "perform") {
    scheduleWaveformResizeRefresh();
    drawOutputScope(outputScopeCanvas, outputScopeSamples.left, outputScopeSamples.right);
    drawOutputAnalysisScopes();
  } else if (targetScreen === "edit") {
    scheduleWaveformResizeRefresh();
    updateEditLfoMarkers();
    scheduleParamModAnim();
  } else if (targetScreen === "mods") {
    redrawAllLfoViews();
    refreshLfoImpactMatrix(undefined, true);
    scheduleLfoCursor();
  } else if (targetScreen === "presets") {
    waveformLayoutDirty = true;
    renderPresetBank();
    renderPresetDetail();
  }
  refreshScopeStreamingState();
}

function initModulationUi() {
  buildLfoStrips();
  ensureLfoImpactMatrixRows();
  lfoStripEls.forEach((r) => refreshLfoStrip(r.index));
  refreshLfoImpactMatrix(undefined, true);
  updateLfoHint();
  rebuildLfoOverview();
}

function defaultPresetName(index) {
  return `Preset ${index + 1}`;
}

function createDefaultPresets() {
  return Array.from({ length: PRESET_COUNT }, (_unused, index) => ({
    name: defaultPresetName(index),
    params: null,
    sampleDirectory: sampleDefaultDir,
    samplePath: "",
    lfo: null
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
      const lfo = loaded.lfo && typeof loaded.lfo === "object" ? loaded.lfo : null;
      return { name, params, sampleDirectory, samplePath, lfo };
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
  if (Object.prototype.hasOwnProperty.call(params, "formantCount")) {
    setParamValue("formantCount", Number(params.formantCount), true);
  }
  Object.entries(params).forEach(([param, value]) => {
    if (param === "formantCount") return;
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
responsivePreviewMode = loadResponsivePreviewMode();

function syncPresetNameField() {
  if (!presetNameEl || !presetSlotEl) return;
  const idx = selectedPresetIndex();
  presetNameEl.value = presets[idx].name;
}

const presetBankListEl = document.getElementById("presetBankList");
const presetDetailBigEl = document.getElementById("presetDetailBig");
const presetDetailNumEl = document.getElementById("presetDetailNum");
const presetDetailNameEl = document.getElementById("presetDetailName");
const presetDetailSubEl = document.getElementById("presetDetailSub");
const presetSignatureCanvas = document.getElementById("presetSignatureView");
const presetStatParamsEl = document.getElementById("presetStatParams");
const presetStatLfoEl = document.getElementById("presetStatLfo");
const presetStatSampleEl = document.getElementById("presetStatSample");
const presetBankCountEl = document.getElementById("presetBankCount");
const clearPresetBtn = document.getElementById("clearPreset");
const renamePresetBtn = document.getElementById("renamePreset");

function presetLfoRouteCount(preset) {
  const configs = preset?.lfo?.configs;
  if (!Array.isArray(configs)) return 0;
  return configs.filter((c) => c && c.enabled && c.target && c.target !== "none" && Number(c.depth) !== 0).length;
}

function presetSampleName(preset) {
  const p = preset?.samplePath;
  if (!p) return "";
  return p.split("/").pop() || "";
}

// Deterministic "signature" wave so each saved slot reads as visually distinct.
// Seeded from the preset's params (or name) — purely decorative, never streamed.
function drawPresetSignature(canvas, preset, color, complexity = 1) {
  if (!canvas) return;
  const empty = !preset || !preset.params;
  const seedStr = preset ? `${preset.name}${JSON.stringify(preset.params || "")}` : "";
  let seed = 0;
  for (let i = 0; i < seedStr.length; i += 1) seed = ((seed * 31) + seedStr.charCodeAt(i)) % 100000;
  const a = 1 + (seed % 5);
  const b = 1 + ((seed >> 3) % 7);
  const phase = (seed % 13) / 13;
  drawWaveformColored(canvas, (t) => {
    if (empty) return 0;
    const x = t * Math.PI * 2;
    return 0.85 * (Math.sin((x * a) + (phase * 6.28)) * 0.6
      + Math.sin(x * b * complexity) * 0.4);
  }, color, empty);
}

// Like drawWaveform but with caller-controlled stroke colour.
function drawWaveformColored(canvas, sampleFn, color, dim) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const metrics = getCanvasMetrics(canvas);
  const { dpr, drawWidth, drawHeight, leftPad, rightPad, topPad, bottomPad } = metrics;
  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }
  ctx.clearRect(0, 0, drawWidth, drawHeight);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(169, 180, 208, 0.22)";
  ctx.beginPath();
  const centerY = drawHeight * 0.5;
  ctx.moveTo(0, centerY);
  ctx.lineTo(drawWidth, centerY);
  ctx.stroke();
  if (dim) return;
  const usableWidth = Math.max(1, rightPad - leftPad);
  const usableHeight = Math.max(1, bottomPad - topPad);
  ctx.strokeStyle = color;
  ctx.beginPath();
  const samples = Math.max(64, Math.floor(drawWidth / 2));
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const normalized = clamp((sampleFn(t) + 1) / 2, 0, 1);
    const x = leftPad + (t * usableWidth);
    const y = topPad + ((1 - normalized) * usableHeight);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

const PRESET_ROW_COLORS = ["#ff6f24", "#1f8bff", "#cfe6ff", "#8fe39b"];

function renderPresetBank() {
  if (!presetBankListEl) return;
  const currentIndex = selectedPresetIndex();
  presetBankListEl.innerHTML = "";
  let savedCount = 0;
  presets.forEach((preset, index) => {
    const saved = Boolean(preset.params);
    if (saved) savedCount += 1;
    const row = document.createElement("div");
    row.className = "prow";
    if (!saved) row.classList.add("empty");
    if (index === currentIndex) row.classList.add("on");
    row.dataset.index = String(index);

    const pn = document.createElement("span");
    pn.className = "pn";
    pn.textContent = String(index + 1).padStart(2, "0");

    const info = document.createElement("div");
    info.className = "info";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = saved ? preset.name : "— empty —";
    const meta = document.createElement("span");
    meta.className = "meta";
    if (saved) {
      const lfo = presetLfoRouteCount(preset);
      meta.textContent = `30P · ${lfo} LFO${presetSampleName(preset) ? " · SMPL" : ""}`;
    } else {
      meta.textContent = "available";
    }
    info.append(nm, meta);

    const sig = document.createElement("canvas");
    sig.className = "sig";
    sig.width = 120;
    sig.height = 34;

    const dot = document.createElement("span");
    dot.className = "dot";
    if (saved) dot.classList.add("lit");

    row.append(pn, info, sig, dot);
    presetBankListEl.appendChild(row);
    drawPresetSignature(sig, saved ? preset : null, PRESET_ROW_COLORS[index % PRESET_ROW_COLORS.length]);
  });
  if (presetBankCountEl) presetBankCountEl.textContent = `${savedCount}/32 SAVED`;
}

function renderPresetDetail() {
  const idx = selectedPresetIndex();
  const preset = presets[idx];
  const saved = Boolean(preset && preset.params);
  const num = String(idx + 1).padStart(2, "0");
  if (presetDetailBigEl) presetDetailBigEl.textContent = num;
  if (presetDetailNumEl) presetDetailNumEl.textContent = num;
  if (presetDetailNameEl) presetDetailNameEl.textContent = preset ? preset.name : "—";
  if (presetDetailSubEl) {
    presetDetailSubEl.textContent = saved
      ? `SAVED · ${presetLfoRouteCount(preset)} LFO routes`
      : "EMPTY · no snapshot";
  }
  if (presetStatParamsEl) presetStatParamsEl.textContent = saved ? `${allParamNames.length} / ${allParamNames.length}` : `— / ${allParamNames.length}`;
  if (presetStatLfoEl) presetStatLfoEl.textContent = `${saved ? presetLfoRouteCount(preset) : 0} routes`;
  if (presetStatSampleEl) presetStatSampleEl.textContent = (saved && presetSampleName(preset)) || "none";
  drawPresetSignature(presetSignatureCanvas, saved ? preset : null, "#ff6f24", 2);
  // highlight active bank row
  if (presetBankListEl) {
    presetBankListEl.querySelectorAll(".prow").forEach((r) => {
      r.classList.toggle("on", Number(r.dataset.index) === idx);
    });
  }
}

function renderPresetOptions() {
  if (presetSlotEl) {
    const currentIndex = selectedPresetIndex();
    presetSlotEl.innerHTML = "";
    presets.forEach((preset, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = `${String(index + 1).padStart(2, "0")} ${preset.params ? "[saved]" : "[empty]"} ${preset.name}`;
      presetSlotEl.appendChild(option);
    });
    presetSlotEl.value = String(currentIndex);
  }
  syncPresetNameField();
  renderPresetBank();
  renderPresetDetail();
}

function scheduleWaveformResizeRefresh() {
  waveformLayoutDirty = true;
  if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
  resizeDebounceTimer = window.setTimeout(() => {
    updateWaveformViews();
  }, RESIZE_DEBOUNCE_MS);
}

function setScreen(name, options = {}) {
  const target = MAIN_SCREENS.includes(name) ? name : "perform";
  if (target === currentMainScreen && !options.force) return;
  currentMainScreen = target;
  currentViewIndex = MAIN_SCREENS.indexOf(target);
  mainScreenButtons.forEach((button) => {
    const on = button.dataset.screen === target;
    button.classList.toggle("active", on);
    button.setAttribute("aria-pressed", String(on));
  });
  mainScreenPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.screen === target);
  });
  if (target === "edit") setParameterPage(currentParamPage);
  handleMainScreenEntered(target);
}

function initScreenNav() {
  if (!mainScreenSwitchEl) return;
  mainScreenSwitchEl.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-btn[data-screen]");
    if (!button) return;
    setScreen(button.dataset.screen);
  });
}

function setScopeStreaming(enabled) {
  const nextEnabled = Boolean(enabled);
  const nextRate = nextEnabled ? ACTIVE_SCOPE_RATE_HZ : MIN_SCOPE_RATE_HZ;
  if (scopeStreamingEnabled === nextEnabled && scopeStreamingRateHz === nextRate) return;
  scopeStreamingEnabled = nextEnabled;
  scopeStreamingRateHz = nextRate;
  window.spaluterApi.setScope(nextEnabled, nextRate).catch(() => {
    appendLog("[SCOPE] Failed to update scope streaming state.");
  });
}

function refreshScopeStreamingState() {
  const visible = document.visibilityState !== "hidden" && document.hasFocus();
  setScopeStreaming(visible);
}

window.spaluterApi.onStatus((text) => {
  statusTextEl.textContent = text;
  const state = classifyStatus(text);
  const statusText = String(text || "").toLowerCase();
  setStatusState(state);
  updateSynthRunningFromStatus(text);
  if (/(synth stopped|stopped by user|manual stop|quitting runtime|sclang exited)/.test(statusText)) {
    activeMidiNotes = [];
    activeMidiNoteNumber = null;
    activeMidiBasePitchValue = null;
    clearOutputScope("Waiting for synth...");
  }
  if (/synth started/.test(statusText) && outputScopeLabelEl) {
    outputScopeLabelEl.textContent = "Live output";
  }
  if (/synth started/.test(statusText)) {
    // Re-push LFO state so the engine matches the UI after a (re)start.
    syncLfosToEngine();
    syncDelayClockParam(true);
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
initModulationUi();
initScreenNav();
setScreen("perform", { force: true });
updateWaveformViews();
clearOutputScope();
window.addEventListener("resize", scheduleWaveformResizeRefresh);
document.addEventListener("visibilitychange", refreshScopeStreamingState);
window.addEventListener("focus", refreshScopeStreamingState);
window.addEventListener("blur", refreshScopeStreamingState);
rendererHeartbeatTimer = window.setInterval(() => {
  window.spaluterApi.heartbeat();
}, RENDERER_HEARTBEAT_MS);

if (DEBUG_FPS) {
  let fpsFrameCount = 0;
  let fpsWindowStart = performance.now();
  const fpsProbe = () => {
    fpsFrameCount += 1;
    const now = performance.now();
    const elapsed = now - fpsWindowStart;
    if (elapsed >= 1000) {
      const fps = Math.round((fpsFrameCount * 1000) / elapsed);
      if (window.spaluterApi.reportFps) window.spaluterApi.reportFps(fps);
      fpsFrameCount = 0;
      fpsWindowStart = now;
    }
    window.requestAnimationFrame(fpsProbe);
  };
  window.requestAnimationFrame(fpsProbe);
}
window.addEventListener("beforeunload", () => {
  stopParamModAnim();
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
initEditCards();

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
syncDelayClockParam(true);
updateDelayBaseTimeEnabled();

if (presetSlotEl) {
  renderPresetOptions();
  presetSlotEl.addEventListener("change", () => {
    syncPresetNameField();
    renderPresetDetail();
  });
}

if (presetBankListEl) {
  presetBankListEl.addEventListener("click", (event) => {
    const row = event.target.closest(".prow[data-index]");
    if (!row || !presetSlotEl) return;
    presetSlotEl.value = row.dataset.index;
    presetSlotEl.dispatchEvent(new Event("change"));
  });
}

if (renamePresetBtn) {
  renamePresetBtn.addEventListener("click", () => {
    const idx = selectedPresetIndex();
    const typed = String(presetNameEl?.value || "").trim();
    const name = typed.length > 0 ? typed : defaultPresetName(idx);
    presets[idx].name = name;
    persistPresets(presets);
    renderPresetOptions();
    presetSlotEl.value = String(idx);
    renderPresetDetail();
    appendLog(`[PRESET] Renamed ${String(idx + 1).padStart(2, "0")}: ${name}`);
  });
}

if (clearPresetBtn) {
  clearPresetBtn.addEventListener("click", () => {
    const idx = selectedPresetIndex();
    presets[idx] = {
      name: defaultPresetName(idx),
      params: null,
      sampleDirectory: sampleDefaultDir,
      samplePath: "",
      lfo: null
    };
    persistPresets(presets);
    renderPresetOptions();
    presetSlotEl.value = String(idx);
    renderPresetDetail();
    appendLog(`[PRESET] Cleared ${String(idx + 1).padStart(2, "0")}`);
  });
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
      samplePath: String(sampleFileEl?.value || ""),
      lfo: collectLfoState()
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
    applyLfoState(preset.lfo);
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
    statusTextEl.textContent = state.status;
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
  refreshScopeStreamingState();
});

// ─────────────────────────── Live UI additions ─────────────────────────────
// Performance-page macro encoders: each macro (0..1) drives several engine
// params via linear interpolation, routed through setParamValue so the OSC
// send + UI sync + previews all stay consistent.
const MACRO_TARGETS = Object.freeze({
  macroBrightness: [["drive", 1, 3.2], ["formant2", 200, 1400], ["formant3", 400, 2600]],
  macroMotion: [["timingJitter", 0, 0.5], ["glisson", 0, 0.5]],
  macroWidth: [["pan2", 0, 1], ["pan3", 0, -1]],
  macroTexture: [["maskAmount", 0, 0.9], ["duty", 0.5, 0.12]],
  macroShape: [["pulsaret", 0, 6], ["window", 0, 5]]
});

// ─────────────────────────── Edit screen cards ─────────────────────────────
// The Edit screen is built from static grouped cards in index.html holding the
// real [data-param] controls (already wired for OSC by the global range/select
// listeners). Here we register each card's value readout + slider so external
// value changes (presets, macros, MIDI) stay reflected, and paint the slider
// "fill" with the owning card's accent colour.
function sliderAccentHex(key) {
  // Inline map keeps this callable from initEditCards() before any module-level
  // const further down the file has initialized (avoids a TDZ ReferenceError).
  const map = { shock: "#ff6f24", acid: "#1f8bff", ice: "#cfe6ff", ok: "#8fe39b" };
  return map[key] || map.shock;
}

function refreshSliderFill(slider, accentHex) {
  if (!slider) return;
  const min = Number(slider.min);
  const max = Number(slider.max);
  const val = Number(slider.value);
  const frac = max > min ? clamp((val - min) / (max - min), 0, 1) : 0;
  const accent = accentHex || sliderAccentHex(slider.dataset.accent);
  const pct = `${(frac * 100).toFixed(1)}%`;
  const trackHeight = slider.classList.contains("lfo-range") ? "14px" : "10px";
  const fillGradient =
    `linear-gradient(to right, ${accent} 0%, ${accent} ${pct}, rgba(255,255,255,0.09) ${pct}, rgba(255,255,255,0.09) 100%) no-repeat center / 100% ${trackHeight}`;
  if (slider.dataset.bipolar === "1" && min < 0 && max > 0) {
    const center = clamp((0 - min) / (max - min), 0, 1) * 100;
    const centerPct = `${center.toFixed(1)}%`;
    slider.style.background =
      `linear-gradient(to right, transparent calc(${centerPct} - 1px), rgba(233,227,214,0.4) calc(${centerPct} - 1px), rgba(233,227,214,0.4) calc(${centerPct} + 1px), transparent calc(${centerPct} + 1px)) no-repeat center / 100% ${trackHeight}, ${fillGradient}`;
    return;
  }
  slider.style.background = fillGradient;
}

function buildSegmentedSelect(select, accent) {
  const opts = document.createElement("div");
  opts.className = "opts";
  opts.dataset.accent = accent;
  const buttons = [];
  Array.from(select.options).forEach((option) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "opt";
    btn.textContent = option.textContent;
    btn.dataset.value = option.value;
    if (option.selected) btn.classList.add("on");
    btn.addEventListener("click", () => {
      if (select.value === option.value) return;
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    buttons.push(btn);
    opts.appendChild(btn);
  });
  const sync = () => {
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.value === select.value));
  };
  select.addEventListener("change", sync);
  select.style.display = "none";
  select.insertAdjacentElement("afterend", opts);
  sync();
}

function initEditCards() {
  document.querySelectorAll(".edit-card").forEach((card) => {
    const accent = card.dataset.accent || "shock";
    card.querySelectorAll(".ctl").forEach((ctl) => {
      const slider = ctl.querySelector("input.edit-slider[data-param]");
      if (slider) {
        const param = slider.dataset.param;
        slider.dataset.accent = accent;
        let sliderWrap = slider.parentElement;
        if (!sliderWrap || !sliderWrap.classList.contains("edit-slider-wrap")) {
          sliderWrap = document.createElement("div");
          sliderWrap.className = "edit-slider-wrap";
          slider.parentElement?.insertBefore(sliderWrap, slider);
          sliderWrap.appendChild(slider);
        }
        let lfoMarker = sliderWrap.querySelector(".lfo-live-marker");
        if (!lfoMarker) {
          lfoMarker = document.createElement("span");
          lfoMarker.className = "lfo-live-marker";
          sliderWrap.appendChild(lfoMarker);
        }
        editLfoMarkerByParam.set(param, lfoMarker);
        const valEl = ctl.querySelector(".val");
        if (valEl) paramValueElByParam.set(param, valEl);
        paramSliderByParam.set(param, slider);
        slider.addEventListener("input", () => refreshSliderFill(slider));
        updateRealtimeParamValue(param, currentParamValue(param, Number(slider.value)));
        refreshSliderFill(slider);
        return;
      }
      const select = ctl.querySelector("select.edit-select[data-param]");
      if (select) {
        select.dataset.accent = accent;
        if (select.dataset.seg === "1") buildSegmentedSelect(select, accent);
      }
    });
  });
  updateEditLfoMarkers();
}

function initMacros() {
  Object.keys(MACRO_TARGETS).forEach((id) => {
    const slider = document.getElementById(id);
    if (!slider) return;
    const valEl = document.getElementById(`${id}Val`);
    const apply = () => {
      const frac = clamp(Number(slider.value), 0, 1);
      if (valEl) {
        const num = String(Math.round(frac * 100));
        if (valEl.firstChild && valEl.firstChild.nodeType === 3) {
          valEl.firstChild.nodeValue = num;
        } else {
          valEl.insertBefore(document.createTextNode(num), valEl.firstChild);
        }
      }
      MACRO_TARGETS[id].forEach(([param, lo, hi]) => {
        setParamValue(param, lo + ((hi - lo) * frac), true);
      });
    };
    slider.addEventListener("input", apply);
  });
}

// Header status chips + perform-page MIDI activity readout.
function setChip(id, cls, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("ok", "warn", "bad");
  if (cls) el.classList.add(cls);
  const lbl = el.querySelector(".lbl");
  if (lbl) lbl.textContent = label;
}

function refreshStatusChips() {
  if (synthRunning) {
    setChip("chipSc", "ok", "RUN");
    setChip("chipAudio", "ok", "ON");
  } else {
    setChip("chipSc", "bad", "OFF");
    setChip("chipAudio", "bad", "OFF");
  }
  if (lastMidiInputCount > 0) setChip("chipMidi", "ok", "LIVE");
  else if (lastMidiInputCount === 0) setChip("chipMidi", "warn", "NONE");
  else setChip("chipMidi", "", "—");

  const midiMeta = document.getElementById("midiActivityMeta");
  if (midiMeta) {
    if (lastMidiInputCount > 0) {
      const n = activeMidiNotes.length;
      midiMeta.textContent = `MIDI IN · ${lastMidiInputCount} dev · ${n} note${n === 1 ? "" : "s"}`;
    } else {
      midiMeta.textContent = "MIDI IN · no device";
    }
  }
}

initMacros();
refreshStatusChips();
window.setInterval(refreshStatusChips, 750);
