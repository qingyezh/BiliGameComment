import crypto from "node:crypto";

const APPKEY = "h9Ejat5tFh81cq8V";
const SIGN_SALT = "BdiI92bjmZ9QRcjJBWv2EEssyjekAGKt";

function random32() {
  const a = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let i = "";
  for (let s = 0; s < 32; s++) i += a[Math.floor(Math.random() * (a.length - 1))];
  return i;
}

/** Sign params the same way biligame GC ApiUtil does. */
function signParams(params) {
  const a = { ...params };
  a.ts = Date.now();
  a.request_id = random32();
  a.appkey = APPKEY;
  const keys = Object.keys(a).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  // qs.stringify with sort by key (localeCompare style used in minified code)
  const parts = keys.map((k) => {
    const v = a[k];
    return `${encodeURIComponent(k)}=${encodeURIComponent(v == null ? "" : v)}`;
  });
  const qs = parts.join("&");
  a.sign = crypto.createHash("md5").update(qs + SIGN_SALT).digest("hex");
  return a;
}

const COOKIE =
  "SESSDATA=6adfc289%2C1790609299%2Ca60f9%2A42CjDc2zjJ1-zy7hiWj2c5sm74y-CgMyMjlcqhhJ0aTzaEx7aCLQLDdjLJ3rOYdWrh460SVlpqNzlmekVJckY4M2lJcjByRWI0VERFMzFXbll4QmJsQzJ0NUJ2NDZVM0VWSXBLTEI3M2E3bVRpaE1OUC1reW40cXZILVpjdFpOOFZ5STYyMENDdmZBIIEC; bili_jct=99c78395da0d20032ff19c306b93644f; DedeUserID=609250890; DedeUserID__ckMd5=ffa751ec363e9bca; sid=7pvkd32o; b_nut=1775715636; buvid3=CF2FB1EE-3BA6-5B11-AA8C-5222737ADE3B42829infoc; buvid_fp=c0edb7ae0caf4ba5bbbd2fdc029b4dea; buvid4=FCD00EEA-ADF6-B43B-271C-336DCC703B8F83897-026091514-gM6PnnZPAxNe0crKAPZOVg%3D%3D; b_lsid=61A5A3D5_1A0C76B9822";

const headers = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Referer: "https://www.biligame.com/detail/?id=103496",
  Origin: "https://www.biligame.com",
  Accept: "application/json, text/plain, */*",
  Cookie: COOKIE,
};

function toQuery(obj) {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k] == null ? "" : obj[k])}`)
    .join("&");
}

async function hit(label, path, params) {
  const signed = signParams(params);
  const qs = toQuery(signed);
  const url = `https://line3-h5-pc-api.biligame.com${path}?${qs}`;
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();
    console.log(`\n==== ${label} ${res.status} ====`);
    console.log(text.slice(0, 700));
  } catch (e) {
    console.log(`\n==== ${label} ERR ====`, e.message);
  }
}

await hit("comment page", "/game/comment/page", {
  game_base_id: 103496,
  rank_type: 3,
  page_num: 1,
  page_size: 2,
  mark_hot_filter_list: "",
  hit_mark_hot_exp: false,
  sdk_type: 11,
});

await hit("comment summary", "/game/comment/summary", {
  game_base_id: 103496,
  sdk_type: 11,
});

await hit("comment recommend", "/game/comment/recommend", {
  game_base_id: 103496,
  hit_mark_hot_exp: false,
  sdk_type: 11,
});

await hit("gameinfo signed", "/game/detail/gameinfo", {
  game_base_id: 103496,
  sdk_type: 11,
});

// also try line1
const signed = signParams({
  game_base_id: 103496,
  rank_type: 3,
  page_num: 1,
  page_size: 2,
  mark_hot_filter_list: "",
  hit_mark_hot_exp: false,
  sdk_type: 11,
});
const url1 = `https://line1-h5-pc-api.biligame.com/game/comment/page?${toQuery(signed)}`;
const res1 = await fetch(url1, { headers });
console.log("\n==== line1 comment page", res1.status, "====");
console.log((await res1.text()).slice(0, 500));
