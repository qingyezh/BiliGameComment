/** 轻量词云：螺旋布局 + canvas */
const COLORS = ["#2563eb", "#0d9488", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777"];

export function drawWordCloud(canvas, items) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
  const cssH = canvas.clientHeight || 360;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssW, cssH);
  if (!items || !items.length) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("暂无词条", cssW / 2, cssH / 2);
    return;
  }

  const max = items[0].count || 1;
  const min = items[items.length - 1].count || 1;
  const cx = cssW / 2;
  const cy = cssH / 2;
  const placed = [];
  const occupied = (x, y, w, h) => {
    for (const r of placed) {
      if (x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y) return true;
    }
    return false;
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const t = max === min ? 0.5 : (it.count - min) / (max - min);
    const size = 11 + Math.round(t * 28);
    const rot = i % 3 === 0 ? -Math.PI / 2 : 0;
    ctx.save();
    ctx.font = `600 ${size}px "Segoe UI","PingFang SC","Microsoft YaHei",sans-serif`;
    const tw = ctx.measureText(it.word).width + 4;
    const th = size + 4;
    const bw = rot ? th : tw;
    const bh = rot ? tw : th;

    let x = 0;
    let y = 0;
    let ok = false;
    for (let step = 0; step < 500; step++) {
      const angle = step * 0.35;
      const rad = 2.2 * step;
      x = cx + Math.cos(angle) * rad * 1.4 - bw / 2;
      y = cy + Math.sin(angle) * rad - bh / 2;
      if (x < 4 || y < 4 || x + bw > cssW - 4 || y + bh > cssH - 4) continue;
      if (!occupied(x, y, bw, bh)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      ctx.restore();
      continue;
    }
    placed.push({ x, y, w: bw, h: bh });
    ctx.translate(x + bw / 2, y + bh / 2);
    ctx.rotate(rot);
    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(it.word, 0, 0);
    ctx.restore();
  }
}
