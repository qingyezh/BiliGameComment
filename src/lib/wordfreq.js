import { readComments, periodKey, normRange, inRange } from "./analyze.js";

const STOP = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "会", "着", "没有", "看", "好", "自己", "这", "那", "什么", "可以", "还是", "就是", "没", "吧", "啊", "呢", "吗", "呀", "哦", "嗯", "哈", "嘛", "啦", "哦",
  "被", "把", "从", "对", "为", "而", "或", "与", "及", "等", "更", "最", "只", "还", "又", "再", "能", "得", "地", "个", "们", "么", "之", "其", "该", "这个", "那个", "什么", "怎么", "怎样", "因为", "所以", "但是", "而且", "如果", "虽然", "然后", "并且", "或者",
  "真的", "觉得", "感觉", "现在", "时候", "一下", "一些", "这种", "那种", "这么", "那么", "这样", "那样", "不是", "不了", "一样", "一直", "已经", "还有", "比较", "非常", "有点", "多少", "几个", "怎么",
  "谢谢", "哈哈", "嘿嘿", "呜呜", "x_x", "www", "http", "https", "com", "cn",
]);

const PRUNE_AT = 120000;
const KEEP_TOP = 80000;

function bump(freq, w) {
  if (!w || w.length < 2) return;
  if (STOP.has(w)) return;
  if (/^\d+$/.test(w)) return;
  if (/^[a-z]$/.test(w)) return;
  if (/^(.)\1+$/.test(w)) return;
  if (/^[啊哈嘿哦嗯呀嘛啦哇唉咦呃呵嘻唔呦嗷]{2,}$/.test(w)) return;
  freq.set(w, (freq.get(w) || 0) + 1);
}

/** 词表剪枝：去掉低频，只保留 Top KEEP_TOP */
function prune(freq) {
  if (freq.size < PRUNE_AT) return;
  const arr = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, KEEP_TOP);
  freq.clear();
  for (const [w, c] of arr) freq.set(w, c);
}

function addText(freq, text) {
  if (!text) return;
  const re = /[A-Za-z][A-Za-z0-9_]{1,20}|[0-9]{2,6}|[一-龥]+/g;
  let m;
  while ((m = re.exec(text))) {
    const tok = m[0];
    if (/^[A-Za-z]/.test(tok)) {
      bump(freq, tok.toLowerCase());
      continue;
    }
    if (/^\d/.test(tok)) continue;
    if (tok.length >= 2 && tok.length <= 4) bump(freq, tok);
    if (tok.length >= 3) {
      for (let i = 0; i + 2 <= tok.length; i++) bump(freq, tok.slice(i, i + 2));
    }
  }
}

/** 词频；source: both | user | comment */
export async function buildWordFreq(gameId, root, { from, to, limit = 300, source = "both", onProgress, sample = 0 } = {}) {
  const freq = new Map();
  const rg = normRange("month", from, to);
  const useUser = source === "both" || source === "user";
  const useComment = source === "both" || source === "comment";
  let n = 0;
  for await (const c of readComments(gameId, root)) {
    n++;
    if (onProgress && n % 20000 === 0) onProgress(n);
    if (sample > 0 && n > sample) break;
    const pk = periodKey(c.publish_time, "month");
    if (!pk || !inRange(pk, rg.from, rg.to)) continue;
    if (useUser) addText(freq, c.user_name);
    if (useComment) addText(freq, c.content);
    if (n % 20000 === 0) prune(freq);
  }
  prune(freq);
  // Top-K：只保留前 limit 个（词表已剪枝，排序代价可控）
  const words = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(1, limit))
    .map(([word, count]) => ({ word, count }));
  return { gameId, source, words, types: freq.size, scanned: n };
}
