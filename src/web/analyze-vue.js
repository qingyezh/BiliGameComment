/**
 * Vue3 + Element Plus 分析台
 */
import { createChart } from "./charts.js";

const { createApp, ref, shallowRef, onMounted, watch, computed, nextTick } = Vue;

const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

function fmt(n, d = 2) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(d);
}
function fmtDelta(d) {
  if (d == null) return "—";
  return (d > 0 ? "+" : "") + fmt(d, 2);
}
function fmtPct(v) {
  if (v == null) return "—";
  return (Number(v) * 100).toFixed(2) + "%";
}
function deltaClass(v) {
  if (v == null) return "";
  return v > 0 ? "pos" : v < 0 ? "neg" : "";
}

async function api(path, params = {}) {
  const base = `http://127.0.0.1:${location.port || 8788}`;
  const u = new URL(base + path);
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

const App = {
  setup() {
    const games = ref([]);
    const gameId = ref("103496");
    const gameId2 = ref("");
    const grain = ref("month");
    const from = ref("");
    const to = ref("");
    const tab = ref("series");
    const factor = ref("play_duration");
    const keyword = ref("");
    const keywordNames = ref([]);
    const loading = ref(false);

    const serMean = ref(true);
    const starMean = ref(true);
    const facMean = ref(true);
    const kwMean = ref(true);
    const crossMean = ref(true);

    const kpi = ref({ avg: null, delta: null, n: 0, zero: null });
    const serRows = ref([]);
    const facOverall = ref([]);
    const kwHits = ref(null);
    const kwMeta = ref("");
    const crossNote = ref("");

    function avgOf(rows, key) {
      const nums = rows.map((r) => r[key]).filter((v) => v != null && Number.isFinite(Number(v)));
      if (!nums.length) return null;
      return nums.reduce((a, b) => a + Number(b), 0) / nums.length;
    }

    const meanSer = computed(() => {
      const r = serRows.value;
      return {
        n: avgOf(r, "n"),
        avg: avgOf(r, "avg"),
        delta_avg: avgOf(r, "delta_avg"),
        cum_avg: avgOf(r, "cum_avg"),
        zero_ratio: avgOf(r, "zero_ratio"),
        star5: avgOf(r, "star5"),
        star4: avgOf(r, "star4"),
        star3: avgOf(r, "star3"),
        star2: avgOf(r, "star2"),
        star1: avgOf(r, "star1"),
      };
    });

    const meanFac = computed(() => {
      const r = facOverall.value;
      return {
        n: avgOf(r, "n"),
        avg: avgOf(r, "avg"),
        zero_ratio: avgOf(r, "zero_ratio"),
      };
    });

    const gameTitleMap = computed(() => {
      const m = {};
      for (const g of games.value) m[g.gameId] = g.title || g.gameId;
      return m;
    });

    const serCanvas = shallowRef(null);
    const starCanvas = shallowRef(null);
    const facCanvas = shallowRef(null);
    const kwCanvas = shallowRef(null);
    const crossCanvas = shallowRef(null);
    const serLegend = shallowRef(null);
    const starLegend = shallowRef(null);
    const facLegend = shallowRef(null);
    const kwLegend = shallowRef(null);
    const crossLegend = shallowRef(null);

    const charts = {};

    function ensureCharts() {
      if (!charts.ser && serCanvas.value) charts.ser = createChart(serCanvas.value, serLegend.value);
      if (!charts.star && starCanvas.value) charts.star = createChart(starCanvas.value, starLegend.value);
      if (!charts.fac && facCanvas.value) charts.fac = createChart(facCanvas.value, facLegend.value);
      if (!charts.kw && kwCanvas.value) charts.kw = createChart(kwCanvas.value, kwLegend.value);
      if (!charts.cross && crossCanvas.value) charts.cross = createChart(crossCanvas.value, crossLegend.value);
    }

    function params() {
      return {
        grain: grain.value,
        from: from.value || undefined,
        to: to.value || undefined,
      };
    }

    async function loadGames() {
      const data = await api("/api/games", params());
      games.value = data.games;
      if (data.games[0] && !gameId.value) gameId.value = data.games[0].gameId;
    }

    async function loadKeywordDict() {
      const data = await api("/api/keywords");
      keywordNames.value = data.names || [];
      window.__kwExpanded = data.expanded || {};
      if (!keyword.value && keywordNames.value.includes("任一主流二游")) {
        keyword.value = "任一主流二游";
      } else if (!keyword.value && keywordNames.value[0]) {
        keyword.value = keywordNames.value[0];
      }
    }

    async function loadSeries() {
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
      ensureCharts();
      charts.ser?.update({
        labels,
        kind: "line",
        yDomain: { yMin: 0, yMax: 10 },
        series: [
          { name: "局部均分", color: PALETTE[0], values: rows.map((r) => r.avg) },
          { name: "累计均分", color: "#94a3b8", values: rows.map((r) => r.cum_avg) },
        ],
      });
      // 星级柱：计数轴自适应，x 与折线同一套 labels
      charts.star?.update({
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
      });
    }

    async function loadFactors() {
      const data = await api("/api/factors", {
        ...params(),
        gameId: gameId.value,
        factor: factor.value,
      });
      facOverall.value = data.overall || [];
      const rows = data.series || [];
      const buckets = data.buckets || [];
      ensureCharts();
      charts.fac?.update({
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
        })),
      });
    }

    async function loadKeywords() {
      const data = await api("/api/keywords/series", {
        ...params(),
        gameId: gameId.value,
        name: keyword.value,
      });
      const rows = data.periods || [];
      const name = keyword.value;
      const get = (r) => (r.keywords && r.keywords[name]) || {};
      const words = window.__kwExpanded?.[name] || [];
      kwMeta.value = words.length
        ? `词条「${name}」${words.length} 个别名：${words.slice(0, 10).join(" / ")}`
        : "";
      const hitRates = rows.map((r) => get(r).hit_rate).filter((v) => v != null);
      const maxHit = hitRates.length ? Math.max(...hitRates) : 0;
      ensureCharts();
      charts.kw?.update({
        labels: rows.map((r) => r.period),
        kind: "line",
        yDomain: { yMin: -5, yMax: 10 },
        yRightDomain: maxHit > 0.5 ? { yMin: 0, yMax: 1 } : { yMin: 0, yMax: 0.5 },
        series: [
          { name: "命中均分", color: PALETTE[0], values: rows.map((r) => get(r).hit_avg) },
          { name: "未命中均分", color: PALETTE[1], values: rows.map((r) => get(r).miss_avg) },
          { name: "Δ 命中−未命中", color: PALETTE[3], values: rows.map((r) => get(r).delta_hit) },
        ],
        rightSeries: [
          {
            name: "命中率",
            color: "#0ea5e9",
            format: "pct",
            values: rows.map((r) => get(r).hit_rate),
          },
        ],
      });
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
      const data = await api("/api/cross", { ...params(), gameId: ids });
      const periodSet = new Set();
      for (const g of data.games || []) {
        for (const r of data.series[g] || []) periodSet.add(r.period);
      }
      const labels = [...periodSet].sort();
      const titleMap = gameTitleMap.value;
      ensureCharts();
      charts.cross?.update({
        labels,
        kind: "line",
        yDomain: { yMin: 0, yMax: 10 },
        series: (data.games || []).map((g, i) => ({
          name: titleMap[g] || g,
          color: PALETTE[i % PALETTE.length],
          values: labels.map((p) => {
            const r = (data.series[g] || []).find((x) => x.period === p);
            return r ? r.avg : null;
          }),
        })),
      });
      const names = (data.games || []).map((g) => titleMap[g] || g).join(" vs ");
      crossNote.value = `${names} · 重合 uid ${data.overlapUsers ?? 0} · 相关 ${fmt(data.corr, 4)} · 周期局部均分（含 0）`;
    }

    async function runAll() {
      loading.value = true;
      try {
        await nextTick();
        await loadSeries();
        await loadFactors();
        await loadKeywords();
        await loadCross();
        requestAnimationFrame(() => {
          charts.ser?.redraw();
          charts.star?.redraw();
          charts.fac?.redraw();
          charts.kw?.redraw();
          charts.cross?.redraw();
        });
      } catch (e) {
        ElementPlus.ElMessage.error(e.message);
      } finally {
        loading.value = false;
      }
    }

    function downloadCsv(name, columns, rows) {
      const esc = (v) => {
        if (v == null) return "";
        const s = String(v);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [columns.join(",")];
      for (const r of rows) lines.push(columns.map((c) => esc(r[c])).join(","));
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
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
        const d = await api("/api/samples", {
          ...params(),
          gameId: gameId.value,
          page,
          pageSize: 50,
        });
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

    function exportPng(key) {
      const map = { ser: serCanvas, star: starCanvas, fac: facCanvas, kw: kwCanvas, cross: crossCanvas };
      const c = map[key]?.value;
      if (!c) return;
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = `${key}_${gameId.value}_${grain.value}.png`;
      a.click();
    }

    watch(serMean, (v) => charts.ser?.setShowMean(v));
    watch(starMean, (v) => charts.star?.setShowMean(v));
    watch(facMean, (v) => charts.fac?.setShowMean(v));
    watch(kwMean, (v) => charts.kw?.setShowMean(v));
    watch(crossMean, (v) => charts.cross?.setShowMean(v));

    watch(tab, () => {
      nextTick(() => {
        requestAnimationFrame(() => {
          charts.ser?.redraw();
          charts.star?.redraw();
          charts.fac?.redraw();
          charts.kw?.redraw();
          charts.cross?.redraw();
        });
      });
    });

    onMounted(async () => {
      try {
        await loadGames();
        await loadKeywordDict();
        await runAll();
      } catch (e) {
        ElementPlus.ElMessage.error(e.message);
      }
    });

    return {
      games, gameId, gameId2, grain, from, to, tab, factor, keyword, keywordNames,
      loading, serMean, starMean, facMean, kwMean, crossMean,
      kpi, serRows, facOverall, kwHits, kwMeta, crossNote,
      meanSer, meanFac, gameTitleMap,
      serCanvas, starCanvas, facCanvas, kwCanvas, crossCanvas,
      serLegend, starLegend, facLegend, kwLegend, crossLegend,
      fmt, fmtDelta, fmtPct, deltaClass,
      runAll, loadFactors, loadKeywords, exportSerCsv, exportSamples, exportKwHits, exportPng,
    };
  },
};

const app = createApp(App);
app.use(ElementPlus, { locale: ElementPlusLocaleZhCn });
app.mount("#app");
