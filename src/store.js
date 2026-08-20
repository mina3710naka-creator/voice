const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const STORE_PATH = path.join(app.getPath("userData"), "settings.json");

const DEFAULTS = {
  launchAtLogin: false,
  cleanupFillers: true,
  maxRecordingSeconds: 60,
  whisperBinPath: "",
  whisperModelPath: "",
};

function load() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(partial) {
  const current = load();
  const next = { ...current, ...partial };
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

module.exports = { load, save, DEFAULTS };
