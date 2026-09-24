import crypto from "node:crypto";

/** biligame GC ApiUtil 签名（appkey + ts + request_id + md5(qs+salt)） */
export const APPKEY = "h9Ejat5tFh81cq8V";
export const SIGN_SALT = "BdiI92bjmZ9QRcjJBWv2EEssyjekAGKt";

const RND = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function random32() {
  let i = "";
  for (let s = 0; s < 32; s++) i += RND[Math.floor(Math.random() * (RND.length - 1))];
  return i;
}

export function md5(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

export function toQuery(obj) {
  return Object.keys(obj)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(obj[k] == null ? "" : obj[k])}`)
    .join("&");
}

export function signParams(params) {
  const a = { ...params };
  a.ts = Date.now();
  a.request_id = random32();
  a.appkey = APPKEY;
  const keys = Object.keys(a).sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const qs = keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(a[k] == null ? "" : a[k])}`).join("&");
  a.sign = md5(qs + SIGN_SALT);
  return a;
}

export function signedUrl(host, path, params) {
  return `${host}${path}?${toQuery(signParams(params))}`;
}
