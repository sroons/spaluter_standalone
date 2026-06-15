const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const osc = require("osc");

// On the Pi's Xorg kiosk (openbox, no compositor) Chromium's native-window
// occlusion detection frequently mis-flags the fullscreen window as occluded and
// stops presenting frames, throttling ALL rendering (rAF, timers, and even
// IPC-driven repaints) to ~1 fps. backgroundThrottling:false does not cover
// occlusion, so disable the occlusion/backgrounding features at the app level and
// lift the frame-rate cap so animations present at the display rate.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-gpu-vsync");
app.commandLine.appendSwitch("disable-frame-rate-limit");

const SC_OSC_PORT = 57130;
const APP_OSC_RECV_PORT_CANDIDATES = [57131, 57132, 57133, 57134];
const LOG_BUFFER_LIMIT = 400;
const LOG_BUFFER_CHARS_LIMIT = 8192;
const DEFAULT_SCOPE_RATE_HZ = 20;
const MIN_SCOPE_RATE_HZ = 1;
const MAX_SCOPE_RATE_HZ = 60;
const COMMAND_TIMEOUT_MS = 20_000;
const INSTALL_COMMAND_TIMEOUT_MS = 30 * 60_000;
const STARTUP_WAIT_TIMEOUT_MS = 90_000;
const UNRESPONSIVE_RESTART_DELAY_MS = 1500;
const RENDERER_HEARTBEAT_TIMEOUT_MS = 8000;
const RENDERER_HEARTBEAT_CHECK_MS = 2000;
const APP_CPU_SAMPLE_INTERVAL_MS = 1000;

let mainWindow = null;
let mainWindowReady = false;
let sclangProc = null;
let oscPort = null;
let appOscRecvPort = APP_OSC_RECV_PORT_CANDIDATES[0];
let lastStatus = "Starting...";
const logBuffer = new Array(LOG_BUFFER_LIMIT);
let logWriteIndex = 0;
let logCount = 0;
let runtimeInjected = false;
let quittingApp = false;
let restartingApp = false;
let sclangStartupBuffer = "";
let shutdownPromise = null;
let scopeStreamEnabled = true;
let scopeRateHz = DEFAULT_SCOPE_RATE_HZ;
let rendererUnresponsiveTimer = null;
let rendererHeartbeatInterval = null;
let lastRendererHeartbeatAt = 0;
let appCpuUsageInterval = null;
let scopeRecvWindow = 0;
let lastRendererFps = 0;
let paramAnimActive = false;
let paramAnimInterval = null;
let paramAnimTickMs = 33;
const statusSubscribers = new Set();

function defaultSampleDir() {
  if (process.platform === "win32") {
    return path.join(app.getPath("home"), "Music");
  }
  return "/spaluter/samples/";
}

const DEFAULT_SAMPLE_DIR = defaultSampleDir();

function pushLog(text) {
  const line = String(text ?? "");
  logBuffer[logWriteIndex] = line;
  logWriteIndex = (logWriteIndex + 1) % LOG_BUFFER_LIMIT;
  if (logCount < LOG_BUFFER_LIMIT) logCount += 1;
}

function snapshotLogs() {
  if (logCount === 0) return [];
  const start = logCount === LOG_BUFFER_LIMIT ? logWriteIndex : 0;
  const result = new Array(logCount);
  for (let i = 0; i < logCount; i += 1) {
    result[i] = logBuffer[(start + i) % LOG_BUFFER_LIMIT];
  }
  return result;
}

function runCommand(command, args = [], options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : COMMAND_TIMEOUT_MS;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: [options.stdinMode || "ignore", "pipe", "pipe"]
      });
    } catch (err) {
      resolve({ ok: false, code: null, stdout, stderr, timedOut, error: err });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore kill errors
      }
    }, timeoutMs);

    const appendChunk = (target, chunk) => {
      const next = target + String(chunk || "");
      if (next.length <= LOG_BUFFER_CHARS_LIMIT) return next;
      return next.slice(next.length - LOG_BUFFER_CHARS_LIMIT);
    };

    if (child.stdout) {
      child.stdout.on("data", (buf) => {
        stdout = appendChunk(stdout, buf.toString());
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (buf) => {
        stderr = appendChunk(stderr, buf.toString());
      });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, timedOut, error: err });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut, error: null });
    });
  });
}

async function commandExists(command) {
  const probe = process.platform === "win32"
    ? await runCommand("where", [command], { timeoutMs: COMMAND_TIMEOUT_MS })
    : await runCommand("sh", ["-lc", `command -v ${command} >/dev/null 2>&1`], { timeoutMs: COMMAND_TIMEOUT_MS });
  return probe.ok;
}

function normalizeOutput(text) {
  return String(text || "").trim();
}

async function isSuperColliderAvailable() {
  if (process.env.SCLANG_PATH) {
    try {
      return fsSync.existsSync(process.env.SCLANG_PATH);
    } catch {
      return false;
    }
  }
  return commandExists(process.platform === "win32" ? "sclang.exe" : "sclang");
}

async function runInstallStep(label, command, args, timeoutMs = INSTALL_COMMAND_TIMEOUT_MS) {
  sendLog(`[BOOT] ${label}: ${command} ${args.join(" ")}`);
  const result = await runCommand(command, args, { timeoutMs, stdinMode: "inherit" });
  if (normalizeOutput(result.stdout)) {
    sendLog(`[BOOT] ${label} output: ${normalizeOutput(result.stdout)}`);
  }
  if (normalizeOutput(result.stderr)) {
    sendLog(`[BOOT] ${label} stderr: ${normalizeOutput(result.stderr)}`);
  }
  if (!result.ok) {
    if (result.timedOut) {
      sendLog(`[BOOT] ${label} timed out.`);
    } else if (result.error) {
      sendLog(`[BOOT] ${label} failed: ${result.error.message}`);
    } else {
      sendLog(`[BOOT] ${label} failed with exit code ${result.code}.`);
    }
  }
  return result.ok;
}

async function runPrivilegedInstall(command, args, label, timeoutMs = INSTALL_COMMAND_TIMEOUT_MS) {
  if (process.platform === "win32") {
    return runInstallStep(label, command, args, timeoutMs);
  }

  if (typeof process.getuid === "function" && process.getuid() === 0) {
    return runInstallStep(label, command, args, timeoutMs);
  }

  if (await commandExists("pkexec")) {
    const ok = await runInstallStep(label, "pkexec", [command, ...args], timeoutMs);
    if (ok) return true;
  }

  if (await commandExists("sudo")) {
    return runInstallStep(label, "sudo", [command, ...args], timeoutMs);
  }

  sendLog(`[BOOT] ${label} skipped: requires root privileges but sudo is unavailable.`);
  return false;
}

async function installSuperCollider() {
  if (process.platform === "darwin") {
    if (!await commandExists("brew")) {
      sendLog("[BOOT] Homebrew is not available. Install Homebrew to enable auto-install.");
      return false;
    }
    const ok = await runInstallStep("Installing SuperCollider via Homebrew", "brew", ["install", "supercollider"]);
    return ok && await isSuperColliderAvailable();
  }

  if (process.platform === "win32") {
    if (await commandExists("winget")) {
      const wingetIds = ["SuperCollider.SuperCollider", "supercollider.supercollider"];
      for (const packageId of wingetIds) {
        const ok = await runInstallStep(
          `Installing SuperCollider via winget (${packageId})`,
          "winget",
          ["install", "--id", packageId, "-e", "--accept-source-agreements", "--accept-package-agreements"]
        );
        if (ok && await isSuperColliderAvailable()) return true;
      }
    }
    if (await commandExists("choco")) {
      const ok = await runInstallStep("Installing SuperCollider via Chocolatey", "choco", ["install", "supercollider", "-y"]);
      if (ok && await isSuperColliderAvailable()) return true;
    }
    sendLog("[BOOT] Automatic install failed on Windows. Install SuperCollider manually or set SCLANG_PATH.");
    return false;
  }

  if (await commandExists("apt-get")) {
    const updateOk = await runPrivilegedInstall("apt-get", ["update"], "Refreshing apt package metadata");
    const installOk = await runPrivilegedInstall(
      "apt-get",
      ["install", "-y", "supercollider", "supercollider-language", "supercollider-server"],
      "Installing SuperCollider via apt"
    );
    if (updateOk && installOk && await isSuperColliderAvailable()) return true;
  }

  if (await commandExists("dnf")) {
    const installOk = await runPrivilegedInstall("dnf", ["install", "-y", "supercollider"], "Installing SuperCollider via dnf");
    if (installOk && await isSuperColliderAvailable()) return true;
  }

  if (await commandExists("pacman")) {
    const installOk = await runPrivilegedInstall("pacman", ["-Sy", "--noconfirm", "supercollider"], "Installing SuperCollider via pacman");
    if (installOk && await isSuperColliderAvailable()) return true;
  }

  if (await commandExists("zypper")) {
    const installOk = await runPrivilegedInstall("zypper", ["--non-interactive", "install", "supercollider"], "Installing SuperCollider via zypper");
    if (installOk && await isSuperColliderAvailable()) return true;
  }

  sendLog("[BOOT] Automatic install failed on Linux. Install SuperCollider manually or set SCLANG_PATH.");
  return false;
}

function detectSclangCommand() {
  if (process.env.SCLANG_PATH) return process.env.SCLANG_PATH;
  if (process.platform === "win32") return "sclang.exe";
  return "sclang";
}

function createOscClient() {
  return new Promise((resolve) => {
    const tryOpenPort = (candidateIndex) => {
      if (candidateIndex >= APP_OSC_RECV_PORT_CANDIDATES.length) {
        sendStatus("OSC error: no available local receive port");
        resolve(false);
        return;
      }

      const candidatePort = APP_OSC_RECV_PORT_CANDIDATES[candidateIndex];
      const candidateOscPort = new osc.UDPPort({
        localAddress: "127.0.0.1",
        localPort: candidatePort,
        remoteAddress: "127.0.0.1",
        remotePort: SC_OSC_PORT
      });

      let settled = false;
      candidateOscPort.on("ready", () => {
        if (settled) return;
        settled = true;
        appOscRecvPort = candidatePort;
        oscPort = candidateOscPort;
        sendStatus("OSC ready");
        if (candidatePort !== APP_OSC_RECV_PORT_CANDIDATES[0]) {
          sendLog(`[OSC] using fallback local port ${candidatePort}`);
        }
        resolve(true);
      });

      candidateOscPort.on("message", (msg) => {
        if (msg.address === "/spaluter/status") {
          const s = String(msg.args?.[0] ?? "");
          sendStatus(s);
          if (s === "Runtime ready") {
            sendLog("[BOOT] sending /spaluter/start");
            sendOsc("/spaluter/start", []);
          }
        } else if (msg.address === "/spaluter/scope") {
          const rawArgs = Array.isArray(msg.args) ? msg.args : [];
          const samples = [];
          for (let i = 0; i < rawArgs.length && samples.length < 512; i += 1) {
            const arg = rawArgs[i];
            const raw = (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value"))
              ? arg.value
              : arg;
            const value = Number(raw);
            if (Number.isFinite(value)) samples.push(value);
          }
          if (samples.length > 0 && mainWindow) {
            scopeRecvWindow += 1;
            mainWindow.webContents.send("sc-scope", samples);
          }
        } else {
          sendLog(`[OSC] ${msg.address} ${JSON.stringify(msg.args || [])}`);
        }
      });

      candidateOscPort.on("error", (err) => {
        if (!settled && err?.code === "EADDRINUSE") {
          settled = true;
          sendLog(`[OSC] local port ${candidatePort} busy, trying next...`);
          try {
            candidateOscPort.close();
          } catch {
            // ignore close errors while probing ports
          }
          tryOpenPort(candidateIndex + 1);
          return;
        }
        sendStatus(`OSC error: ${err.message}`);
        if (!settled) {
          settled = true;
          resolve(false);
        }
      });

      candidateOscPort.open();
    };

    tryOpenPort(0);
  });
}

function sendStatus(text) {
  lastStatus = String(text ?? "");
  pushLog(`[STATUS] ${lastStatus}`);
  statusSubscribers.forEach((listener) => {
    try {
      listener(lastStatus);
    } catch {
      // ignore listener errors
    }
  });
  sendRendererEvent("sc-status", lastStatus);
}

function sendLog(text) {
  const line = String(text ?? "");
  pushLog(line);
  sendRendererEvent("sc-log", line);
}

function sendRendererEvent(channel, payload) {
  if (!mainWindow || !mainWindowReady) return;
  if (mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send(channel, payload);
  } catch {
    // Renderer may still be tearing down during app shutdown.
  }
}

// MIDI/OSC diagnostics: counts per-second rates for /spaluter/set traffic
// so Phase 0 baseline and Phase 1+ effects can be measured. Logged once/sec.
let oscSetCountWindow = 0;
let oscSetCountTotal = 0;
let oscSetCountPeakPerSec = 0;
let setParamInFlight = 0;
let setParamInFlightPeak = 0;
// Phase 2.3 telemetry: raw incoming MIDI event count reported by renderer.
let midiRawCountWindow = 0;
let midiRawCountTotal = 0;
// Phase 2.2 telemetry: count flush batches and their sizes.
let setManyBatchesWindow = 0;
let setManyMaxBatchWindow = 0;
setInterval(() => {
  if (oscSetCountWindow > 0 || setParamInFlight > 0 || midiRawCountWindow > 0 || scopeRecvWindow > 0 || lastRendererFps > 0) {
    if (oscSetCountWindow > oscSetCountPeakPerSec) oscSetCountPeakPerSec = oscSetCountWindow;
    const compression = midiRawCountWindow > 0
      ? (1 - (oscSetCountWindow / midiRawCountWindow)) * 100
      : 0;
    const line = `[MIDI-DIAG] raw=${midiRawCountWindow}/s set=${oscSetCountWindow}/s peak=${oscSetCountPeakPerSec}/s compress=${compression.toFixed(0)}% batches=${setManyBatchesWindow}/s maxBatch=${setManyMaxBatchWindow} inflight=${setParamInFlight} inflight-peak=${setParamInFlightPeak} scope=${scopeRecvWindow}/s fps=${lastRendererFps} totals: raw=${midiRawCountTotal} set=${oscSetCountTotal}`;
    console.log(line);
    sendLog(line);
  }
  oscSetCountWindow = 0;
  midiRawCountWindow = 0;
  setManyBatchesWindow = 0;
  setManyMaxBatchWindow = 0;
  scopeRecvWindow = 0;
}, 1000);

// Synthetic scope preview animation is driven from the main process: the renderer's
// own setInterval/requestAnimationFrame are throttled to ~1 Hz on the Pi's
// occluded Xorg kiosk window, but IPC-receipt callbacks in the renderer paint at
// the full push rate (the live output scope proves this). The renderer can
// request a tick rate (default ~30 fps, responsive mode ~60 fps).
// So we push a
// tick that the renderer turns into a redraw. Only runs while the renderer asks
// for it (on the scopes page with an active synth-view LFO).
function setParamAnimTicker(active, tickMs = 33) {
  paramAnimActive = Boolean(active);
  const parsedTickMs = Number(tickMs);
  const nextTickMs = Number.isFinite(parsedTickMs) ? Math.max(8, Math.min(100, Math.round(parsedTickMs))) : 33;
  const rateChanged = nextTickMs !== paramAnimTickMs;
  paramAnimTickMs = nextTickMs;
  if (rateChanged && paramAnimInterval) {
    clearInterval(paramAnimInterval);
    paramAnimInterval = null;
  }
  if (paramAnimActive && !paramAnimInterval) {
    paramAnimInterval = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("param-anim-tick");
      }
    }, paramAnimTickMs);
  } else if (!paramAnimActive && paramAnimInterval) {
    clearInterval(paramAnimInterval);
    paramAnimInterval = null;
  }
}

function sendOsc(address, args = []) {
  if (!oscPort) return;
  if (address === "/spaluter/set") {
    oscSetCountWindow += 1;
    oscSetCountTotal += 1;
  }
  oscPort.send({ address, args });
}

// Phase 3.1 preview: a true OSC bundle helper. Currently unused (Phase 2
// emits the batch as separate /spaluter/set messages so SC's existing
// OSCdef keeps working). Phase 3 wires this in alongside a new
// /spaluter/set-many OSCdef in runtime.scd.
function sendOscBundle(packets) {
  if (!oscPort || !Array.isArray(packets) || packets.length === 0) return;
  for (let i = 0; i < packets.length; i += 1) {
    const p = packets[i];
    if (p && p.address === "/spaluter/set") {
      oscSetCountWindow += 1;
      oscSetCountTotal += 1;
    }
  }
  oscPort.send({ timeTag: osc.timeTag(0), packets });
}

function waitForSynthStartup(timeoutMs = STARTUP_WAIT_TIMEOUT_MS) {
  const successRegex = /synth started/i;
  const failureRegex = /(failed to launch sclang|sclang exited|patch did not expose|synthdef not found|server boot failed|osc error)/i;

  if (successRegex.test(lastStatus)) return Promise.resolve(lastStatus);
  if (failureRegex.test(lastStatus)) {
    return Promise.reject(new Error(`Synth startup failed: ${lastStatus}`));
  }

  return new Promise((resolve, reject) => {
    const listener = (status) => {
      if (successRegex.test(status)) {
        cleanup();
        resolve(status);
        return;
      }
      if (!failureRegex.test(status)) return;
      cleanup();
      reject(new Error(`Synth startup failed: ${status}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for synth startup."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      statusSubscribers.delete(listener);
    };

    statusSubscribers.add(listener);
  });
}

function isSupportedSampleFile(filePath) {
  return [".wav", ".aif", ".aiff", ".flac", ".ogg", ".mp3"].includes(path.extname(filePath).toLowerCase());
}

function maybeInjectRuntime(textChunk, runtimePath, patchPath) {
  if (runtimeInjected || !sclangProc) return;

  const chunk = String(textChunk ?? "");
  if (chunk.length > 0) {
    sclangStartupBuffer = `${sclangStartupBuffer}${chunk}`.slice(-LOG_BUFFER_CHARS_LIMIT);
  }

  if (!/welcome to supercollider/i.test(sclangStartupBuffer)) return;

  runtimeInjected = true;
  const escaped = runtimePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedPatch = patchPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = [
    `~spaluterPatchPath="${escapedPatch}"`,
    `~spaluterAppPort=${appOscRecvPort}`,
    `~spaluterScopeEnabled=${scopeStreamEnabled ? 1 : 0}`,
    `~spaluterScopeRate=${scopeRateHz}`,
    `this.executeFile("${escaped}")`
  ].join("; ") + ";\n";
  sendLog("[BOOT] injecting runtime.scd into sclang");
  sclangProc.stdin.write(script);
}

function resolveExternalAssetPath(...parts) {
  const packagedPath = path.join(__dirname, ...parts);
  const asarSegment = `${path.sep}app.asar${path.sep}`;

  if (!packagedPath.includes(asarSegment)) return packagedPath;

  const unpackedPath = packagedPath.replace(asarSegment, `${path.sep}app.asar.unpacked${path.sep}`);
  if (fsSync.existsSync(unpackedPath)) return unpackedPath;
  return packagedPath;
}

function startSuperCollider() {
  if (sclangProc) return;

  const cmd = detectSclangCommand();
  const runtimePath = resolveExternalAssetPath("sc", "runtime.scd");
  const patchPath = resolveExternalAssetPath("spaluter_supercollider.scd");
  const sclangCwd = path.dirname(runtimePath);

  sendStatus(`Starting sclang (${cmd})...`);
  sendLog(`[BOOT] runtime: ${runtimePath}`);
  sendLog(`[BOOT] patch:   ${patchPath}`);
  sendLog(`[BOOT] cwd:     ${sclangCwd}`);

  runtimeInjected = false;
  sclangStartupBuffer = "";
  sclangProc = spawn(cmd, [], {
    cwd: sclangCwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  sclangProc.stdout.on("data", (buf) => {
    const text = buf.toString();
    sendLog(text);
    maybeInjectRuntime(text, runtimePath, patchPath);
  });

  sclangProc.stderr.on("data", (buf) => {
    const text = buf.toString();
    sendLog(`[ERR] ${text}`);
    maybeInjectRuntime(text, runtimePath, patchPath);
  });

  sclangProc.on("error", (err) => {
    sendStatus(`Failed to launch sclang: ${err.message}`);
    sendLog("Tip: install SuperCollider and ensure sclang is in PATH, or set SCLANG_PATH env var.");
    sclangProc = null;
  });

  sclangProc.on("close", (code) => {
    sendStatus(`sclang exited (${code})`);
    sclangProc = null;
    runtimeInjected = false;
    sclangStartupBuffer = "";
  });
}

function normalizedScopeRate(rawRate) {
  const parsed = Number(rawRate);
  if (!Number.isFinite(parsed)) return scopeRateHz;
  return Math.min(MAX_SCOPE_RATE_HZ, Math.max(MIN_SCOPE_RATE_HZ, Math.round(parsed)));
}

function stopSuperCollider() {
  return new Promise((resolve) => {
    if (!sclangProc) {
      resolve();
      return;
    }

    const procRef = sclangProc;
    const onClose = () => {
      procRef.removeListener("close", onClose);
      resolve();
    };
    procRef.on("close", onClose);

    try {
      sendStatus("Stopping synth runtime...");
      sendOsc("/spaluter/quit", []);
    } catch {
      // fall through to timeout kill
    }

    setTimeout(() => {
      if (sclangProc) {
        sendLog("[BOOT] force-killing sclang after timeout");
        sclangProc.kill();
      }
      resolve();
    }, 1500);
  });
}

function closeOscPort() {
  if (!oscPort) return;
  try {
    oscPort.close();
  } catch {
    // ignore
  }
  oscPort = null;
}

function stopRuntimeAndCloseOsc() {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = stopSuperCollider()
    .finally(() => {
      closeOscPort();
    })
    .finally(() => {
      shutdownPromise = null;
    });
  return shutdownPromise;
}

function clearRendererUnresponsiveTimer() {
  if (!rendererUnresponsiveTimer) return;
  clearTimeout(rendererUnresponsiveTimer);
  rendererUnresponsiveTimer = null;
}

function clearRendererHeartbeatWatchdog() {
  if (!rendererHeartbeatInterval) return;
  clearInterval(rendererHeartbeatInterval);
  rendererHeartbeatInterval = null;
}

function markRendererHeartbeat() {
  lastRendererHeartbeatAt = Date.now();
}

function startRendererHeartbeatWatchdog() {
  clearRendererHeartbeatWatchdog();
  markRendererHeartbeat();
  rendererHeartbeatInterval = setInterval(() => {
    if (quittingApp || restartingApp) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindowReady) return;
    if ((Date.now() - lastRendererHeartbeatAt) <= RENDERER_HEARTBEAT_TIMEOUT_MS) return;
    restartApplication("Renderer heartbeat stalled");
  }, RENDERER_HEARTBEAT_CHECK_MS);
}

function clearAppCpuUsageBroadcast() {
  if (!appCpuUsageInterval) return;
  clearInterval(appCpuUsageInterval);
  appCpuUsageInterval = null;
}

function publishAppCpuUsage() {
  const usage = process.getCPUUsage();
  const percent = Number(usage?.percentCPUUsage);
  const safePercent = Number.isFinite(percent) ? Math.max(0, percent) : 0;
  sendRendererEvent("app-cpu-usage", safePercent);
}

function startAppCpuUsageBroadcast() {
  clearAppCpuUsageBroadcast();
  appCpuUsageInterval = setInterval(() => {
    if (quittingApp || restartingApp) return;
    publishAppCpuUsage();
  }, APP_CPU_SAMPLE_INTERVAL_MS);
}

function restartApplication(reason) {
  if (restartingApp) return;
  restartingApp = true;
  clearRendererUnresponsiveTimer();
  clearRendererHeartbeatWatchdog();
  clearAppCpuUsageBroadcast();
  sendLog(`[APP] ${reason}. Relaunching app process.`);
  stopRuntimeAndCloseOsc()
    .catch((err) => {
      sendLog(`[APP] Shutdown before relaunch failed: ${err.message}`);
    })
    .finally(() => {
      app.relaunch();
      app.exit(0);
    });
}

function createWindow() {
  mainWindowReady = false;
  mainWindow = new BrowserWindow({
    width: 800,
    height: 480,
    fullscreen: process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // Kiosk fullscreen under Xorg with no compositor can be treated as
      // occluded, which makes Electron throttle requestAnimationFrame and
      // timers to ~1 Hz. Disable so renderer animations run at full rate.
      backgroundThrottling: false
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindowReady = true;
    markRendererHeartbeat();
    startRendererHeartbeatWatchdog();
    publishAppCpuUsage();
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    const reason = details?.reason || "unknown";
    sendLog(`[APP] renderer process exited (${reason})`);
    if (quittingApp) return;
    restartApplication(`Renderer process exited (${reason})`);
  });
  mainWindow.on("unresponsive", () => {
    if (quittingApp) return;
    if (restartingApp) return;
    sendLog("[APP] window became unresponsive");
    if (rendererUnresponsiveTimer) return;
    rendererUnresponsiveTimer = setTimeout(() => {
      rendererUnresponsiveTimer = null;
      restartApplication("Window remained unresponsive");
    }, UNRESPONSIVE_RESTART_DELAY_MS);
  });
  mainWindow.on("responsive", () => {
    if (!rendererUnresponsiveTimer) return;
    sendLog("[APP] window responsiveness restored");
    clearRendererUnresponsiveTimer();
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    clearRendererUnresponsiveTimer();
    clearRendererHeartbeatWatchdog();
    clearAppCpuUsageBroadcast();
    mainWindowReady = false;
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.on("sc:heartbeat", () => {
    markRendererHeartbeat();
  });

  ipcMain.on("paramAnim:active", (_evt, payload) => {
    if (payload && typeof payload === "object") {
      setParamAnimTicker(payload.active, payload.tickMs);
      return;
    }
    setParamAnimTicker(payload);
  });

  ipcMain.on("diag:fps", (_evt, fps) => {
    lastRendererFps = Number(fps) || 0;
  });

  ipcMain.handle("sc:set-param", (_evt, payload) => {
    setParamInFlight += 1;
    if (setParamInFlight > setParamInFlightPeak) setParamInFlightPeak = setParamInFlight;
    try {
      const { key, value } = payload || {};
      if (typeof key !== "string") return false;
      sendOsc("/spaluter/set", [key, Number(value)]);
      return true;
    } finally {
      setParamInFlight -= 1;
    }
  });

  // Phase 2.2: fire-and-forget single param. No Promise round-trip, no
  // reply correlation. Renderer's hot path uses this (or set-many).
  ipcMain.on("sc:set-param-fast", (_evt, payload) => {
    const { key, value } = payload || {};
    if (typeof key !== "string") return;
    sendOsc("/spaluter/set", [key, Number(value)]);
  });

  // Phase 2.2: batched fire-and-forget. Phase 2 still emits each entry
  // Phase 3b: send the full batch as a single OSC bundle. Each entry is
  // still a /spaluter/set so sclang's existing OSCdef handles it without
  // change (bundled messages dispatch to their per-address responders).
  // One UDP packet replaces N: fewer syscalls in node-osc, fewer packets
  // crossing loopback, and SuperCollider applies all messages from the
  // same bundle in one language-thread pass.
  ipcMain.on("sc:set-param-many", (_evt, entries) => {
    if (!Array.isArray(entries) || entries.length === 0) return;
    setManyBatchesWindow += 1;
    if (entries.length > setManyMaxBatchWindow) setManyMaxBatchWindow = entries.length;
    const packets = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const key = entry[0];
      const value = entry[1];
      if (typeof key !== "string") continue;
      packets.push({ address: "/spaluter/set", args: [key, Number(value)] });
    }
    if (packets.length === 1) {
      // Single-entry batches are cheaper as a plain message (no bundle wrapper).
      const p = packets[0];
      sendOsc(p.address, p.args);
    } else if (packets.length > 1) {
      sendOscBundle(packets);
    }
  });

  // Phase 2.3: renderer reports raw incoming MIDI events so main can
  // compute the compression ratio (raw vs flushed).
  ipcMain.on("midi:raw-count", (_evt, count) => {
    const n = Number(count);
    if (!Number.isFinite(n) || n <= 0) return;
    midiRawCountWindow += n;
    midiRawCountTotal += n;
  });

  ipcMain.on("midi:note", (_evt, info) => {
    const line = `[MIDI-NOTE] ${String(info)}`;
    console.log(line);
    sendLog(line);
  });

  // Internal LFO modulation: fire-and-forget IPC → OSC. Config changes are
  // low-rate and human-driven, so there is no hot-path impact.
  ipcMain.on("sc:lfo-count", (_evt, n) => {
    const count = Number(n);
    if (!Number.isFinite(count)) return;
    sendOsc("/spaluter/lfo/count", [Math.max(0, Math.round(count))]);
  });

  ipcMain.on("sc:lfo-set", (_evt, cfg) => {
    if (!cfg || typeof cfg !== "object") return;
    const idx = Number(cfg.idx);
    const target = typeof cfg.target === "string" ? cfg.target : "none";
    if (!Number.isFinite(idx)) return;
    sendOsc("/spaluter/lfo/set", [
      Math.round(idx),
      target,
      Number(cfg.rate),
      Number(cfg.depth),
      Math.round(Number(cfg.shape)),
      cfg.enabled ? 1 : 0,
      Number(cfg.phase) || 0
    ]);
  });

  ipcMain.on("sc:lfo-set-many", (_evt, list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    const args = [];
    for (let i = 0; i < list.length; i += 1) {
      const cfg = list[i];
      if (!cfg || typeof cfg !== "object") continue;
      const idx = Number(cfg.idx);
      if (!Number.isFinite(idx)) continue;
      args.push(
        Math.round(idx),
        typeof cfg.target === "string" ? cfg.target : "none",
        Number(cfg.rate),
        Number(cfg.depth),
        Math.round(Number(cfg.shape)),
        cfg.enabled ? 1 : 0,
        Number(cfg.phase) || 0
      );
    }
    if (args.length > 0) sendOsc("/spaluter/lfo/set-many", args);
  });

  ipcMain.handle("sc:trigger", (_evt, action) => {
    if (action === "start") sendOsc("/spaluter/start", []);
    if (action === "stop") sendOsc("/spaluter/stop", []);
    if (action === "reset") sendOsc("/spaluter/reset", []);
    return true;
  });

  ipcMain.handle("sc:get-initial-state", () => {
    return { status: lastStatus, logs: snapshotLogs(), sampleDefaultDir: DEFAULT_SAMPLE_DIR };
  });

  ipcMain.handle("samples:list", async (_evt, dirPath) => {
    const targetDir = (typeof dirPath === "string" && dirPath.trim().length > 0)
      ? dirPath.trim()
      : DEFAULT_SAMPLE_DIR;

    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      const files = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => isSupportedSampleFile(name))
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({ name, path: path.join(targetDir, name) }));

      sendLog(`[SAMPLE] Found ${files.length} files in ${targetDir}`);
      return { ok: true, directory: targetDir, files };
    } catch (err) {
      const message = `Failed to list samples in ${targetDir}: ${err.message}`;
      sendLog(`[SAMPLE] ${message}`);
      return { ok: false, directory: targetDir, files: [], error: message };
    }
  });

  ipcMain.handle("samples:load", (_evt, samplePath) => {
    if (typeof samplePath !== "string" || samplePath.trim().length === 0) return false;
    const trimmed = samplePath.trim();
    sendLog(`[SAMPLE] Loading: ${trimmed}`);
    sendOsc("/spaluter/load-sample", [trimmed]);
    return true;
  });

  ipcMain.handle("sc:set-scope", (_evt, payload) => {
    const enabled = payload?.enabled !== false;
    const rate = normalizedScopeRate(payload?.rate);
    scopeStreamEnabled = enabled;
    scopeRateHz = rate;
    sendOsc("/spaluter/scope-config", [enabled ? 1 : 0, rate]);
    return true;
  });
}

async function performStartupSequence() {
  sendStatus("Startup 1/4: checking SuperCollider...");
  let superColliderReady = await isSuperColliderAvailable();
  if (!superColliderReady) {
    sendStatus("Startup 2/4: installing SuperCollider packages...");
    sendLog("[BOOT] sclang was not found. Attempting automatic install.");
    superColliderReady = await installSuperCollider();
  } else {
    sendStatus("Startup 2/4: SuperCollider already installed.");
  }

  if (!superColliderReady) {
    sendStatus("SuperCollider unavailable; open UI for manual setup.");
    return;
  }

  sendLog("[BOOT] Starting OSC bridge...");
  const oscReady = await createOscClient();
  if (!oscReady) {
    sendStatus("OSC unavailable; open UI for troubleshooting.");
    return;
  }

  sendStatus("Startup 3/4: starting SuperCollider runtime...");
  startSuperCollider();

  sendStatus("Startup 4/4: starting synth...");
  try {
    await waitForSynthStartup(STARTUP_WAIT_TIMEOUT_MS);
  } catch (err) {
    sendLog(`[BOOT] ${err.message}`);
    sendStatus("ERROR. Check Log.");
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createWindow();
  startAppCpuUsageBroadcast();
  performStartupSequence().catch((err) => {
    sendLog(`[BOOT] Startup sequence failed: ${err.message}`);
    sendStatus("Startup failed; see log for details.");
  });
});

app.on("before-quit", (event) => {
  if (quittingApp) return;
  quittingApp = true;
  event.preventDefault();
  clearAppCpuUsageBroadcast();
  stopRuntimeAndCloseOsc().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (quittingApp) return;
  quittingApp = true;
  clearAppCpuUsageBroadcast();
  stopRuntimeAndCloseOsc().finally(() => app.quit());
});
