import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SRC_ROOT = path.resolve(LIB_DIR, "..");
export const APP_ROOT = path.resolve(SRC_ROOT, "..", "app");
export const PROJECT_ROOT = path.resolve(SRC_ROOT, "..");
export const DATA_DIR = path.join(APP_ROOT, "data");
export const LOG_DIR = path.join(APP_ROOT, "logs");
export const CACHE_DIR = path.join(APP_ROOT, "cache");
export const DIST_DIR = path.join(APP_ROOT, "dist");
export const WEB_DIR = path.join(SRC_ROOT, "web");
export const BIN_RS = path.join(
  APP_ROOT,
  "bin",
  process.platform === "win32" ? "analyze_rs.exe" : "analyze_rs"
);
