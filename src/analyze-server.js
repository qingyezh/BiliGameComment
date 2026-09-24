/**
 * 分析端独立服务（默认 8788）——只读 data/，不占用采集端 8787
 * 启动: node analyze-server.js
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import {
  buildCrossGame,
  buildFactors,
  buildKeywords,
  buildSeries,
  expandEntry,
  findHits,
  hitContext,
  loadKeywords,
  mapGrade,
  readComments,
} from "./lib/analyze.js";
import { buildCrossDist } from "./lib/cross-dist.js";
import { fingerprintOf, commentsPath, withCache } from "./lib/cache.js";
import { fastSeries } from "./lib/series-fast.js";
import { rustWordFreq, rustFactors, rustKeywords, rustCrossDist, rustAvailable } from "./lib/rust-analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', 'app');
const PORT = Number(process.env.ANALYZE_PORT) || 8788;
const cache = new Map();
const wordProgress = { gameId: "", n: 0, running: false, done: false };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function sendJson(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function q(url, key, def = "") {
  return url.searchParams.get(key) ?? def;
}

function wantRefresh(url) {
  const v = q(url, "refresh", "");
  return v === "1" || v === "true";
}

function withDisk(cacheKey, fp, compute, force = false) {
  const t0 = Date.now();
  return withCache(ROOT, cacheKey, fp, compute, force).then((payload) => {
    const ms = Date.now() - t0;
    const hit = !force && ms < 8;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ...payload, profile: { ms, hit, force: !!force, ...(payload.profile || {}) } };
    }
    return payload;
  });
}

function runWordFreqWorker(opts) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(ROOT, "lib", "wordfreq-worker.js"), { workerData: opts });
    w.on("message", (m) => {
      if (m.type === "progress") wordProgress.n = m.n;
      else if (m.type === "done") {
        wordProgress.running = false;
        wordProgress.done = true;
        resolve(m.data);
      } else if (m.type === "error") {
        wordProgress.running = false;
        reject(new Error(m.message));
      }
    });
    w.on("error", reject);
  });
}

function listGameIds() {
  const base = path.join(ROOT, "data");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => d.name);
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const grain = q(url, "grain", "month");
  const from = q(url, "from", "");
  const to = q(url, "to", "");

  if (p === "/api/health") return sendJson(res, 200, { ok: true });

  if (p === "/api/games") {
    const ids = listGameIds();
    const games = [];
    for (const id of ids) {
      const metaPath = path.join(ROOT, "data", id, "meta.json");
      const gamePath = path.join(ROOT, "data", id, "game.json");
      let title = id;
      for (const fp2 of [metaPath, gamePath]) {
        try {
          const j = JSON.parse(fs.readFileSync(fp2, "utf8"));
          const info = j.gameinfo || j.gameInfo || j;
          const t =
            j.title || info.title || info.game_name || info.name || info.gameName || info.game_title;
          if (t && String(t).trim()) {
            title = String(t).trim();
            break;
          }
        } catch {
          /* try next */
        }
      }
      games.push({ gameId: id, title: String(title) });
    }
    return sendJson(res, 200, { games });
  }

  if (p === "/api/games/refresh-title") {
    const { fetchGameInfo } = await import("./lib/api.js");
    const { writeGameInfo } = await import("./lib/store.js");
    const updated = [];
    for (const id of listGameIds()) {
      const metaPath = path.join(ROOT, "data", id, "meta.json");
      const gamePath = path.join(ROOT, "data", id, "game.json");
      let hasTitle = false;
      for (const fp2 of [metaPath, gamePath]) {
        try {
          const j = JSON.parse(fs.readFileSync(fp2, "utf8"));
          const info = j.gameinfo || j;
          if (j.title || info.title || info.game_name || info.name) {
            hasTitle = true;
            break;
          }
        } catch {}
      }
      if (hasTitle) continue;
      try {
        const info = await fetchGameInfo(id, q(url, "cookie", ""));
        if (info) {
          writeGameInfo(id, info, ROOT);
          updated.push({ gameId: id, title: info.title || info.game_name || id });
        }
      } catch (e) {
        updated.push({ gameId: id, error: e.message });
      }
    }
    return sendJson(res, 200, { updated });
  }

  if (p === "/api/keywords") {
    const dict = loadKeywords(ROOT);
    return sendJson(res, 200, { names: Object.keys(dict), expanded: dict });
  }

  if (p === "/api/wordfreq/status") {
    return sendJson(res, 200, { ...wordProgress });
  }

  if (p === "/api/wordfreq") {
    const gameId = q(url, "gameId");
    const limit = Math.min(500, Math.max(50, Number(q(url, "limit", "300")) || 300));
    const source = q(url, "source", "both") || "both";
    const sample = Math.max(0, Number(q(url, "sample", "0")) || 0);
    const force = wantRefresh(url);
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `wf|${gameId}|${grain}|${from}|${to}|${limit}|${source}|${sample}`;
    let data = await withDisk(key, fp, async () => {
      const file = commentsPath(ROOT, gameId);
      const t0 = Date.now();
      const r = rustWordFreq(file, { source, limit });
      return {
        gameId,
        source,
        words: r.words || [],
        types: r.types || 0,
        scanned: r.scanned || 0,
        profile: { backend: "rust", scanMs: Date.now() - t0 },
      };
    }, force);
    return sendJson(res, 200, data);
  }

  if (p === "/api/series") {
    const gameId = q(url, "gameId");
    const keyword = q(url, "keyword", "") || null;
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `ser|${gameId}|${grain}|${from}|${to}|${keyword}`;
    const t0 = Date.now();
    let data;
    let backend = "js";
    if (!keyword) {
      backend = "rust";
      data = await withDisk(key, fp, () => {
        const out = fastSeries(ROOT, gameId, { grain, from, to });
        return { grain: out.grain, periods: out.periods, rows: out.rows, profile: out.profile };
      }, wantRefresh(url));
    } else {
      data = await withDisk(
        key,
        fp,
        () => buildSeries(gameId, ROOT, { grain, from, to, keyword }),
        wantRefresh(url)
      );
    }
    const ms = Date.now() - t0;
    return sendJson(res, 200, { gameId, ...data, profile: { ms, backend, ...(data.profile || {}) } });
  }

  if (p === "/api/factors") {
    const gameId = q(url, "gameId");
    const factor = q(url, "factor", "play_duration");
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `fac|${gameId}|${grain}|${from}|${to}|${factor}`;
    const data = await withDisk(
      key,
      fp,
      () => {
        const t0 = Date.now();
        if (factor === "play_duration") {
          const r = rustFactors(commentsPath(ROOT, gameId), { grain, from, to });
          const mapAcc = (a) => ({
            bucket: a.bucket,
            n: a.n,
            avg: a.n ? +(a.sum / a.n).toFixed(4) : null,
            zero_ratio: a.n ? +(a.zero / a.n).toFixed(4) : null,
          });
          const overall = (r.overall || []).map(mapAcc);
          return {
            gameId,
            grain,
            factor,
            buckets: overall.map((x) => x.bucket),
            overall,
            series: (r.series || []).map((row) => ({
              period: row.period,
              buckets: (row.buckets || []).map(mapAcc),
            })),
            profile: { backend: "rust", scanMs: Date.now() - t0 },
          };
        }
        return buildFactors(gameId, ROOT, { grain, factor, from, to }).then((d) => ({
          ...d,
          profile: { backend: "js", scanMs: Date.now() - t0 },
        }));
      },
      wantRefresh(url)
    );
    return sendJson(res, 200, { gameId, ...data });
  }

  if (p === "/api/keywords/series") {
    const gameId = q(url, "gameId");
    const only = url.searchParams.getAll("name");
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `kw|${gameId}|${grain}|${from}|${to}|${only.join(",")}`;
    const data = await withDisk(
      key,
      fp,
      () => {
        const t0 = Date.now();
        const dict = loadKeywords(ROOT);
        const aliases = expandEntry(dict, only[0] || "") || [];
        const r = rustKeywords(commentsPath(ROOT, gameId), {
          name: only[0] || "",
          aliases,
          grain,
          from,
          to,
        });
        return { gameId, grain, ...r, profile: { backend: "rust", scanMs: Date.now() - t0 } };
      },
      wantRefresh(url)
    );
    return sendJson(res, 200, { gameId, ...data });
  }

  if (p === "/api/keywords/hits") {
    const gameId = q(url, "gameId");
    const name = q(url, "name");
    const page = Math.max(1, Number(q(url, "page", "1")) || 1);
    const pageSize = Math.min(50, Number(q(url, "pageSize", "20")) || 20);
    const force = wantRefresh(url);
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `kh|${gameId}|${name}|${grain}|${from}|${to}|${page}|${pageSize}`;
    const data = await withDisk(
      key,
      fp,
      async () => {
        const dict = loadKeywords(ROOT);
        const list = expandEntry(dict, name);
        const rows = [];
        for await (const c of readComments(gameId, ROOT)) {
          const pk = (c.publish_time || "").slice(0, grain === "day" ? 10 : 7);
          if (!pk) continue;
          const fromKey = grain === "day" && from && from.length === 7 ? from + "-01" : from;
          const toKey = grain === "day" && to && to.length === 7 ? to + "-31" : to;
          if (fromKey && pk < fromKey) continue;
          if (toKey && pk > toKey) continue;
          const text = c.content || "";
          const hits = findHits(text, list);
          if (!hits.length) continue;
          rows.push({
            comment_no: c.comment_no,
            publish_time: c.publish_time,
            grade_mapped: mapGrade(c.grade),
            user_name: c.user_name,
            hit_words: hits.map((h) => h.word).slice(0, 8),
            content: hitContext(text, hits, 22),
          });
        }
        rows.sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time)));
        const total = rows.length;
        const start = (page - 1) * pageSize;
        return { name, total, page, pageSize, items: rows.slice(start, start + pageSize) };
      },
      force
    );
    return sendJson(res, 200, data);
  }

  if (p === "/api/cross") {
    const gameIds = url.searchParams.getAll("gameId");
    const ids = gameIds.length ? gameIds : listGameIds();
    const fp = fingerprintOf(ids.map((g) => commentsPath(ROOT, g)));
    const key = `cross|${ids.join(",")}|${grain}|${from}|${to}`;
    const data = await withDisk(
      key,
      fp,
      () => buildCrossGame(ids, ROOT, { grain, from, to }),
      wantRefresh(url)
    );
    return sendJson(res, 200, data);
  }

  if (p === "/api/cross/dist") {
    const src = q(url, "sourceGame") || q(url, "fromGame") || q(url, "gameId");
    const tgt = q(url, "targetGame") || q(url, "toGame") || q(url, "gameId2");
    const fp = fingerprintOf([commentsPath(ROOT, src), commentsPath(ROOT, tgt)]);
    const key = `cdist|${src}|${tgt}|${grain}|${from}|${to}`;
    const data = await withDisk(
      key,
      fp,
      () => {
        const t0 = Date.now();
        const r = rustCrossDist(commentsPath(ROOT, src), commentsPath(ROOT, tgt), {
          grain,
          from,
          to,
        });
        return {
          ...r,
          sourceGame: src,
          targetGame: tgt,
          grain,
          profile: { backend: "rust", scanMs: Date.now() - t0 },
        };
      },
      wantRefresh(url)
    );
    return sendJson(res, 200, data);
  }

  if (p === "/api/samples") {
    const gameId = q(url, "gameId");
    const grade = q(url, "grade", "");
    const kw = q(url, "keyword", "");
    const page = Math.max(1, Number(q(url, "page", "1")) || 1);
    const pageSize = Math.min(50, Number(q(url, "pageSize", "20")) || 20);
    const force = wantRefresh(url);
    const fp = fingerprintOf(commentsPath(ROOT, gameId));
    const key = `sp|${gameId}|${grade}|${kw}|${from}|${to}|${page}|${pageSize}`;
    const data = await withDisk(
      key,
      fp,
      async () => {
        const rows = [];
        for await (const c of readComments(gameId, ROOT)) {
          const gm = mapGrade(c.grade);
          if (grade !== "" && String(gm) !== String(grade)) continue;
          if (kw && !(c.content || "").includes(kw)) continue;
          if (from && (c.publish_time || "").slice(0, 7) < from) continue;
          if (to && (c.publish_time || "").slice(0, 7) > to) continue;
          rows.push({
            comment_no: c.comment_no,
            grade_mapped: gm,
            grade_raw: c.grade,
            publish_time: c.publish_time,
            user_name: c.user_name,
            user_level: c.user_level,
            play_duration: c.play_duration,
            device_type: c.device_type,
            content_len: (c.content || "").length,
            content: (c.content || "").slice(0, 200),
            up_count: c.up_count,
          });
        }
        rows.sort((a, b) => String(b.publish_time).localeCompare(String(a.publish_time)));
        const total = rows.length;
        const start = (page - 1) * pageSize;
        return { total, page, pageSize, items: rows.slice(start, start + pageSize) };
      },
      force
    );
    return sendJson(res, 200, data);
  }

  return sendJson(res, 404, { error: "not found" });
}

function serveStatic(res, urlPath) {
  if (urlPath === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (urlPath === "/" || urlPath === "/analyze.html") {
    for (const p of [
      path.join(ROOT, "dist", "src", "web", "analyze.html"),
      path.join(ROOT, "dist", "analyze.html"),
    ]) {
      if (fs.existsSync(p)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        fs.createReadStream(p).pipe(res);
        return;
      }
    }
  }
  if (urlPath.startsWith("/assets/")) {
    const distFile = path.join(ROOT, "dist", urlPath);
    if (
      distFile.startsWith(path.join(ROOT, "dist")) &&
      fs.existsSync(distFile) &&
      fs.statSync(distFile).isFile()
    ) {
      const ext = path.extname(distFile).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(distFile).pipe(res);
      return;
    }
  }
  let rel = urlPath === "/" ? "/analyze.html" : urlPath;
  rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end("Not Found");
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
      if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
      else serveStatic(res, url.pathname);
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  })
  .listen(PORT, () => {
    console.log(`分析端: http://127.0.0.1:${PORT}`);
  });
