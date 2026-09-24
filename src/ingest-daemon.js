/**
 * ② 入库进程：消费 data/_queue，写 comments.jsonl、seen、游标
 * 启动：node ingest-daemon.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendComments,
  appendTimeline,
  fsyncComments,
  loadSeenIds,
  pathsFor,
  writeCursor,
} from "./lib/store.js";
import { ack, depth, failJob, listPending, queuePaths, readJob } from "./lib/queue.js";
import { createLogger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'app');
const logger = createLogger({ root: ROOT, name: "ingest" });

const POLL_MS = 50;
const CKPT_EVERY = 10;
const CKPT_MS = 3000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeRuntime(gameId, obj) {
  const p = path.join(pathsFor(gameId, ROOT).dir, "runtime.ingest.json");
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

async function main() {
  queuePaths(ROOT);
  logger.info(`ingest-daemon 启动 · 队列 ${path.join(ROOT, "data", "_queue")}`);

  const seenByGame = new Map();
  const ckptAt = new Map();
  let sessionNew = 0;
  let lastSampleAt = 0;

  async function getSeen(gameId) {
    if (!seenByGame.has(gameId)) {
      seenByGame.set(gameId, await loadSeenIds(gameId, ROOT));
    }
    return seenByGame.get(gameId);
  }

  function maybeCkpt(gameId, isFull, page, pageCount, meta, sessionNewGame) {
    const now = Date.now();
    const last = ckptAt.get(gameId) || 0;
    if (page % CKPT_EVERY !== 0 && now - last < CKPT_MS) return;
    ckptAt.set(gameId, now);
    writeCursor(
      gameId,
      isFull ? "full" : "update",
      {
        schemaVersion: 1,
        gameId,
        mode: isFull ? "full" : "update",
        paramsFingerprint: meta.paramsFingerprint,
        lastCompletedPage: page,
        lastScannedPage: page,
        pageCount,
        pageSize: meta.pageSize,
        rankType: meta.rankType,
        status: "running",
        jobId: meta.jobId,
        updatedAt: new Date().toISOString(),
        seenCount: meta.seenCount,
        sessionNew: sessionNewGame,
      },
      ROOT
    );
    fsyncComments(gameId, ROOT);
  }

  for (;;) {
    const names = listPending(ROOT);
    if (!names.length) {
      await sleep(POLL_MS);
      continue;
    }
    const name = names[0];
    let job;
    try {
      job = readJob(ROOT, name);
    } catch (e) {
      logger.error(`读取队列失败 ${name}: ${e.message}`);
      failJob(ROOT, name);
      continue;
    }

    const gameId = String(job.gameId || "");
    if (!gameId) {
      failJob(ROOT, name);
      continue;
    }

    try {
      const seen = await getSeen(gameId);
      const items = job.items || [];
      let newOnPage = 0;
      const fresh = [];
      for (const c of items) {
        const id = c.comment_no;
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        fresh.push(c);
        newOnPage++;
      }

      if (fresh.length) {
        appendComments(gameId, fresh, ROOT);
        sessionNew += fresh.length;
      }

      const isFull = job.crawlMode !== "incremental";
      const meta = {
        paramsFingerprint: job.paramsFingerprint,
        pageSize: job.pageSize,
        rankType: job.rankType,
        jobId: job.jobId,
        seenCount: seen.size,
      };
      maybeCkpt(gameId, isFull, job.page, job.pageCount, meta, sessionNew);
      ack(ROOT, name);

      writeRuntime(gameId, {
        updatedAt: new Date().toISOString(),
        queueDepth: depth(ROOT),
        lastPage: job.page,
        sessionNew,
        seenCount: seen.size,
        lastNewOnPage: newOnPage,
        status: "running",
      });

      const now = Date.now();
      if (now - lastSampleAt >= 10000) {
        lastSampleAt = now;
        appendTimeline(
          gameId,
          {
            ts: now,
            iso: new Date(now).toISOString(),
            localCount: seen.size,
            sessionNew,
            page: job.page,
          },
          ROOT
        );
      }

      if (newOnPage || job.page % 5 === 0) {
        logger.info(`页 ${job.page} · 新 ${newOnPage}/${items.length} · 库 ${seen.size} · 队列 ${depth(ROOT)}`);
      }
    } catch (e) {
      logger.error(`入库失败 ${name}: ${e.message}`);
      failJob(ROOT, name);
    }
  }
}

process.on("SIGINT", () => process.exit(0));
main().catch((e) => {
  logger.error(e.message);
  process.exit(1);
});
