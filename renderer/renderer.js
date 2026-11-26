const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText") || statusEl;
const cpuUsageEl = document.getElementById("cpuUsage");
const cpuValEl = document.getElementById("cpuVal");
const cpuKeyEl = document.getElementById("cpuKey");
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
const pulsaretWaveCanvas = document.getElementById("pulsaretWaveView");
const windowWaveCanvas = document.getElementById("windowWaveView");
const dutyWaveCanvas = document.getElementById("dutyWaveView");
const formantWaveCanvas = document.getElementById("formantWaveView");
const formantActivityCanvas = document.getElementById("formantActivityView");
const maskScopeCanvas = document.getElementById("maskScopeView");
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
const PARAM_ANIM_TICK_MS_DEFAULT = 33;
const PARAM_ANIM_TICK_MS_RESPONSIVE = 22;
const RESPONSIVE_PREVIEW_MODE_STORAGE_KEY = "spaluter-responsive-preview-v1";
const DEFAULT_RESPONSIVE_PREVIEW_MODE = true;
const MAIN_SCREENS = ["edit", "mods", "reverb", "presets"];
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
// MIDI clock readouts redraw at most this often, and the clock is declared
// lost when no tick has arrived for this long (two beats at 30 BPM).
const MIDI_CLOCK_READOUT_MIN_INTERVAL_MS = 250;
const MIDI_CLOCK_LOST_AFTER_MS = 4000;
// Clock-locked LFOs: the engine's beat-position bus is resynced to the counted
// tick position every sixteenth (6 ticks) and snapped on Start.
const MIDI_CLOCK_SYNC_EVERY_TICKS = 6;
const RENDERER_HEARTBEAT_MS = 1000;
const DSP_CPU_STALE_MS = 3500;
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
let midiClockReadoutLastAtMs = 0;
let midiClockLostTimer = null;
let midiClockPresent = false;
let midiClockTickCount = 0;
let midiClockTempoKnownSent = false;
let lastLoggedMidiGate = -1;
let synthRunning = false;
let waveformLayoutDirty = true;
let resizeDebounceTimer = null;
let midiRebindTimer = null;
let rendererHeartbeatTimer = null;
let activeKnobDrag = null;
let logLineCount = 0;
let currentMainScreen = "edit";
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
    params: ["formantCount", "formantTrack", "formantQuant", "formant1", "formant2", "formantInterval2", "formant3", "formantInterval3", "pan1", "pan2", "pan3"]
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
  formantQuant: 63,
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
// ─────────────────────────── Synth screen ──────────────────────────────────
// Screen id stays "edit" internally. A rail of four section tabs (each with a
// live two-line summary) on the left; the selected section on the right as
// full-width 48 px rows: name · [−] slider [+] · value. Nothing scrolls at
// 1024x600. Extras per row: double-tap the name to reset the parameter to its
// default, an "LFO" badge when an LFO drives it (tap: jump to that LFO on the
// Mods screen), and in MIDI-learn mode a CC tag (tap the name, move a
// controller; tap the tag to clear).
const SYNTH_SECTIONS = ["engine", "formants", "grain", "voice"];
const SYNTH_SECTION_TITLES = { engine: "Engine", formants: "Formants", grain: "Grain", voice: "Voice" };
const SYNTH_SECTION_STORAGE_KEY = "spaluter.synth.section";
const SYNTH_NUDGE_REPEAT_DELAY_MS = 420;
const SYNTH_NUDGE_REPEAT_MS = 70;
const SYNTH_DOUBLE_TAP_MS = 350;
const SYNTH_SUMMARY_DEBOUNCE_MS = 120;
const SYNTH_HINT_DEFAULT = "double-tap a name to reset it";
const SYNTH_HINT_LEARN = "tap a name, then move a controller · tap a CC tag to clear it";
// Which rows depend on another control, keyed by the row's data-depends value.
const SYNTH_DEPENDENCY_DRIVERS = new Set(["dutyMode", "maskMode", "formantCount", "voiceCount", "formantQuant"]);

const synthLayoutEl = document.querySelector(".synth-layout");
const synthRailEl = document.getElementById("synthRail");
const synthSectionTitleEl = document.getElementById("synthSectionTitle");
const synthSectionHintEl = document.getElementById("synthSectionHint");
const synthMidiLearnEl = document.getElementById("synthMidiLearn");
const synthSectionEls = new Map();
const synthTabEls = new Map();
const synthSummaryEls = new Map();
const synthRowByParam = new Map();
let synthSection = loadSynthSection();
let midiLearnActive = false;
let midiLearnArmedParam = null;
let synthSummaryTimer = 0;

function loadSynthSection() {
  try {
    const raw = localStorage.getItem(SYNTH_SECTION_STORAGE_KEY);
    return SYNTH_SECTIONS.includes(raw) ? raw : SYNTH_SECTIONS[0];
  } catch (_err) {
    return SYNTH_SECTIONS[0];
  }
}

function setSynthSection(key, persist = true) {
  const next = SYNTH_SECTIONS.includes(key) ? key : SYNTH_SECTIONS[0];
  synthSection = next;
  synthSectionEls.forEach((el, k) => { el.hidden = k !== next; });
  synthTabEls.forEach((el, k) => el.setAttribute("aria-pressed", String(k === next)));
  if (synthSectionTitleEl) synthSectionTitleEl.textContent = SYNTH_SECTION_TITLES[next];
  const bodyEl = document.querySelector(".synth-body");
  const tabEl = synthTabEls.get(next);
  if (bodyEl && tabEl) bodyEl.dataset.accent = tabEl.dataset.accent;
  if (persist) {
    try { localStorage.setItem(SYNTH_SECTION_STORAGE_KEY, next); } catch (_err) { /* ignore */ }
  }
  // The previews live in the Engine section; their canvases measure 0 while hidden.
  waveformLayoutDirty = true;
  if (next === "engine") updateWaveformViews();
  updateEditLfoMarkers();
}

// Coarser steps for the wide Hz/ms ranges: 1 below 200, 10 above; otherwise
// the control's own step.
function synthNudgeStep(meta, current, direction) {
  const span = Number(meta.max) - Number(meta.min);
  if (span >= 500) {
    const coarse = (direction > 0 ? current >= 200 : current > 200) ? 10 : 1;
    return Math.max(Number(meta.step) || 1, coarse);
  }
  return Number(meta.step) || 0.01;
}

function synthNudge(param, direction) {
  const meta = getControlMeta(param);
  if (!meta || meta.type !== "continuous") return;
  const current = currentParamValue(param, meta.min);
  const step = synthNudgeStep(meta, current, direction);
  setParamValue(param, clamp(current + (direction * step), meta.min, meta.max), true);
}

function makeSynthNudgeButton(param, direction) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "synth-nudge";
  btn.textContent = direction > 0 ? "+" : "−";
  btn.setAttribute("aria-label", `${direction > 0 ? "Increase" : "Decrease"} ${param}`);
  let holdTimer = 0;
  let repeatTimer = 0;
  const stop = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (repeatTimer) { clearInterval(repeatTimer); repeatTimer = 0; }
  };
  btn.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    stop();
    synthNudge(param, direction);
    holdTimer = window.setTimeout(() => {
      repeatTimer = window.setInterval(() => synthNudge(param, direction), SYNTH_NUDGE_REPEAT_MS);
    }, SYNTH_NUDGE_REPEAT_DELAY_MS);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => btn.addEventListener(type, stop));
  btn.addEventListener("click", (event) => event.preventDefault());
  return btn;
}

function synthDefaultValue(param) {
  const slider = paramSliderByParam.get(param);
  if (slider && slider.classList.contains("edit-slider")) return Number(slider.defaultValue);
  const select = selectByParam.get(param);
  if (select) {
    const def = Array.from(select.options).find((o) => o.defaultSelected) || select.options[0];
    return def ? Number(def.value) : null;
  }
  return null;
}

function synthResetParam(param) {
  const def = synthDefaultValue(param);
  if (def === null || !Number.isFinite(def)) return;
  setParamValue(param, def, true);
  const refs = synthRowByParam.get(param);
  if (refs) {
    refs.row.classList.remove("synth-reset-flash");
    void refs.row.offsetWidth; // restart the animation
    refs.row.classList.add("synth-reset-flash");
  }
  appendLog(`[SYNTH] ${param} reset to ${formatParamValue(param, def)}`);
}

// ── dependencies ────────────────────────────────────────────────────────────
function refreshSynthDependencies() {
  const dutyMode = Math.round(currentParamValue("dutyMode", 0));
  const maskMode = Math.round(currentParamValue("maskMode", 0));
  const formantCount = Math.round(currentParamValue("formantCount", 3));
  const voiceCount = Math.round(currentParamValue("voiceCount", 1));
  const quantOn = currentParamValue("formantQuant", 0) > 0.5;
  const rules = {
    duty: { disabled: dutyMode >= 1 },
    formant2: { disabled: formantCount < 2 },
    formant3: { disabled: formantCount < 3 },
    formant2free: { hidden: quantOn, disabled: formantCount < 2 },
    formant3free: { hidden: quantOn, disabled: formantCount < 3 },
    interval2: { hidden: !quantOn, disabled: formantCount < 2 },
    interval3: { hidden: !quantOn, disabled: formantCount < 3 },
    maskOn: { disabled: maskMode === 0 },
    maskStochastic: { disabled: maskMode !== 1 },
    maskBurst: { hidden: maskMode !== 2 },
    chord: { disabled: voiceCount < 2 }
  };
  document.querySelectorAll(".synth-section .ctl[data-depends], .synth-section .ctl .sub[data-depends]").forEach((row) => {
    const rule = rules[row.dataset.depends] || {};
    row.hidden = Boolean(rule.hidden);
    row.classList.toggle("ctl-disabled", Boolean(rule.disabled) && !rule.hidden);
  });
  refreshSynthIntervalHz();
}

// ── quantized formants ──────────────────────────────────────────────────────
// Must match ~spaluterFormantRatios in spaluter_supercollider.scd.
const FORMANT_RATIOS = [1 / 2, 3 / 4, 1, 6 / 5, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 2, 5 / 2, 3, 4, 5, 6];
// The interval rows share the MIDI CC of the formant they replace: one
// controller moves Formant 2's Hz when free and steps through its ratios
// when quantized. midiMappings never holds an entry for the interval params.
const MIDI_CC_ALIAS = { formantInterval2: "formant2", formantInterval3: "formant3" };
const MIDI_CC_QUANT_REDIRECT = { formant2: "formantInterval2", formant3: "formantInterval3" };
function midiMappingOwner(param) { return MIDI_CC_ALIAS[param] || param; }
// Where a CC bound to `param` should land right now.
function midiCcTargetParam(param) {
  const redirect = MIDI_CC_QUANT_REDIRECT[param];
  return redirect && formantQuantOn() ? redirect : param;
}
const FORMANT_QUANT_PARAMS = new Set(["formant1", "formant2", "formant3", "formantQuant", "formantInterval2", "formantInterval3", "formantCount"]);

function formantQuantOn() {
  return currentParamValue("formantQuant", 0) > 0.5;
}

function formantRatioForIndex(idx) {
  return FORMANT_RATIOS[clamp(Math.round(Number(idx) || 0), 0, FORMANT_RATIOS.length - 1)];
}

function nearestFormantRatioIndex(ratio) {
  const r = Math.max(Number(ratio) || 1, 1e-6);
  let best = 0;
  let bestDist = Infinity;
  FORMANT_RATIOS.forEach((cand, i) => {
    const d = Math.abs(Math.log(r / cand));
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// Quantized Hz for formant 2 or 3 (before LFO offsets), from formant 1 and the interval.
function quantizedFormantHz(n) {
  const f1 = currentParamValue("formant1", 20);
  return clamp(f1 * formantRatioForIndex(currentParamValue(`formantInterval${n}`, n === 2 ? 6 : 8)), 20, 8000);
}

function refreshSynthIntervalHz() {
  [2, 3].forEach((n) => {
    const refs = synthRowByParam.get(`formantInterval${n}`);
    if (!refs || !refs.hzEl) return;
    refs.hzEl.textContent = formantQuantOn() ? `${Math.round(quantizedFormantHz(n))} Hz` : "";
  });
}

// User tap on the Quantize switch (not presets or MIDI): keep the sound where
// it is. Turning on picks the nearest ratio to each free formant; turning off
// writes the quantized Hz back into the sliders.
function snapFormantsForQuantToggle(turningOn) {
  const f1 = Math.max(currentParamValue("formant1", 20), 1e-6);
  [2, 3].forEach((n) => {
    if (turningOn) {
      setParamValue(`formantInterval${n}`, nearestFormantRatioIndex(currentParamValue(`formant${n}`, f1) / f1), true);
    } else {
      const meta = getControlMeta(`formant${n}`);
      const hz = quantizedFormantHz(n);
      setParamValue(`formant${n}`, clamp(Math.round(hz), meta ? meta.min : 20, meta ? meta.max : 3000), true);
    }
  });
}

function initFormantQuantToggle() {
  const row = document.getElementById("formantQuantRow");
  if (!row) return;
  row.addEventListener("click", (event) => {
    const btn = event.target.closest(".opt");
    if (!btn) return;
    const next = Number(btn.dataset.value);
    if (!Number.isFinite(next) || next === Math.round(currentParamValue("formantQuant", 0))) return;
    snapFormantsForQuantToggle(next > 0.5);
  }, true);
}

// ── rail summaries ──────────────────────────────────────────────────────────
// Summary lines for a rail tab: arrays of lines, each an array of segments
// [class, text] with class "k" (label), "v" (value) or "h" (headline value).
function synthSummaryLines(key) {
  const v = (p, d = 0) => currentParamValue(p, d);
  const f = (p) => formatParamValue(p, v(p));
  const K = (t) => ["k", t];
  const V = (t) => ["v", t];
  const H = (t) => ["h", t];
  if (key === "engine") {
    const duty = Math.round(v("dutyMode")) >= 1 ? [K("formant duty")] : [K("duty "), V(f("duty"))];
    return [
      [K("amp "), H(f("amp")), K(" · drive "), V(f("drive"))],
      [K("puls "), V(f("pulsaret")), K(" · win "), V(f("window"))],
      duty
    ];
  }
  if (key === "formants") {
    const n = clamp(Math.round(v("formantCount", 3)), 1, 3);
    const quant = formantQuantOn();
    const hzLine = quant
      ? [V(`${Math.round(v("formant1"))}`), K(" Hz"), ...[2, 3].slice(0, Math.max(0, n - 1)).flatMap((i) => [K(" · "), V(f(`formantInterval${i}`))])]
      : [V([1, 2, 3].slice(0, n).map((i) => Math.round(v(`formant${i}`))).join(" / ")), K(" Hz")];
    return [
      [H(`${n} formant${n > 1 ? "s" : ""}`), K(quant ? " · quantized" : "")],
      hzLine,
      [K(Math.round(v("formantTrack")) ? "tracking pitch" : "static")]
    ];
  }
  if (key === "grain") {
    const m = Math.round(v("maskMode"));
    const mask = m === 0 ? [H("mask off")]
      : m === 1 ? [H("stochastic"), K(" "), V(f("maskAmount"))]
        : [H("burst"), K(" "), V(`${f("burstOn")} / ${f("burstOff")}`)];
    return [
      mask,
      [K("jitter "), V(`${f("ampJitter")} / ${f("timingJitter")}`)],
      [K("gliss "), V(f("glisson"))]
    ];
  }
  if (key === "voice") {
    const gm = ["MIDI-like", "free run", "CV-like"][Math.round(v("gateMode", 1))] || "—";
    const vc = clamp(Math.round(v("voiceCount", 1)), 1, 4);
    const chordSel = selectByParam.get("chordType");
    const chord = vc > 1 && chordSel ? chordSel.options[chordSel.selectedIndex]?.textContent || "" : "";
    return [
      [H(`${vc} voice${vc > 1 ? "s" : ""}`), K(chord ? " · " : ""), V(chord)],
      [K(gm), K(" · "), V(f("basePitch")), K(" Hz")],
      [K("A "), V(f("attackMs")), K(" · R "), V(f("releaseMs")), K(" ms")]
    ];
  }
  return [];
}

function refreshSynthSummaries() {
  synthSummaryEls.forEach((el, key) => {
    el.textContent = "";
    synthSummaryLines(key).forEach((line, i) => {
      if (i > 0) el.append("\n");
      line.forEach(([cls, text]) => {
        if (!text) return;
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text;
        el.append(span);
      });
    });
  });
}

function scheduleSynthSummaries() {
  if (synthSummaryTimer) return;
  synthSummaryTimer = window.setTimeout(() => {
    synthSummaryTimer = 0;
    refreshSynthSummaries();
  }, SYNTH_SUMMARY_DEBOUNCE_MS);
}

// Called from setParamValue for every parameter change (local, preset, MIDI).
function onSynthParamChanged(param) {
  if (synthRowByParam.size === 0) return;
  if (SYNTH_DEPENDENCY_DRIVERS.has(param)) refreshSynthDependencies();
  else if (FORMANT_QUANT_PARAMS.has(param)) refreshSynthIntervalHz();
  scheduleSynthSummaries();
}

// ── LFO badges ──────────────────────────────────────────────────────────────
function firstLfoIndexForTarget(param) {
  for (let i = 0; i < LFO_MAX; i += 1) {
    if (lfoIsActive(lfoConfigs[i]) && lfoConfigs[i].target === param) return i;
  }
  return -1;
}

function refreshSynthLfoBadges() {
  synthRowByParam.forEach((refs, param) => {
    if (refs.lfoEl) refs.lfoEl.classList.toggle("on", firstLfoIndexForTarget(param) >= 0);
  });
}

// ── MIDI learn ──────────────────────────────────────────────────────────────
function setMidiLearnActive(on) {
  midiLearnActive = Boolean(on);
  midiLearnArmedParam = null;
  if (synthLayoutEl) synthLayoutEl.classList.toggle("learn", midiLearnActive);
  if (synthMidiLearnEl) synthMidiLearnEl.setAttribute("aria-pressed", String(midiLearnActive));
  if (synthSectionHintEl) synthSectionHintEl.textContent = midiLearnActive ? SYNTH_HINT_LEARN : SYNTH_HINT_DEFAULT;
  refreshSynthCcChips();
}

function armMidiLearn(paramRaw) {
  const param = midiMappingOwner(paramRaw);
  midiLearnArmedParam = midiLearnArmedParam === param ? null : param;
  refreshSynthCcChips();
}

function clearMidiMapping(paramRaw) {
  const param = midiMappingOwner(paramRaw);
  midiMappings[param] = null;
  rebuildMidiCcLookup();
  persistMidiMappings();
  appendLog(`[MIDI] ${param} mapping cleared`);
  if (midiLearnArmedParam === param) midiLearnArmedParam = null;
  refreshSynthCcChips();
}

// Next CC on the input channel while a row is armed becomes its mapping.
// Returns true when the CC was consumed by learn.
function handleMidiLearnCc(cc) {
  if (!midiLearnActive || midiLearnArmedParam === null) return false;
  const param = midiLearnArmedParam;
  // One parameter per CC: a CC already bound elsewhere moves to this row.
  Object.keys(midiMappings).forEach((other) => {
    if (other !== param && midiMappings[other] === cc) midiMappings[other] = null;
  });
  midiMappings[param] = cc;
  rebuildMidiCcLookup();
  persistMidiMappings();
  appendLog(`[MIDI] ${param} mapped to CC ${cc} (learn)`);
  midiLearnArmedParam = null;
  refreshSynthCcChips();
  return true;
}

function refreshSynthCcChips() {
  synthRowByParam.forEach((refs, paramRaw) => {
    const param = midiMappingOwner(paramRaw);
    const cc = midiMappings[param];
    const mapped = Number.isInteger(cc);
    const armed = midiLearnArmedParam === param;
    refs.row.classList.toggle("armed", armed);
    if (!refs.ccEl) return;
    refs.ccEl.textContent = armed ? "waiting for CC…" : (mapped ? `CC ${cc} ×` : "no CC");
    refs.ccEl.classList.toggle("mapped", mapped && !armed);
    refs.ccEl.title = mapped ? "Tap to clear this mapping" : "Tap the name to assign a controller";
  });
}

// ── build ───────────────────────────────────────────────────────────────────
function refreshSynthScreen() {
  setSynthSection(synthSection, false);
  refreshSynthDependencies();
  refreshSynthSummaries();
  refreshSynthLfoBadges();
  refreshSynthCcChips();
}

function initSynthUi() {
  if (!synthLayoutEl) return;
  document.querySelectorAll(".synth-section").forEach((el) => synthSectionEls.set(el.dataset.section, el));
  document.querySelectorAll(".synth-tab").forEach((el) => {
    synthTabEls.set(el.dataset.section, el);
    const sum = el.querySelector("[data-summary]");
    if (sum) synthSummaryEls.set(el.dataset.section, sum);
    el.addEventListener("click", () => setSynthSection(el.dataset.section));
  });

  const units = [];
  document.querySelectorAll(".synth-section .ctl").forEach((ctl) => {
    if (ctl.classList.contains("dual")) ctl.querySelectorAll(".sub").forEach((sub) => units.push(sub));
    else units.push(ctl);
  });
  units.forEach((row) => {
    const slider = row.querySelector("input.edit-slider[data-param]");
    const select = row.querySelector("select.edit-select[data-param]");
    const param = slider?.dataset.param || select?.dataset.param;
    if (!param) return;
    const nameEl = row.querySelector(".nm");
    if (!nameEl) return;
    const nameText = nameEl.textContent;
    nameEl.textContent = "";
    const title = document.createElement("span");
    title.textContent = nameText;
    const tags = document.createElement("span");
    tags.className = "synth-tags";
    const lfoEl = document.createElement("span");
    lfoEl.className = "synth-lfo";
    lfoEl.textContent = "LFO";
    lfoEl.title = "Driven by an LFO · tap to open it on the Mods screen";
    const ccEl = document.createElement("span");
    ccEl.className = "synth-cc";
    tags.append(lfoEl, ccEl);
    let hzEl = null;
    if (param === "formantInterval2" || param === "formantInterval3") {
      hzEl = document.createElement("span");
      hzEl.className = "synth-hz";
      tags.prepend(hzEl);
    }
    nameEl.append(title, tags);

    if (slider) {
      const wrap = slider.closest(".edit-slider-wrap") || slider;
      wrap.insertAdjacentElement("beforebegin", makeSynthNudgeButton(param, -1));
      wrap.insertAdjacentElement("afterend", makeSynthNudgeButton(param, 1));
    }

    let lastTapAt = 0;
    nameEl.addEventListener("click", (event) => {
      if (event.target === lfoEl || event.target === ccEl) return;
      if (midiLearnActive) {
        armMidiLearn(param);
        return;
      }
      const now = performance.now();
      if (now - lastTapAt < SYNTH_DOUBLE_TAP_MS) {
        lastTapAt = 0;
        synthResetParam(param);
      } else {
        lastTapAt = now;
      }
    });
    lfoEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const idx = firstLfoIndexForTarget(param);
      if (idx < 0) return;
      selectLfo(idx);
      setScreen("mods");
    });
    ccEl.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!midiLearnActive) return;
      const owner = midiMappingOwner(param);
      if (Number.isInteger(midiMappings[owner]) && midiLearnArmedParam !== owner) clearMidiMapping(param);
      else armMidiLearn(param);
    });

    synthRowByParam.set(param, { row, nameEl, lfoEl, ccEl, hzEl, slider, select });
  });

  if (synthMidiLearnEl) synthMidiLearnEl.addEventListener("click", () => setMidiLearnActive(!midiLearnActive));
  initFormantQuantToggle();
  refreshSynthScreen();
}

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

// The header chip shows the engine's own load (scsynth /status avgCPU, with
// peakCPU in the label) rather than Electron's: that is the number that
// predicts dropouts. UI-side CPU still arrives via onCpuUsage; it is kept on
// the chip's tooltip and in the main process's [CPU] session log lines.
let lastUiCpuPercent = 0;
let dspCpuStaleTimer = null;

function refreshCpuChipTooltip() {
  if (!cpuUsageEl) return;
  cpuUsageEl.title = `Engine CPU: scsynth average, peak in label · UI ${lastUiCpuPercent.toFixed(1)}%`;
}

function setCpuUsage(percent) {
  const numeric = Number(percent);
  lastUiCpuPercent = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  refreshCpuChipTooltip();
}

function setDspCpu(info) {
  if (!cpuUsageEl) return;
  if (dspCpuStaleTimer) {
    clearTimeout(dspCpuStaleTimer);
    dspCpuStaleTimer = null;
  }
  const avg = Number(info?.avg);
  const peak = Number(info?.peak);
  if (!info || !Number.isFinite(avg)) {
    if (cpuValEl) cpuValEl.textContent = "--";
    if (cpuKeyEl) cpuKeyEl.textContent = "DSP";
    cpuUsageEl.classList.remove("cpu-warn", "cpu-hot");
    return;
  }
  const safePeak = Number.isFinite(peak) ? Math.max(0, peak) : 0;
  if (cpuValEl) cpuValEl.textContent = `${Math.max(0, avg).toFixed(1)}%`;
  if (cpuKeyEl) cpuKeyEl.textContent = Number.isFinite(peak) ? `DSP PK ${Math.round(safePeak)}` : "DSP";
  cpuUsageEl.classList.toggle("cpu-hot", safePeak >= 80);
  cpuUsageEl.classList.toggle("cpu-warn", safePeak >= 60 && safePeak < 80);
  dspCpuStaleTimer = window.setTimeout(() => setDspCpu(null), DSP_CPU_STALE_MS);
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
      clamp((formantQuantOn() ? quantizedFormantHz(2) : currentParamValue("formant2", 200)) + lfoModOffset("formant2", nowSec), 20, 8000),
      clamp((formantQuantOn() ? quantizedFormantHz(3) : currentParamValue("formant3", 400)) + lfoModOffset("formant3", nowSec), 20, 8000)
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
    if (MIDI_CC_ALIAS[param]) { mappings[param] = null; return; }
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
      if (MIDI_CC_ALIAS[param]) { sanitized[param] = null; return; }
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

function sendClockSync(reset = false) {
  if (!window.spaluterApi?.clockSync) return;
  const hz = Number.isFinite(midiClockHz) && midiClockHz > 0 ? midiClockHz : 0;
  window.spaluterApi.clockSync(midiClockTickCount / MIDI_CLOCK_TICKS_PER_QUARTER, hz, reset);
}

function syncMidiClockLockedLfos(nowMs = performance.now(), force = false) {
  const clockRate = midiClockRateHz();
  if (clockRate === null) return;
  if (!force && (nowMs - midiClockLastSyncAtMs) < MIDI_CLOCK_SYNC_MIN_INTERVAL_MS) return;

  // The engine only locks an LFO's phase once a tempo exists (lfoToIpc's
  // useClock), so the first estimate after a reset re-sends every synced LFO
  // even if its rate did not move.
  const tempoKnownChanged = !midiClockTempoKnownSent;
  midiClockTempoKnownSent = true;
  const changed = [];
  for (let i = 0; i < LFO_MAX; i += 1) {
    const cfg = lfoConfigs[i];
    if (!cfg?.useMidiClock) continue;
    const nextRate = clamp(clockRate * lfoClockRatioValue(cfg), LFO_RATE_MIN, LFO_RATE_MAX);
    if (!tempoKnownChanged && Math.abs(cfg.rate - nextRate) <= MIDI_CLOCK_RATE_EPSILON) continue;
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

function midiClockTempoText() {
  return Number.isFinite(midiClockBpm) ? `${midiClockBpm.toFixed(1)} BPM` : null;
}

// Both tempo readouts (Mods hint line, VERB/DLY clock line) follow the clock
// handler directly; they used to redraw only when an LFO was edited, so the
// number on screen was whatever the tempo had been at the last edit.
function refreshMidiClockReadouts(force = false, nowMs = performance.now()) {
  if (!force && (nowMs - midiClockReadoutLastAtMs) < MIDI_CLOCK_READOUT_MIN_INTERVAL_MS) return;
  midiClockReadoutLastAtMs = nowMs;
  const tempo = midiClockTempoText();
  updateLfoHint();
  const dlyEl = document.getElementById("dlyClockBpm");
  if (dlyEl) {
    dlyEl.textContent = midiClockPresent
      ? (tempo ? `${tempo} (locked)` : "detecting…")
      : (tempo ? `${tempo} (stopped, last tempo held)` : "none detected");
  }
  if (isModulationScreenActive()) {
    for (let i = 0; i < LFO_MAX; i += 1) {
      if (lfoConfigs[i]?.useMidiClock && lfoStripEls[i]) refreshLfoStrip(i);
    }
  }
}

function markMidiClockLost() {
  midiClockLostTimer = null;
  if (!midiClockPresent) return;
  midiClockPresent = false;
  midiClockTickTimesMs.length = 0;
  clearLfoBeatStartPending();
  appendLog(`[MIDI] Clock stopped${Number.isFinite(midiClockBpm) ? ` (holding ${midiClockBpm.toFixed(1)} BPM)` : ""}.`);
  refreshMidiClockReadouts(true);
}

function noteMidiClockPresent() {
  if (!midiClockPresent) {
    midiClockPresent = true;
    appendLog("[MIDI] Clock detected on an input.");
    refreshMidiClockReadouts(true);
    // Ticks resuming after a gap: the engine kept integrating at the old tempo
    // while the count stood still, so snap it to the counted position instead
    // of letting the resync glide sweep every locked LFO through its cycle.
    sendClockSync(true);
  }
  if (midiClockLostTimer) clearTimeout(midiClockLostTimer);
  midiClockLostTimer = window.setTimeout(markMidiClockLost, MIDI_CLOCK_LOST_AFTER_MS);
}

function resetMidiClockTracking() {
  midiClockTickTimesMs.length = 0;
  midiClockLastSyncAtMs = 0;
  midiClockBpm = null;
  midiClockHz = null;
  midiClockTempoKnownSent = false;
}

function handleMidiRealtimeMessage(status, eventTimeMs) {
  if (status === MIDI_STATUS_START || status === MIDI_STATUS_CONTINUE || status === MIDI_STATUS_STOP) {
    // Transport messages only restart the tick window. The last tempo is kept:
    // clearing it sent the delay back to Base Time for the eight ticks the
    // estimate needs, an audible warble on every Start, and left the synced
    // LFOs at their old rate anyway.
    midiClockTickTimesMs.length = 0;
    midiClockLastSyncAtMs = 0;
    if (status === MIDI_STATUS_START) {
      // The first clock after Start is the downbeat: snap the engine's beat
      // position to zero so clock-locked LFOs restart on the one.
      midiClockTickCount = 0;
      sendClockSync(true);
    } else if (status === MIDI_STATUS_CONTINUE) {
      sendClockSync(false);
    }
    return;
  }
  if (status !== MIDI_STATUS_CLOCK) return;

  // Web MIDI stamps each event when it arrived at the port; using that instead
  // of the handler's run time keeps UI load out of the tempo estimate.
  const nowMs = Number.isFinite(eventTimeMs) ? eventTimeMs : performance.now();
  noteMidiClockPresent();
  if (midiClockTickCount % MIDI_CLOCK_SYNC_EVERY_TICKS === 0) sendClockSync(false);
  if (midiClockTickCount % MIDI_CLOCK_TICKS_PER_QUARTER === 0) clearLfoBeatStartPending();
  midiClockTickCount += 1;
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
  refreshMidiClockReadouts(false, nowMs);
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
    handleMidiRealtimeMessage(status, event.timeStamp);
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
    if (handleMidiLearnCc(cc)) return;
    const mappedParams = midiParamsByCc.get(cc);
    if (!Array.isArray(mappedParams) || mappedParams.length === 0) return;
    // Phase 1.3: stage latest-value-per-param; rAF drain applies them once
    // per frame. No CC value is dropped; the value at frame boundary is
    // whatever the controller sent most recently for that CC.
    for (let i = 0; i < mappedParams.length; i += 1) {
      const param = midiCcTargetParam(mappedParams[i]);
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
    || param === "formantQuant"
    || param === "formantInterval2"
    || param === "formantInterval3"
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
  onSynthParamChanged(param);
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
// LFOs whose Run was pressed in MIDI clock mode and that the engine is holding
// silent until the next whole beat (startOnBeat). Only a display state: the
// engine does the waiting; this clears on the beat tick so the row can stop
// showing "armed".
const lfoBeatStartPending = new Set();
// All 16 LFOs are always presented and always live on the engine; each one's
// `enabled` flag (not the count) decides whether it actually runs.
let lfoCount = LFO_MAX;

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

// ─── Mods screen ─────────────────────────────────────────────────────────────
// Two panes. MONITOR (left): the 16 LFO rows (tap to select, tap the number to
// run/stop) with live meters, an optional scope and a live target readout.
// EDITOR (right): the selected LFO's controls in two accordion sections.
// Everything live here comes from the engine's /spaluter/modscope stream
// (\spaluterModScope): 16 normalised LFO outputs, the 20 summed mod-bus
// channels the synth actually receives, and the beat position. Nothing on this
// screen is a client-side re-synthesis of the LFO shapes, and no renderer
// timer is involved (requestAnimationFrame is throttled on the Pi kiosk).

const LFO_PRIMARY_ACCENT = "#ff6f24";
const MOD_SCOPE_LFO_COUNT = 16;
const MOD_SCOPE_MOD_COUNT = 20;
const MOD_SCOPE_HISTORY = 512;
const MOD_SCOPE_WINDOW_SEC = 4;
const MOD_SCOPE_RATE_SCOPE_HZ = 30;
const MOD_SCOPE_RATE_ROWS_HZ = 10;
const MOD_SCOPE_STALE_MS = 1500;
const MOD_SCOPE_GAP_MS = 400;
const MOD_SCOPE_ROWS_MIN_INTERVAL_MS = 60;
const MOD_SCOPE_LIVE_MIN_INTERVAL_MS = 120;
const MODS_SCOPE_STORAGE_KEY = "spaluter.mods.scopeVisible";
const MODS_ACCORDION_STORAGE_KEY = "spaluter.mods.accordion";
// Channel order of the engine's mod bus. MUST match `modParams` in sc/runtime.scd.
const MOD_BUS_INDEX = new Map([
  "amp", "drive", "pulsaret", "window", "duty",
  "formant1", "formant2", "formant3", "maskAmount",
  "pan1", "pan2", "pan3",
  "ampJitter", "timingJitter", "glisson", "basePitch",
  "attackMs", "releaseMs", "glideMs", "sampleRate"
].map((name, i) => [name, i]));
const LFO_SHAPE_SHORT = ["Sine", "Tri", "Saw ↑", "Saw ↓", "Square", "S&H", "Rnd"];
// 24x14 glyph polylines for the shape chooser.
const LFO_SHAPE_GLYPHS = [
  Array.from({ length: 13 }, (_, k) => `${k * 2},${(7 - (6 * Math.sin((k / 12) * TWO_PI))).toFixed(1)}`).join(" "),
  "0,7 6,1 18,13 24,7",
  "0,13 12,1 12,13 24,1",
  "0,1 12,13 12,1 24,13",
  "0,13 0,1 12,1 12,13 24,13 24,1",
  "0,9 6,9 6,3 12,3 12,11 18,11 18,5 24,5",
  "0,8 4,4 8,3 12,8 16,12 20,9 24,5"
];

const lfoStripListEl = document.getElementById("lfoStripList");
const lfoCountHintEl = document.getElementById("lfoCountHint");
const lfoActiveCountEl = document.getElementById("lfoActiveCount");
const lfoScopeToggleEl = document.getElementById("lfoScopeToggle");
const lfoScopeBoxEl = document.getElementById("lfoScopeBox");
const lfoScopeCanvasEl = document.getElementById("lfoScopeView");
const lfoScopeLegendEl = document.getElementById("lfoScopeLegend");
const lfoScopeMetaEl = document.getElementById("lfoScopeMeta");
const lfoLiveLineEl = document.getElementById("lfoLiveLine");
const lfoLiveFillEl = document.getElementById("lfoLiveFill");
const lfoEditorBodyEl = document.getElementById("lfoEditorBody");
const lfoEditTitleEl = document.getElementById("lfoEditTitle");
const lfoEditSubEl = document.getElementById("lfoEditSub");
const lfoEditRunEl = document.getElementById("lfoEditRun");
const lfoPrevEl = document.getElementById("lfoPrev");
const lfoNextEl = document.getElementById("lfoNext");
const lfoStripEls = [];
let lfoEditor = null;
let selectedLfoIndex = 0;
let lfoScopeVisible = loadModsScopeVisible();
const lfoAccordionOpen = loadModsAccordionState();

// Telemetry ring buffers (newest at modScopeHead - 1).
const modScopeHist = Array.from({ length: MOD_SCOPE_LFO_COUNT }, () => new Float32Array(MOD_SCOPE_HISTORY));
const modScopeHistBeat = new Float32Array(MOD_SCOPE_HISTORY);
const modScopeHistT = new Float64Array(MOD_SCOPE_HISTORY);
let modScopeHead = 0;
let modScopeCount = 0;
let modScopeLastAtMs = 0;
const lfoLiveOut = new Float32Array(MOD_SCOPE_LFO_COUNT);
const modBusLive = new Float32Array(MOD_SCOPE_MOD_COUNT);
let modScopeRowsLastAtMs = 0;
let modScopeLiveLastAtMs = 0;
let modScopeStreamEnabled = false;
let modScopeStreamRateHz = 0;

function loadModsScopeVisible() {
  try {
    const raw = localStorage.getItem(MODS_SCOPE_STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch (_err) {
    return true;
  }
}

function loadModsAccordionState() {
  const state = { source: true, destination: true };
  try {
    const raw = localStorage.getItem(MODS_ACCORDION_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      if (typeof parsed.source === "boolean") state.source = parsed.source;
      if (typeof parsed.destination === "boolean") state.destination = parsed.destination;
    }
  } catch (_err) { /* defaults */ }
  return state;
}

function saveModsUiState() {
  try {
    localStorage.setItem(MODS_SCOPE_STORAGE_KEY, lfoScopeVisible ? "1" : "0");
    localStorage.setItem(MODS_ACCORDION_STORAGE_KEY, JSON.stringify(lfoAccordionOpen));
  } catch (_err) { /* storage unavailable */ }
}

function applyCenteredMeterFill(fillEl, normalized) {
  if (!fillEl) return;
  const n = clamp(Number(normalized) || 0, -1, 1);
  const widthPct = Math.abs(n) * 50;
  fillEl.style.width = `${widthPct.toFixed(1)}%`;
  fillEl.classList.toggle("neg", n < 0);
  fillEl.style.left = n < 0 ? `${(50 - widthPct).toFixed(1)}%` : "50%";
}

function lfoNumberText(index) {
  return String(index + 1).padStart(2, "0");
}

function lfoTargetLabel(cfg) {
  return LFO_TARGET_BY_NAME.get(cfg.target)?.label || "—";
}

// Effective rate text: free rate, or clock ratio with the resulting Hz once a
// tempo is known.
function lfoRateText(cfg) {
  const hasTempo = Number.isFinite(midiClockHz);
  if (cfg.useMidiClock) {
    const ratioLabel = lfoClockRatioLabel(lfoClockRatioValue(cfg));
    if (!hasTempo) return `clock ${ratioLabel} · no tempo`;
    const hz = clamp(midiClockHz * lfoClockRatioValue(cfg), LFO_RATE_MIN, LFO_RATE_MAX);
    return `clock ${ratioLabel} · ${hz.toFixed(2)} Hz`;
  }
  return `${cfg.rate.toFixed(2)} Hz`;
}

function lfoRowSummary(cfg) {
  return `${LFO_SHAPE_NAMES[cfg.shape]} · ${lfoRateText(cfg)}`;
}

// Compact form for the monitor rows (two columns, ~120 px of text).
function lfoRowShortSummary(cfg) {
  const shape = LFO_SHAPE_SHORT[cfg.shape];
  if (cfg.useMidiClock) {
    const ratioLabel = lfoClockRatioLabel(lfoClockRatioValue(cfg));
    if (!Number.isFinite(midiClockHz)) return `${shape} · ${ratioLabel} · no clock`;
    const hz = clamp(midiClockHz * lfoClockRatioValue(cfg), LFO_RATE_MIN, LFO_RATE_MAX);
    return `${shape} · ${ratioLabel} · ${hz.toFixed(2)} Hz`;
  }
  return `${shape} · ${cfg.rate.toFixed(2)} Hz`;
}

// Live own contribution of LFO `index` in native units of its target.
function lfoLiveContribution(index) {
  const cfg = lfoConfigs[index];
  if (!lfoIsActive(cfg)) return 0;
  return lfoLiveOut[index] * cfg.depth;
}

// ── monitor rows ────────────────────────────────────────────────────────────

function createLfoRow(index) {
  const row = document.createElement("div");
  row.className = "lfo-row";
  row.dataset.lfoIndex = String(index);
  row.setAttribute("role", "button");
  row.tabIndex = 0;

  const runBtn = document.createElement("button");
  runBtn.type = "button";
  runBtn.className = "lfo-row-run";
  runBtn.textContent = lfoNumberText(index);
  runBtn.setAttribute("aria-label", `LFO ${index + 1} run/stop`);
  runBtn.title = "Run / stop";

  const main = document.createElement("div");
  main.className = "lfo-row-main";
  const targetEl = document.createElement("span");
  targetEl.className = "lfo-row-target";
  const subEl = document.createElement("span");
  subEl.className = "lfo-row-sub";
  main.append(targetEl, subEl);

  const meter = document.createElement("div");
  meter.className = "lfo-meter lfo-row-meter";
  const fill = document.createElement("span");
  fill.className = "lfo-meter-fill";
  meter.appendChild(fill);

  row.append(runBtn, main, meter);
  lfoStripListEl.appendChild(row);

  runBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleLfoEnabled(index);
  });
  row.addEventListener("click", () => selectLfo(index));
  row.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectLfo(index);
    }
  });

  return { index, strip: row, runBtn, targetEl, subEl, meterFill: fill };
}

function buildLfoStrips() {
  if (!lfoStripListEl) return;
  lfoStripListEl.innerHTML = "";
  lfoStripEls.length = 0;
  for (let i = 0; i < LFO_MAX; i += 1) lfoStripEls.push(createLfoRow(i));
}

function refreshLfoRowMeter(index) {
  const r = lfoStripEls[index];
  if (!r) return;
  const cfg = lfoConfigs[index];
  const frac = lfoIsActive(cfg) ? lfoLiveOut[index] * lfoDepthFractionSigned(cfg) : 0;
  applyCenteredMeterFill(r.meterFill, frac);
}

function refreshLfoRow(index) {
  const r = lfoStripEls[index];
  if (!r) return;
  const cfg = lfoConfigs[index];
  const running = lfoIsActive(cfg);
  r.strip.classList.toggle("lfo-disabled", !cfg.enabled);
  r.strip.classList.toggle("lfo-running", running);
  r.strip.classList.toggle("is-selected", index === selectedLfoIndex);
  r.strip.setAttribute("aria-pressed", String(index === selectedLfoIndex));
  r.runBtn.classList.toggle("on", cfg.enabled);
  r.runBtn.classList.toggle("armed", cfg.enabled && lfoBeatStartPending.has(index));
  r.runBtn.setAttribute("aria-pressed", String(cfg.enabled));
  r.targetEl.textContent = cfg.target === "none" ? "unassigned" : lfoTargetLabel(cfg);
  r.targetEl.classList.toggle("is-empty", cfg.target === "none");
  r.subEl.textContent = lfoRowShortSummary(cfg);
  refreshLfoRowMeter(index);
}

// Kept under its historical name: callers elsewhere (clock sync, readouts)
// refresh "the strip" for one LFO. Now that is its row, and the editor when it
// is the selected one.
function refreshLfoStrip(index) {
  refreshLfoRow(index);
  if (index === selectedLfoIndex) refreshLfoEditor();
}

// Run pressed on a clock-locked LFO while MIDI clock is ticking: ask the engine
// to hold its output until the next whole beat instead of starting mid-beat.
// With no clock ticking (or in free-run mode) the LFO starts at once as before.
function lfoShouldStartOnBeat(cfg) {
  return Boolean(cfg.useMidiClock) && Number.isFinite(midiClockHz) && midiClockPresent;
}

function toggleLfoEnabled(index) {
  const cfg = lfoConfigs[index];
  cfg.enabled = !cfg.enabled;
  const startOnBeat = cfg.enabled && lfoShouldStartOnBeat(cfg);
  if (startOnBeat) lfoBeatStartPending.add(index); else lfoBeatStartPending.delete(index);
  refreshLfoStrip(index);
  updateLfoHint();
  sendLfo(index, startOnBeat);
  drawLfoScope();
}

// The engine releases a waiting LFO when its beat position crosses a whole
// beat, which is the tick the renderer counts as a multiple of 24; clear the
// armed display on that tick (and when the clock disappears).
function clearLfoBeatStartPending() {
  if (lfoBeatStartPending.size === 0) return;
  const indices = Array.from(lfoBeatStartPending);
  lfoBeatStartPending.clear();
  indices.forEach((idx) => refreshLfoStrip(idx));
}

function selectLfo(index) {
  const next = clamp(Math.round(Number(index) || 0), 0, LFO_MAX - 1);
  const prev = selectedLfoIndex;
  selectedLfoIndex = next;
  if (prev !== next) refreshLfoRow(prev);
  refreshLfoRow(next);
  refreshLfoEditor();
  refreshLfoLiveReadout(true);
  drawLfoScope();
  const row = lfoStripEls[next]?.strip;
  if (row && typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "nearest" });
  }
}

// ── editor ──────────────────────────────────────────────────────────────────

function makeLfoAccordion(key, title) {
  const section = document.createElement("section");
  section.className = "lfo-acc";
  section.dataset.acc = key;
  const head = document.createElement("button");
  head.type = "button";
  head.className = "lfo-acc-head";
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = title;
  const sum = document.createElement("span");
  sum.className = "sum";
  const chev = document.createElement("span");
  chev.className = "chev";
  chev.setAttribute("aria-hidden", "true");
  head.append(t, sum, chev);
  const body = document.createElement("div");
  body.className = "lfo-acc-body";
  section.append(head, body);
  head.addEventListener("click", () => {
    lfoAccordionOpen[key] = !lfoAccordionOpen[key];
    saveModsUiState();
    refreshLfoEditor();
  });
  return { section, head, sum, body };
}

function makeLfoSliderRow(labelText, slider) {
  const row = document.createElement("div");
  row.className = "lfo-field lfo-field-slider";
  const key = document.createElement("span");
  key.className = "k";
  key.textContent = labelText;
  const val = document.createElement("span");
  val.className = "v is-accent";
  row.append(key, slider, val);
  return { row, val };
}

function buildLfoEditor() {
  if (!lfoEditorBodyEl) return null;
  lfoEditorBodyEl.innerHTML = "";

  // SOURCE: shape, clock source, rate or ratio.
  const source = makeLfoAccordion("source", "Source");
  const seg = document.createElement("div");
  seg.className = "lfo-seg";
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", "LFO shape");
  const shapeBtns = LFO_SHAPE_SHORT.map((label, shapeIdx) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lfo-seg-btn";
    b.dataset.shape = String(shapeIdx);
    b.innerHTML = `<svg viewBox="0 0 24 14" width="26" height="15" aria-hidden="true"><polyline points="${LFO_SHAPE_GLYPHS[shapeIdx]}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg><span>${label}</span>`;
    b.setAttribute("aria-label", LFO_SHAPE_NAMES[shapeIdx]);
    seg.appendChild(b);
    return b;
  });

  const clockBtn = document.createElement("button");
  clockBtn.type = "button";
  clockBtn.className = "lfo-clock-toggle";
  const clockDot = document.createElement("span");
  clockDot.className = "lfo-clock-dot";
  const clockText = document.createElement("span");
  clockText.className = "lfo-clock-text";
  clockBtn.append(clockDot, clockText);

  const rateEl = document.createElement("input");
  rateEl.type = "range";
  rateEl.className = "lfo-range";
  rateEl.min = "0";
  rateEl.max = "1";
  rateEl.step = "0.001";
  rateEl.setAttribute("aria-label", "Rate");
  const rateRow = makeLfoSliderRow("Rate", rateEl);

  const ratioEl = document.createElement("input");
  ratioEl.type = "range";
  ratioEl.className = "lfo-range lfo-clock-ratio-range";
  ratioEl.min = "0";
  ratioEl.max = String(LFO_CLOCK_RATIO_OPTIONS.length - 1);
  ratioEl.step = "1";
  ratioEl.setAttribute("aria-label", "Clock ratio");
  const ratioRow = makeLfoSliderRow("Ratio", ratioEl);

  source.body.append(seg, clockBtn, rateRow.row, ratioRow.row);

  // DESTINATION: target, depth.
  const dest = makeLfoAccordion("destination", "Destination");
  const targetRow = document.createElement("div");
  targetRow.className = "lfo-field lfo-field-select";
  const targetKey = document.createElement("span");
  targetKey.className = "k";
  targetKey.textContent = "Target";
  const targetSel = document.createElement("select");
  targetSel.className = "lfo-target-sel";
  targetSel.setAttribute("aria-label", "Target parameter");
  LFO_TARGETS.forEach((t) => {
    const option = document.createElement("option");
    option.value = t.name;
    option.textContent = t.label;
    targetSel.appendChild(option);
  });
  targetRow.append(targetKey, targetSel);

  const depthEl = document.createElement("input");
  depthEl.type = "range";
  depthEl.className = "lfo-range";
  depthEl.dataset.bipolar = "1";
  depthEl.min = "-1";
  depthEl.max = "1";
  depthEl.step = "0.01";
  depthEl.setAttribute("aria-label", "Depth");
  const depthRow = makeLfoSliderRow("Depth", depthEl);
  const depthNote = document.createElement("div");
  depthNote.className = "lfo-field-note";

  dest.body.append(targetRow, depthRow.row, depthNote);
  lfoEditorBodyEl.append(source.section, dest.section);

  const editor = {
    source, dest, shapeBtns, clockBtn, clockText,
    rateEl, rateVal: rateRow.val, rateRow: rateRow.row,
    ratioEl, ratioVal: ratioRow.val, ratioRow: ratioRow.row,
    targetSel, depthEl, depthVal: depthRow.val, depthNote
  };

  const commit = () => {
    const i = selectedLfoIndex;
    const c = lfoConfigs[i];
    c.target = LFO_TARGET_BY_NAME.has(targetSel.value) ? targetSel.value : "none";
    c.clockRatio = lfoClockRatioFromIndex(ratioEl.value);
    const clockRate = midiClockRateHz();
    if (c.useMidiClock) {
      if (clockRate !== null) c.rate = clamp(clockRate * c.clockRatio, LFO_RATE_MIN, LFO_RATE_MAX);
    } else {
      c.rate = lfoSliderPosToRate(rateEl.value);
    }
    c.depth = clamp(Number(depthEl.value) || 0, -1, 1) * lfoCapFor(c.target);
    refreshLfoStrip(i);
    updateLfoHint();
    sendLfo(i);
  };

  shapeBtns.forEach((b) => b.addEventListener("click", () => {
    lfoConfigs[selectedLfoIndex].shape = clamp(parseInt(b.dataset.shape, 10) || 0, 0, 6);
    commit();
  }));
  clockBtn.addEventListener("click", () => {
    lfoConfigs[selectedLfoIndex].useMidiClock = !lfoConfigs[selectedLfoIndex].useMidiClock;
    commit();
  });
  targetSel.addEventListener("change", commit);
  rateEl.addEventListener("input", commit);
  ratioEl.addEventListener("input", commit);
  depthEl.addEventListener("input", commit);

  return editor;
}

function refreshLfoEditor() {
  const e = lfoEditor;
  if (!e) return;
  const i = selectedLfoIndex;
  const c = lfoConfigs[i];
  const hasTempo = Number.isFinite(midiClockHz);
  const ratio = lfoClockRatioValue(c);
  const displayedRate = (c.useMidiClock && hasTempo)
    ? clamp(midiClockHz * ratio, LFO_RATE_MIN, LFO_RATE_MAX)
    : c.rate;

  if (lfoEditTitleEl) lfoEditTitleEl.textContent = `LFO ${lfoNumberText(i)}`;
  if (lfoEditSubEl) {
    lfoEditSubEl.textContent = c.target === "none"
      ? "unassigned"
      : `${lfoTargetLabel(c)} · ${lfoRateText(c)}`;
  }
  if (lfoEditRunEl) {
    const armed = c.enabled && lfoBeatStartPending.has(i);
    lfoEditRunEl.textContent = c.enabled ? (armed ? "On next beat" : "Running") : "Off";
    lfoEditRunEl.classList.toggle("on", c.enabled);
    lfoEditRunEl.classList.toggle("armed", armed);
    lfoEditRunEl.setAttribute("aria-pressed", String(c.enabled));
  }

  // Accordion open state + summaries (so a collapsed section still reads).
  e.source.section.classList.toggle("closed", !lfoAccordionOpen.source);
  e.source.head.setAttribute("aria-expanded", String(Boolean(lfoAccordionOpen.source)));
  e.dest.section.classList.toggle("closed", !lfoAccordionOpen.destination);
  e.dest.head.setAttribute("aria-expanded", String(Boolean(lfoAccordionOpen.destination)));
  e.source.sum.textContent = lfoRowSummary(c);
  e.dest.sum.textContent = c.target === "none"
    ? "no target"
    : `${lfoTargetLabel(c)} · ${Math.round(lfoDepthFractionSigned(c) * 100)}%`;

  e.shapeBtns.forEach((b, idx) => {
    b.classList.toggle("on", idx === c.shape);
    b.setAttribute("aria-pressed", String(idx === c.shape));
  });

  e.clockBtn.classList.toggle("on", Boolean(c.useMidiClock));
  e.clockBtn.setAttribute("aria-pressed", String(Boolean(c.useMidiClock)));
  const tempo = midiClockTempoText();
  if (c.useMidiClock) {
    e.clockText.textContent = tempo
      ? `MIDI clock · ${tempo}${midiClockPresent ? "" : " (stopped)"} · ${displayedRate.toFixed(2)} Hz`
      : "MIDI clock · waiting for tempo";
  } else {
    e.clockText.textContent = tempo ? `Free rate · clock ${tempo} available` : "Free rate";
  }

  // One rate control at a time: the free rate slider or the clock ratio.
  e.rateRow.hidden = Boolean(c.useMidiClock);
  e.ratioRow.hidden = !c.useMidiClock;
  e.rateEl.value = String(lfoRateToSliderPos(displayedRate));
  e.rateVal.textContent = `${displayedRate.toFixed(2)} Hz`;
  refreshSliderFill(e.rateEl, LFO_PRIMARY_ACCENT);
  e.ratioEl.value = String(lfoClockRatioIndexFromValue(ratio));
  // Short value only: the resulting Hz lives in the clock button text. The
  // value column is 96 px and the Pi substitutes a wide font for the condensed
  // one, so anything longer overflowed the pane and flickered its scrollbars.
  e.ratioVal.textContent = lfoClockRatioLabel(ratio);
  refreshSliderFill(e.ratioEl, LFO_PRIMARY_ACCENT);

  e.targetSel.value = c.target;
  const depthFrac = lfoDepthFractionSigned(c);
  e.depthEl.value = String(depthFrac);
  e.depthEl.disabled = c.target === "none";
  e.depthEl.classList.toggle("is-locked", c.target === "none");
  e.depthVal.textContent = `${depthFrac >= 0 ? "+" : ""}${Math.round(depthFrac * 100)}%`;
  refreshSliderFill(e.depthEl, LFO_PRIMARY_ACCENT);
  const cap = lfoCapFor(c.target);
  e.depthNote.textContent = c.target === "none"
    ? "Pick a target to set a depth."
    : `±100% = ±${formatParamDelta(c.target, cap)} ${lfoTargetLabel(c)}; negative depth inverts the shape.`;
}

// Historical name: controls are config-driven now, so this is a refresh.
function syncLfoStripFromConfig(index) {
  refreshLfoStrip(index);
}

function lfoActiveCount() {
  let n = 0;
  for (let i = 0; i < LFO_MAX; i += 1) if (lfoConfigs[i].enabled) n += 1;
  return n;
}

function updateLfoHint() {
  const active = lfoActiveCount();
  if (lfoActiveCountEl) lfoActiveCountEl.textContent = String(active);
  if (lfoCountHintEl) {
    const tempo = midiClockTempoText();
    const tempoText = tempo
      ? `MIDI ${tempo}${midiClockPresent ? "" : " (stopped)"}`
      : "no MIDI clock";
    lfoCountHintEl.textContent = `${active} running · ${tempoText}`;
  }
}

function redrawAllLfoViews() {
  for (let i = 0; i < LFO_MAX; i += 1) refreshLfoRow(i);
  updateLfoHint();
  refreshLfoEditor();
  refreshLfoLiveReadout(true);
  drawLfoScope();
}

// ── live readout + scope (engine telemetry) ─────────────────────────────────

function refreshLfoLiveReadout(force = false, nowMs = performance.now()) {
  if (!lfoLiveLineEl) return;
  if (!force && (nowMs - modScopeLiveLastAtMs) < MOD_SCOPE_LIVE_MIN_INTERVAL_MS) return;
  modScopeLiveLastAtMs = nowMs;
  const i = selectedLfoIndex;
  const c = lfoConfigs[i];
  const stale = (nowMs - modScopeLastAtMs) > MOD_SCOPE_STALE_MS;
  if (c.target === "none") {
    lfoLiveLineEl.textContent = `LFO ${lfoNumberText(i)} · no target`;
    applyCenteredMeterFill(lfoLiveFillEl, 0);
    return;
  }
  if (stale) {
    lfoLiveLineEl.textContent = `${lfoTargetLabel(c)} · engine idle`;
    applyCenteredMeterFill(lfoLiveFillEl, 0);
    return;
  }
  const busIdx = MOD_BUS_INDEX.get(c.target);
  const base = currentParamValue(c.target, 0);
  const total = busIdx === undefined ? 0 : modBusLive[busIdx];
  const own = lfoLiveContribution(i);
  const live = clampToParamMeta(c.target, base + total);
  const sign = (v) => (v >= 0 ? "+" : "");
  lfoLiveLineEl.textContent =
    `${lfoTargetLabel(c)} ${formatParamValue(c.target, base)} → ${formatParamValue(c.target, live)}`
    + ` · LFO ${lfoNumberText(i)} ${sign(own)}${formatParamDelta(c.target, own)}`
    + ` · Σ ${sign(total)}${formatParamDelta(c.target, total)}`;
  const cap = lfoCapFor(c.target);
  applyCenteredMeterFill(lfoLiveFillEl, cap > 0 ? total / cap : 0);
}

function setLfoScopeVisible(visible) {
  lfoScopeVisible = Boolean(visible);
  if (lfoScopeBoxEl) lfoScopeBoxEl.hidden = !lfoScopeVisible;
  if (lfoScopeToggleEl) lfoScopeToggleEl.setAttribute("aria-pressed", String(lfoScopeVisible));
  saveModsUiState();
  waveformLayoutDirty = true;
  refreshModScopeStreaming();
  drawLfoScope();
}

// Ask the engine for the monitor stream only while this screen can show it.
// 30 Hz with the scope up, 10 Hz for the row meters alone, off otherwise.
function refreshModScopeStreaming() {
  const visible = document.visibilityState !== "hidden" && document.hasFocus();
  const enabled = visible && isModulationScreenActive();
  const rate = lfoScopeVisible ? MOD_SCOPE_RATE_SCOPE_HZ : MOD_SCOPE_RATE_ROWS_HZ;
  if (modScopeStreamEnabled === enabled && modScopeStreamRateHz === rate) return;
  modScopeStreamEnabled = enabled;
  modScopeStreamRateHz = rate;
  if (!window.spaluterApi?.setModScope) return;
  window.spaluterApi.setModScope(enabled, rate).catch(() => {
    appendLog("[SCOPE] Failed to update LFO monitor streaming state.");
  });
}

function handleModScopeFrame(values) {
  if (!Array.isArray(values) || values.length < MOD_SCOPE_LFO_COUNT) return;
  const nowMs = performance.now();
  for (let i = 0; i < MOD_SCOPE_LFO_COUNT; i += 1) {
    const v = Number(values[i]);
    lfoLiveOut[i] = Number.isFinite(v) ? v : 0;
    modScopeHist[i][modScopeHead] = lfoLiveOut[i];
  }
  for (let k = 0; k < MOD_SCOPE_MOD_COUNT; k += 1) {
    const v = Number(values[MOD_SCOPE_LFO_COUNT + k]);
    modBusLive[k] = Number.isFinite(v) ? v : 0;
  }
  const beat = Number(values[MOD_SCOPE_LFO_COUNT + MOD_SCOPE_MOD_COUNT]);
  modScopeHistBeat[modScopeHead] = Number.isFinite(beat) ? beat : 0;
  modScopeHistT[modScopeHead] = nowMs;
  modScopeHead = (modScopeHead + 1) % MOD_SCOPE_HISTORY;
  if (modScopeCount < MOD_SCOPE_HISTORY) modScopeCount += 1;
  modScopeLastAtMs = nowMs;

  if (!isModulationScreenActive()) return;
  if ((nowMs - modScopeRowsLastAtMs) >= MOD_SCOPE_ROWS_MIN_INTERVAL_MS) {
    modScopeRowsLastAtMs = nowMs;
    for (let i = 0; i < LFO_MAX; i += 1) refreshLfoRowMeter(i);
  }
  refreshLfoLiveReadout(false, nowMs);
  drawLfoScope(nowMs);
}

function drawLfoScope(nowMs = performance.now()) {
  const canvas = lfoScopeCanvasEl;
  if (!canvas || !lfoScopeVisible || !isModulationScreenActive()) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const m = getCanvasMetrics(canvas);
  const { dpr, drawWidth, drawHeight, leftPad, rightPad } = m;
  if (canvas.width !== drawWidth || canvas.height !== drawHeight) {
    canvas.width = drawWidth;
    canvas.height = drawHeight;
  }
  const topPad = 8 * dpr;
  const bottomPad = drawHeight - (8 * dpr);
  const usableWidth = Math.max(1, rightPad - leftPad);
  const half = Math.max(1, (bottomPad - topPad) / 2);
  const centerY = topPad + half;
  const windowMs = MOD_SCOPE_WINDOW_SEC * 1000;
  const xAt = (t) => leftPad + ((1 - ((nowMs - t) / windowMs)) * usableWidth);
  const yAt = (v) => centerY - (clamp(v, -1, 1) * half);

  ctx.clearRect(0, 0, drawWidth, drawHeight);
  // Grid: centre, ±1 and one-second ticks.
  ctx.lineWidth = Math.max(1, dpr);
  ctx.strokeStyle = "rgba(233,227,214,0.10)";
  ctx.beginPath();
  ctx.moveTo(0, yAt(1)); ctx.lineTo(drawWidth, yAt(1));
  ctx.moveTo(0, yAt(-1)); ctx.lineTo(drawWidth, yAt(-1));
  for (let s = 1; s < MOD_SCOPE_WINDOW_SEC; s += 1) {
    const x = leftPad + ((s / MOD_SCOPE_WINDOW_SEC) * usableWidth);
    ctx.moveTo(x, topPad); ctx.lineTo(x, bottomPad);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(233,227,214,0.22)";
  ctx.beginPath();
  ctx.moveTo(0, centerY); ctx.lineTo(drawWidth, centerY);
  ctx.stroke();

  const count = modScopeCount;
  const start = (modScopeHead - count + MOD_SCOPE_HISTORY) % MOD_SCOPE_HISTORY;
  const slot = (k) => (start + k) % MOD_SCOPE_HISTORY;

  // Beat grid from the engine's beat position (only while clock is present).
  if (midiClockPresent && count > 1) {
    ctx.beginPath();
    let barPath = null;
    for (let k = 1; k < count; k += 1) {
      const a = slot(k - 1);
      const b = slot(k);
      const t = modScopeHistT[b];
      if (nowMs - t > windowMs) continue;
      const beatA = Math.floor(modScopeHistBeat[a]);
      const beatB = Math.floor(modScopeHistBeat[b]);
      if (beatB === beatA) continue;
      const x = xAt(t);
      if (beatB % 4 === 0) {
        barPath = barPath || new Path2D();
        barPath.moveTo(x, topPad); barPath.lineTo(x, bottomPad);
      } else {
        ctx.moveTo(x, topPad); ctx.lineTo(x, bottomPad);
      }
    }
    ctx.strokeStyle = "rgba(207,230,255,0.16)";
    ctx.stroke();
    if (barPath) {
      ctx.strokeStyle = "rgba(207,230,255,0.42)";
      ctx.stroke(barPath);
    }
  }

  const stale = (nowMs - modScopeLastAtMs) > MOD_SCOPE_STALE_MS;
  const sel = selectedLfoIndex;
  const traceOrder = [];
  for (let i = 0; i < LFO_MAX; i += 1) if (i !== sel && lfoIsActive(lfoConfigs[i])) traceOrder.push(i);
  if (lfoIsActive(lfoConfigs[sel])) traceOrder.push(sel);

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = `${Math.round(9 * dpr)}px ${getComputedStyle(document.body).getPropertyValue("--mono") || "monospace"}`;
  ctx.textBaseline = "middle";
  if (!stale) {
    traceOrder.forEach((i) => {
      const isSel = i === sel;
      const depthFrac = lfoDepthFractionSigned(lfoConfigs[i]);
      const hist = modScopeHist[i];
      ctx.strokeStyle = isSel ? LFO_PRIMARY_ACCENT : "rgba(207,230,255,0.38)";
      ctx.lineWidth = Math.max(1, dpr * (isSel ? 2 : 1.2));
      ctx.shadowBlur = isSel ? dpr * 5 : 0;
      ctx.shadowColor = isSel ? LFO_PRIMARY_ACCENT : "transparent";
      ctx.beginPath();
      let pen = false;
      let prevT = 0;
      let lastX = null;
      let lastY = null;
      for (let k = 0; k < count; k += 1) {
        const s = slot(k);
        const t = modScopeHistT[s];
        if (nowMs - t > windowMs) continue;
        const x = xAt(t);
        const y = yAt(hist[s] * depthFrac);
        if (!pen || (t - prevT) > MOD_SCOPE_GAP_MS) {
          ctx.moveTo(x, y);
          pen = true;
        } else {
          ctx.lineTo(x, y);
        }
        prevT = t;
        lastX = x;
        lastY = y;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (lastX !== null) {
        ctx.fillStyle = isSel ? LFO_PRIMARY_ACCENT : "rgba(207,230,255,0.6)";
        ctx.textAlign = "right";
        ctx.fillText(lfoNumberText(i), Math.min(lastX, rightPad) - (3 * dpr), clamp(lastY, topPad + (5 * dpr), bottomPad - (5 * dpr)));
      }
    });
  }

  if (lfoScopeLegendEl) {
    const c = lfoConfigs[sel];
    lfoScopeLegendEl.textContent = lfoIsActive(c)
      ? `LFO ${lfoNumberText(sel)} · ${lfoTargetLabel(c)} · ${lfoRowSummary(c)}`
      : `LFO ${lfoNumberText(sel)} · ${c.enabled ? (c.target === "none" ? "no target" : "depth 0") : "off"}`;
  }
  if (lfoScopeMetaEl) {
    lfoScopeMetaEl.textContent = stale
      ? "engine idle"
      : `${MOD_SCOPE_WINDOW_SEC} s · ±depth · ${traceOrder.length} live`;
  }
}

function isModulationScreenActive() {
  return currentMainScreen === "mods";
}

function initModulationUi() {
  buildLfoStrips();
  lfoEditor = buildLfoEditor();
  if (lfoScopeToggleEl) {
    lfoScopeToggleEl.addEventListener("click", () => setLfoScopeVisible(!lfoScopeVisible));
  }
  if (lfoEditRunEl) {
    lfoEditRunEl.addEventListener("click", () => toggleLfoEnabled(selectedLfoIndex));
  }
  if (lfoPrevEl) lfoPrevEl.addEventListener("click", () => selectLfo((selectedLfoIndex + LFO_MAX - 1) % LFO_MAX));
  if (lfoNextEl) lfoNextEl.addEventListener("click", () => selectLfo((selectedLfoIndex + 1) % LFO_MAX));
  if (lfoScopeBoxEl) lfoScopeBoxEl.hidden = !lfoScopeVisible;
  if (lfoScopeToggleEl) lfoScopeToggleEl.setAttribute("aria-pressed", String(lfoScopeVisible));
  if (window.spaluterApi?.onModScope) window.spaluterApi.onModScope(handleModScopeFrame);
  redrawAllLfoViews();
  updateLfoHint();
}

function lfoToIpc(index, startOnBeat = false) {
  const c = lfoConfigs[index];
  return {
    idx: index,
    target: c.target,
    rate: c.rate,
    depth: c.depth,
    shape: c.shape,
    enabled: c.enabled,
    phase: c.phase,
    // Phase lock only once a tempo exists; until then the LFO free-runs at rate.
    useClock: Boolean(c.useMidiClock) && Number.isFinite(midiClockHz),
    clockRatio: lfoClockRatioValue(c),
    // Hold the output until the next whole beat; the runtime only honours it
    // on the message that turns the LFO on (Run button, clock mode, clock present).
    startOnBeat: Boolean(startOnBeat)
  };
}

function sendLfo(index, startOnBeat = false) {
  window.spaluterApi.setLfo(index, lfoToIpc(index, startOnBeat));
  updateLfoHint();
  updateEditLfoMarkers();
  refreshSynthLfoBadges();
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
  updateEditLfoMarkers();
  refreshSynthLfoBadges();
  syncLfosToEngine();
  scheduleParamModAnim();
  if (currentMainScreen === "edit") scheduleWaveformViewsRedraw();
}

function handleMainScreenEntered(targetScreen) {
  if (targetScreen === "edit") {
    scheduleWaveformResizeRefresh();
    refreshSynthScreen();
    updateEditLfoMarkers();
    scheduleParamModAnim();
  } else if (targetScreen === "mods") {
    waveformLayoutDirty = true;
    redrawAllLfoViews();
  } else if (targetScreen === "presets") {
    waveformLayoutDirty = true;
    renderPresetBank();
    renderPresetDetail();
  }
  refreshScopeStreamingState();
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
  const target = MAIN_SCREENS.includes(name) ? name : "edit";
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

// Engine telemetry streams follow screen/window visibility. The audio output
// scope stream (/spaluter/scope) is no longer requested: the Perform screen
// that drew it was removed, and main.js starts sclang with it disabled.
function refreshScopeStreamingState() {
  refreshModScopeStreaming();
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

window.spaluterApi.onDspCpu((info) => {
  setDspCpu(info);
});

window.spaluterApi.onLog((text) => {
  appendLog(text);
  if (/^\[ERR\]|ERROR:|FAILURE IN SERVER/i.test(String(text || ""))) {
    setStatusState("error");
  }
});

renderSynthToggle();
setCpuUsage(0);
setDspCpu(null);
initModulationUi();
initScreenNav();
setScreen("edit", { force: true });
updateWaveformViews();
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
  if (dspCpuStaleTimer) {
    clearTimeout(dspCpuStaleTimer);
    dspCpuStaleTimer = null;
  }
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
initSynthUi();

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

// ─────────────────────────── Edit screen cards ─────────────────────────────
// The Edit screen is built from static grouped cards in index.html holding the
// real [data-param] controls (already wired for OSC by the global range/select
// listeners). Here we register each card's value readout + slider so external
// value changes (presets, MIDI) stay reflected, and paint the slider
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
  const trackHeight = (slider.classList.contains("lfo-range") || slider.closest(".synth-section")) ? "14px" : "10px";
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
  // setParamValue (CC, presets, MIDI learn, quantize snap) sets the select
  // directly and fires this instead of "change", so the chips must follow it too.
  select.addEventListener("spaluter:param-sync", sync);
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
      ctl.querySelectorAll("select.edit-select[data-param]").forEach((select) => {
        select.dataset.accent = accent;
        if (select.dataset.seg === "1") buildSegmentedSelect(select, accent);
      });
    });
  });
  updateEditLfoMarkers();
}

// Header status chips.
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
}

refreshStatusChips();
window.setInterval(refreshStatusChips, 750);
