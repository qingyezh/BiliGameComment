import crypto from "node:crypto";

function dec(t) {
  let e = "";
  for (let n = 0; n < t.length; n++) e += String.fromCharCode(t.charCodeAt(n) - 1);
  return e;
}

const imgKey = dec("d569546b86c252:db:9bc7e99c5d71e5");
const subKey = dec("557251g796:g54:f:ee94g8fg969e2de");

const mixinTable = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33,
  9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26,
  17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20,
  34, 44, 52,
];

function mixinKey(img, sub) {
  const n = img + sub;
  const r = [];
  for (const t of mixinTable) {
    if (n.charAt(t)) r.push(n.charAt(t));
  }
  return r.join("").slice(0, 32);
}

function encWbi(params, img = imgKey, sub = subKey) {
  const s = mixinKey(img, sub);
  const wts = Math.round(Date.now() / 1000);
  const u = { ...params, wts };
  const keys = Object.keys(u).sort();
  const d = [];
  const f = /[!'()*]/g;
  for (const p of keys) {
    let m = u[p];
    if (m && typeof m === "string") m = m.replace(f, "");
    if (m !== undefined && m !== null) {
      d.push(`${encodeURIComponent(p)}=${encodeURIComponent(m)}`);
    }
  }
  const v = d.join("&");
  const w_rid = crypto.createHash("md5").update(v + s).digest("hex");
  return { query: v + "&w_rid=" + w_rid, w_rid, wts };
}

const cookie =
  "SESSDATA=6adfc289%2C1790609299%2Ca60f9%2A42CjDc2zjJ1-zy7hiWj2c5sm74y-CgMyMjlcqhhJ0aTzaEx7aCLQLDdjLJ3rOYdWrh460SVlpqNzlmekVJckY4M2lJcjByRWI0VERFMzFXbll4QmJsQzJ0NUJ2NDZVM0VWSXBLTEI3M2E3bVRpaE1OUC1reW40cXZILVpjdFpOOFZ5STYyMENDdmZBIIEC; bili_jct=99c78395da0d20032ff19c306b93644f; DedeUserID=609250890; buvid3=CF2FB1EE-3BA6-5B11-AA8C-5222737ADE3B42829infoc";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.biligame.com/detail/?id=103496",
  Origin: "https://www.biligame.com",
  Accept: "application/json, text/plain, */*",
  Cookie: cookie,
};

const device = JSON.stringify({
  platform: "web",
  device: "",
  spmid: "555.222",
});

async function tryUrl(label, url) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    console.log(`\n==== ${label} status=${res.status} ====`);
    console.log(text.slice(0, 500));
  } catch (e) {
    console.log(`\n==== ${label} ERR ====`);
    console.log(String(e));
  }
}

const hosts = [
  "https://line3-h5-pc-api.biligame.com",
  "https://le3-api.game.bilibili.com/pc",
];

const bases = [
  {
    game_base_id: 103496,
    rank_type: 3,
    page_num: 1,
    page_size: 2,
    sdk_type: 11,
  },
  {
    game_base_id: "103496",
    rank_type: 3,
    page_num: 1,
    page_size: 2,
    mark_hot_filter_list: "",
    hit_mark_hot_exp: false,
    sdk_type: 11,
  },
  {
    game_base_id: 103496,
    rank_type: 3,
    page_num: 1,
    page_size: 10,
    mark_hot_filter_list: "",
    hit_mark_hot_exp: false,
    "x-bili-device-req-json": device,
    sdk_type: 11,
  },
];

for (const host of hosts) {
  for (const [i, params] of bases.entries()) {
    const signed = encWbi(params);
    await tryUrl(`wbi ${host} set${i}`, `${host}/game/comment/page?${signed.query}`);
    await tryUrl(
      `nowbi ${host} set${i}`,
      `${host}/game/comment/page?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()}`
    );
  }
  // summary with wbi
  const sum = encWbi({ game_base_id: 103496, sdk_type: 11 });
  await tryUrl(`summary wbi ${host}`, `${host}/game/comment/summary?${sum.query}`);
  await tryUrl(`recommend wbi ${host}`, `${host}/game/comment/recommend?${encWbi({ game_base_id: 103496, hit_mark_hot_exp: false, sdk_type: 11 }).query}`);
}
