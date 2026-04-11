const statusEl = document.getElementById("status");
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
const outputScopeLabelEl = document.getElementById("outputScopeLabel");
const pulsaretWaveLabelEl = document.getElementById("pulsaretWaveLabel");
const windowWaveLabelEl = document.getElementById("windowWaveLabel");
const dutyWaveLabelEl = document.getElementById("dutyWaveLabel");
const knobs = Array.from(document.querySelectorAll(".knob[data-param]"));
const rangeInputs = Array.from(document.querySelectorAll('input[data-param][type="range"]'));
const selectInputs = Array.from(document.querySelectorAll("select[data-param]"));
const knobByParam = new Map(knobs.map((knob) => [knob.dataset.param, knob]));
const rangeByParam = new Map(rangeInputs.map((input) => [input.dataset.param, input]));
const selectByParam = new Map(selectInputs.map((input) => [input.dataset.param, input]));

const PRESET_COUNT = 32;
const PRESET_STORAGE_KEY = "spaluter-presets-v1";
const MIDI_MAP_STORAGE_KEY = "spaluter-midi-map-v1";
const DEFAULT_SAMPLE_DIR = "/spaluter/samples/";
let currentSamplePath = "";
let midiAccess = null;
let midiMappings = {};
let synthRunning = false;
const allParamNames = Array.from(new Set([
  ...knobByParam.keys(),
  ...rangeByParam.keys(),
  ...selectByParam.keys()
]));
const midiUiByParam = new Map();
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
const OUTPUT_SCOPE_FRAME_SIZE = 64;
let outputScopeSamples = Array.from({ length: OUTPUT_SCOPE_FRAME_SIZE }, () => 0);

function appendLog(text) {
  logEl.textContent += `${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
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
  const pointer = knob.querySelector(".knob-pointer");
  const valueEl = knob.parentElement.querySelector(".knob-value");
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

function drawWaveform(canvas, sampleFn, minValue = -1, maxValue = 1) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = Math.max(1, Math.round(canvas.clientWidth || Number(canvas.getAttribute("width")) || 320));
  const cssHeight = Math.max(1, Math.round(canvas.clientHeight || Number(canvas.getAttribute("height")) || 84));
  const drawWidth = Math.max(1, Math.round(cssWidth * dpr));
  const drawHeight = Math.max(1, Math.round(cssHeight * dpr));
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

  const leftPad = 4 * dpr;
  const rightPad = drawWidth - (4 * dpr);
  const topPad = 6 * dpr;
  const bottomPad = drawHeight - (6 * dpr);
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
  const values = samples.map((v) => Number(v));
  drawWaveform(canvas, (t) => {
    const idx = t * (values.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(values.length - 1, lo + 1);
    const mix = idx - lo;
    return (values[lo] * (1 - mix)) + (values[hi] * mix);
  }, -1, 1);
}

function normalizeScopeSamples(samples) {
  if (!Array.isArray(samples)) return null;
  const normalized = samples
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .slice(0, OUTPUT_SCOPE_FRAME_SIZE);
  if (normalized.length === 0) return null;
  if (normalized.length < OUTPUT_SCOPE_FRAME_SIZE) {
    const fillCount = OUTPUT_SCOPE_FRAME_SIZE - normalized.length;
    for (let i = 0; i < fillCount; i += 1) normalized.push(0);
  }
  return normalized;
}

function setOutputScopeSamples(samples, label = "Live output") {
  const normalized = normalizeScopeSamples(samples);
  if (!normalized) return;
  outputScopeSamples = normalized;
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  drawScopeFromSamples(outputScopeCanvas, outputScopeSamples);
}

function clearOutputScope(label = "Waiting for synth...") {
  outputScopeSamples = Array.from({ length: OUTPUT_SCOPE_FRAME_SIZE }, () => 0);
  if (outputScopeLabelEl) outputScopeLabelEl.textContent = label;
  drawScopeFromSamples(outputScopeCanvas, outputScopeSamples);
}

function updateWaveformViews() {
  const pulsaret = currentParamValue("pulsaret", 2.5);
  const windowType = currentParamValue("window", 0.5);
  const duty = clamp(currentParamValue("duty", 0.5), 0.01, 1);

  if (pulsaretWaveLabelEl) {
    pulsaretWaveLabelEl.textContent = `${interpolatedWaveLabel(pulsaret, PULSARET_WAVE_NAMES)} (${pulsaret.toFixed(2)})`;
  }
  if (windowWaveLabelEl) {
    windowWaveLabelEl.textContent = `${interpolatedWaveLabel(windowType, WINDOW_WAVE_NAMES)} (${windowType.toFixed(2)})`;
  }
  if (dutyWaveLabelEl) {
    dutyWaveLabelEl.textContent = duty.toFixed(2);
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
  drawWaveform(
    dutyWaveCanvas,
    (t) => {
      const dutyStart = (1 - duty) * 0.5;
      return (t >= dutyStart && t < (dutyStart + duty)) ? 1 : -1;
    },
    -1,
    1
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

function getControlMeta(param) {
  const knob = knobByParam.get(param);
  if (knob) {
    return {
      type: "continuous",
      min: Number(knob.dataset.min),
      max: Number(knob.dataset.max),
      step: Number(knob.dataset.step || "0.01")
    };
  }

  const range = rangeByParam.get(param);
  if (range) {
    return {
      type: "continuous",
      min: Number(range.min),
      max: Number(range.max),
      step: Number(range.step || "0.01")
    };
  }

  const select = selectByParam.get(param);
  if (select) {
    return {
      type: "discrete",
      values: Array.from(select.options).map((opt) => Number(opt.value))
    };
  }

  return null;
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
      persistMidiMappings();
      refreshMidiMapControl(param);
    });

    clearButton.addEventListener("click", () => {
      midiMappings[param] = null;
      persistMidiMappings();
      refreshMidiMapControl(param);
      appendLog(`[MIDI] ${param} mapping cleared`);
    });
  });

  allParamNames.forEach((param) => refreshMidiMapControl(param));

  document.addEventListener("click", () => closeMidiPanels(null));
}

function handleMidiMessage(event) {
  const data = event?.data;
  if (!data || data.length < 3) return;
  const status = data[0];
  if ((status & 0xF0) !== 0xB0) return;
  const cc = Number(data[1]);
  const ccValue = Number(data[2]);

  Object.entries(midiMappings).forEach(([param, mappedCc]) => {
    if (mappedCc !== cc) return;
    const value = valueFromMidiCc(param, ccValue);
    if (value === null) return;
    setParamValue(param, value, true);
  });
}

function bindMidiInputs() {
  if (!midiAccess) return;
  let inputCount = 0;
  midiAccess.inputs.forEach((input) => {
    input.onmidimessage = handleMidiMessage;
    inputCount += 1;
  });
  appendLog(`[MIDI] Listening on ${inputCount} input${inputCount === 1 ? "" : "s"}.`);
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
      if (event?.port?.type === "input") {
        bindMidiInputs();
        appendLog(`[MIDI] ${event.port.name || event.port.id} is ${event.port.state}.`);
      }
    };
  } catch (err) {
    appendLog(`[MIDI] Failed to initialize: ${err.message}`);
  }
}

function normalizeParamValue(param, rawValue) {
  const value = Number(rawValue);
  if (Number.isNaN(value)) return null;

  const knob = knobByParam.get(param);
  if (knob) {
    const min = Number(knob.dataset.min);
    const max = Number(knob.dataset.max);
    const step = Number(knob.dataset.step || "0.01");
    return clamp(quantize(value, step), min, max);
  }

  const range = rangeByParam.get(param);
  if (range) {
    const min = Number(range.min);
    const max = Number(range.max);
    const step = Number(range.step || "0.01");
    return clamp(quantize(value, step), min, max);
  }

  const select = selectByParam.get(param);
  if (select) {
    const optionValues = new Set(Array.from(select.options).map((opt) => Number(opt.value)));
    if (!optionValues.has(value)) return null;
    return value;
  }

  return value;
}

function setParamValue(param, rawValue, send = true) {
  const value = normalizeParamValue(param, rawValue);
  if (value === null) return false;

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
    if (Array.from(select.options).some((opt) => opt.value === valueStr)) {
      select.value = valueStr;
    }
  }

  if (param === "pulsaret" || param === "window" || param === "duty") {
    updateWaveformViews();
  }

  if (send) window.spaluterApi.setParam(param, value);
  return true;
}

function defaultPresetName(index) {
  return `Preset ${index + 1}`;
}

function createDefaultPresets() {
  return Array.from({ length: PRESET_COUNT }, (_unused, index) => ({
    name: defaultPresetName(index),
    params: null,
    sampleDirectory: DEFAULT_SAMPLE_DIR,
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
        : DEFAULT_SAMPLE_DIR;
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
  const dir = (preferredDir || sampleDirectoryEl.value || DEFAULT_SAMPLE_DIR).trim() || DEFAULT_SAMPLE_DIR;
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

window.spaluterApi.onStatus((text) => {
  statusEl.textContent = text;
  const state = classifyStatus(text);
  const statusText = String(text || "").toLowerCase();
  setStatusState(state);
  updateSynthRunningFromStatus(text);
  if (/(synth stopped|stopped by user|manual stop|quitting runtime|sclang exited)/.test(statusText)) {
    clearOutputScope("Waiting for synth...");
  }
  if (/synth started/.test(statusText) && outputScopeLabelEl) {
    outputScopeLabelEl.textContent = "Live output";
  }
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
updateWaveformViews();
clearOutputScope();
window.addEventListener("resize", updateWaveformViews);

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

knobs.forEach((knob) => {
  const param = knob.dataset.param;
  const min = Number(knob.dataset.min);
  const max = Number(knob.dataset.max);
  const step = Number(knob.dataset.step || "0.01");
  let value = Number(knob.dataset.value ?? min);

  value = clamp(value, min, max);
  setParamValue(param, value, true);

  let dragging = false;
  let startY = 0;
  let startValue = value;

  knob.addEventListener("mousedown", (e) => {
    dragging = true;
    startY = e.clientY;
    startValue = Number(knob.dataset.value);
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    const scale = (max - min) / 180;
    setParamValue(param, startValue + (dy * scale), true);
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
  });
});

setupMidiMappingControls();
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
      sampleDirectory: String(sampleDirectoryEl?.value || "").trim() || DEFAULT_SAMPLE_DIR,
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
    await refreshSampleList(preset.sampleDirectory || DEFAULT_SAMPLE_DIR, preset.samplePath || "");
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
    refreshSampleList(sampleDirectoryEl?.value || DEFAULT_SAMPLE_DIR, sampleFileEl?.value || "");
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
    logEl.textContent = `${state.logs.join("\n")}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  const defaultDir = String(state.sampleDefaultDir || DEFAULT_SAMPLE_DIR);
  refreshSampleList(defaultDir, "");
});
