import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(
  __dirname,
  "..",
  "..",
  "app",
  "bin",
  process.platform === "win32" ? "analyze_rs.exe" : "analyze_rs"
);

export function rustAvailable() {
  return fs.existsSync(BIN);
}

function run(args) {
  const r = spawnSync(BIN, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr || `analyze_rs exit ${r.status}`);
  return JSON.parse(r.stdout);
}

export function rustSeriesRows(file, { grain = "month", from = "", to = "" } = {}) {
  return run(["series", file, grain, from || "", to || ""]).rows || [];
}

export function rustWordFreq(file, { source = "both", limit = 300 } = {}) {
  return run(["wordfreq", file, source, String(limit)]);
}

export function rustFactors(file, { grain = "month", from = "", to = "" } = {}) {
  return run(["factors", file, grain, from || "", to || ""]);
}

export function rustKeywords(file, { name = "", aliases = [], grain = "month", from = "", to = "" } = {}) {
  return run(["keywords", file, name, aliases.join("|"), grain, from || "", to || ""]);
}

export function rustCrossDist(fileA, fileB, { grain = "month", from = "", to = "" } = {}) {
  return run(["crossdist", fileA, fileB, grain, from || "", to || ""]);
}
