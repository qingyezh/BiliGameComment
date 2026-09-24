import {
  fetchCommentPage,
  fetchCommentSummary,
  fetchGameInfo,
  normalizeComment,
} from "./api.js";
import {
  appendComments,
  appendJob,
  appendRawPage,
  appendTimeline,
  dataDir,
  fingerprintParams,
  fsyncComments,
  loadSeenIds,
  readCursor,
  readGameInfo,
  writeCursor,
  writeGameInfo,
  writeSeenIds,
} from "./store.js";
import { createLogger } from "./logger.js";

const MIN_DELAY_MS = 800;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 800ms 起步 + 0–400ms 随机抖动 */
function delayWithJitter(base) {
  const b = Math.max(MIN_DELAY_MS, base);
  return b + Math.floor(Math.random() * 400);
}

function makeJobId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 单游戏采集器。
 * mode: full_resume | full_restart | incremental
 */
export class Crawler {
  constructor({ root = process.cwd(), io, logger } = {}) {
    this.root = root;
    this.io = io || (() => {});
    this.logger = logger || createLogger({ root });
    this.running = false;
    this.stopping = false;
    this.task = null;
    this.loopPromise = null;
  }

  status() {
    const t = this.task;
    if (!t) return { running: false };
    return {
      running: this.running,
      stopping: this.stopping,
      jobId: t.jobId,
      gameId: t.gameId,
      title: t.title,
      mode: t.mode,
      pageNum: t.nextPage,
      pageCount: t.pageCount,
      pageSize: t.pageSize,
      sessionPages: t.sessionPages,
      sessionNew: t.sessionNew,
      crawledCount: t.seen.size,
      errorCount: t.errorCount,
      lastError: t.lastError,
      startedAt: t.startedAt,
      updatedAt: new Date().toISOString(),
      ratePerSec: t.ratePerSec,
      logs: t.logs.slice(-80),
      rankType: t.rankType,
      delayMs: t.delayMs,
      seenCount: t.seen.size,
      dupStop: t.dupStop,
      dupWindow: t.dupWindow,
      dupThreshold: t.dupThreshold,
      stoppedByDup: t.stoppedByDup,
      lastSample: t.lastSample || null,
    };
  }

  /** 采集中增量聚合，禁止全文件统计 */
  sessionStats() {
    const t = this.task;
    if (!t || !t.acc) return null;
    const a = t.acc;
    return {
      sessionOnly: true,
      sessionNew: t.sessionNew,
      seenCount: t.seen ? t.seen.size : 0,
      uniqueUsers: a.users.size,
      avgGrade: a.n ? +(a.sumGrade / a.n).toFixed(3) : 0,
      gradeDist: a.gradeDist.slice(),
      totalUp: a.up,
      totalDown: a.down,
      timeRange: { min: a.minT, max: a.maxT },
      note: "采集中为增量聚合；全量分布请停止后 force=1 刷新",
      generatedAt: new Date().toISOString(),
    };
  }

  #accAdd(c) {
    const acc = this.task.acc;
    acc.n++;
    const g = Number(c.grade) || 0;
    if (g >= 0 && g <= 10) acc.gradeDist[g]++;
    acc.sumGrade += g;
    if (c.uid != null) acc.users.add(c.uid);
    acc.up += Number(c.up_count) || 0;
    acc.down += Number(c.down_count) || 0;
    const t = c.publish_time || "";
    if (t) {
      if (!acc.minT || t < acc.minT) acc.minT = t;
      if (!acc.maxT || t > acc.maxT) acc.maxT = t;
    }
  }

  log(msg, level = "info", extra = {}) {
    const line = this.logger[level] ? this.logger[level](msg, extra) : this.logger.info(msg, extra);
    const rec = { ts: line.ts || new Date().toISOString(), level, msg };
    if (this.task) {
      this.task.logs.push(rec);
      if (this.task.logs.length > 400) this.task.logs.splice(0, this.task.logs.length - 400);
    }
    this.io("crawl:log", rec);
    this.io("crawl:status", this.status());
    return rec;
  }

  async start(opts) {
    if (this.running) throw new Error("已有采集任务在运行（单游戏串行）");
    const gameId = String(opts.gameId || "").trim();
    if (!gameId) throw new Error("缺少 gameId");

    const pageSize = Math.min(20, Math.max(1, Number(opts.pageSize) || 20));
    const rankType = Number(opts.rankType) || 3;
    const delayMs = Math.max(MIN_DELAY_MS, Number(opts.delayMs) || MIN_DELAY_MS);
    const maxPages = opts.maxPages ? Math.max(1, Number(opts.maxPages)) : null;
    const saveRaw = !!opts.saveRaw;
    const cookie = opts.cookie || "";
    const dupStop = opts.dupStop !== false;
    const dupWindow = Math.max(5, Number(opts.dupWindow) || 50);
    const dupThreshold = Math.max(1, Math.min(dupWindow, Number(opts.dupThreshold) || 45));
    let mode = opts.mode || "full_resume";
    if (opts.resume === false && !opts.mode) mode = "incremental";
    if (opts.resume === true && !opts.mode) mode = "full_resume";

    const fp = fingerprintParams({ pageSize, rankType });
    dataDir(gameId, this.root);

    const jobId = makeJobId();
    const full = readCursor(gameId, "full", this.root);
    const seen = await loadSeenIds(gameId, this.root);

    let startPage = 1;
    let resumeReason = "";

    if (mode === "full_resume") {
      if (!full) {
        mode = "full_restart";
        resumeReason = "无全量游标，自动改为全量重来";
      } else if (full.paramsFingerprint && full.paramsFingerprint !== fp) {
        throw new Error(
          `参数指纹不一致（存档 ${full.paramsFingerprint}，本次 ${fp}），请用「全量重来」或恢复相同 pageSize/rank_type`
        );
      } else if (full.status === "done" && full.lastCompletedPage >= (full.pageCount || 0)) {
        mode = "incremental";
        resumeReason = "全量已完成，自动切换增量更新";
      } else {
        startPage = (full.lastCompletedPage || 0) + 1;
        resumeReason = `从第 ${startPage} 页续爬`;
      }
    } else if (mode === "full_restart") {
      startPage = 1;
      resumeReason = "忽略旧游标，从第 1 页全量重来（仍按 comment_no 去重）";
    } else {
      startPage = 1;
      resumeReason = "增量：从第 1 页扫描新评论";
    }

    this.task = {
      jobId,
      gameId,
      title: readGameInfo(gameId, this.root)?.title || "",
      mode,
      pageSize,
      rankType,
      delayMs,
      maxPages,
      saveRaw,
      cookie,
      paramsFingerprint: fp,
      startPage,
      nextPage: startPage,
      pageCount: full?.pageCount || 0,
      sessionPages: 0,
      sessionNew: 0,
      errorCount: 0,
      consecutiveErrors: 0,
      lastError: null,
      startedAt: new Date().toISOString(),
      ratePerSec: 0,
      logs: [],
      seen,
      lastCkptAt: 0,
      acc: {
        n: 0,
        sumGrade: 0,
        gradeDist: Array.from({ length: 11 }, () => 0),
        users: new Set(),
        up: 0,
        down: 0,
        minT: null,
        maxT: null,
      },
      dupStop,
      dupWindow,
      dupThreshold,
      dupRecent: [],
      stoppedByDup: false,
      lastSample: null,
      lastSampleAt: 0,
      resumeReason,
      _t0: Date.now(),
    };

    this.running = true;
    this.stopping = false;

    try {
      const [info, summary] = await Promise.all([
        fetchGameInfo(gameId, cookie),
        fetchCommentSummary(gameId, cookie),
      ]);
      this.task.title = info?.title || this.task.title;
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
        this.root
      );
      this.task.lastSample = {
        ts: Date.now(),
        avgGrade: summary?.grade,
        commentNumber: summary?.comment_number,
        validCommentNumber: summary?.valid_comment_number,
        localCount: seen.size,
        starNumberList: summary?.star_number_list,
      };
    } catch (e) {
      this.log(`游戏信息预取失败：${e.message}`, "warn");
    }

    appendJob(
      gameId,
      {
        id: jobId,
        mode,
        paramsFingerprint: fp,
        startPage,
        pageSize,
        rankType,
        delayMs,
        startedAt: this.task.startedAt,
        status: "running",
      },
      this.root
    );

    this.log(`开始[${mode}] ${this.task.title || gameId} · ${resumeReason} · delay≥${delayMs}ms+抖动`);
    this.io("crawl:status", this.status());
    this.loopPromise = this.#loop();
    return this.status();
  }

  async stop() {
    if (!this.running) return this.status();
    this.stopping = true;
    this.log("正在停止…", "warn");
    if (this.loopPromise) await this.loopPromise.catch(() => {});
    return this.status();
  }

  async #sampleGrade(force = false) {
    const t = this.task;
    const now = Date.now();
    if (!force && now - t.lastSampleAt < 10000) return;
    t.lastSampleAt = now;
    try {
      const summary = await fetchCommentSummary(t.gameId, t.cookie);
      const sample = {
        ts: now,
        iso: new Date(now).toISOString(),
        avgGrade: summary?.grade ?? null,
        commentNumber: summary?.comment_number ?? null,
        validCommentNumber: summary?.valid_comment_number ?? null,
        localCount: t.seen.size,
        sessionNew: t.sessionNew,
        page: t.nextPage - 1,
        starNumberList: summary?.star_number_list || null,
      };
      appendTimeline(t.gameId, sample, this.root);
      t.lastSample = sample;
      this.io("crawl:sample", sample);
    } catch (e) {
      this.log(`均分采样失败：${e.message}`, "warn");
    }
  }

  #writeCheckpoint(completedPage, isFull) {
    const t = this.task;
    const now = Date.now();
    if (t.sessionPages % 10 !== 0 && now - t.lastCkptAt < 3000) return;
    t.lastCkptAt = now;
    try {
      writeCursor(
        t.gameId,
        isFull ? "full" : "update",
        {
          schemaVersion: 1,
          gameId: t.gameId,
          mode: isFull ? "full" : "update",
          paramsFingerprint: t.paramsFingerprint,
          lastCompletedPage: completedPage,
          lastScannedPage: completedPage,
          pageCount: t.pageCount,
          pageSize: t.pageSize,
          rankType: t.rankType,
          status: "running",
          jobId: t.jobId,
          updatedAt: new Date().toISOString(),
          seenCount: t.seen.size,
          sessionNew: t.sessionNew,
        },
        this.root
      );
      fsyncComments(t.gameId, this.root);
    } catch (e) {
      this.log(`checkpoint 写入失败（继续采集）：${e.message}`, "warn");
    }
  }

  async #loop() {
    const t = this.task;
    const isFull = t.mode === "full_resume" || t.mode === "full_restart";
    try {
      while (!this.stopping) {
        if (t.maxPages && t.sessionPages >= t.maxPages) {
          this.log(`已达到试跑页数上限 ${t.maxPages}`, "warn");
          break;
        }

        let page;
        try {
          page = await fetchCommentPage(t.gameId, t.nextPage, t.pageSize, {
            cookie: t.cookie,
            rankType: t.rankType,
            includeReplies: false,
          });
        } catch (e) {
          t.errorCount++;
          t.consecutiveErrors++;
          t.lastError = e.message;
          this.log(`第 ${t.nextPage} 页失败：${e.message}`, "error", { page: t.nextPage });
          if (t.consecutiveErrors >= 8) {
            this.log("连续失败过多，自动停止。请检查 Cookie 或稍后用全量续爬。", "error");
            break;
          }
          await sleep(Math.min(8000, 800 * 2 ** (t.consecutiveErrors - 1)));
          continue;
        }

        t.consecutiveErrors = 0;
        if (!t.pageCount) {
          t.pageCount = page.pageCount;
          this.log(`总页数 ${page.pageCount}（page_size=${page.pageSize}）`);
        }

        const crawledAt = new Date().toISOString();
        const items = page.list.map((c) => ({
          ...normalizeComment(c, t.gameId),
          crawled_at: crawledAt,
          source_page: t.nextPage,
          rank_type: t.rankType,
        }));

        let newOnPage = 0;
        let dupOnPage = 0;
        const fresh = [];
        for (const c of items) {
          const isNew = !c.comment_no || !t.seen.has(c.comment_no);
          if (isNew) {
            if (c.comment_no) t.seen.add(c.comment_no);
            fresh.push(c);
            newOnPage++;
            t.dupRecent.push(0);
          } else {
            dupOnPage++;
            t.dupRecent.push(1);
          }
          if (t.dupRecent.length > t.dupWindow) t.dupRecent.shift();
        }

        if (fresh.length) {
          appendComments(t.gameId, fresh, this.root);
          t.sessionNew += fresh.length;
          for (const c of fresh) this.#accAdd(c);
        }
        if (t.saveRaw) {
          appendRawPage(
            t.gameId,
            { page: t.nextPage, fetchedAt: Date.now(), count: items.length, list: items },
            this.root
          );
        }

        const completedPage = t.nextPage;
        t.sessionPages++;
        t.nextPage++;
        const elapsed = (Date.now() - t._t0) / 1000;
        t.ratePerSec = elapsed > 0 ? +(t.sessionPages / elapsed).toFixed(3) : 0;

        this.#writeCheckpoint(completedPage, isFull);

        if (t.sessionPages % 5 === 0 || newOnPage) {
          this.log(
            `页 ${completedPage} · 新 ${newOnPage}/重 ${dupOnPage} · 本次 +${t.sessionNew} · 库 ${t.seen.size} · ${t.ratePerSec}页/s`
          );
        }

        this.io("crawl:status", this.status());
        await this.#sampleGrade();

        if (!isFull && t.dupStop && t.dupRecent.length >= t.dupWindow) {
          const dups = t.dupRecent.reduce((a, b) => a + b, 0);
          if (dups >= t.dupThreshold) {
            t.stoppedByDup = true;
            this.log(
              `重复自动停止：最近 ${t.dupRecent.length} 条中 ${dups} 条已在库（${t.dupThreshold}/${t.dupWindow}）`,
              "warn"
            );
            break;
          }
        }

        if (t.pageCount && t.nextPage > t.pageCount) {
          this.log(`已到达最后一页 ${t.pageCount}`);
          break;
        }

        await sleep(delayWithJitter(t.delayMs));
      }
    } finally {
      await this.#sampleGrade(true);
      let cursorStatus = "paused";
      if (t.stoppedByDup) cursorStatus = "done";
      else if (t.errorCount >= 8) cursorStatus = "error";
      else if (this.stopping) cursorStatus = "paused";
      else if (t.pageCount && t.nextPage > t.pageCount) cursorStatus = "done";
      else if (t.maxPages && t.sessionPages >= t.maxPages) cursorStatus = "paused";

      writeCursor(
        t.gameId,
        isFull ? "full" : "update",
        {
          schemaVersion: 1,
          gameId: t.gameId,
          mode: isFull ? "full" : "update",
          paramsFingerprint: t.paramsFingerprint,
          lastCompletedPage: t.nextPage - 1,
          lastScannedPage: t.nextPage - 1,
          pageCount: t.pageCount,
          pageSize: t.pageSize,
          rankType: t.rankType,
          status: cursorStatus,
          jobId: t.jobId,
          updatedAt: new Date().toISOString(),
          seenCount: t.seen.size,
          sessionNew: t.sessionNew,
          stoppedByDup: !!t.stoppedByDup,
          finishedAt: new Date().toISOString(),
        },
        this.root
      );

      writeSeenIds(t.gameId, t.seen, this.root);
      appendJob(
        t.gameId,
        {
          id: t.jobId,
          mode: t.mode,
          startPage: t.startPage,
          sessionPages: t.sessionPages,
          sessionNew: t.sessionNew,
          seenCount: t.seen.size,
          status: cursorStatus,
          stoppedByDup: !!t.stoppedByDup,
          startedAt: t.startedAt,
          finishedAt: new Date().toISOString(),
        },
        this.root
      );

      this.running = false;
      this.stopping = false;
      const tail = t.stoppedByDup ? "（重复窗口自动停）" : t.errorCount >= 8 ? "（连续失败）" : "";
      this.log(
        `结束：本次 +${t.sessionNew} 条 / ${t.sessionPages} 页 · 库内 ${t.seen.size} 条${tail}`,
        "info"
      );
      this.io("crawl:status", this.status());
    }
  }
}