import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** 进程内缓存：必须带指纹，文件变更即失效 */
const mem = new Map();

export function fingerprintOf(files) {
  const parts = [];
  for (const f of [].concat(files)) {
    try {
      const st = fs.statSync(f);
      parts.push(`${path.basename(f)}:${st.mtimeMs}:${st.size}`);
    } catch {
      parts.push(`${path.basename(String(f))}:missing`);
    }
  }
  return crypto.createHash("md5").update(parts.join("|")).digest("hex").slice(0, 16);
}

function cacheDir(root) {
  const d = path.join(root, "data", "_cache");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function fileFor(root, key) {
  const h = crypto.createHash("md5").update(String(key)).digest("hex").slice(0, 24);
  return path.join(cacheDir(root), h + ".json");
}

export function memGet(key, fingerprint) {
  const e = mem.get(key);
  if (e && e.fp === fingerprint) return e.payload;
  return undefined;
}

export function memSet(key, fingerprint, payload) {
  mem.set(key, { fp: fingerprint, payload });
  if (mem.size > 80) {
    const k = mem.keys().next().value;
    mem.delete(k);
  }
}

export function memDel(key) {
  mem.delete(key);
}

export function memDelByGame(gameId) {
  const gid = String(gameId);
  for (const k of [...mem.keys()]) {
    if (String(k).includes(gid)) mem.delete(k);
  }
}

export function loadCache(root, key, fingerprint) {
  try {
    const raw = fs.readFileSync(fileFor(root, key), "utf8");
    const j = JSON.parse(raw);
    if (j && j.fingerprint === fingerprint && j.payload !== undefined) return j.payload;
  } catch {
    /* miss */
  }
  return null;
}

export function saveCache(root, key, fingerprint, payload) {
  try {
    const p = fileFor(root, key);
    const tmp = p + ".tmp";
    fs.writeFileSync(
      tmp,
      JSON.stringify({ fingerprint, key: String(key), savedAt: new Date().toISOString(), payload }),
      "utf8"
    );
    fs.renameSync(tmp, p);
  } catch {
    /* ignore */
  }
}

export function dropCache(root, key) {
  mem.delete(key);
  try {
    fs.unlinkSync(fileFor(root, key));
  } catch {
    /* ignore */
  }
}

/** ingest 写库后：清该游戏磁盘缓存 + 本进程内存（ingest 侧仅磁盘） */
export function invalidateGameCache(root, gameId) {
  const gid = String(gameId);
  memDelByGame(gid);
  const dir = cacheDir(root);
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const p = path.join(dir, f);
      try {
        const j = JSON.parse(fs.readFileSync(p, "utf8"));
        const k = String(j?.key || "");
        if (k.includes(gid) || k.split("|").includes(gid)) {
          fs.unlinkSync(p);
          n++;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* ignore */
  }
  return n;
}

export function commentsPath(root, gameId) {
  return path.join(root, "data", String(gameId), "comments.jsonl");
}

/**
 * 统一读写：force 时跳过缓存重算并回写；
 * 否则内存(带指纹) → 磁盘(带指纹) → 重算。
 */
export function cachedCompute(root, key, fp, compute, force = false) {
  if (!force) {
    const m = memGet(key, fp);
    if (m !== undefined) return Promise.resolve(m);
    const d = loadCache(root, key, fp);
    if (d != null) {
      memSet(key, fp, d);
      return Promise.resolve(d);
    }
  } else {
    dropCache(root, key);
  }
  return Promise.resolve(compute()).then((payload) => {
    saveCache(root, key, fp, payload);
    memSet(key, fp, payload);
    return payload;
  });
}

export const withCache = cachedCompute;
