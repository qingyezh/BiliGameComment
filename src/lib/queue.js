import fs from "node:fs";
import path from "node:path";

/**
 * 目录文件队列（方案 A）
 * 入队：*.tmp → rename；出队按文件名排序；ack 移入 _done
 */
export function queuePaths(root = process.cwd()) {
  const base = path.join(root, "data");
  const queue = path.join(base, "_queue");
  const done = path.join(base, "_done");
  const failed = path.join(base, "_failed");
  fs.mkdirSync(queue, { recursive: true });
  fs.mkdirSync(done, { recursive: true });
  fs.mkdirSync(failed, { recursive: true });
  return { base, queue, done, failed };
}

function padSeq(n) {
  return String(n).padStart(12, "0");
}

let seq = 0;
function nextSeq() {
  seq += 1;
  return padSeq(Date.now()) + "-" + padSeq(seq);
}

export function enqueue(root, payload) {
  const { queue } = queuePaths(root);
  const name = `${nextSeq()}-${payload.gameId}-p${payload.page}.json`;
  const tmp = path.join(queue, name + ".tmp");
  const final = path.join(queue, name);
  fs.writeFileSync(tmp, JSON.stringify(payload), "utf8");
  fs.renameSync(tmp, final);
  return name;
}

export function depth(root) {
  const { queue } = queuePaths(root);
  return fs.readdirSync(queue).filter((f) => f.endsWith(".json")).length;
}

export function listPending(root) {
  const { queue } = queuePaths(root);
  return fs
    .readdirSync(queue)
    .filter((f) => f.endsWith(".json"))
    .sort();
}

export function readJob(root, name) {
  const { queue } = queuePaths(root);
  return JSON.parse(fs.readFileSync(path.join(queue, name), "utf8"));
}

export function ack(root, name) {
  const { queue, done } = queuePaths(root);
  const src = path.join(queue, name);
  const dst = path.join(done, name);
  try {
    fs.renameSync(src, dst);
  } catch {
    try {
      fs.unlinkSync(src);
    } catch {
      /* ignore */
    }
  }
}

export function failJob(root, name) {
  const { queue, failed } = queuePaths(root);
  const src = path.join(queue, name);
  const dst = path.join(failed, name);
  try {
    fs.renameSync(src, dst);
  } catch {
    /* ignore */
  }
}
