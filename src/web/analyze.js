import {
  PALETTE,
  bindChartExport,
  createChart,
  exportRowsCsv,
} from "./charts.js";

const $ = (s) => document.querySelector(s);
const apiBase = () => `http://127.0.0.1:${location.port || 8788}`;

const state = {
  grain: "month",
  tab: "series",
  series: null,
  factors: null,
  keywords: null,
  cross: null,
  factor: "play_duration",
  keyword: "",
};

const charts = {
  ser: null,
  star: null,
  fac: null,
  kw: null,
  cross: null,
};

function meanRow(cols, values) {
  // cols: [{key, type:'n'|'avg'|'pct'|'int'}]
  const cells = cols.map((c) => {
    const nums = values.map((r) => r[c.key]).filter((v) => v != null && Number.isFinite(Number(v)));
    if (!nums.length) return "—";
    const mu = nums.reduce((a, b) => a + Number(b), 0) / nums.length;
    if (c.type === "pct") return (mu * 100).toFixed(2) + "%";
    if (c.type === "n" || c.type === "int") return mu.toFixed(2);
    return mu.toFixed(2);
  });
  return `<tr class="mean-row"><td>均值</td>${cells.map((x) => `<td class="num">${x}</td>`).join("")}</tr>`;
}

function bindMeanToggle(toggleId, chart) {
  const el = document.querySelector(toggleId);
  if (!el || !chart) return;
  el.checked = chart.getShowMean();
  el.onchange = () => chart.setShowMean(el.checked);
}

function grain() {
  return state.grain;
}
function from() {
  return $("#from").value || undefined;
}
function to() {
  // month input: 2026-09 → day grain use prefix compare in API
  return $("#to").value || undefined;
}
function gameId() {
  return $("#gameId").value;
}

async function api(path, params = {}) {
  const u = new URL(apiBase() + path);
  u.searchParams.set("grain", grain());
  if (from()) u.searchParams.set("from", from());
  if (to()) u.searchParams.set("to", to());
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else u.searchParams.set(k, v);
  }
  const res = await fetch(u);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(d);
}

function deltaClass(v) {
  if (v == null) return "";
  return v > 0 ? "pos" : v < 0 ? "neg" : "";
}

async function loadGames() {
  const data = await api("/api/games");
  const opts = data.games
    .map((g) => `<option value="${g.gameId}">${g.gameId} · ${escapeHtml(g.title)}</option>`)
    .join("");
  $("#gameId").innerHTML = opts;
  $("#gameId2").innerHTML = `<option value="">（可选）</option>` + opts;
  if (data.games[0]) $("#gameId").value = data.games[0].gameId;
  if (data.games[1]) $("#gameId2").value = data.games[1].gameId;
}

const GAME_KEYS = [
  "原神",
  "崩坏：星穹铁道",
  "绝区零",
  "崩坏3",
  "鸣潮",
  "明日方舟",
  "重返未来1999",
  "幻塔",
  "战双帕弥什",
  "蔚蓝档案",
  "FGO",
  "碧蓝航线",
  "少女前线",
  "尘白禁区",
];

async function loadKeywordDict() {
  const data = await api("/api/keywords");
  const names = data.names || Object.keys(data.dict || {});
  state.kwExpanded = data.expanded || {};
  const gameNames = GAME_KEYS.filter((g) => names.includes(g));
  const other = names.filter((n) => n !== "任一主流二游" && !gameNames.includes(n));
  const groups = [];
  if (names.includes("任一主流二游")) {
    groups.push(`<optgroup label="汇总">${gameOption("任一主流二游")}</optgroup>`);
  }
  if (gameNames.length) {
    groups.push(`<optgroup label="具体游戏（含别名）">${gameNames.map(gameOption).join("")}</optgroup>`);
  }
  if (other.length) {
    groups.push(`<optgroup label="其他词条">${other.map(gameOption).join("")}</optgroup>`);
  }
  $("#kwSel").innerHTML = groups.join("");
  const first = names.includes("任一主流二游") ? "任一主流二游" : names[0];
  if (first) {
    $("#kwSel").value = first;
    state.keyword = first;
  }
  updateKwMeta();
}

function gameOption(n) {
  const words = state.kwExpanded?.[n] || [];
  const hint = words.length ? `（${words.length} 个别名）` : "";
  return `<option value="${escapeHtml(n)}">${escapeHtml(n)}${hint}</option>`;
}

function updateKwMeta() {
  const n = state.keyword;
  const words = state.kwExpanded?.[n] || [];
  const el = $("#kwMeta");
  if (!el) return;
  el.textContent = n
    ? `词条「${n}」匹配 ${words.length} 个别名：${words.slice(0, 12).join(" / ")}${words.length > 12 ? " …" : ""}`
    : "";
}

function renderKpis(rows) {
  if (!rows || !rows.length) {
    $("#kAvg").textContent = "—";
    $("#kDelta").textContent = "—";
    $("#kN").textContent = "—";
    $("#kZero").textContent = "—";
    return;
  }
  const last = rows[rows.length - 1];
  $("#kAvg").textContent = fmt(last.avg, 2);
  const d = last.delta_avg;
  $("#kDelta").textContent = d == null ? "—" : (d > 0 ? "+" : "") + fmt(d, 2);
  $("#kDelta").className = deltaClass(d);
  $("#kN").textContent = String(last.n);
  $("#kZero").textContent = last.zero_ratio == null ? "—" : (last.zero_ratio * 100).toFixed(2) + "%";
}

function renderSeries(data) {
  state.series = data;
  const rows = data.rows || [];
  renderKpis(rows);
  const labels = rows.map((r) => r.period);
  const series = [
    {
      name: "局部均分",
      color: PALETTE[0],
      values: rows.map((r) => r.avg),
    },
    {
      name: "累计均分",
      color: "#94a3b8",
      values: rows.map((r) => r.cum_avg),
    },
  ];
  charts.ser.update({ labels, series, kind: "line", yDomain: { yMin: 0, yMax: 10 } });

  $("#serTbody").innerHTML = rows
    .slice()
    .reverse()
    .map(
      (r) => `<tr>
      <td class="mono">${r.period}</td>
      <td class="num">${r.n}</td>
      <td class="num">${fmt(r.avg, 2)}</td>
      <td class="num ${deltaClass(r.delta_avg)}">${r.delta_avg == null ? "—" : (r.delta_avg > 0 ? "+" : "") + fmt(r.delta_avg, 2)}</td>
      <td class="num">${fmt(r.cum_avg, 2)}</td>
      <td class="num">${r.zero_ratio == null ? "—" : (r.zero_ratio * 100).toFixed(2) + "%"}</td>
      <td class="num">${r.star5 ?? 0}</td>
      <td class="num">${r.star4 ?? 0}</td>
      <td class="num">${r.star3 ?? 0}</td>
      <td class="num">${r.star2 ?? 0}</td>
      <td class="num">${r.star1 ?? 0}</td>
    </tr>`
    )
    .join("");
  $("#serTbody").insertAdjacentHTML(
    "beforeend",
    meanRow(
      [
        { key: "n", type: "n" },
        { key: "avg", type: "avg" },
        { key: "delta_avg", type: "avg" },
        { key: "cum_avg", type: "avg" },
        { key: "zero_ratio", type: "pct" },
        { key: "star5", type: "int" },
        { key: "star4", type: "int" },
        { key: "star3", type: "int" },
        { key: "star2", type: "int" },
        { key: "star1", type: "int" },
      ],
      rows
    )
  );

  // 星级分组柱
  charts.star.update({
    labels,
    kind: "bar",
    yDomain: null,
    series: [
      { name: "★5", color: PALETTE[0], values: rows.map((r) => r.star5) },
      { name: "★4", color: PALETTE[1], values: rows.map((r) => r.star4) },
      { name: "★3", color: PALETTE[2], values: rows.map((r) => r.star3) },
      { name: "★2", color: PALETTE[3], values: rows.map((r) => r.star2) },
      { name: "★1", color: PALETTE[4], values: rows.map((r) => r.star1) },
    ],
  });

  bindChartExport(
    $("#serCsv"),
    $("#serPng"),
    $("#serCanvas"),
    () => ({
      columns: ["period", "n", "avg", "delta_avg", "cum_avg", "zero_ratio", "star5", "star4", "star3", "star2", "star1"],
      rows,
    }),
    `series_${gameId()}_${grain()}`
  );
  bindChartExport(
    null,
    $("#starPng"),
    $("#starCanvas"),
    () => ({
      columns: ["period", "star5", "star4", "star3", "star2", "star1"],
      rows,
    }),
    `stars_${gameId()}_${grain()}`
  );
  $("#serTableCsv").onclick = () =>
    exportRowsCsv(
      `series_table_${gameId()}_${grain()}.csv`,
      ["period", "n", "avg", "delta_avg", "cum_avg", "zero_ratio", "star5", "star4", "star3", "star2", "star1"],
      rows
    );
  $("#starCsv").onclick = () =>
    exportRowsCsv(`stars_${gameId()}_${grain()}.csv`, ["period", "star5", "star4", "star3", "star2", "star1"], rows);
}

function renderFactors(data) {
  state.factors = data;
  const rows = data.series || [];
  const labels = rows.map((r) => r.period);
  const buckets = data.buckets || [];
  const series = buckets.map((b, i) => ({
    name: b,
    color: PALETTE[i % PALETTE.length],
    values: rows.map((r) => {
      const x = (r.buckets || []).find((z) => z.bucket === b);
      return x ? x.avg : null;
    }),
  }));
  charts.fac.update({ labels, series, kind: "line", yDomain: { yMin: 0, yMax: 10 } });

  $("#facTbody").innerHTML = (data.overall || [])
    .map(
      (r) => `<tr><td>${escapeHtml(r.bucket)}</td><td class="num">${r.n}</td><td class="num">${fmt(r.avg, 2)}</td><td class="num">${r.zero_ratio == null ? "—" : (r.zero_ratio * 100).toFixed(2) + "%"}</td></tr>`
    )
    .join("");
  $("#facTbody").insertAdjacentHTML(
    "beforeend",
    meanRow(
      [
        { key: "n", type: "n" },
        { key: "avg", type: "avg" },
        { key: "zero_ratio", type: "pct" },
      ],
      data.overall || []
    )
  );

  const flat = [];
  for (const r of rows) {
    for (const b of r.buckets || []) {
      flat.push({ period: r.period, ...b });
    }
  }
  bindChartExport(
    $("#facCsv"),
    $("#facPng"),
    $("#facCanvas"),
    () => ({ columns: ["period", "bucket", "n", "avg", "zero_ratio"], rows: flat }),
    `factor_${data.factor}_${gameId()}_${grain()}`
  );
  $("#facTableCsv").onclick = () =>
    exportRowsCsv(`factor_overall_${data.factor}.csv`, ["bucket", "n", "avg", "zero_ratio"], data.overall || []);
}

function renderKeywords(data) {
  state.keywords = data;
  const name = state.keyword || data.names?.[0];
  updateKwMeta();
  const rows = data.periods || [];
  const labels = rows.map((r) => r.period);
  const get = (r) => (r.keywords && r.keywords[name]) || {};
  const series = [
    {
      name: "命中均分",
      color: PALETTE[0],
      values: rows.map((r) => get(r).hit_avg),
    },
    {
      name: "未命中均分",
      color: PALETTE[1],
      values: rows.map((r) => get(r).miss_avg),
    },
    {
      name: "Δ 命中−未命中",
      color: PALETTE[3],
      values: rows.map((r) => get(r).delta_hit),
    },
  ];
  // 右轴：命中率（默认 0–50%；任一点 >50% 则 0–100%）
  const hitRates = rows.map((r) => get(r).hit_rate).filter((v) => v != null && Number.isFinite(Number(v)));
  const maxHit = hitRates.length ? Math.max(...hitRates.map(Number)) : 0;
  const rightSeries = [
    {
      name: "命中率",
      color: "#0ea5e9",
      format: "pct",
      values: rows.map((r) => get(r).hit_rate),
    },
  ];
  charts.kw.update({
    labels,
    series,
    rightSeries,
    kind: "line",
    yDomain: { yMin: -5, yMax: 10 },
    yRightDomain: maxHit > 0.5 ? { yMin: 0, yMax: 1 } : { yMin: 0, yMax: 0.5 },
  });

  $("#kwTbody").innerHTML = rows
    .slice()
    .reverse()
    .map((r) => {
      const k = get(r);
      return `<tr>
        <td class="mono">${r.period}</td>
        <td class="num">${k.hit_n ?? 0}</td>
        <td class="num">${k.hit_rate == null ? "—" : (k.hit_rate * 100).toFixed(2) + "%"}</td>
        <td class="num">${fmt(k.hit_avg, 2)}</td>
        <td class="num">${fmt(k.miss_avg, 2)}</td>
        <td class="num ${deltaClass(k.delta_hit)}">${k.delta_hit == null ? "—" : (k.delta_hit > 0 ? "+" : "") + fmt(k.delta_hit, 2)}</td>
      </tr>`;
    })
    .join("");

  const flat = rows.map((r) => {
    const k = get(r);
    return {
      period: r.period,
      hit_n: k.hit_n,
      hit_rate: k.hit_rate,
      hit_avg: k.hit_avg,
      miss_avg: k.miss_avg,
      delta_hit: k.delta_hit,
    };
  });
  $("#kwTbody").insertAdjacentHTML(
    "beforeend",
    meanRow(
      [
        { key: "hit_n", type: "n" },
        { key: "hit_rate", type: "pct" },
        { key: "hit_avg", type: "avg" },
        { key: "miss_avg", type: "avg" },
        { key: "delta_hit", type: "avg" },
      ],
      flat
    )
  );
  bindChartExport(
    $("#kwCsv"),
    $("#kwPng"),
    $("#kwCanvas"),
    () => ({
      columns: ["period", "hit_n", "hit_rate", "hit_avg", "miss_avg", "delta_hit"],
      rows: flat,
    }),
    `keyword_${name}_${gameId()}_${grain()}`
  );
  $("#kwTableCsv").onclick = () =>
    exportRowsCsv(`keyword_table_${name}.csv`, ["period", "hit_n", "hit_rate", "hit_avg", "miss_avg", "delta_hit"], flat);
}

function renderCross(data) {
  state.cross = data;
  const games = data.games || [];
  // align periods
  const periodSet = new Set();
  for (const g of games) {
    for (const r of data.series[g] || []) periodSet.add(r.period);
  }
  const labels = [...periodSet].sort();
  const titleMap = Object.fromEntries(
    [...$("#gameId").options, ...$("#gameId2").options].map((o) => [
      o.value,
      (o.textContent.split("·")[1] || o.textContent).trim(),
    ])
  );
  const series = games.map((g, i) => ({
    name: titleMap[g] || g,
    color: PALETTE[i % PALETTE.length],
    values: labels.map((p) => {
      const r = (data.series[g] || []).find((x) => x.period === p);
      return r ? r.avg : null;
    }),
  }));
  charts.cross.update({ labels, series, kind: "line", yDomain: { yMin: 0, yMax: 10 } });

  const flat = [];
  for (const g of games) {
    for (const r of data.series[g] || []) {
      flat.push({ game: g, period: r.period, n: r.n, avg: r.avg, zero_ratio: r.zero_ratio });
    }
  }
  bindChartExport(
    $("#crossCsv"),
    $("#crossPng"),
    $("#crossCanvas"),
    () => ({ columns: ["game", "period", "n", "avg", "zero_ratio"], rows: flat }),
    `cross_${grain()}`
  );

  $("#crossTbody").innerHTML = `
    <tr><td>对比游戏</td><td>${games.map(escapeHtml).join(" vs ")}</td></tr>
    <tr><td>重合 uid 数</td><td class="num">${data.overlapUsers ?? 0}</td></tr>
    <tr><td>均分相关（Pearson）</td><td class="num">${fmt(data.corr, 4)}</td></tr>
  `;
  $("#crossNote").textContent = `口径：周期局部均分（含 0）。重合用户 ${data.overlapUsers ?? 0} 人；相关仅在双游戏皆有评分的用户上计算。`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function runAll() {
  const id = gameId();
  const [ser, fac, kw, cross] = await Promise.all([
    api("/api/series", { gameId: id }),
    api("/api/factors", { gameId: id, factor: state.factor }),
    api("/api/keywords/series", { gameId: id, name: state.keyword || "" }),
    api("/api/cross", { gameId: [id, $("#gameId2").value].filter(Boolean) }),
  ]);
  renderSeries(ser);
  renderFactors(fac);
  renderKeywords(kw);
  renderCross(cross);
  loadKwHits();
}

async function loadKwHits() {
  const box = $("#kwHits");
  if (!box) return;
  const name = state.keyword;
  if (!name) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<div class="footnote">加载命中评论…</div>`;
  try {
    const data = await api("/api/keywords/hits", { gameId: gameId(), name, pageSize: 8 });
    state.kwHits = data;
    const words = (data.words || []).slice(0, 15).join(" / ");
    box.innerHTML = `
      <div class="footnote" style="margin-bottom:8px">
        共 <b>${data.total}</b> 条命中「${escapeHtml(name)}」· 别名：${escapeHtml(words)}
        · <button class="btn sm" id="kwHitsCsv" type="button">导出命中 CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>时间</th><th>分</th><th>命中词</th><th>摘要</th></tr></thead>
        <tbody>${(data.items || [])
          .map(
            (r) => `<tr>
              <td class="mono">${escapeHtml(r.publish_time || "")}</td>
              <td class="num">${r.grade_mapped}</td>
              <td>${(r.hit_words || []).map((w) => `<span class="tag">${escapeHtml(w)}</span>`).join(" ")}</td>
              <td>${escapeHtml(r.content || "")}</td>
            </tr>`
          )
          .join("")}</tbody>
      </table></div>`;
    const btn = $("#kwHitsCsv");
    if (btn) btn.onclick = exportKwHits;
  } catch (e) {
    box.innerHTML = `<div class="footnote">${escapeHtml(e.message)}</div>`;
  }
}

async function exportKwHits() {
  const name = state.keyword;
  let page = 1;
  const all = [];
  for (;;) {
    const d = await api("/api/keywords/hits", { gameId: gameId(), name, page, pageSize: 50 });
    all.push(...(d.items || []));
    if (all.length >= d.total || page > 400) break;
    page++;
  }
  exportRowsCsv(
    `kw_hits_${name}_${gameId()}.csv`,
    ["publish_time", "grade_mapped", "user_name", "hit_words", "comment_no", "content"],
    all.map((r) => ({ ...r, hit_words: (r.hit_words || []).join("|") }))
  );
}

function bindUi() {
  $("#grainSeg").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      $("#grainSeg").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.grain = b.dataset.v;
    };
  });
  $("#tabs").querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      $("#tabs").querySelectorAll("button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      state.tab = b.dataset.tab;
      for (const t of ["series", "factors", "keywords", "cross"]) {
        $(`#panel-${t}`).classList.toggle("hidden", t !== state.tab);
      }
      // 显示后按真实宽度重绘，避免 display:none 时的小位图被拉伸
      const panel = $(`#panel-${state.tab}`);
      if (panel) {
        const canvases = panel.querySelectorAll("canvas");
        canvases.forEach(() => {});
        requestAnimationFrame(() => {
          if (state.tab === "series") {
            charts.ser.redraw();
            charts.star.redraw();
          } else if (state.tab === "factors") charts.fac.redraw();
          else if (state.tab === "keywords") charts.kw.redraw();
          else if (state.tab === "cross") charts.cross.redraw();
        });
      }
    };
  });
  $("#factorSel").onchange = async () => {
    state.factor = $("#factorSel").value;
    const fac = await api("/api/factors", { gameId: gameId(), factor: state.factor });
    renderFactors(fac);
  };
  $("#kwSel").onchange = async () => {
    state.keyword = $("#kwSel").value;
    updateKwMeta();
    const kw = await api("/api/keywords/series", { gameId: gameId(), name: state.keyword });
    renderKeywords(kw);
    loadKwHits();
  };
  $("#btnRun").onclick = () => runAll().catch((e) => alert(e.message));
  $("#btnCsvAll").onclick = async () => {
    const data = await api("/api/samples", { gameId: gameId(), pageSize: 50, page: 1 });
    // 仅导出第一页提示；完整导出由多次调用或后端——这里拉全部：page 循环
    let page = 1;
    const all = [];
    for (;;) {
      const d = await api("/api/samples", { gameId: gameId(), pageSize: 50, page });
      all.push(...d.items);
      if (all.length >= d.total || page > 200) break;
      page++;
    }
    exportRowsCsv(
      `samples_${gameId()}.csv`,
      [
        "comment_no",
        "grade_mapped",
        "grade_raw",
        "publish_time",
        "user_name",
        "user_level",
        "play_duration",
        "device_type",
        "content_len",
        "up_count",
        "content",
      ],
      all
    );
  };
}

async function boot() {
  charts.ser = createChart($("#serCanvas"), $("#serLegend"));
  charts.star = createChart($("#starCanvas"), $("#starLegend"));
  charts.fac = createChart($("#facCanvas"), $("#facLegend"));
  charts.kw = createChart($("#kwCanvas"), $("#kwLegend"));
  charts.cross = createChart($("#crossCanvas"), $("#crossLegend"));
  bindMeanToggle("#serMean", charts.ser);
  bindMeanToggle("#starMean", charts.star);
  bindMeanToggle("#facMean", charts.fac);
  bindMeanToggle("#kwMean", charts.kw);
  bindMeanToggle("#crossMean", charts.cross);
  bindUi();
  await loadGames();
  await loadKeywordDict();
  await runAll();
  // 首帧布局稳定后再补画一次
  requestAnimationFrame(() => {
    charts.ser.redraw();
    charts.star.redraw();
    charts.fac.redraw();
    charts.kw.redraw();
    charts.cross.redraw();
  });
}

boot().catch((e) => {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<pre style="color:#e25555;padding:20px">${escapeHtml(e.message)}</pre>`
  );
});
