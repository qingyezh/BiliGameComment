<script setup>
import { ref, shallowRef, computed, onMounted, nextTick, watch, reactive } from "vue";
import { ElMessage } from "element-plus";
import ChartBox from "./ChartBox.vue";
import { PALETTE, api, downloadCsv, fmt, fmtDelta, fmtPct, deltaClass } from "./api.js";
import { drawWordCloud } from "../web/wordcloud.js";

const games = ref([]);
const gameId = ref("");
const gameId2 = ref("");
const grain = ref("month");
const from = ref("");
const to = ref("");
const tab = ref("series");
const factor = ref("play_duration");
const keyword = ref("");
const keywordNames = ref([]);
const kwExpanded = ref({});
const loading = ref(false);

const serMean = ref(true);
const cntMean = ref(true);
const starMean = ref(true);
const facMean = ref(true);
const kwMean = ref(true);
const crossMean = ref(true);

const kpi = ref({ avg: null, delta: null, n: 0, zero: null });
const serRows = ref([]);
const facOverall = ref([]);
const facPeriods = ref([]);
const facBuckets = ref([]);

const facBucketCols = computed(() => {
  const names = facBuckets.value.length ? facBuckets.value : facOverall.value.map((x) => x.bucket);
  return names.map((b, i) => ({ key: "c" + i, label: b }));
});

const facOverallT = computed(() => {
  const cols = facBucketCols.value;
  const find = (b) => facOverall.value.find((x) => x.bucket === b) || {};
  const names = facBuckets.value.length ? facBuckets.value : facOverall.value.map((x) => x.bucket);
  const mk = (label, get) => {
    const o = { label };
    names.forEach((b, i) => {
      o[cols[i].key] = get(find(b));
    });
    return o;
  };
  return [
    mk("n", (x) => x.n ?? "—"),
    mk("均分", (x) => (x.avg == null ? "—" : fmt(x.avg, 2))),
    mk("0分%", (x) => (x.zero_ratio == null ? "—" : fmtPct(x.zero_ratio))),
  ];
});

const facPeriodRows = computed(() =>
  (facPeriods.value || []).map((r) => {
    const buckets = r.buckets || [];
    const n = buckets.reduce((a, b) => a + (Number(b.n) || 0), 0);
    const o = { period: r.period, n: r.n != null ? r.n : n || "—" };
    facBucketCols.value.forEach((col) => {
      const x = buckets.find((z) => z.bucket === col.label);
      o[col.key] = x && x.avg != null ? fmt(x.avg, 2) : "—";
    });
    return o;
  })
);
const kwHits = ref(null);
const kwMeta = ref("");
const kwCorr = ref(null);
const kwHitTotal = ref(0);
const crossNote = ref("");
const crossSeries = shallowRef(null);
const crossEvalChart = shallowRef(null);
const crossMeanRows = ref([]);
const crossEvalRows = ref([]);
const crossEvalMean = ref(true);
const wordWords = ref([]);
const wordCloudEl = shallowRef(null);
const wordSource = ref("both");
const wordProgress = ref(0);
let wordTimer = 0;
const dirty = reactive({
  series: true,
  factors: true,
  keywords: true,
  cross: true,
  wordcloud: true,
});
const serChart = shallowRef(null);
const cntChart = shallowRef(null);
const starChart = shallowRef(null);
const facChart = shallowRef(null);
const kwChart = shallowRef(null);
const crossDistChart = shallowRef(null);
const kwRows = ref([]);

const crossDir = ref("AB");
const crossDist = shallowRef(null);
const crossDistRows = ref([]);

const crossDistNote = computed(() => {
  if (!crossDist.value) return "";
  const d = crossDist.value;
  const srcTitle = d.sourceGame === gameId.value ? crossTitleA.value : crossTitleB.value;
  const tgtTitle = d.targetGame === gameId.value ? crossTitleA.value : crossTitleB.value;
  return `${srcTitle} → ${tgtTitle} · 源好评均分≥8 / 源差评<8 · 目标好=8–10 差=0–6 · 周期局部四格占比 · 粒度 ${
    grain.value === "day" ? "日" : "月"
  }`;
});

const crossDistTableRows = computed(() => {
  const d = crossDist.value;
  if (!d) return [];
  const o = d.overview || {};
  const rows = [
    {
      label: "总览",
      pp: o.pp,
      pn: o.pn,
      np: o.np,
      nn: o.nn,
      n: o.n,
      chi2: o.chi2,
      phi: o.phi,
      related: o.related,
    },
  ];
  for (const r of [...crossDistRows.value].reverse()) {
    rows.push({
      label: r.period,
      pp: r.pp,
      pn: r.pn,
      np: r.np,
      nn: r.nn,
      n: r.n,
      chi2: r.chi2,
      phi: r.phi,
      related: r.related,
    });
  }
  return rows;
});

async function loadCrossDist() {
  if (!gameId.value || !gameId2.value || gameId.value === gameId2.value) {
    crossDist.value = null;
    crossDistRows.value = [];
    crossDistChart.value = null;
    return;
  }
  try {
    const src = crossDir.value === "AB" ? gameId.value : gameId2.value;
    const tgt = crossDir.value === "AB" ? gameId2.value : gameId.value;
    const data = await api("/api/cross/dist", {
      ...params(),
      gameId: gameId.value,
      gameId2: gameId2.value,
      sourceGame: src,
      targetGame: tgt,
    });
    crossDist.value = data;
    const rows = data.periods || [];
    crossDistRows.value = rows;
    const distW = rows.map((r) => Number(r.n) || 0);
    crossDistChart.value = {
      labels: rows.map((r) => r.period),
      kind: "line",
      yDomain: { yMin: 0, yMax: 1 },
      yFormat: "pct",
      series: [
        {
          name: "好→好",
          color: "#22c55e",
          dash: false,
          format: "pct",
          values: rows.map((r) => r.pp),
          weights: distW,
        },
        {
          name: "好→差",
          color: "#f59e0b",
          dash: false,
          format: "pct",
          values: rows.map((r) => r.pn),
          weights: distW,
        },
        {
          name: "差→好",
          color: "#3b82f6",
          dash: true,
          format: "pct",
          values: rows.map((r) => r.np),
          weights: distW,
        },
        {
          name: "差→差",
          color: "#ef4444",
          dash: true,
          format: "pct",
          values: rows.map((r) => r.nn),
          weights: distW,
        },
      ],
    };
  } catch (e) {
    ElMessage.error(e.message);
  }
}

watch([crossDir, gameId, gameId2, grain, from, to], () => {
  loadCrossDist();
});

const gameTitleMap = computed(() => {
  const m = {};
  for (const g of games.value) m[g.gameId] = g.title || g.gameId;
  return m;
});

const crossTitleA = computed(() => gameTitleMap.value[gameId.value] || gameId.value);
const crossTitleB = computed(() => gameTitleMap.value[gameId2.value] || gameId2.value || "");

function params() {
  return { grain: grain.value, from: from.value || undefined, to: to.value || undefined };
}

async function loadGames() {
  const data = await api("/api/games", params());
  games.value = data.games;
}

async function loadKeywordDict() {
  const data = await api("/api/keywords");
  keywordNames.value = data.names || [];
  kwExpanded.value = data.expanded || {};
}

async function loadSeries() {
  if (!gameId.value) {
    serRows.value = [];
    serChart.value = null;
    cntChart.value = null;
    starChart.value = null;
    kpi.value = { avg: null, delta: null, n: 0, zero: null };
    return;
  }
  const data = await api("/api/series", { ...params(), gameId: gameId.value });
  const rows = data.rows || [];
  serRows.value = rows.slice().reverse();
  const last = rows[rows.length - 1];
  kpi.value = {
    avg: last?.avg ?? null,
    delta: last?.delta_avg ?? null,
    n: last?.n ?? 0,
    zero: last?.zero_ratio ?? null,
  };
  const labels = rows.map((r) => r.period);
  const periodN = rows.map((r) => Number(r.n) || 0);
  serChart.value = {
    labels,
    kind: "line",
    yDomain: { yMin: 0, yMax: 10 },
    series: [
      {
        name: "局部均分",
        color: PALETTE[0],
        values: rows.map((r) => r.avg),
        weights: periodN,
      },
      {
        name: "累计均分",
        color: "#94a3b8",
        values: rows.map((r) => r.cum_avg),
        weights: periodN,
      },
    ],
  };
  let runN = 0;
  const cumN = rows.map((r) => {
    runN += Number(r.n) || 0;
    return runN;
  });
  cntChart.value = {
    labels,
    kind: "line",
    yDomain: null,
    series: [
      { name: "局部评价数", color: PALETTE[0], values: rows.map((r) => Number(r.n) || 0) },
    ],
    rightSeries: [
      { name: "累计评价数", color: "#94a3b8", format: "num", values: cumN },
    ],
    yRightDomain: { yMin: 0, yMax: Math.max(1, ...cumN) },
  };
  starChart.value = {
    labels,
    kind: "bar",
    yDomain: null,
    series: [
      { name: "★5", color: PALETTE[0], values: rows.map((r) => Number(r.star5) || 0) },
      { name: "★4", color: PALETTE[1], values: rows.map((r) => Number(r.star4) || 0) },
      { name: "★3", color: PALETTE[2], values: rows.map((r) => Number(r.star3) || 0) },
      { name: "★2", color: PALETTE[3], values: rows.map((r) => Number(r.star2) || 0) },
      { name: "★1", color: PALETTE[4], values: rows.map((r) => Number(r.star1) || 0) },
    ],
  };
}

async function loadFactors() {
  if (!gameId.value) {
    facOverall.value = [];
    facChart.value = null;
    return;
  }
  const data = await api("/api/factors", {
    ...params(),
    gameId: gameId.value,
    factor: factor.value,
  });
  facOverall.value = data.overall || [];
  facBuckets.value = data.buckets || [];
  facPeriods.value = data.series || [];
  const rows = data.series || [];
  const buckets = data.buckets || [];
  facChart.value = {
    labels: rows.map((r) => r.period),
    kind: "line",
    yDomain: { yMin: 0, yMax: 10 },
    series: buckets.map((b, i) => ({
      name: b,
      color: PALETTE[i % PALETTE.length],
      values: rows.map((r) => {
        const x = (r.buckets || []).find((z) => z.bucket === b);
        return x ? x.avg : null;
      }),
      weights: rows.map((r) => {
        const x = (r.buckets || []).find((z) => z.bucket === b);
        return x ? x.n : 0;
      }),
    })),
  };
}

async function loadKeywords() {
  if (!gameId.value || !keyword.value) {
    kwChart.value = null;
    kwRows.value = [];
    kwHits.value = null;
    kwCorr.value = null;
    kwHitTotal.value = 0;
    return;
  }
  const data = await api("/api/keywords/series", {
    ...params(),
    gameId: gameId.value,
    name: keyword.value,
  });
  const rows = data.periods || [];
  const name = keyword.value;
  const get = (r) => (r.keywords && r.keywords[name]) || {};
  const words = kwExpanded.value?.[name] || [];
  kwMeta.value = words.length
    ? `词条「${name}」${words.length} 个别名：${words.slice(0, 10).join(" / ")}`
    : "";
  const hitRates = rows.map((r) => get(r).hit_rate).filter((v) => v != null);
  const maxHit = hitRates.length ? Math.max(...hitRates) : 0;
  let hitSum = 0;
  let hitN = 0;
  let allSum = 0;
  let allN = 0;
  for (const r of rows) {
    const k = get(r);
    const hn = Number(k.hit_n) || 0;
    const n = Number(r.n) || 0;
    if (hn && k.hit_avg != null) {
      hitSum += hn * Number(k.hit_avg);
      hitN += hn;
    }
    if (n && r.avg != null) {
      allSum += n * Number(r.avg);
      allN += n;
    }
  }
  const gHit = hitN ? hitSum / hitN : null;
  const gAvg = allN ? allSum / allN : null;
  const gDelta = gHit != null && gAvg != null ? gHit - gAvg : null;
  // 相关度 RMS 按周期样本量加权：√(Σ n·Δ² / Σ n)
  let ss = 0;
  let wSum = 0;
  for (const r of rows) {
    const k = get(r);
    if (k.hit_avg == null || r.avg == null || gDelta == null) continue;
    const w = Number(r.n) || 0;
    if (!w) continue;
    const d = Number(k.hit_avg) - Number(r.avg) - gDelta;
    ss += w * d * d;
    wSum += w;
  }
  kwCorr.value = wSum ? +((10 - Math.sqrt(ss / wSum)) / 10).toFixed(4) : null;
  kwHitTotal.value = hitN;
  const periodN = rows.map((r) => Number(r.n) || 0);
  const hitNList = rows.map((r) => Number(get(r).hit_n) || 0);
  kwChart.value = {
    labels: rows.map((r) => r.period),
    kind: "line",
    yDomain: { yMin: -5, yMax: 10 },
    yRightDomain: maxHit > 0.5 ? { yMin: 0, yMax: 1 } : { yMin: 0, yMax: 0.5 },
    series: [
      {
        name: "命中均分",
        color: PALETTE[0],
        values: rows.map((r) => get(r).hit_avg),
        weights: hitNList,
      },
      {
        name: "全部均分",
        color: PALETTE[1],
        values: rows.map((r) => r.avg),
        weights: periodN,
      },
      {
        name: "Δ 命中−全部",
        color: PALETTE[3],
        values: rows.map((r) => {
          const h = get(r).hit_avg;
          if (h == null || r.avg == null) return null;
          return +(Number(h) - Number(r.avg)).toFixed(4);
        }),
        // 均值口径：全量命中μ − 全量全部μ（≠ 各期差的再平均）
        meanOverride: gDelta,
      },
    ],
    rightSeries: [
      {
        name: "命中率",
        color: "#0ea5e9",
        format: "pct",
        values: rows.map((r) => get(r).hit_rate),
        weights: periodN,
      },
    ],
  };
  kwRows.value = rows;
  const hits = await api("/api/keywords/hits", {
    ...params(),
    gameId: gameId.value,
    name: keyword.value,
    pageSize: 8,
  });
  kwHits.value = hits;
}

async function loadCross() {
  const ids = [gameId.value, gameId2.value].filter(Boolean);
  if (ids.length < 2 || gameId.value === gameId2.value) {
    crossSeries.value = null;
    crossNote.value = "请选择两个不同游戏进行对比";
    return;
  }
  const data = await api("/api/cross", { ...params(), gameId: ids });
  const periodSet = new Set();
  for (const g of data.games || []) {
    for (const r of data.series[g] || []) periodSet.add(r.period);
  }
  const labels = [...periodSet].sort();
  const titleMap = gameTitleMap.value;
  const nByPeriod = new Map((data.commonByPeriod || []).map((r) => [r.period, r.n]));
  const commonN = labels.map((p) => nByPeriod.get(p) ?? null);
  const commonNums = commonN.filter((v) => v != null && Number.isFinite(v));
  const maxCommon = commonNums.length ? Math.max(...commonNums) : 1;
  const gA = data.games?.[0];
  const gB = data.games?.[1];
  const nameA = titleMap[gA] || gA || "A";
  const nameB = titleMap[gB] || gB || "B";
  const avgA = labels.map((p) => {
    const r = (data.series[gA] || []).find((x) => x.period === p);
    return r ? r.avg : null;
  });
  const avgB = labels.map((p) => {
    const r = (data.series[gB] || []).find((x) => x.period === p);
    return r ? r.avg : null;
  });
  const nA = labels.map((p) => {
    const r = (data.series[gA] || []).find((x) => x.period === p);
    return r ? Number(r.n) || 0 : 0;
  });
  const nB = labels.map((p) => {
    const r = (data.series[gB] || []).find((x) => x.period === p);
    return r ? Number(r.n) || 0 : 0;
  });
  const evalA = labels.map((p) => {
    const r = (data.evalSeries?.[gA] || []).find((x) => x.period === p);
    return r ? r.n : null;
  });
  const evalB = labels.map((p) => {
    const r = (data.evalSeries?.[gB] || []).find((x) => x.period === p);
    return r ? r.n : null;
  });
  const maxEvalA = Math.max(1, ...evalA.filter((v) => v != null && Number.isFinite(v)), 1);
  const maxEvalB = Math.max(1, ...evalB.filter((v) => v != null && Number.isFinite(v)), 1);
  crossSeries.value = {
    labels,
    kind: "line",
    yDomain: { yMin: 0, yMax: 10 },
    series: [
      { name: nameA, color: PALETTE[0], values: avgA, weights: nA },
      { name: nameB, color: PALETTE[1], values: avgB, weights: nB },
    ],
    rightSeries: [],
  };
  crossEvalChart.value = {
    labels,
    kind: "line",
    yDomain: { yMin: 0, yMax: Math.ceil(Math.max(maxEvalA, maxEvalB) * 1.15) },
    series: [
      {
        name: nameA,
        color: PALETTE[0],
        format: "num",
        dash: false,
        values: evalA,
      },
      {
        name: nameB,
        color: PALETTE[1],
        format: "num",
        dash: false,
        values: evalB,
      },
    ],
    rightSeries: [
      {
        name: "共同评价者",
        color: "#0ea5e9",
        format: "num",
        values: commonN,
      },
    ],
    yRightDomain: { yMin: 0, yMax: Math.ceil(maxCommon * 1.15) },
    yRightLog: false,
  };
  crossMeanRows.value = labels.map((p, i) => ({
    period: p,
    [nameA]: avgA[i],
    [nameB]: avgB[i],
  }));
  crossEvalRows.value = labels.map((p, i) => ({
    period: p,
    [nameA]: evalA[i],
    [nameB]: evalB[i],
    common_n: commonN[i],
  }));
  crossNote.value = `${nameA} vs ${nameB} · 共同评价者 ${data.overlapUsers ?? 0} 人 · 相关 ${fmt(data.corr, 4)} · 曲线仅含同时评过两游戏的 uid`;
}

async function loadWordFreq() {
  if (!gameId.value) {
    wordWords.value = [];
    return;
  }
  wordProgress.value = 0;
  wordTimer = setInterval(async () => {
    try {
      const s = await api("/api/wordfreq/status");
      if (s?.running) wordProgress.value = s.n;
    } catch {}
  }, 500);
  try {
    const data = await api("/api/wordfreq", {
      from: from.value || undefined,
      to: to.value || undefined,
      gameId: gameId.value,
      limit: 300,
      source: wordSource.value,
    });
    wordWords.value = data.words || [];
  } finally {
    clearInterval(wordTimer);
    wordTimer = 0;
    wordProgress.value = 0;
  }
  await nextTick();
  drawWordCloud(wordCloudEl.value, wordWords.value.slice(0, 150));
}

const wordTableRows = computed(() => {
  const src = wordWords.value;
  const rows = [];
  for (let i = 0; i < src.length; i += 3) {
    rows.push({
      n1: i + 1,
      w1: src[i]?.word ?? "",
      n2: src[i + 1] ? i + 2 : null,
      w2: src[i + 1]?.word ?? "",
      n3: src[i + 2] ? i + 3 : null,
      w3: src[i + 2]?.word ?? "",
    });
  }
  return rows;
});

function markDirty(keys) {
  for (const k of keys) if (k in dirty) dirty[k] = true;
}

async function loadSection(name, force = false, bypassCache = false) {
  if (!force && !dirty[name]) return;
  if (bypassCache) window.__mimo_refresh = 1;
  try {
    if (name === "series") await loadSeries();
    else if (name === "factors") await loadFactors();
    else if (name === "keywords") await loadKeywords();
    else if (name === "cross") {
      await loadCross();
      await loadCrossDist();
    } else if (name === "wordcloud") await loadWordFreq();
    dirty[name] = false;
  } finally {
    delete window.__mimo_refresh;
  }
}

async function refreshSection(name) {
  loading.value = true;
  try {
    dirty[name] = true;
    await loadSection(name, true, true);
    ElMessage.success("已强制重算");
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

async function runAll() {
  loading.value = true;
  try {
    await nextTick();
    await loadSection(tab.value, true);
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
}

watch(tab, async (t) => {
  try {
    loading.value = true;
    await loadSection(t, false);
    if (t === "wordcloud") {
      await nextTick();
      drawWordCloud(wordCloudEl.value, wordWords.value.slice(0, 150));
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    loading.value = false;
  }
});

watch([gameId, grain, from, to], () => {
  markDirty(["series", "factors", "keywords", "cross", "wordcloud"]);
});

async function onFactorChange() {
  try {
    dirty.factors = true;
    await loadFactors();
    dirty.factors = false;
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function onKeywordChange() {
  try {
    dirty.keywords = true;
    await loadKeywords();
    dirty.keywords = false;
  } catch (e) {
    ElMessage.error(e.message);
  }
}

async function onWordSourceChange() {
  try {
    dirty.wordcloud = true;
    await loadSection("wordcloud", true);
  } catch (e) {
    ElMessage.error(e.message);
  }
}

function exportSerCsv() {
  downloadCsv(
    `series_${gameId.value}.csv`,
    ["period", "n", "avg", "delta_avg", "cum_avg", "zero_ratio", "star5", "star4", "star3", "star2", "star1"],
    serRows.value
  );
}

async function exportSamples() {
  let page = 1;
  const all = [];
  for (;;) {
    const d = await api("/api/samples", { ...params(), gameId: gameId.value, page, pageSize: 50 });
    all.push(...d.items);
    if (all.length >= d.total || page > 200) break;
    page++;
  }
  downloadCsv(
    `samples_${gameId.value}.csv`,
    ["publish_time", "grade_mapped", "user_name", "user_level", "play_duration", "device_type", "content_len", "content"],
    all
  );
}

async function exportKwHits() {
  let page = 1;
  const all = [];
  for (;;) {
    const d = await api("/api/keywords/hits", {
      ...params(),
      gameId: gameId.value,
      name: keyword.value,
      page,
      pageSize: 50,
    });
    all.push(...(d.items || []));
    if (all.length >= d.total || page > 200) break;
    page++;
  }
  downloadCsv(
    `kw_hits_${keyword.value}_${gameId.value}.csv`,
    ["publish_time", "grade_mapped", "user_name", "hit_words", "content"],
    all.map((r) => ({ ...r, hit_words: (r.hit_words || []).join("|") }))
  );
}

function exportStarCsv() {
  downloadCsv(
    `star_${gameId.value}_${grain.value}.csv`,
    ["period", "n", "star5", "star4", "star3", "star2", "star1"],
    serRows.value
  );
}

function exportCntCsv() {
  let runN = 0;
  const rows = serRows.value.map((r) => {
    runN += Number(r.n) || 0;
    return { period: r.period, n: Number(r.n) || 0, cum_n: runN };
  });
  downloadCsv(`cnt_${gameId.value}_${grain.value}.csv`, ["period", "n", "cum_n"], rows);
}

function exportFacCsv() {
  downloadCsv(
    `factor_${factor.value}_${gameId.value}_${grain.value}.csv`,
    ["bucket", "n", "avg", "zero_ratio"],
    facOverall.value
  );
}

function exportKwCsv() {
  const name = keyword.value;
  downloadCsv(
    `kw_series_${name}_${gameId.value}_${grain.value}.csv`,
    ["period", "hit_avg", "avg", "delta_hit", "hit_rate"],
    kwRows.value.map((r) => {
      const o = (r.keywords && r.keywords[name]) || {};
      const all = r.avg;
      return {
        period: r.period,
        hit_avg: o.hit_avg,
        avg: all,
        delta_hit:
          o.hit_avg != null && all != null ? +(Number(o.hit_avg) - Number(all)).toFixed(4) : null,
        hit_rate: o.hit_rate,
      };
    })
  );
}

function exportCrossMeanCsv() {
  const rows = crossMeanRows.value;
  if (!rows.length) return;
  downloadCsv(
    `cross_mean_${gameId.value}_${gameId2.value}_${grain.value}.csv`,
    Object.keys(rows[0]),
    rows
  );
}

function exportCrossEvalCsv() {
  const rows = crossEvalRows.value;
  if (!rows.length) return;
  downloadCsv(
    `cross_eval_${gameId.value}_${gameId2.value}_${grain.value}.csv`,
    Object.keys(rows[0]),
    rows
  );
}

function exportCrossDistCsv() {
  const src = crossDir.value === "AB" ? gameId.value : gameId2.value;
  const tgt = crossDir.value === "AB" ? gameId2.value : gameId.value;
  const d = crossDist.value;
  const body = [];
  if (d && d.overview) {
    const o = d.overview;
    body.push({
      period: "总览",
      n: o.n,
      pp: o.pp,
      pn: o.pn,
      np: o.np,
      nn: o.nn,
      chi2: o.chi2,
      phi: o.phi,
      related: o.related == null ? "" : o.related ? "有" : "无",
    });
  }
  for (const r of [...crossDistRows.value].reverse()) {
    body.push({
      period: r.period,
      n: r.n,
      pp: r.pp,
      pn: r.pn,
      np: r.np,
      nn: r.nn,
      chi2: r.chi2,
      phi: r.phi,
      related: r.related == null ? "" : r.related ? "有" : "无",
    });
  }
  downloadCsv(
    `cross_dist_${src}_${tgt}_${grain.value}.csv`,
    ["period", "n", "pp", "pn", "np", "nn", "chi2", "phi", "related"],
    body
  );
}

function crossDistCellStyle({ row, column }) {
  if (column.label !== "是否有关") return {};
  if (row.related == null) return {};
  return row.related
    ? { background: "#fee2e2", color: "#b91c1c" }
    : { background: "#dcfce7", color: "#15803d" };
}

async function exportPng(key) {
  const box = document.querySelector(`[data-chart="${key}"] canvas`);
  if (!box) return;
  const a = document.createElement("a");
  a.href = box.toDataURL("image/png");
  a.download = `${key}_${gameId.value}_${grain.value}.png`;
  a.click();
}

onMounted(async () => {
  try {
    await loadGames();
    await loadKeywordDict();
    await runAll();
  } catch (e) {
    ElMessage.error(e.message);
  }
});
</script>

<template>
  <div class="app-shell">
    <header class="hero">
      <div class="logo" aria-hidden="true"></div>
      <div>
        <h1>游戏评论分析</h1>
        <div class="sub">周期局部均分 · 0/2/4/6/8/10 · 图表 CSV / PNG · Vue3 SFC</div>
      </div>
    </header>

    <main class="main">
      <el-card shadow="never" class="toolbar-card">
        <div class="toolbar">
          <span class="field">
            游戏
            <el-select v-model="gameId" filterable size="small" style="width: 150px">
              <el-option
                v-for="g in games"
                :key="g.gameId"
                :label="`${g.gameId} · ${g.title}`"
                :value="g.gameId"
              />
            </el-select>
          </span>
          <span class="field">
            对比
            <el-select v-model="gameId2" clearable size="small" style="width: 150px">
              <el-option
                v-for="g in games"
                :key="g.gameId"
                :label="`${g.gameId} · ${g.title}`"
                :value="g.gameId"
              />
            </el-select>
          </span>
          <span class="field">
            粒度
            <el-segmented
              v-model="grain"
              size="small"
              :options="[
                { label: '月', value: 'month' },
                { label: '日', value: 'day' },
              ]"
            />
          </span>
          <span class="field"
            >从 <el-date-picker v-model="from" type="month" value-format="YYYY-MM" size="small" style="width: 108px"
          /></span>
          <span class="field"
            >到 <el-date-picker v-model="to" type="month" value-format="YYYY-MM" size="small" style="width: 108px"
          /></span>
          <el-button type="primary" size="small" :loading="loading" @click="runAll">刷新本页</el-button>
          <el-button size="small" :loading="loading" @click="refreshSection(tab)">强制重算</el-button>
          <el-button size="small" class="btn-export" @click="exportSamples">样本CSV</el-button>
        </div>
      </el-card>

      <el-tabs v-model="tab" class="main-tabs">
        <el-tab-pane label="评分轨迹" name="series">
          <div class="kpis">
            <div class="kpi-card">
              <div class="kpi-label">最新周期均分</div>
              <div class="kpi-value">{{ fmt(kpi.avg, 2) }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">环比 Δ</div>
              <div class="kpi-value" :class="deltaClass(kpi.delta)">{{ fmtDelta(kpi.delta) }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">样本量 n</div>
              <div class="kpi-value">{{ kpi.n }}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">0 分占比</div>
              <div class="kpi-value">{{ fmtPct(kpi.zero) }}</div>
            </div>
          </div>
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>周期均分走势</span>
                <el-checkbox v-model="serMean">均值</el-checkbox>
              </div>
            </template>
            <div data-chart="ser">
              <ChartBox :payload="serChart" :show-mean="serMean" />
            </div>
            <div class="card-foot">
              <el-button size="small" @click="exportSerCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('ser')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>周期评价数量</span>
                <el-checkbox v-model="cntMean">均值</el-checkbox>
              </div>
            </template>
            <div data-chart="cnt">
              <ChartBox :payload="cntChart" :show-mean="cntMean" />
            </div>
            <div class="card-foot">
              <el-button size="small" :disabled="!serRows.length" @click="exportCntCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('cnt')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>周期明细</template>
            <el-table :data="serRows" class="app-table" size="small" stripe style="width: 100%">
              <el-table-column prop="period" label="周期" min-width="100" />
              <el-table-column prop="n" label="n" min-width="70" align="right" />
              <el-table-column label="均分" min-width="80" align="right">
                <template #default="{ row }">{{ fmt(row.avg, 2) }}</template>
              </el-table-column>
              <el-table-column label="Δ" min-width="80" align="right">
                <template #default="{ row }">
                  <span :class="deltaClass(row.delta_avg)">{{ fmtDelta(row.delta_avg) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="累计" min-width="80" align="right">
                <template #default="{ row }">{{ fmt(row.cum_avg, 2) }}</template>
              </el-table-column>
              <el-table-column label="0分%" min-width="80" align="right">
                <template #default="{ row }">{{ fmtPct(row.zero_ratio) }}</template>
              </el-table-column>
              <el-table-column prop="star5" label="★5" min-width="56" align="right" />
              <el-table-column prop="star4" label="★4" min-width="56" align="right" />
              <el-table-column prop="star3" label="★3" min-width="56" align="right" />
              <el-table-column prop="star2" label="★2" min-width="56" align="right" />
              <el-table-column prop="star1" label="★1" min-width="56" align="right" />
            </el-table>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>评分分布</span>
                <el-checkbox v-model="starMean">均值</el-checkbox>
              </div>
            </template>
            <div data-chart="star">
              <ChartBox :payload="starChart" :show-mean="starMean" />
            </div>
            <div class="card-foot">
              <el-button size="small" @click="exportStarCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('star')">PNG</el-button>
            </div>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="因子交叉" name="factors">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>因子 × 周期均分</span>
                <div>
                  <el-select v-model="factor" style="width: 140px" @change="onFactorChange">
                    <el-option label="游玩时长" value="play_duration" />
                    <el-option label="用户等级" value="user_level" />
                    <el-option label="评论长度" value="content_len" />
                    <el-option label="终端" value="device_type" />
                  </el-select>
                  <el-checkbox v-model="facMean">均值</el-checkbox>
                </div>
              </div>
            </template>
            <div data-chart="fac">
              <ChartBox :payload="facChart" :show-mean="facMean" />
            </div>
            <div class="card-foot">
              <el-button size="small" :disabled="!facOverall.length" @click="exportFacCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('fac')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>因子总表</template>
            <el-table :data="facOverallT" class="app-table" size="small" stripe style="width: 100%">
              <el-table-column prop="label" label="" min-width="80" />
              <el-table-column
                v-for="col in facBucketCols"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                min-width="90"
                align="right"
              />
            </el-table>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never" class="cross-table-card">
            <template #header>周期均分明细</template>
            <el-table :data="facPeriodRows" class="app-table" size="small" stripe style="width: 100%">
              <el-table-column prop="period" label="周期" min-width="100" />
              <el-table-column prop="n" label="n" min-width="70" align="right" />
              <el-table-column
                v-for="col in facBucketCols"
                :key="col.key"
                :prop="col.key"
                :label="col.label"
                min-width="90"
                align="right"
              />
            </el-table>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="关键词趋势" name="keywords">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>关键词命中率 / Δ评分</span>
                <div>
                  <el-select v-model="keyword" style="width: 180px" @change="onKeywordChange">
                    <el-option v-for="n in keywordNames" :key="n" :label="n" :value="n" />
                  </el-select>
                  <el-checkbox v-model="kwMean">均值</el-checkbox>
                </div>
              </div>
            </template>
            <div data-chart="kw">
              <ChartBox :payload="kwChart" :show-mean="kwMean" />
            </div>
            <div class="kw-meta" v-if="kwMeta">{{ kwMeta }}</div>
            <div class="card-foot kw-foot">
              <span class="corr-text" v-if="kwCorr != null"
                >命中数量：{{ kwHitTotal }} 条 | 相关度：{{ fmt(kwCorr, 4) }}</span
              >
              <span v-else></span>
              <div class="foot-actions">
                <el-button size="small" :disabled="!kwRows.length" @click="exportKwCsv">CSV</el-button>
                <el-button size="small" @click="exportPng('kw')">PNG</el-button>
              </div>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>命中评论抽样</template>
            <div class="kw-actions" v-if="kwHits">
              <span>共 <b>{{ kwHits.total }}</b> 条</span>
              <el-button size="small" @click="exportKwHits">导出命中 CSV</el-button>
            </div>
            <el-table
              :data="kwHits?.items || []"
              class="app-table"
              size="small"
              stripe
              style="width: 100%"
              max-height="360"
            >
              <el-table-column label="时间" min-width="150">
                <template #default="{ row }"><span class="mono">{{ row.publish_time }}</span></template>
              </el-table-column>
              <el-table-column label="分" min-width="60" align="right">
                <template #default="{ row }">{{ row.grade_mapped }}</template>
              </el-table-column>
              <el-table-column label="命中词" min-width="160">
                <template #default="{ row }">
                  <el-tag
                    v-for="w in row.hit_words || []"
                    :key="w"
                    size="small"
                    type="warning"
                    class="hit-tag"
                    >{{ w }}</el-tag
                  >
                </template>
              </el-table-column>
              <el-table-column label="摘要" min-width="280">
                <template #default="{ row }">{{ row.content }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="跨游戏对比" name="cross">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>共同评价者周期均分对比</span>
                <el-checkbox v-model="crossMean">均值</el-checkbox>
              </div>
            </template>
            <div data-chart="cross">
              <ChartBox :payload="crossSeries" :show-mean="crossMean" />
            </div>
            <div class="kw-meta">{{ crossNote }}</div>
            <div class="card-foot">
              <el-button size="small" :disabled="!crossMeanRows.length" @click="exportCrossMeanCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('cross')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>对比游戏评价者数量</span>
                <el-checkbox v-model="crossEvalMean">均值</el-checkbox>
              </div>
            </template>
            <div data-chart="crosseval">
              <ChartBox :payload="crossEvalChart" :show-mean="crossEvalMean" />
            </div>
            <div class="card-foot">
              <el-button size="small" :disabled="!crossEvalRows.length" @click="exportCrossEvalCsv">CSV</el-button>
              <el-button size="small" @click="exportPng('crosseval')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>评价迁移四格占比</span>
                <div class="dist-controls">
                  <el-segmented
                    v-model="crossDir"
                    :options="[
                      { label: `${crossTitleA} → ${crossTitleB}`, value: 'AB' },
                      { label: `${crossTitleB} → ${crossTitleA}`, value: 'BA' },
                    ]"
                  />
                </div>
              </div>
            </template>
            <div data-chart="crossdist">
              <ChartBox :payload="crossDistChart" :show-mean="true" />
            </div>
            <div class="kw-meta" v-if="crossDistNote">{{ crossDistNote }}</div>
            <div class="card-foot">
              <el-button size="small" :disabled="!crossDistRows.length" @click="exportCrossDistCsv"
                >CSV</el-button
              >
              <el-button size="small" :disabled="!crossDist" @click="exportPng('crossdist')"
                >PNG</el-button
              >
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never" class="cross-table-card">
            <template #header>占比数据表</template>
            <el-table :data="crossDistTableRows" size="small" border :cell-style="crossDistCellStyle">
              <el-table-column prop="label" label="周期" min-width="100" align="center" header-align="center" />
              <el-table-column label="好→好" min-width="88" align="right" header-align="center">
                <template #default="{ row }">{{ fmtPct(row.pp) }}</template>
              </el-table-column>
              <el-table-column label="好→差" min-width="88" align="right" header-align="center">
                <template #default="{ row }">{{ fmtPct(row.pn) }}</template>
              </el-table-column>
              <el-table-column label="差→好" min-width="88" align="right" header-align="center">
                <template #default="{ row }">{{ fmtPct(row.np) }}</template>
              </el-table-column>
              <el-table-column label="差→差" min-width="88" align="right" header-align="center">
                <template #default="{ row }">{{ fmtPct(row.nn) }}</template>
              </el-table-column>
              <el-table-column prop="n" label="n" width="72" align="right" header-align="center" />
              <el-table-column label="χ²" min-width="80" align="right" header-align="center">
                <template #default="{ row }">{{ row.chi2 == null ? "—" : fmt(row.chi2, 2) }}</template>
              </el-table-column>
              <el-table-column label="φ" min-width="72" align="right" header-align="center">
                <template #default="{ row }">{{ row.phi == null ? "—" : fmt(row.phi, 4) }}</template>
              </el-table-column>
              <el-table-column label="是否有关" min-width="88" align="center" header-align="center">
                <template #default="{ row }">{{ row.related == null ? "—" : row.related ? "有" : "无" }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>

        <el-tab-pane label="词云" name="wordcloud">
          <el-card shadow="never">
            <template #header>
              <div class="card-head">
                <span>评论 / 用户名词云</span>
                <div class="dist-controls">
                  <el-segmented
                    v-model="wordSource"
                    size="small"
                    :options="[
                      { label: '合并', value: 'both' },
                      { label: '用户名', value: 'user' },
                      { label: '评论', value: 'comment' },
                    ]"
                    @change="onWordSourceChange"
                  />
                  <el-button size="small" class="btn-export" @click="refreshSection('wordcloud')">强制重算</el-button>
                </div>
              </div>
            </template>
            <div v-if="wordProgress > 0" class="word-progress">
              已扫描约 {{ (wordProgress / 10000).toFixed(1) }} 万条…
            </div>
            <div data-chart="wordcloud" class="wordcloud-host">
              <canvas ref="wordCloudEl" class="wordcloud-canvas"></canvas>
            </div>
            <div class="card-foot">
              <el-button size="small" class="btn-export" :disabled="!wordWords.length" @click="exportPng('wordcloud')">PNG</el-button>
            </div>
          </el-card>
          <div class="section-gap" aria-hidden="true"></div>
          <el-card shadow="never" class="cross-table-card">
            <template #header>前 300 高频词</template>
            <el-table :data="wordTableRows" size="small" border>
              <el-table-column label="序号" width="70" align="right" header-align="center">
                <template #default="{ row }">{{ row.n1 }}</template>
              </el-table-column>
              <el-table-column label="词" min-width="110" align="left" header-align="center">
                <template #default="{ row }">{{ row.w1 }}</template>
              </el-table-column>
              <el-table-column label="序号" width="70" align="right" header-align="center">
                <template #default="{ row }">{{ row.n2 ?? "" }}</template>
              </el-table-column>
              <el-table-column label="词" min-width="110" align="left" header-align="center">
                <template #default="{ row }">{{ row.w2 }}</template>
              </el-table-column>
              <el-table-column label="序号" width="70" align="right" header-align="center">
                <template #default="{ row }">{{ row.n3 ?? "" }}</template>
              </el-table-column>
              <el-table-column label="词" min-width="110" align="left" header-align="center">
                <template #default="{ row }">{{ row.w3 }}</template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-tab-pane>
      </el-tabs>
    </main>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: #f5f7fb;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.app-shell {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px 40px;
}
.hero {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 0 16px;
}
.hero .logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #3b82f6, #06b6d4);
}
.hero h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
}
.hero .sub {
  color: #64748b;
  font-size: 13px;
  margin-top: 2px;
}
.main {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  flex-wrap: nowrap;
  gap: 6px 8px;
  align-items: center;
  overflow-x: auto;
}
.toolbar .el-button {
  padding: 5px 10px;
}
.toolbar .btn-export {
  background: #f1f5f9;
  border-color: #e2e8f0;
  color: #475569;
}
.toolbar .btn-export:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
  color: #0f172a;
}
.field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #334155;
  white-space: nowrap;
  flex: 0 0 auto;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.kpi-card {
  background: #fff;
  border: 1px solid #e5eaf2;
  border-radius: 10px;
  padding: 12px 14px;
}
.kpi-label {
  font-size: 12px;
  color: #64748b;
}
.kpi-value {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin-top: 4px;
}
.kpi-value.pos {
  color: #16a34a;
}
.kpi-value.neg {
  color: #dc2626;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.card-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}
.dist-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.word-progress {
  font-size: 12px;
  color: #2563eb;
  margin-bottom: 8px;
}
.wordcloud-host {
  width: 100%;
}
.wordcloud-canvas {
  width: 100%;
  height: 360px;
  display: block;
  border: 1px solid #e5eaf2;
  border-radius: 8px;
}
.section-gap {
  height: 12px;
}
.kw-meta {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
}
.kw-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 13px;
}
.kw-foot {
  justify-content: space-between;
  align-items: center;
}
.corr-text {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
}
.foot-actions {
  display: flex;
  gap: 8px;
}
.pos {
  color: #16a34a;
}
.neg {
  color: #dc2626;
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
.hit-tag {
  margin-right: 4px;
}
@media (max-width: 800px) {
  .kpis {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
