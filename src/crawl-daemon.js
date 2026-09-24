/**
 * ③ 爬取进程：只请求 + 入队，600ms+0–200ms 抖动
 * 启动：node crawl-daemon.js
 * 控制：data/_cmd.json {action:start|stop, gameId, mode, ...}
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCommentPage, fetchCommentSummary, fetchGameInfo, normalizeComment } from "./lib/api.js";
import { fingerprintParams, pathsFor, readCursor, writeGameInfo, appendJob } from "./lib/store.js";
import { depth, enqueue, queuePaths } from "./lib/queue.js";
import { createLogger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'app');
const logger = createLogger({ root: ROOT, name: "crawl" });
const CMD = path.join(ROOT, "data", "_cmd.json");
const MIN_DELAY = 600;
const MAX_JITTER = 200;
const MAX_QUEUE = 5;
let lastEmit = 0;
let baseDelay = MIN_DELAY;
let bannedStreak = 0;
const BAN_LIMIT = 3;

function isBanErr(err) {
  const m = String(err && err.message ? err.message : err || "");
  return m.includes("-412") || m.includes("request was banned");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 目标发出间隔：baseDelay+抖动；约 5%×2、1%×3 */
function nextInterval() {
  const base = baseDelay + Math.floor(Math.random() * (MAX_JITTER + 1));
  const r = Math.random();
  const mult = r < 0.01 ? 3 : r < 0.06 ? 2 : 1;
  return base * mult;
}

/** 等到距上次发出至少 nextInterval() */
async function paceEmit() {
  if (!lastEmit) return;
  const wait = nextInterval() - (Date.now() - lastEmit);
  if (wait > 0) await sleep(wait);
}

function readCmd() {
  try {
    return JSON.parse(fs.readFileSync(CMD, "utf8"));
  } catch {
    return null;
  }
}

function writeRuntime(gameId, obj) {
  const p = path.join(pathsFor(gameId, ROOT).dir, "runtime.crawl.json");
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  try {
    fs.renameSync(tmp, p);
  } catch {
    try {
      fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
    } catch {
      /* ignore */
    }
  }
}

function delay() {
  return nextInterval();
}

function makeJobId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

let active = null;
let lastJobId = null;

async function startJob(cmd) {
  const gameId = String(cmd.gameId || "").trim();
  if (!gameId) throw new Error("缺少 gameId");
  baseDelay = Math.max(MIN_DELAY, Number(cmd.delayMs) || MIN_DELAY);
  const pageSize = Math.min(20, Math.max(1, Number(cmd.pageSize) || 20));
  const rankType = Number(cmd.rankType) || 3;
  const mode = cmd.mode || "full_resume";
  const fp = fingerprintParams({ pageSize, rankType });
  const full = readCursor(gameId, "full", ROOT);
  const cookie = cmd.cookie || "";
  const maxPages = cmd.maxPages ? Math.max(1, Number(cmd.maxPages)) : null;

  let startPage = 1;
  let crawlMode = mode;
  if (mode === "full_resume" && full && full.paramsFingerprint === fp) {
    if (full.status === "done" && full.lastCompletedPage >= (full.pageCount || 0)) {
      crawlMode = "incremental";
      startPage = 1;
    } else {
      startPage = (full.lastCompletedPage || 0) + 1;
    }
  } else if (mode === "full_restart" || (mode === "full_resume" && !full)) {
    crawlMode = "full_restart";
    startPage = 1;
  } else {
    crawlMode = "incremental";
    startPage = 1;
  }

  active = {
    gameId,
    crawlMode,
    pageSize,
    rankType,
    fp,
    cookie,
    maxPages,
    jobId: cmd.jobId || makeJobId(),
    nextPage: startPage,
    startPage,
    pageCount: full?.pageCount || 0,
    sessionPages: 0,
    sessionEnqueued: 0,
    t0: Date.now(),
  };

  try {
    const [info, summary] = await Promise.all([
      fetchGameInfo(gameId, cookie),
      fetchCommentSummary(gameId, cookie),
    ]);
    writeGameInfo(
      gameId,
      {
        gameId,
        title: info?.title,
        icon: info?.icon,
        download_count: info?.download_count,
        summary,
        updatedAt: new Date().toISOString(),
      },
      ROOT
    );
  } catch (e) {
    logger.warn(`游戏信息预取失败：${e.message}`);
  }

  appendJob(gameId, { id: active.jobId, mode: crawlMode, startPage, pageSize, rankType, status: "running" }, ROOT);
  logger.info(`开始[${crawlMode}] ${gameId} 页 ${startPage} · 发出间隔≥${baseDelay}ms+0-${MAX_JITTER}ms（5%×2 / 1%×3）`);
}

async function stopJob() {
  if (!active) {
    await sleep(200);
    return;
  }
  const a = active;
  writeRuntime(a.gameId, {
    updatedAt: new Date().toISOString(),
    mode: a.crawlMode,
    jobId: a.jobId,
    nextPage: a.nextPage,
    pageCount: a.pageCount,
    sessionPages: a.sessionPages,
    sessionEnqueued: a.sessionEnqueued,
    queueDepth: depth(ROOT),
    status: "stopped",
  });
  active = null;
  logger.info("已停止");
}

async function tickCrawl(cmd) {
  if (cmd?.action === "stop") {
    await stopJob();
    return;
  }
  if (
    cmd?.action === "start" &&
    cmd.jobId &&
    cmd.jobId !== lastJobId &&
    (!active || active.jobId !== cmd.jobId)
  ) {
    if (active) await stopJob();
    await startJob(cmd);
    lastJobId = cmd.jobId;
  }
  if (!active) {
    await sleep(200);
    return;
  }

  while (depth(ROOT) > MAX_QUEUE) {
    await sleep(200);
    if (!active) {
    await sleep(200);
    return;
  }
  }

  const a = active;
  if (a.maxPages && a.sessionPages >= a.maxPages) {
    await stopJob();
    return;
  }

  let page;
  try {
    await paceEmit();
    lastEmit = Date.now();
    page = await fetchCommentPage(a.gameId, a.nextPage, a.pageSize, {
      cookie: a.cookie,
      rankType: a.rankType,
      includeReplies: false,
    });
    bannedStreak = 0;
  } catch (e) {
    if (isBanErr(e)) {
      bannedStreak++;
      logger.error(`页 ${a.nextPage} 被风控(-412) 连续 ${bannedStreak}/${BAN_LIMIT}：${e.message}`);
      if (bannedStreak >= BAN_LIMIT) {
        logger.error(`连续 ${bannedStreak} 次 -412，自动停止任务并退出 crawl-daemon（请冷却后再启动）`);
        try {
          await stopJob();
        } catch {}
        try {
          const cur = readCmd() || {};
          fs.writeFileSync(CMD, JSON.stringify({ ...cur, action: "stop" }, null, 2), "utf8");
        } catch {}
        process.exit(0);
      }
    } else {
      bannedStreak = 0;
      logger.error(`页 ${a.nextPage} 失败：${e.message}`);
    }
    await sleep(800);
    return;
  }

  if (!a.pageCount) a.pageCount = page.pageCount;

  const items = page.list.map((c) => ({
    ...normalizeComment(c, a.gameId),
    crawled_at: new Date().toISOString(),
    source_page: a.nextPage,
    rank_type: a.rankType,
  }));

  enqueue(ROOT, {
    schemaVersion: 1,
    gameId: a.gameId,
    page: a.nextPage,
    pageSize: a.pageSize,
    rankType: a.rankType,
    paramsFingerprint: a.fp,
    crawlMode: a.crawlMode,
    jobId: a.jobId,
    pageCount: a.pageCount,
    enqueuedAt: new Date().toISOString(),
    items,
  });

  a.sessionPages++;
  a.sessionEnqueued += items.length;
  a.nextPage++;
  const elapsed = (Date.now() - a.t0) / 1000;
  const rate = elapsed > 0 ? +(a.sessionPages / elapsed).toFixed(3) : 0;

  writeRuntime(a.gameId, {
    updatedAt: new Date().toISOString(),
    mode: a.crawlMode,
    jobId: a.jobId,
    startPage: a.startPage,
    nextPage: a.nextPage,
    pageCount: a.pageCount,
    sessionPages: a.sessionPages,
    sessionEnqueued: a.sessionEnqueued,
    queueDepth: depth(ROOT),
    ratePerSec: rate,
    status: "running",
  });

  if (a.sessionPages % 5 === 0) {
    logger.info(`页 ${a.nextPage - 1} · 入队 ${items.length} · 队列 ${depth(ROOT)} · ${rate}页/s`);
  }

  if (a.pageCount && a.nextPage > a.pageCount) {
    await stopJob();
    return;
  }
}

async function main() {
  queuePaths(ROOT);
  fs.mkdirSync(path.dirname(CMD), { recursive: true });
  logger.info("crawl-daemon 启动 · 等待 data/_cmd.json start");

  for (;;) {
    try {
      await tickCrawl(readCmd());
    } catch (e) {
      logger.error(e.message);
      await sleep(500);
    }
  }
}

process.on("SIGINT", () => process.exit(0));
main().catch((e) => {
  logger.error(e.message);
  process.exit(1);
});
