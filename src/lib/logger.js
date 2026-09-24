import fs from "node:fs";
import path from "node:path";

/**
 * 轻量双通道日志：控制台 + 按日文件（text + jsonl）
 */
export function createLogger({ root = process.cwd(), name = "crawl" } = {}) {
  const dir = path.join(root, "logs");
  fs.mkdirSync(dir, { recursive: true });

  function dayStamp(d = new Date()) {
    return d.toISOString().slice(0, 10);
  }

  function files() {
    const day = dayStamp();
    return {
      text: path.join(dir, `${name}-${day}.log`),
      jsonl: path.join(dir, `${name}-${day}.jsonl`),
    };
  }

  function write(level, msg, extra = {}) {
    const ts = new Date().toISOString();
    const f = files();
    const line = `${ts} [${level.toUpperCase()}] ${msg}`;
    try {
      fs.appendFileSync(f.text, line + "\n", "utf8");
      fs.appendFileSync(f.jsonl, JSON.stringify({ ts, level, msg, ...extra }) + "\n", "utf8");
    } catch {
      /* 日志失败不影响主流程 */
    }
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return { ts, level, msg, ...extra };
  }

  return {
    dir,
    debug: (msg, extra) => write("debug", msg, extra),
    info: (msg, extra) => write("info", msg, extra),
    warn: (msg, extra) => write("warn", msg, extra),
    error: (msg, extra) => write("error", msg, extra),
  };
}
