import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Crawler } from "./lib/crawler.js";
import { createLogger } from "./lib/logger.js";
import {
  computeStatsStream,
  exportCsv,
  listGames,
  pathsFor,
  queryCommentsStream,
  readCursor,
  readGameInfo,
  readTimeline,
} from "./lib/store.js";
import { fetchCommentSummary, fetchGameInfo } from "./lib/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'app');
const PORT = Number(process.env.PORT) || 8787;
const CONFIG_PATH = path.join(ROOT, "config.local.json");

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { cookie: "", defaultGameId: "103496", delayMs: 800, pageSize: 20, rankType: 3 };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}

const config = loadConfig();
if (!config.delayMs || Number(config.delayMs) < 800) config.delayMs = 800;

const logger = createLogger({ root: ROOT, name: "crawl" });
const crawler = new Crawler({ root: ROOT, logger });

const sseClients = new Set();
function sseSend(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}
crawler.io = sseSend;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jsonl": "application/x-ndjson; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  const webRoot = path.resolve(__dirname, "web");
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(webRoot, rel);
  if (!file.startsWith(webRoot)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

function maskCookie(cookie) {
  const m = /SESSDATA=([^;]+)/.exec(cookie);
  if (!m) return cookie.slice(0, 8) + "…";
  const v = decodeURIComponent(m[1]);
  return `SESSDATA=${v.slice(0, 6)}…${v.slice(-4)}（已保存）`;
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method || "GET";

  if (p === "/api/health") return sendJson(res, 200, { ok: true, now: Date.now() });

  if (p === "/api/config" && method === "GET") {
    const cookie = config.cookie || "";
    return sendJson(res, 200, {
      defaultGameId: config.defaultGameId || "103496",
      delayMs: config.delayMs ?? 800,
      pageSize: config.pageSize ?? 20,
      rankType: config.rankType ?? 3,
      hasCookie: !!cookie,
      cookiePreview: cookie ? maskCookie(cookie) : "",
    });
  }

  if (p === "/api/config" && method === "POST") {
    const body = await readBody(req);
    if (typeof body.cookie === "string") config.cookie = body.cookie.trim();
    if (body.defaultGameId != null) config.defaultGameId = String(body.defaultGameId).trim();
    if (body.delayMs != null) config.delayMs = Math.max(800, Number(body.delayMs) || 800);
    if (body.pageSize != null) config.pageSize = Number(body.pageSize) || 20;
    if (body.rankType != null) config.rankType = Number(body.rankType) || 3;
    saveConfig(config);
    return sendJson(res, 200, { ok: true, hasCookie: !!config.cookie });
  }

  if (p === "/api/games" && method === "GET") {
    return sendJson(res, 200, { games: listGames(ROOT) });
  }

  if (p === "/api/state" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    return sendJson(res, 200, {
      gameId,
      game: readGameInfo(gameId, ROOT),
      full: readCursor(gameId, "full", ROOT),
      update: readCursor(gameId, "update", ROOT),
      paths: pathsFor(gameId, ROOT),
    });
  }

  if (p === "/api/timeline" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const limit = Math.min(2000, Number(url.searchParams.get("limit")) || 500);
    const all = readTimeline(gameId, ROOT);
    return sendJson(res, 200, { gameId, samples: all.slice(-limit) });
  }

  if (p === "/api/game/preview" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    try {
      const [info, summary] = await Promise.all([
        fetchGameInfo(gameId, config.cookie),
        fetchCommentSummary(gameId, config.cookie),
      ]);
      return sendJson(res, 200, {
        ok: true,
        gameId,
        title: info?.title,
        icon: info?.icon,
        grade: summary?.grade,
        commentNumber: summary?.comment_number,
        validCommentNumber: summary?.valid_comment_number,
        starNumberList: summary?.star_number_list,
        downloadCount: info?.download_count,
      });
    } catch (e) {
      return sendJson(res, 502, { ok: false, error: e.message });
    }
  }

  if (p === "/api/crawl/start" && method === "POST") {
    const body = await readBody(req);
    try {
      const cmd = {
        action: "start",
        gameId: body.gameId || config.defaultGameId,
        cookie: body.cookie || config.cookie,
        pageSize: body.pageSize || config.pageSize,
        rankType: body.rankType || config.rankType,
        delayMs: Math.max(600, Number(body.delayMs || config.delayMs) || 600),
        maxPages: body.maxPages || null,
        mode: body.mode || undefined,
        resume: body.resume,
        saveRaw: !!body.saveRaw,
        dupStop: body.dupStop !== false,
        dupWindow: body.dupWindow || 50,
        dupThreshold: body.dupThreshold || 45,
        jobId: "cmd-" + Date.now(),
        issuedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(ROOT, "data", "_cmd.json"), JSON.stringify(cmd, null, 2), "utf8");
      return sendJson(res, 200, { ok: true, cmd, note: "已写入 data/_cmd.json，由 crawl-daemon 消费" });
    } catch (e) {
      return sendJson(res, 400, { ok: false, error: e.message });
    }
  }

  if (p === "/api/crawl/stop" && method === "POST") {
    const cmd = { action: "stop", issuedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(ROOT, "data", "_cmd.json"), JSON.stringify(cmd, null, 2), "utf8");
    return sendJson(res, 200, { ok: true, cmd });
  }

  if (p === "/api/crawl/status" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const dir = pathsFor(gameId, ROOT).dir;
    const readJ = (f) => {
      for (let i = 0; i < 3; i++) {
        try {
          return JSON.parse(fs.readFileSync(f, "utf8"));
        } catch {
          /* 读到写入中间态则重试 */
        }
      }
      return null;
    };
    const crawl = readJ(path.join(dir, "runtime.crawl.json"));
    const ingest = readJ(path.join(dir, "runtime.ingest.json"));
    const cmd = readJ(path.join(ROOT, "data", "_cmd.json"));
    let queueDepth = 0;
    try {
      queueDepth = fs
        .readdirSync(path.join(ROOT, "data", "_queue"))
        .filter((f) => f.endsWith(".json")).length;
    } catch {
      /* ignore */
    }
    const running = crawl?.status === "running" || (cmd?.action === "start" && crawl?.status !== "stopped" && crawl?.status !== "done");
    const rate = Number(crawl?.ratePerSec) || 0;
    const pageCount = Number(crawl?.pageCount) || 0;
    const donePages = Math.max(0, (Number(crawl?.nextPage) || 1) - 1);
    const remain = Math.max(0, pageCount - donePages);
    const etaSec = rate > 0 && remain > 0 ? Math.round(remain / rate) : null;
    const day = new Date().toISOString().slice(0, 10);
    const tailFile = (f) => {
      try {
        const stt = fs.statSync(f);
        const maxB = 65536;
        const off = Math.max(0, stt.size - maxB);
        const fd = fs.openSync(f, "r");
        try {
          const buf = Buffer.alloc(Math.min(maxB, stt.size));
          fs.readSync(fd, buf, 0, buf.length, off);
          return buf
            .toString("utf8")
            .trim()
            .split("\n")
            .slice(-30)
            .map((line) => {
              const m = /^(\S+)\s+\[(\w+)\]\s+([\s\S]*)$/.exec(line) || [];
              return { ts: m[1] || "", level: (m[2] || "info").toLowerCase(), msg: m[3] || line };
            });
        } finally {
          fs.closeSync(fd);
        }
      } catch {
        return [];
      }
    };
    const logs = [
      ...tailFile(path.join(ROOT, "logs", `crawl-${day}.log`)),
      ...tailFile(path.join(ROOT, "logs", `ingest-${day}.log`)),
    ]
      .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
      .slice(-40);
    return sendJson(res, 200, {
      running,
      gameId,
      title: readGameInfo(gameId, ROOT)?.title || "",
      mode: crawl?.mode || cmd?.mode || "",
      pageNum: crawl?.nextPage,
      pageCount,
      pageSize: crawl?.pageSize,
      sessionPages: crawl?.sessionPages || 0,
      sessionNew: ingest?.sessionNew || 0,
      sessionEnqueued: crawl?.sessionEnqueued || 0,
      crawledCount: ingest?.seenCount || 0,
      seenCount: ingest?.seenCount || 0,
      ratePerSec: rate,
      etaSec,
      queueDepth,
      errorCount: 0,
      lastError: null,
      logs,
      cmdAction: cmd?.action || "",
      statusFile: crawl?.status || "",
    });
  }

  if (p === "/api/comments" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const q = url.searchParams.get("q") || "";
    const grade = url.searchParams.get("grade");
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
    const data = await queryCommentsStream(gameId, ROOT, { q, grade, page, pageSize });
    return sendJson(res, 200, data);
  }

  // B：采集进行中不扫全库；force=1 才全量
  if (p === "/api/stats" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const force = url.searchParams.get("force") === "1";
    const st = crawler.status();
    if (st.running && !force) {
      return sendJson(res, 200, {
        gameId,
        light: true,
        crawlRunning: true,
        stats: crawler.sessionStats?.() || null,
        meta: readGameInfo(gameId, ROOT),
      });
    }
    const stats = await computeStatsStream(gameId, ROOT);
    return sendJson(res, 200, {
      gameId,
      light: false,
      crawlRunning: !!st.running,
      game: readGameInfo(gameId, ROOT),
      full: readCursor(gameId, "full", ROOT),
      update: readCursor(gameId, "update", ROOT),
      stats,
    });
  }

  if (p === "/api/export/csv" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const r = await exportCsv(gameId, ROOT);
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="comments_${gameId}.csv"`,
    });
    fs.createReadStream(r.path).pipe(res);
    return;
  }

  if (p === "/api/export/jsonl" && method === "GET") {
    const gameId = url.searchParams.get("gameId") || config.defaultGameId;
    const fp = pathsFor(gameId, ROOT).jsonl;
    if (!fs.existsSync(fp)) return sendJson(res, 404, { error: "no data" });
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="comments_${gameId}.jsonl"`,
    });
    fs.createReadStream(fp).pipe(res);
    return;
  }

  return sendJson(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (url.pathname === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  logger.info(`B站游戏评论采集控制台: http://127.0.0.1:${PORT}`);
  logger.info(`日志目录: ${logger.dir}`);
  logger.info(`数据目录: ${path.join(ROOT, "data")}`);
});