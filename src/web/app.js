/* 控制台前端 — 0.5s 自动刷新；表单获焦点时不覆盖参数 */
const $ = (sel) => document.querySelector(sel);

const state = {
  page: 1,
  pageSize: 20,
  total: 0,
  gameId: "103496",
  lastRefreshAt: 0,
  samples: [],
  seenLogKeys: new Set(),
};

const FORM_IDS = [
  "gameId",
  "cookie",
  "mode",
  "pageSize",
  "rankType",
  "delayMs",
  "maxPages",
  "dupWindow",
  "dupThreshold",
];

/** 焦点在左侧表单上时，禁止自动刷新写回 */
function isFormFocused() {
  const el = document.activeElement;
  return !!(el && el.id && FORM_IDS.includes(el.id));
}

function gameId() {
  return ($("#gameId").value || "").trim();
}

function fmt(n) {
  if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("zh-CN");
}

function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} 时 ${m} 分`;
  if (m > 0) return `${m} 分 ${r} 秒`;
  return `${r} 秒`;
}

function setConn(ok, text) {
  const el = $("#connBadge");
  el.textContent = text;
  el.className = "badge " + (ok ? "ok" : "err");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function logLine(line) {
  const box = $("#log");
  const div = document.createElement("div");
  div.className = `line ${line.level || "info"}`;
  const ts = (line.ts || new Date().toISOString()).replace("T", " ").slice(0, 19);
  div.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(line.msg || "")}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  while (box.children.length > 500) box.removeChild(box.firstChild);
}

function applyStatus(st) {
  const running = !!(st && st.running);
  $("#btnStart").disabled = running;
  $("#btnStop").disabled = !running;

  const dot = $("#statusDot");
  const text = $("#statusText");
  dot.className = "dot";
  if (!st || (!st.running && !st.gameId)) {
    text.textContent = "空闲";
  } else if (st.stopping) {
    dot.classList.add("paused");
    text.textContent = "正在停止…";
  } else if (running) {
    dot.classList.add("running");
    text.textContent = `采集中 · ${st.mode || ""}`;
  } else if (st.stoppedByDup) {
    dot.classList.add("paused");
    text.textContent = "增量已采完（重复自动停）";
  } else if (st.lastError && st.errorCount >= 8) {
    dot.classList.add("error");
    text.textContent = "异常停止";
  } else if (st.gameId) {
    dot.classList.add("paused");
    text.textContent = "已停止 / 可续爬";
  }

  if (st && st.gameId) {
    const idInput = $("#gameId");
    if (idInput && !idInput.value && !isFormFocused()) idInput.value = st.gameId;
    $("#progressTitle").textContent = st.title || `Game ${st.gameId}`;
    const completed = st.pageCount ? Math.min(st.pageCount, Math.max(0, (st.pageNum || 1) - 1)) : st.sessionPages;
    const pct = st.pageCount ? Math.min(100, (completed / st.pageCount) * 100) : 0;
    $("#pctText").textContent = st.pageCount ? `${pct.toFixed(1)}%` : "—";
    $("#barFg").style.width = `${pct}%`;
    const C = 2 * Math.PI * 52;
    $("#ringFg").style.strokeDashoffset = String(C * (1 - pct / 100));
    $("#mCount").textContent = fmt(st.seenCount ?? st.crawledCount);
    $("#mNew").textContent = fmt(st.sessionNew ?? 0);
    $("#mPage").textContent = st.pageCount
      ? `${fmt(Math.max(0, (st.pageNum || 1) - 1))} / ${fmt(st.pageCount)}`
      : `${fmt(st.sessionPages)} 页`;
    $("#mRate").textContent = st.ratePerSec ?? 0;
    $("#mEta").textContent = fmtEta(st.etaSec);
    state.gameId = st.gameId;
  }
}

function renderCursorBox(stateApi) {
  const full = stateApi?.full;
  const upd = stateApi?.update;
  const lines = [];
  if (full) {
    lines.push(
      `<b>全量</b> 页 ${full.lastCompletedPage || 0}/${full.pageCount || "?"} · ${full.status || ""} · 指纹 ${full.paramsFingerprint || "—"}`
    );
  } else {
    lines.push(`<b>全量</b> 暂无游标`);
  }
  if (upd) {
    lines.push(
      `<b>增量</b> 扫至 ${upd.lastScannedPage || 0} 页 · +${upd.sessionNew || 0} · ${upd.status || ""}`
    );
  } else {
    lines.push(`<b>增量</b> 暂无游标`);
  }
  if (stateApi?.game?.title) {
    lines.push(`游戏 ${escapeHtml(stateApi.game.title)}`);
  }
  $("#cursorBox").innerHTML = lines.join("\n");
}

function renderTrend(samples) {
  // 本次启动后的增量均分：取采样序列末值（ingest 增量写入）
  {
    const pts0 = (samples || []).filter((x) => x && x.avgGrade != null);
    const last = pts0[pts0.length - 1];
    const el = document.querySelector("#mAvg") || document.getElementById("mAvg");
    if (el && last) el.textContent = last.avgGrade;
  }

  // 本次启动后的增量均分：取采样序列末值（ingest 增量写入）
  {
    const pts0 = (samples || []).filter((x) => x && x.avgGrade != null);
    const last = pts0[pts0.length - 1];
    const el = document.querySelector("#mAvg") || document.getElementById("mAvg");
    if (el && last) el.textContent = last.avgGrade;
  }

  // 本次启动后的增量均分：取采样序列末值（ingest 增量写入）
  {
    const pts0 = (samples || []).filter((x) => x && x.avgGrade != null);
    const last = pts0[pts0.length - 1];
    const el = document.querySelector("#mAvg") || document.getElementById("mAvg");
    if (el && last) el.textContent = last.avgGrade;
  }

  // 本次启动后的增量均分：取采样序列末值（ingest 增量写入）
  {
    const pts0 = (samples || []).filter((x) => x && x.avgGrade != null);
    const last = pts0[pts0.length - 1];
    const el = document.querySelector("#mAvg") || document.getElementById("mAvg");
    if (el && last) el.textContent = last.avgGrade;
  }

  state.samples = samples || [];
  const el = $("#gradeTrend");
  const pts = (samples || []).filter((s) => s.avgGrade != null);
  $("#trendMeta").textContent = pts.length
    ? `${pts.length} 个采样 · 最新 ${pts[pts.length - 1].avgGrade}`
    : "暂无采样（采集时每 10s 记录）";
  if (pts.length < 2) {
    el.innerHTML = `<div class="empty">${pts.length ? "采样中…" : "暂无均分曲线"}</div>`;
    return;
  }
  const w = 600;
  const h = 120;
  const grades = pts.map((p) => Number(p.avgGrade));
  let min = Math.min(...grades);
  let max = Math.max(...grades);
  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.1;
  min -= pad;
  max += pad;
  const xs = pts.map((_, i) => (i / (pts.length - 1)) * w);
  const ys = pts.map((p) => h - ((Number(p.avgGrade) - min) / (max - min)) * h);
  const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  const last = pts[pts.length - 1];
  const first = pts[0];
  el.innerHTML = `
    <div class="trend-axis"><span>${max.toFixed(2)}</span><span>${min.toFixed(2)}</span></div>
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="tg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#00A1D6" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#00A1D6" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#tg)"/>
      <path d="${path}" fill="none" stroke="#4FD1FF" stroke-width="2"/>
      <circle cx="${xs[xs.length - 1]}" cy="${ys[ys.length - 1]}" r="3.5" fill="#3DDC97"/>
    </svg>
    <div class="trend-x">
      <span>${new Date(first.ts || first.iso || Date.now()).toLocaleTimeString()}</span>
      <span>均分 ${first.avgGrade} → ${last.avgGrade}</span>
      <span>${new Date(last.ts || last.iso || Date.now()).toLocaleTimeString()}</span>
    </div>`;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}

async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    $("#gameId").value = cfg.defaultGameId || "103496";
    $("#pageSize").value = cfg.pageSize ?? 20;
    $("#rankType").value = cfg.rankType ?? 3;
    $("#delayMs").value = Math.max(800, cfg.delayMs ?? 800);
    $("#cookieState").textContent = cfg.hasCookie ? cfg.cookiePreview : "未保存 Cookie";
    state.gameId = cfg.defaultGameId || "103496";
  } catch (e) {
    setConn(false, "服务未连接");
    logLine({ level: "error", msg: `无法读取配置：${e.message}` });
  }
}

async function saveCookie() {
  const cookie = $("#cookie").value;
  const body = {
    cookie,
    defaultGameId: gameId(),
    pageSize: Number($("#pageSize").value) || 20,
    rankType: Number($("#rankType").value) || 3,
    delayMs: Math.max(600, Number($("#delayMs").value) || 600),
  };
  await api("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const cfg = await api("/api/config");
  $("#cookieState").textContent = cfg.hasCookie ? cfg.cookiePreview : "未保存 Cookie";
  logLine({ level: "info", msg: "Cookie / 参数已保存到 config.local.json" });
}

async function previewGame() {
  const id = gameId();
  if (!id) return alert("请填写 gameId");
  const data = await api(`/api/game/preview?gameId=${encodeURIComponent(id)}`);
  $("#gameCard").classList.remove("hidden");
  if (data.icon) {
    const icon = $("#gameIcon");
    icon.src = data.icon.startsWith("//") ? "https:" + data.icon : data.icon;
  }
  $("#gameTitle").textContent = data.title || id;
  $("#gameMeta").textContent = `评分 ${data.grade ?? "—"} · 评论 ${fmt(data.commentNumber)} · 下载 ${fmt(data.downloadCount)}`;
  logLine({ level: "info", msg: `预览 ${data.title || id}：评论 ${fmt(data.commentNumber)}，均分 ${data.grade}` });
}

async function startCrawl() {
  const id = gameId();
  if (!id) return alert("请填写 gameId");
  const maxPagesRaw = $("#maxPages").value.trim();
  const mode = $("#mode").value;
  const payload = {
    gameId: id,
    mode,
    cookie: $("#cookie").value.trim() || undefined,
    pageSize: Number($("#pageSize").value) || 20,
    rankType: Number($("#rankType").value) || 3,
    delayMs: Math.max(600, Number($("#delayMs").value) || 600),
    maxPages: maxPagesRaw ? Number(maxPagesRaw) : null,
    saveRaw: $("#saveRaw").checked,
    dupStop: $("#dupStop").checked,
    dupWindow: Number($("#dupWindow").value) || 50,
    dupThreshold: Number($("#dupThreshold").value) || 45,
  };
  await api("/api/crawl/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  logLine({ level: "info", msg: `已发起采集 mode=${mode}` });
}

async function stopCrawl() {
  await api("/api/crawl/stop", { method: "POST" });
  logLine({ level: "warn", msg: "已请求停止" });
}

async function refreshStatus() {
  if (isFormFocused()) return;
  try {
    const st = await api("/api/crawl/status");
    applyStatus(st);
    if (Array.isArray(st.logs) && st.logs.length) {
      const box = $("#log");
      for (const line of st.logs) {
        const key = `${line.ts}|${line.msg}`;
        if (state.seenLogKeys.has(key)) continue;
        state.seenLogKeys.add(key);
        logLine(line);
      }
    }
  } catch {
    /* ignore */
  }
}

async function refreshState() {
  if (isFormFocused()) return;
  try {
    const st = await api(`/api/state?gameId=${encodeURIComponent(gameId() || state.gameId)}`);
    renderCursorBox(st);
    if (st.game?.title) $("#progressTitle").textContent = st.game.title;
  } catch {
    /* ignore */
  }
}

async function refreshGames() {
  try {
    const data = await api("/api/games");
    const ul = $("#gameList");
    ul.innerHTML = "";
    if (!data.games.length) {
      ul.innerHTML = `<li style="cursor:default;color:var(--muted);font-size:12px">暂无已采集游戏</li>`;
      return;
    }
    for (const g of data.games) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div>
          <div class="name">${escapeHtml(g.title || g.gameId)}</div>
          <div class="meta">id=${escapeHtml(g.gameId)} · ${fmt(g.commentCount)} 条 · ${escapeHtml(g.status)}</div>
        </div>
        <span class="meta">打开</span>`;
      li.onclick = () => {
        $("#gameId").value = g.gameId;
        state.gameId = g.gameId;
        loadStats(true);
        loadTimeline();
        refreshState();
        previewGame().catch(() => {});
      };
      ul.appendChild(li);
    }
  } catch {
    /* ignore */
  }
}


async function loadStats(force = false) {
  try {
    const q = force ? "&force=1" : "";
    const data = await api(`/api/stats?gameId=${encodeURIComponent(gameId() || state.gameId)}${q}`);
    const s = data.stats || {};
    const apiGrade = data.game?.summary?.grade ?? s.avgGrade;
    $("#sAvg").textContent = apiGrade ?? "—";
    $("#sUsers").textContent = fmt(s.uniqueUsers);
    $("#sRange").textContent = s.timeRange?.min
      ? `${s.timeRange.min.slice(0, 10)} → ${s.timeRange.max?.slice(0, 10) || ""}`
      : "—";
    $("#sVotes").textContent = `${fmt(s.totalUp)} / ${fmt(s.totalDown)}`;

    const chart = $("#gradeChart");
    chart.innerHTML = "";
    const dist = s.gradeDist || [];
    const max = Math.max(1, ...dist);
    for (let g = 0; g <= 10; g++) {
      const v = dist[g] || 0;
      const el = document.createElement("div");
      el.className = "gbar";
      el.title = `${g} 分：${fmt(v)}`;
      el.innerHTML = `<div class="bar" style="height:${Math.max(2, (v / max) * 100)}%"></div><div class="lab">${g}</div>`;
      chart.appendChild(el);
    }
  } catch {
    /* ignore */
  }
}

async function loadTimeline() {
  try {
    const data = await api(`/api/timeline?gameId=${encodeURIComponent(gameId() || state.gameId)}&limit=500`);
    renderTrend(data.samples || []);
  } catch {
    /* ignore */
  }
}

function bindEvents() {
  $("#btnPreview").onclick = () => previewGame().catch((e) => alert(e.message));
  $("#btnSaveCookie").onclick = () => saveCookie().catch((e) => alert(e.message));
  $("#btnStart").onclick = () => startCrawl().catch((e) => alert(e.message));
  $("#btnStop").onclick = () => stopCrawl().catch((e) => alert(e.message));
  $("#btnClearLog").onclick = () => { $("#log").innerHTML = ""; };
}

async function boot() {
  await loadConfig();
  await loadStats(false);
  refreshGames();
  tick();
  setInterval(tick, 1500);
  setInterval(refreshGames, 20000);
}

boot();
