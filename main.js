const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const { spawn } = require("child_process");
const osc = require("osc");

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
let sclangStartupBuffer = "";
let shutdownPromise = null;
let scopeStreamEnabled = true;
let scopeRateHz = DEFAULT_SCOPE_RATE_HZ;
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
          for (let i = 0; i < rawArgs.length && samples.length < 128; i += 1) {
            const arg = rawArgs[i];
            const raw = (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value"))
              ? arg.value
              : arg;
            const value = Number(raw);
            if (Number.isFinite(value)) samples.push(value);
          }
          if (samples.length > 0 && mainWindow) {
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

function sendOsc(address, args = []) {
  if (!oscPort) return;
  oscPort.send({ address, args });
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

function createWindow() {
  mainWindowReady = false;
  mainWindow = new BrowserWindow({
    width: 800,
    height: 480,
    fullscreen: process.platform === "linux",
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindowReady = true;
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.on("closed", () => {
    mainWindowReady = false;
    mainWindow = null;
  });
}

function registerIpcHandlers() {
  ipcMain.handle("sc:set-param", (_evt, payload) => {
    const { key, value } = payload || {};
    if (typeof key !== "string") return false;
    sendOsc("/spaluter/set", [key, Number(value)]);
    return true;
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
  performStartupSequence().catch((err) => {
    sendLog(`[BOOT] Startup sequence failed: ${err.message}`);
    sendStatus("Startup failed; see log for details.");
  });
});

app.on("before-quit", (event) => {
  if (quittingApp) return;
  quittingApp = true;
  event.preventDefault();
  stopRuntimeAndCloseOsc().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform === "darwin") return;
  if (quittingApp) return;
  quittingApp = true;
  stopRuntimeAndCloseOsc().finally(() => app.quit());
});
