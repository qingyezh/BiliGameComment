import { signedUrl } from "./sign.js";

export const HOSTS = [
  "https://line3-h5-pc-api.biligame.com",
  "https://line1-h5-pc-api.biligame.com",
];

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function buildHeaders({ cookie, gameId } = {}) {
  const h = {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: `https://www.biligame.com/detail/?id=${gameId || 103496}`,
    Origin: "https://www.biligame.com",
  };
  if (cookie) h.Cookie = cookie;
  return h;
}

async function requestOnce(path, params, { cookie, gameId, host, timeoutMs = 12000 } = {}) {
  const base = host || HOSTS[0];
  const url = signedUrl(base, path, params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: buildHeaders({ cookie, gameId }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, code: -1, message: `非 JSON 响应: ${text.slice(0, 120)}` };
    }
    return { ok: json.code === 0, status: res.status, ...json };
  } finally {
    clearTimeout(timer);
  }
}

/** 双线容灾：line3 失败再试 line1 */
export async function request(path, params, opts = {}) {
  const errors = [];
  for (const host of HOSTS) {
    try {
      const r = await requestOnce(path, params, { ...opts, host });
      if (r.ok) return r;
      // 业务可重试错误不切换主机时也记录
      errors.push(`${host}: code=${r.code} ${r.message || ""}`);
      if (r.code === -400 || r.code === -1203) {
        // 参数/风控类错误，换主机意义不大，但仍然试完
      }
    } catch (e) {
      errors.push(`${host}: ${e.name === "AbortError" ? "timeout" : e.message}`);
    }
  }
  const err = new Error(errors.join(" | ") || "request failed");
  err.errors = errors;
  throw err;
}

export async function fetchGameInfo(gameId, cookie) {
  const r = await request("/game/detail/gameinfo", { game_base_id: gameId, sdk_type: 11 }, { cookie, gameId });
  return r.data;
}

export async function fetchCommentGameInfo(gameId, cookie) {
  const r = await request("/game/detail/comment/gameinfo", { game_base_id: gameId, sdk_type: 11 }, { cookie, gameId });
  return r.data;
}

export async function fetchCommentSummary(gameId, cookie) {
  const r = await request("/game/comment/summary", { game_base_id: gameId, sdk_type: 11 }, { cookie, gameId });
  return r.data;
}

export async function fetchCommentPage(gameId, pageNum, pageSize, opts = {}) {
  const {
    cookie,
    rankType = 3,
    markHotFilterList = "",
    hitMarkHotExp = false,
    includeReplies = false,
  } = opts;
  const r = await request(
    "/game/comment/page",
    {
      game_base_id: gameId,
      rank_type: rankType,
      page_num: pageNum,
      page_size: pageSize,
      mark_hot_filter_list: markHotFilterList,
      hit_mark_hot_exp: hitMarkHotExp,
      sdk_type: 11,
    },
    { cookie, gameId }
  );
  const data = r.data || {};
  let list = data.list || [];
  if (!includeReplies) {
    list = list.map((c) => {
      const { reply_list, official_reply, ...rest } = c;
      return rest;
    });
  }
  return {
    pageNumber: data.page_number ?? pageNum,
    pageSize: data.page_size ?? pageSize,
    pageCount: data.page_count ?? 0,
    list,
    ts: r.ts,
  };
}

/** 去掉楼中楼等大字段，保留分析所需主字段 */
export function normalizeComment(c, gameId) {
  return {
    game_base_id: c.game_base_id ?? gameId,
    comment_no: c.comment_no,
    uid: c.uid,
    user_name: c.user_name,
    user_level: c.user_level,
    user_official_verify_type: c.user_official_verify_type,
    user_official_verify_desc: c.user_official_verify_desc,
    grade: c.grade,
    publish_time: c.publish_time,
    content: c.content,
    device_type: c.device_type || "",
    up_count: c.up_count ?? 0,
    down_count: c.down_count ?? 0,
    reply_count: c.reply_count ?? 0,
    report_status: c.report_status ?? 0,
    evaluate_status: c.evaluate_status ?? 0,
    mark_hot_list: c.mark_hot_list || [],
    hot_recall: c.hot_recall ?? 0,
    play_duration: c.play_duration ?? 0,
    play_duration_text: c.play_duration_text || "",
  };
}
