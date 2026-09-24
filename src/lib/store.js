import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { invalidateGameCache } from "./cache.js";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function dataDir(gameId, root = process.cwd()) {
  const dir = path.join(root, "data", String(gameId));
  ensureDir(dir);
  return dir;
}

export function stateDir(gameId, root = process.cwd()) {
  const dir = path.join(dataDir(gameId, root), "state");
  ensureDir(dir);
  return dir;
}

export function jobsDir(gameId, root = process.cwd()) {
  const dir = path.join(dataDir(gameId, root), "jobs");
  ensureDir(dir);
  return dir;
}

export function pathsFor(gameId, root = process.cwd()) {
  const dir = dataDir(gameId, root);
  const state = stateDir(gameId, root);
  return {
    dir,
    state,
    jobs: jobsDir(gameId, root),
    jsonl: path.join(dir, "comments.jsonl"),
    game: path.join(dir, "game.json"),
    meta: path.join(dir, "meta.json"),
    fullCursor: path.join(state, "full.cursor.json"),
    updateCursor: path.join(state, "update.cursor.json"),
    timeline: path.join(state, "grade-timeline.jsonl"),
    seenIds: path.join(state, "seen.ids"),
    raw: path.join(dir, "raw-pages.jsonl"),
    csv: path.join(dir, "comments.csv"),
    stats: path.join(dir, "stats.json"),
  };
}

export function fingerprintParams({ pageSize, rankType }) {
  return `rank${rankType}|ps${pageSize}`;
}

function atomicWrite(file, data) {
  const tmp = file + ".tmp";
  const payload = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload, "utf8");
  try {
    fs.renameSync(tmp, file);
  } catch {
    try {
      fs.writeFileSync(file, payload, "utf8");
    } catch {
      /* 尽力而为 */
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function writeGameInfo(gameId, game, root) {
  atomicWrite(pathsFor(gameId, root).game, game);
}

export function readGameInfo(gameId, root) {
  return readJson(pathsFor(gameId, root).game);
}

export function readCursor(gameId, mode, root) {
  const p = pathsFor(gameId, root);
  const file = mode === "update" ? p.updateCursor : p.fullCursor;
  return readJson(file);
}

export function writeCursor(gameId, mode, cursor, root) {
  const p = pathsFor(gameId, root);
  const file = mode === "update" ? p.updateCursor : p.fullCursor;
  atomicWrite(file, cursor);
}

export function readMeta(gameId, root) {
  return readJson(pathsFor(gameId, root).meta) || readGameInfo(gameId, root);
}

export function writeMeta(gameId, meta, root) {
  atomicWrite(pathsFor(gameId, root).meta, meta);
}

/** 追加写入；默认不 fsync，checkpoint 时再 fsync，避免每页刷盘阻塞爬取 */
export function appendComments(gameId, comments, root) {
  invalidateGameCache(root, gameId);
  if (!comments.length) return;
  const p = pathsFor(gameId, root).jsonl;
  const lines = comments.map((c) => JSON.stringify(c)).join("\n") + "\n";
  fs.appendFileSync(p, lines, "utf8");
}

export function fsyncComments(gameId, root) {
  const p = pathsFor(gameId, root).jsonl;
  if (!fs.existsSync(p)) return;
  try {
    const fd = fs.openSync(p, "r+");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* ignore */
  }
}

export function appendRawPage(gameId, pageObj, root) {
  const p = pathsFor(gameId, root).raw;
  fs.appendFileSync(p, JSON.stringify(pageObj) + "\n", "utf8");
}

export function appendTimeline(gameId, sample, root) {
  const p = pathsFor(gameId, root).timeline;
  fs.appendFileSync(p, JSON.stringify(sample) + "\n", "utf8");
}

export function readTimeline(gameId, root) {
  const p = pathsFor(gameId, root).timeline;
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function appendJob(gameId, job, root) {
  const id = job.id || `job-${Date.now()}`;
  atomicWrite(path.join(jobsDir(gameId, root), `${id}.json`), { ...job, id });
  return id;
}

export async function* readComments(gameId, root) {
  const p = pathsFor(gameId, root).jsonl;
  if (!fs.existsSync(p)) return;
  const rl = readline.createInterface({
    input: fs.createReadStream(p, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      yield JSON.parse(t);
    } catch {
      /* skip */
    }
  }
}

export async function loadSeenIds(gameId, root) {
  const seen = new Set();
  for await (const c of readComments(gameId, root)) {
    if (c.comment_no) seen.add(c.comment_no);
  }
  return seen;
}

export function writeSeenIds(gameId, seen, root) {
  try {
    atomicWrite(pathsFor(gameId, root).seenIds, [...seen].join("\n") + "\n");
  } catch {
    /* ignore */
  }
}

export function readSeenIdsFile(gameId, root) {
  const p = pathsFor(gameId, root).seenIds;
  if (!fs.existsSync(p)) return null;
  const s = new Set();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (t) s.add(t);
  }
  return s;
}

export function countCommentsSync(gameId, root) {
  const p = pathsFor(gameId, root).jsonl;
  if (!fs.existsSync(p)) return 0;
  const buf = fs.readFileSync(p);
  let n = 0;
  for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
  if (buf.length && buf[buf.length - 1] !== 10) n++;
  return n;
}

export function listGames(root = process.cwd()) {
  const base = path.join(root, "data");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => {
      const game = readGameInfo(d.name, root) || {};
      const full = readCursor(d.name, "full", root);
      const upd = readCursor(d.name, "update", root);
      return {
        gameId: d.name,
        title: game.title || "",
        commentCount: full?.seenCount ?? countCommentsSync(d.name, root),
        status: full?.status || upd?.status || "unknown",
        updatedAt: full?.updatedAt || upd?.updatedAt || game.updatedAt || null,
        fullLastPage: full?.lastCompletedPage || 0,
        pageCount: full?.pageCount || 0,
      };
    })
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

const CSV_COLUMNS = [
  "game_base_id",
  "comment_no",
  "uid",
  "user_name",
  "user_level",
  "grade",
  "publish_time",
  "content",
  "device_type",
  "up_count",
  "down_count",
  "reply_count",
  "play_duration",
  "play_duration_text",
  "user_official_verify_type",
  "user_official_verify_desc",
  "hot_recall",
  "crawled_at",
  "source_page",
  "rank_type",
];

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportCsv(gameId, root) {
  const p = pathsFor(gameId, root);
  const ws = fs.createWriteStream(p.csv, { encoding: "utf8" });
  ws.write("﻿" + CSV_COLUMNS.join(",") + "\n");
  let n = 0;
  for await (const c of readComments(gameId, root)) {
    ws.write(CSV_COLUMNS.map((k) => csvEscape(c[k])).join(",") + "\n");
    n++;
  }
  await new Promise((resolve, reject) => {
    ws.end(resolve);
    ws.on("error", reject);
  });
  return { path: p.csv, count: n };
}

export async function computeStatsStream(gameId, root) {
  const gradeDist = Array.from({ length: 11 }, () => 0);
  let sumGrade = 0;
  let gradeN = 0;
  const byDay = new Map();
  let minT = null;
  let maxT = null;
  let contentLen = 0;
  let withContent = 0;
  const users = new Set();
  let up = 0;
  let down = 0;
  let replies = 0;
  let total = 0;
  const byPlayBucket = { "0": 0, "1-7": 0, "8-30": 0, "31-90": 0, "91-365": 0, "366+": 0 };
  const byDevice = new Map();
  const byLevel = Array.from({ length: 7 }, () => 0);

  for await (const c of readComments(gameId, root)) {
    total++;
    const g = Number(c.grade) || 0;
    if (g >= 0 && g <= 10) gradeDist[g]++;
    // 与 analyze.js 一致：0 分计入均分
    if (Number.isFinite(g)) {
      sumGrade += g;
      gradeN++;
    }
    const t = c.publish_time || "";
    if (t) {
      const day = t.slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
      if (!minT || t < minT) minT = t;
      if (!maxT || t > maxT) maxT = t;
    }
    if (c.content) {
      contentLen += c.content.length;
      withContent++;
    }
    if (c.uid != null) users.add(c.uid);
    up += Number(c.up_count) || 0;
    down += Number(c.down_count) || 0;
    replies += Number(c.reply_count) || 0;

    const pd = Number(c.play_duration) || 0;
    if (pd <= 0) byPlayBucket["0"]++;
    else if (pd <= 7) byPlayBucket["1-7"]++;
    else if (pd <= 30) byPlayBucket["8-30"]++;
    else if (pd <= 90) byPlayBucket["31-90"]++;
    else if (pd <= 365) byPlayBucket["91-365"]++;
    else byPlayBucket["366+"]++;

    const dev = c.device_type || "未知";
    byDevice.set(dev, (byDevice.get(dev) || 0) + 1);
    const lv = Math.min(6, Math.max(0, Number(c.user_level) || 0));
    byLevel[lv]++;
  }

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return {
    total,
    uniqueUsers: users.size,
    avgGrade: gradeN ? +(sumGrade / gradeN).toFixed(3) : 0,
    gradeDist,
    avgContentLength: withContent ? +(contentLen / withContent).toFixed(1) : 0,
    totalUp: up,
    totalDown: down,
    totalReplies: replies,
    timeRange: { min: minT, max: maxT },
    byDay: days.map(([date, count]) => ({ date, count })),
    byPlayBucket,
    byDevice: [...byDevice.entries()].map(([device, count]) => ({ device, count })),
    byLevel,
    generatedAt: new Date().toISOString(),
  };
}

export async function queryCommentsStream(gameId, root, { q = "", grade = "", page = 1, pageSize = 20 } = {}) {
  const needle = String(q || "").trim().toLowerCase();
  const gradeVal = grade === "" || grade == null ? null : Number(grade);
  const light = [];

  for await (const c of readComments(gameId, root)) {
    if (gradeVal != null && Number(c.grade) !== gradeVal) continue;
    if (needle) {
      const hit =
        (c.content || "").toLowerCase().includes(needle) ||
        (c.user_name || "").toLowerCase().includes(needle) ||
        String(c.comment_no || "").toLowerCase().includes(needle);
      if (!hit) continue;
    }
    light.push({
      comment_no: c.comment_no,
      publish_time: c.publish_time || "",
      grade: c.grade,
      uid: c.uid,
      user_name: c.user_name,
      user_level: c.user_level,
      up_count: c.up_count,
      down_count: c.down_count,
      reply_count: c.reply_count,
    });
  }

  light.sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time)));
  const total = light.length;
  const start = (page - 1) * pageSize;
  const pageLight = light.slice(start, start + pageSize);
  const need = new Set(pageLight.map((x) => x.comment_no));
  const full = new Map();

  if (need.size) {
    for await (const c of readComments(gameId, root)) {
      if (c.comment_no && need.has(c.comment_no)) {
        full.set(c.comment_no, c);
        if (full.size >= need.size) break;
      }
    }
  }

  const items = pageLight.map((x) => full.get(x.comment_no) || x);
  return { total, page, pageSize, items };
}
