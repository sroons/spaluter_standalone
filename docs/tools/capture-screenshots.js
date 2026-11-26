// Regenerates docs/img/screen-*.png from the real renderer at the Pi's
// 1024x600, with a fake engine (capture-preload.js). Makes no sound and uses
// a throwaway profile, so the app's own presets and settings are untouched.
//   npm run site:screenshots
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const outDir = path.join(__dirname, "..", "img");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "spiluter-capture-")));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page: a musical-looking patch, six LFOs, a few named presets.
const SETUP = `(async () => {
  const L = window.__capture.listeners;
  L.status && L.status("Synth started");
  lastMidiInputCount = 1;
  refreshStatusChips();
  applyPresetParams({
    formantCount: 3, amp: 0.42, drive: 1.35, pulsaret: 3.4, window: 1.6, duty: 0.38,
    formant1: 220, formant2: 330, formant3: 880, pan1: 0, pan2: 0.55, pan3: -0.55,
    maskMode: 2, burstOn: 5, burstOff: 2, ampJitter: 0.12, timingJitter: 0.05,
    gateMode: 1, voiceCount: 3, chordType: 5, basePitch: 55, attackMs: 12, releaseMs: 640,
    revWet: 0.32, revTime: 0.82, revDiff: 0.8, revDamp: 0.42, revShimmer: 0.25, revMod: 0.4,
    revLowCut: 180, dlyWet: 0.28, dlyFeedback: 0.45, dlySpread: 0.6, dlyTimeMs: 375
  });
  const lfo = (target, rate, depth, shape) => ({ target, rate, depth, shape, enabled: true, phase: 0, useMidiClock: false, clockRatio: 1 });
  const configs = [
    lfo("formant1", 0.21, 140, 0), lfo("pulsaret", 0.5, 1.2, 1), lfo("duty", 1.3, 0.18, 6),
    lfo("pan2", 0.33, 0.6, 0), lfo("formant3", 2.0, 260, 5), lfo("revWet", 0.08, 0.2, 2)
  ];
  applyLfoState({ version: 3, count: 16, configs });
  const names = ["Glass Choir", "Burst Engine", "Slow Vowels", "Tin Rain", "Sub Pulse", "Formant Bells", "Ghost Clock"];
  const state = collectLfoState();
  const slots = names.map((name, i) => ({
    name, sampleDirectory: "/spaluter/samples/", samplePath: "", lfo: i % 2 ? null : state,
    params: Object.assign(collectCurrentParams(), {
      pulsaret: (i * 1.37) % 9, window: (i * 2.1) % 8, duty: 0.15 + ((i * 0.13) % 0.8),
      formant1: 80 + i * 130, formant2: 200 + i * 210, formant3: 400 + i * 330
    })
  }));
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify({ slots }));
  // Feed the Mods monitor the same kind of frames the engine sends, in real time.
  const shapes = [
    (p) => Math.sin(2 * Math.PI * p), (p) => 1 - 4 * Math.abs(p - 0.5), null, null, null, null, null
  ];
  const t0 = performance.now();
  let held = 0, heldStep = -1, smooth = 0, smoothTo = 0, smoothStep = -1;
  window.__capture.timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const frame = new Array(37).fill(0);
    configs.forEach((c, i) => {
      const cyc = t * c.rate, p = cyc - Math.floor(cyc);
      let v;
      if (c.shape === 5) { if (Math.floor(cyc) !== heldStep) { heldStep = Math.floor(cyc); held = Math.random() * 2 - 1; } v = held; }
      else if (c.shape === 6) { if (Math.floor(cyc) !== smoothStep) { smoothStep = Math.floor(cyc); smoothTo = Math.random() * 2 - 1; } smooth += (smoothTo - smooth) * 0.12; v = smooth; }
      else if (c.shape === 2) v = 2 * p - 1;
      else v = shapes[c.shape](p);
      frame[i] = v;
    });
    L.modscope && L.modscope(frame);
    L.dsp && L.dsp({ avg: 11.8 + Math.sin(t) * 0.6, peak: 15 });
  }, 33);
})()`;

const SHOTS = [
  { file: "screen-synth-engine", js: `setScreen("edit"); setSynthSection("engine", false);` },
  { file: "screen-synth-formants", js: `setScreen("edit"); setSynthSection("formants", false);` },
  { file: "screen-synth-grain", js: `setScreen("edit"); setSynthSection("grain", false);` },
  { file: "screen-synth-voice", js: `setScreen("edit"); setSynthSection("voice", false);` },
  { file: "screen-mods", js: `setScreen("mods"); selectLfo(0);`, settle: 4600 },
  { file: "screen-effects", js: `setScreen("reverb");` },
  { file: "screen-presets", js: `setScreen("presets");` }
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 600, useContentSize: true, show: true, frame: false,
    webPreferences: {
      preload: path.join(__dirname, "capture-preload.js"),
      contextIsolation: false, backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(root, "renderer", "index.html"));
  await wait(600);
  await win.webContents.executeJavaScript(SETUP);
  // Presets are read from storage at load: reload so the bank shows them.
  await win.loadFile(path.join(root, "renderer", "index.html"));
  await wait(600);
  await win.webContents.executeJavaScript(SETUP);
  await wait(400);
  fs.mkdirSync(outDir, { recursive: true });
  for (const shot of SHOTS) {
    await win.webContents.executeJavaScript(`${shot.js}; void 0;`);
    await wait(shot.settle || 700);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${shot.file}.png`), image.toPNG());
    console.log(`wrote docs/img/${shot.file}.png`, image.getSize());
  }
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });
