import { mapGrade, normRange, periodKey, readComments } from "./analyze.js";

/** df=1 卡方尾概率：p = erfc(√(χ²/2)) */
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r =
    t *
    Math.exp(
      -z * z - 1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))))
    );
  return x >= 0 ? r : 2 - r;
}

/** 2×2 独立性检验：行=源好/源差，列=目标好/目标差 */
function chi2Ind(a, b, c, d) {
  const n = a + b + c + d;
  if (n <= 0) return { chi2: null, p: null, phi: null, related: null };
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const c2 = b + d;
  if (!r1 || !r2 || !c1 || !c2) return { chi2: null, p: null, phi: null, related: null };
  const num = n * (a * d - b * c) ** 2;
  const den = r1 * r2 * c1 * c2;
  const chi2 = num / den;
  const p = erfc(Math.sqrt(chi2 / 2));
  const phi = (a * d - b * c) / Math.sqrt(den);
  return {
    chi2: +chi2.toFixed(4),
    p: +p.toFixed(6),
    phi: +phi.toFixed(4),
    related: p < 0.05,
  };
}

/**
 * 跨游戏四格占比（周期局部）
 * 好评: grade_mapped >= 8（4–5星）；差评: 0/2/4/6
 * 分母：共同 uid 且目标游戏评论落在当期的条数；四条加总=1
 */
export async function buildCrossDist(gameA, gameB, root, opts = {}) {
  const grain = opts.grain || "month";
  const rg = normRange(grain, opts.from, opts.to);

  // 源游戏：uid → 是否好评（该用户在源游戏全部评论均分 >= 8）
  const src = new Map();
  for await (const c of readComments(gameA, root)) {
    const id = c.uid;
    if (id == null) continue;
    let a = src.get(id);
    if (!a) {
      a = { sum: 0, n: 0 };
      src.set(id, a);
    }
    a.sum += mapGrade(c.grade);
    a.n++;
  }
  for (const a of src.values()) a.pos = a.n ? a.sum / a.n >= 8 : false;

  const cells = new Map();
  for await (const c of readComments(gameB, root)) {
    const pk = periodKey(c.publish_time, grain);
    if (!pk) continue;
    if (rg.from && pk < rg.from) continue;
    if (rg.to && pk > rg.to) continue;
    const s = src.get(c.uid);
    if (!s) continue;
    const sh = s.pos ? 1 : 0;
    const th = mapGrade(c.grade) >= 8 ? 1 : 0;
    let b = cells.get(pk);
    if (!b) {
      b = { n: 0, pp: 0, pn: 0, np: 0, nn: 0 };
      cells.set(pk, b);
    }
    b.n++;
    if (sh === 1 && th === 1) b.pp++;
    else if (sh === 1 && th === 0) b.pn++;
    else if (sh === 0 && th === 1) b.np++;
    else b.nn++;
  }

  const ov = { n: 0, pp: 0, pn: 0, np: 0, nn: 0 };
  const periods = [...cells.keys()].sort().map((period) => {
    const b = cells.get(period);
    ov.n += b.n;
    ov.pp += b.pp;
    ov.pn += b.pn;
    ov.np += b.np;
    ov.nn += b.nn;
    const z = b.n || 1;
    const st = chi2Ind(b.pp, b.pn, b.np, b.nn);
    return {
      period,
      n: b.n,
      pp: +(b.pp / z).toFixed(4),
      pn: +(b.pn / z).toFixed(4),
      np: +(b.np / z).toFixed(4),
      nn: +(b.nn / z).toFixed(4),
      chi2: st.chi2,
      p: st.p,
      phi: st.phi,
      related: st.related,
    };
  });
  const z = ov.n || 1;
  const ost = chi2Ind(ov.pp, ov.pn, ov.np, ov.nn);
  return {
    direction: `${gameA}→${gameB}`,
    overview: {
      n: ov.n,
      pp: +(ov.pp / z).toFixed(4),
      pn: +(ov.pn / z).toFixed(4),
      np: +(ov.np / z).toFixed(4),
      nn: +(ov.nn / z).toFixed(4),
      chi2: ost.chi2,
      p: ost.p,
      phi: ost.phi,
      related: ost.related,
    },
    periods,
  };
}
