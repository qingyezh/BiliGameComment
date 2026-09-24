/**
 * 轻量 Canvas 多折线/柱图 + 图例显隐 + 悬停读数 + CSV / PNG 导出
 */
export const PALETTE = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4"];

const CHART_H = 400;

function ensureOverlay(canvas) {
  let tip = canvas.parentElement.querySelector(".chart-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.style.cssText = [
      "position:absolute",
      "pointer-events:none",
      "z-index:5",
      "background:rgba(15,23,42,0.92)",
      "color:#fff",
      "font-size:12px",
      "line-height:1.45",
      "padding:8px 10px",
      "border-radius:8px",
      "max-width:260px",
      "display:none",
      "box-shadow:0 6px 20px rgba(15,23,42,0.2)",
    ].join(";");
    canvas.parentElement.style.position = "relative";
    canvas.parentElement.appendChild(tip);
  }
  return tip;
}

function formatNum(v) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "k";
  if (Number.isInteger(v)) return String(v);
  return Number(v).toFixed(2);
}

/** 量程→合适刻度步长（约 4–6 档） */
function niceStep(span) {
  if (!(span > 0)) return 1;
  const raw = span / 5;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return mult * pow;
}

/** Catmull-Rom → 三次贝塞尔，平滑曲线 */
function drawSmoothCurve(ctx, pts) {
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    ctx.stroke();
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 1 / 6;
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) * t,
      p1.y + (p2.y - p0.y) * t,
      p2.x - (p3.x - p1.x) * t,
      p2.y - (p3.y - p1.y) * t,
      p2.x,
      p2.y
    );
  }
  ctx.stroke();
}

export function createChart(canvas, legendEl, opts = {}) {
  let needsRedraw = false;
  const state = {
    labels: [],
    series: [],
    hidden: new Set(),
    kind: "line",
    hits: [],
    pad: { t: 20, r: 150, b: 56, l: 52 },
    min: 0,
    max: 1,
    layout: null,
    showMean: true,
    /** 固定 Y 轴：{yMin, yMax}；null 表示自适应 */
    yDomain: opts.yDomain || null,
    /** 右轴序列（命中率等） */
    rightSeries: [],
    yRightDomain: opts.yRightDomain || { yMin: 0, yMax: 0.5 },
    yRightLog: !!opts.yRightLog,
  };

  const tip = ensureOverlay(canvas);

  function visibleSeries() {
    return state.series
      .map((s, i) => ({ ...s, _i: i }))
      .filter((s) => !state.hidden.has(s._i));
  }

  function layout() {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const host = canvas.parentElement || canvas;
    // 以容器为准铺满；canvas CSS 为 100%，测量 host 更稳
    const cssW = host.clientWidth || canvas.clientWidth;
    const cssH = host.clientHeight > 40 ? host.clientHeight : CHART_H;
    // 布局未完成（display:none / 0 宽）时不画
    if (!cssW || cssW < 40) return null;
    // 位图 = CSS 像素 × dpr，与 100% 显示区 1:1，既铺满又不发虚
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, cssW, cssH, dpr };
  }

  let raf = 0;
  function scheduleRedraw() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      draw();
    });
  }

  function draw() {
    const lay = layout();
    if (!lay) {
      needsRedraw = true;
      scheduleRedraw();
      return;
    }
    needsRedraw = false;
    const { ctx, cssW, cssH } = lay;
    ctx.clearRect(0, 0, cssW, cssH);
    const { t, r, b, l } = state.pad;
    // 用 labels 与 values 最大长度，避免 labels 空导致柱/点挤在左侧
    const n = Math.max(
      state.labels.length,
      ...state.series.map((s) => s.values.length),
      ...((state.rightSeries || []).map((s) => s.values.length)),
      1
    );

    // 动态右侧预留：按均值标签实测宽度扩展，防止超出画布被裁切
    const visPre = visibleSeries();
    const rightPre = (state.rightSeries || []).filter((s) => !state.hiddenRight?.has(s.name));
    const meanLabelTexts = [];
    if (state.showMean) {
      for (const s of visPre) {
        const nums = s.values.filter((v) => v != null && Number.isFinite(v));
        if (!nums.length) continue;
        const mu = nums.reduce((a, b) => a + b, 0) / nums.length;
        meanLabelTexts.push(`${shortName(s.name)} μ=${fmtMu(mu)}`);
      }
      for (const s of rightPre) {
        const nums = s.values.filter((v) => v != null && Number.isFinite(v));
        if (!nums.length) continue;
        const mu = nums.reduce((a, b) => a + b, 0) / nums.length;
        if ((s.format || "pct") === "pct") meanLabelTexts.push(`命中率：${(mu * 100).toFixed(2)}%`);
        else meanLabelTexts.push(`${shortName(s.name)} μ=${formatNum(mu)}`);
      }
    }
    ctx.font = "600 11px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    let maxLabelW = 0;
    for (const lb of meanLabelTexts) maxLabelW = Math.max(maxLabelW, ctx.measureText(lb).width);
    const needR = Math.max(r, Math.ceil(maxLabelW + 56), 110);
    const w = Math.max(48, cssW - l - needR);
    // 右侧安全区：给方框/胶囊描边与圆角留足余量
    const labelRight = cssW - 12;
    const h = cssH - t - b;

    const vis = visibleSeries();
    const vals = vis.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)));
    let min;
    let max;
    if (state.yDomain && state.yDomain.yMin != null && state.yDomain.yMax != null) {
      min = state.yDomain.yMin;
      max = state.yDomain.yMax;
    } else if (state.kind === "bar") {
      // 柱状（星级计数）自适应
      min = 0;
      max = vals.length ? Math.max(...vals) : 1;
      if (max === min) max = min + 1;
    } else {
      min = vals.length ? Math.min(...vals) : 0;
      max = vals.length ? Math.max(...vals) : 1;
      if (min === max) {
        min -= 1;
        max += 1;
      }
      const span = max - min;
      min -= span * 0.1;
      max += span * 0.1;
    }
    state.min = min;
    state.max = max;

    // 组中心：0..n-1 均匀铺满绘图区
    const xAt = (i) => l + (n <= 1 ? w / 2 : (w * i) / (n - 1));
    const yAt = (v) => t + h - ((v - min) / (max - min)) * h;
    const rD = state.yRightDomain || { yMin: 0, yMax: 0.5 };
    const rMin = rD.yMin ?? 0;
    let rMax = rD.yMax ?? 0.5;
    // 任一右轴点超出量程：pct 扩到 100%，计数等扩到数据最大值
    {
      const rVals = (state.rightSeries || []).flatMap((s) =>
        s.values.filter((v) => v != null && Number.isFinite(v))
      );
      const mx = rVals.length ? Math.max(...rVals) : 0;
      if (mx > rMax) {
        if (rMax < 1) rMax = 1;
        else rMax = mx;
      }
    }
    const rLog = !!state.yRightLog;
    const log1pSafe = (v) => Math.log1p(Math.max(0, v));
    const yAtR = (v) => {
      if (rLog) {
        const a = log1pSafe(rMin);
        const b = log1pSafe(rMax);
        const t0 = log1pSafe(v);
        return t + h - ((t0 - a) / (b - a || 1)) * h;
      }
      return t + h - ((v - rMin) / (rMax - rMin || 1)) * h;
    };
    state.layout = { l, t, w, h, xAt, yAt, yAtR, n, cssW, cssH };

    ctx.strokeStyle = "#e5eaf2";
    ctx.fillStyle = "#6b7a90";
    ctx.font = "11px sans-serif";
    ctx.lineWidth = 1;
    // 水平网格：0–1 百分比域每 25%；固定量程每 2.5 分；否则 4 等分
    const yTicks = [];
    const yPct = state.yFormat === "pct" || (max <= 1.001 && min >= -0.001 && max > 0);
    const ySpan = max - min;
    if (state.yDomain && state.yDomain.yMin != null && state.yDomain.yMax != null) {
      let yStep;
      if (yPct) yStep = 0.25;
      else if (ySpan > 0 && ySpan <= 12) yStep = 2.5;
      else yStep = niceStep(ySpan);
      for (let v = min; v <= max + 1e-9; v += yStep) {
        yTicks.push(Math.round(v * 1000) / 1000);
        if (yTicks.length > 12) break;
      }
      if (yTicks[yTicks.length - 1] < max - 1e-9) yTicks.push(max);
    } else {
      for (let i = 0; i <= 4; i++) yTicks.push(max - ((max - min) * i) / 4);
    }
    for (const v of yTicks) {
      const y = yAt(v);
      ctx.beginPath();
      ctx.moveTo(l, y);
      ctx.lineTo(l + w, y);
      ctx.stroke();
      const yl = yPct ? (v * 100).toFixed(0) + "%" : formatNum(v);
      ctx.fillText(yl, 4, y + 3);
    }

    // y=0 黑色基线（先画，叠在曲线下面）
    if (min <= 0 && max >= 0) {
      const y0 = yAt(0);
      ctx.save();
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.25;
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(l, y0);
      ctx.lineTo(l + w, y0);
      ctx.stroke();
      ctx.restore();
    }

    // 右轴（命中率）刻度
    const rightVis = (state.rightSeries || []).filter((s) => !state.hiddenRight?.has(s.name));
    if (rightVis.length) {
      ctx.fillStyle = "#6b7a90";
      ctx.font = "11px sans-serif";
      ctx.textAlign = "left";
      for (let i = 0; i <= 4; i++) {
        let rv;
        if (rLog) {
          const a = log1pSafe(rMin);
          const b = log1pSafe(rMax);
          rv = Math.expm1(b - ((b - a) * i) / 4);
        } else {
          rv = rMax - ((rMax - rMin) * i) / 4;
        }
        const y = yAtR(rv);
        ctx.beginPath();
        ctx.strokeStyle = "rgba(229,234,242,0.85)";
        ctx.moveTo(l + w, y);
        ctx.lineTo(l + w + 4, y);
        ctx.stroke();
        const rFmt = (rightVis[0] && rightVis[0].format) || "pct";
        const rLbl = rFmt === "pct" ? (rv * 100).toFixed(0) + "%" : formatNum(rv);
        ctx.fillText(rLbl, l + w + 6, y + 3);
      }
    }

    ctx.fillStyle = "#6b7a90";
    const xStep = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += xStep) {
      ctx.save();
      ctx.translate(xAt(i), t + h + 12);
      ctx.rotate(-Math.PI / 5);
      ctx.textAlign = "right";
      ctx.fillText(String(state.labels[i] ?? ""), 0, 0);
      ctx.restore();
    }

    state.hits = [];
    if (state.kind === "bar") {
      const groupW = n > 1 ? w / (n - 1 + 0.6) : w * 0.7;
      const barW = Math.max(2, Math.min(18, (groupW * 0.8) / Math.max(1, vis.length)));
      const maxBar = Math.max(1, ...(vals.length ? vals : [1]));
      vis.forEach((s, si) => {
        const color = s.color || PALETTE[s._i % PALETTE.length];
        ctx.fillStyle = color;
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return;
          // 与折线同一 xAt，整组柱子在组中心对齐
          const cx = xAt(i);
          const groupWidth = barW * vis.length;
          const x = cx - groupWidth / 2 + barW * si;
          const bh = (Math.max(0, v) / maxBar) * h;
          const y = t + h - bh;
          ctx.fillRect(x, y, barW, Math.max(1, bh));
          state.hits.push({
            x: x + barW / 2,
            y: y + bh / 2,
            i,
            name: s.name,
            value: v,
            label: state.labels[i] ?? String(i + 1),
            color,
          });
        });
      });
      if (state.showMean) {
        const means = [];
        for (const s of vis) {
          const color = s.color || PALETTE[s._i % PALETTE.length];
          const nums = s.values.filter((v) => v != null && Number.isFinite(v));
          if (!nums.length) continue;
          const mu = nums.reduce((a, b) => a + b, 0) / nums.length;
          const y = t + h - (Math.max(0, mu) / maxBar) * h;
          means.push({ name: s.name, color, mu, y });
        }
        for (const m of means) {
          ctx.save();
          ctx.strokeStyle = m.color;
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(l, m.y);
          ctx.lineTo(l + w - 4, m.y);
          ctx.stroke();
          ctx.restore();
        }
        means.sort((a, b) => a.y - b.y);
        let prevBottom = -Infinity;
        for (const m of means) {
          let y = m.y - 9;
          if (y < t + 1) y = t + 1;
          if (y < prevBottom + 6) y = prevBottom + 6;
          if (y + 18 > t + h - 1) y = t + h - 1 - 18;
          prevBottom = y + 18;
          drawMeanPill(ctx, labelRight, y, m, 18);
        }
      }
    } else {
      vis.forEach((s) => {
        const color = s.color || PALETTE[s._i % PALETTE.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash(s.dash ? [6, 4] : []);
        ctx.beginPath();
        let started = false;
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return;
          const x = xAt(i);
          const y = yAt(v);
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return;
          const x = xAt(i);
          const y = yAt(v);
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
          state.hits.push({ x, y, i, name: s.name, value: v, label: state.labels[i], color, format: s.format || "num" });
        });
      });

      // 右轴曲线（命中率）— 虚线
      for (const s of rightVis) {
        const color = s.color || "#0ea5e9";
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const pts = [];
        s.values.forEach((v, i) => {
          if (v == null || !Number.isFinite(v)) return;
          pts.push({ x: xAt(i), y: yAtR(v), v, i });
        });
        ctx.beginPath();
        if (pts.length) {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        pts.forEach((p) => {
          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
          state.hits.push({
            x: p.x,
            y: p.y,
            i: p.i,
            name: s.name,
            value: p.v,
            label: state.labels[p.i],
            color,
            format: s.format || "num",
          });
        });
      }

      // 均值参考线 + 右端标签（左轴胶囊 / 右轴方框）
      if (state.showMean) {
        const means = [];
        for (const s of vis) {
          const color = s.color || PALETTE[s._i % PALETTE.length];
          const nums = s.values.filter((v) => v != null && Number.isFinite(v));
          if (!nums.length) continue;
          const mu = nums.reduce((a, b) => a + b, 0) / nums.length;
          const muText =
            s.format === "pct"
              ? `${shortName(s.name)} μ=${(mu * 100).toFixed(2)}%`
              : `${shortName(s.name)} μ=${fmtMu(mu)}`;
          means.push({
            name: s.name,
            color,
            mu,
            y: yAt(mu),
            text: muText,
            style: s.format === "pct" ? "box" : "pill",
          });
        }
        for (const s of rightVis) {
          const color = s.color || "#0ea5e9";
          const nums = s.values.filter((v) => v != null && Number.isFinite(v));
          if (!nums.length) continue;
          const mu = nums.reduce((a, b) => a + b, 0) / nums.length;
          const rFmt = s.format || "pct";
          means.push({
            name: s.name,
            color,
            mu,
            y: yAtR(mu),
            text:
              rFmt === "pct"
                ? `命中率：${(mu * 100).toFixed(2)}%`
                : rFmt === "ln"
                  ? `ln(n+1)=${fmtMu(mu)}`
                  : `${shortName(s.name)} μ=${formatNum(mu)}`,
            style: "box",
          });
        }
        // 虚线贯通绘图区，标签在右侧 pad 内
        for (const m of means) {
          ctx.save();
          ctx.strokeStyle = m.color;
          ctx.globalAlpha = 0.5;
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(l, m.y);
          ctx.lineTo(l + w, m.y);
          ctx.stroke();
          ctx.restore();
        }
        // 标签从上到下排，过近则下推避让
        means.sort((a, b) => a.y - b.y);
        const labelH = 18;
        const minGap = 6;
        let prevBottom = -Infinity;
        for (const m of means) {
          let y = m.y - labelH / 2;
          if (y < t + 1) y = t + 1;
          if (y < prevBottom + minGap) y = prevBottom + minGap;
          if (y + labelH > t + h - 1) y = t + h - 1 - labelH;
          prevBottom = y + labelH;
          if (m.style === "box") {
            drawMeanBox(ctx, labelRight, y, m, labelH);
          } else {
            drawMeanPill(ctx, labelRight, y, m, labelH);
          }
        }
      }
    }
  }

  /** 两位小数；负号用 U+2212，避免被虚线/裁切“吃掉” */
  function fmtMu(v) {
    const s = Math.abs(v).toFixed(2);
    return v < 0 ? "−" + s : s;
  }

  function shortName(n) {
    const s = String(n || "");
    return s.length > 8 ? s.slice(0, 7) + "…" : s;
  }

  /** 右轴均值：直角方框（非胶囊），右缘贴齐 canvas 内侧 */
  function drawMeanBox(ctx, rightX, y, m, hgt) {
    const label = m.text;
    ctx.save();
    ctx.font = "600 11px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const padX = 10;
    const textW = ctx.measureText(label).width;
    // 含色点 + 内边距 + 描边，整体限制在 rightX 左侧
    const wBox = Math.min(textW + padX * 2 + 14, Math.max(88, rightX - 10));
    const x = rightX - wBox;
    // 直角矩形
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fillRect(x, y, wBox, hgt);
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, wBox - 1, hgt - 1);
    ctx.globalAlpha = 1;
    const ink = "#1f2a37";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const cy = y + hgt / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText(label, x + padX, cy);
    ctx.fillStyle = ink;
    ctx.fillText(label, x + padX, cy);
    // 左侧方块色标
    ctx.fillStyle = m.color;
    ctx.fillRect(x + 4, cy - 3, 6, 6);
    ctx.restore();
  }

  /** 左轴均值：圆角胶囊 */
  function drawMeanPill(ctx, rightX, y, m, hgt) {
    const label = m.text != null ? m.text : `${shortName(m.name)} μ=${fmtMu(m.mu)}`;
    ctx.save();
    ctx.font = "600 11px 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    const padX = 10;
    const textW = ctx.measureText(label).width;
    const wBox = Math.min(textW + padX * 2 + 14, Math.max(88, rightX - 10));
    const x = rightX - wBox;
    // 胶囊
    const r = hgt / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + wBox, y, x + wBox, y + hgt, r);
    ctx.arcTo(x + wBox, y + hgt, x, y + hgt, r);
    ctx.arcTo(x, y + hgt, x, y, r);
    ctx.arcTo(x, y, x + wBox, y, r);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 白描边 + 彩字（负值用深红加重减号可读性）
    const ink = m.mu < 0 ? "#b42318" : "#1f2a37";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const cy = y + hgt / 2;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText(label, x + padX, cy);
    ctx.fillStyle = ink;
    ctx.fillText(label, x + padX, cy);
    // 左侧色条，对应曲线
    ctx.fillStyle = m.color;
    ctx.beginPath();
    ctx.arc(x + 5, cy, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function renderLegend() {
    if (!legendEl) return;
    const all = [
      ...state.series.map((s, i) => ({ ...s, _i: i, _side: "left" })),
      ...(state.rightSeries || []).map((s, i) => ({ ...s, _i: 100 + i, _side: "right", name: s.name })),
    ];
    // 底部居中「色块 + 名称」词条；点击切换曲线显隐
    legendEl.innerHTML = all
      .map((s, i) => {
        const key = s._side === "right" ? "R" + (s._i - 100) : "L" + s._i;
        const off =
          s._side === "right"
            ? state.hiddenRight?.has(s.name)
            : state.hidden.has(s._i);
        const color = s.color || PALETTE[i % PALETTE.length];
        return `<button type="button" class="legend-item${off ? " off" : ""}" data-key="${key}" title="点击显示/隐藏">
          <i style="background:${color}"></i><span>${escapeHtml(s.name)}</span>
        </button>`;
      })
      .join("");
    legendEl.querySelectorAll(".legend-item").forEach((btn) => {
      btn.onclick = () => {
        const key = btn.dataset.key;
        if (key.startsWith("R")) {
          const name = state.rightSeries[Number(key.slice(1))]?.name;
          if (!state.hiddenRight) state.hiddenRight = new Set();
          if (state.hiddenRight.has(name)) state.hiddenRight.delete(name);
          else state.hiddenRight.add(name);
        } else {
          const i = Number(key.slice(1));
          if (state.hidden.has(i)) state.hidden.delete(i);
          else state.hidden.add(i);
        }
        draw();
        renderLegend();
      };
    });
  }

  canvas.addEventListener("mousemove", (ev) => {
    if (!state.hits.length || !state.layout) {
      tip.style.display = "none";
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / rect.width) * (state.layout.cssW || rect.width);
    const y = ((ev.clientY - rect.top) / rect.height) * (state.layout.cssH || rect.height);
    let best = null;
    let bestD = 14 * 14;
    for (const h of state.hits) {
      const dx = h.x - x;
      const dy = h.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (!best) {
      tip.style.display = "none";
      return;
    }
    const showVal =
      best.format === "pct"
        ? (Number(best.value) * 100).toFixed(2) + "%"
        : best.format === "ln"
          ? `ln=${fmtMu(best.value)}（n=${Math.max(0, Math.round(Math.exp(best.value) - 1))}）`
          : formatNum(best.value);
    tip.innerHTML = `<div style="opacity:.85">${escapeHtml(best.label)}</div>
      <div><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${best.color};margin-right:6px"></span>${escapeHtml(best.name)}：<b>${showVal}</b></div>`;
    tip.style.display = "block";
    const tw = tip.offsetWidth || 120;
    const th = tip.offsetHeight || 40;
    let left = best.x + 12;
    let top = best.y - th - 8;
    if (left + tw > canvas.clientWidth - 4) left = best.x - tw - 12;
    if (top < 4) top = best.y + 12;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  });

  canvas.addEventListener("mouseleave", () => {
    tip.style.display = "none";
  });

  // 尺寸变化 / 首帧布局完成后补画
  const ro = new ResizeObserver(() => scheduleRedraw());
  ro.observe(canvas.parentElement || canvas);
  window.addEventListener("resize", scheduleRedraw);

  return {
    update({ labels, series, kind = "line", yDomain, rightSeries, yRightDomain, yRightLog } = {}) {
      if (labels) state.labels = labels;
      if (series) {
        state.series = series;
      }
      if (yDomain !== undefined) state.yDomain = yDomain;
      if (rightSeries !== undefined) state.rightSeries = rightSeries || [];
      if (yRightDomain !== undefined) state.yRightDomain = yRightDomain;
      if (yRightLog !== undefined) state.yRightLog = !!yRightLog;
      state.kind = kind || "line";
      draw();
      renderLegend();
    },
    setShowMean(on) {
      state.showMean = !!on;
      draw();
    },
    getShowMean: () => state.showMean,
    redraw: scheduleRedraw,
    getState: () => state,
  };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportCanvasPng(canvas, filename) {
  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = filename || "chart.png";
  a.click();
}

export function exportRowsCsv(filename, columns, rows) {
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
  a.download = filename || "export.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function bindChartExport(btnCsv, btnPng, canvas, getCsvPayload, nameBase) {
  if (btnCsv) {
    btnCsv.onclick = () => {
      const { columns, rows } = getCsvPayload();
      exportRowsCsv(`${nameBase}.csv`, columns, rows);
    };
  }
  if (btnPng) {
    btnPng.onclick = () => exportCanvasPng(canvas, `${nameBase}.png`);
  }
}

export function renderLegendStatic(el, series) {
  if (!el) return;
  el.innerHTML = series
    .map(
      (s, i) =>
        `<span class="legend-item"><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${escapeHtml(s.name)}</span>`
    )
    .join("");
}

export { PALETTE as COLORS, formatNum };
