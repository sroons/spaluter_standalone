#!/usr/bin/env node
const { spawn } = require("child_process");
const path = require("path");

const electronBinary = path.join(
  __dirname,
  "..",
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron.cmd" : "electron"
);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronBinary, ["."], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  env
});

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to start Electron:", err.message);
  process.exit(1);
});
