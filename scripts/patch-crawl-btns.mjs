import fs from "node:fs";
const p = "src/web/app.js";
let s = fs.readFileSync(p, "utf8");

// 1) refreshStatus: always fetch with gameId, always applyStatus (buttons)
const oldRefresh = `async function refreshStatus() {
  if (isFormFocused()) return;
  try {
    const st = await api("/api/crawl/status");`;

const newRefresh = `async function refreshStatus() {
  try {
    const gid = gameId() || state.gameId || undefined;
    const st = await api(\`/api/crawl/status\${gid ? \`?gameId=\${encodeURIComponent(gid)}\` : ""}\`);`;

if (!s.includes(oldRefresh)) {
  // try find by index
  const i = s.indexOf("async function refreshStatus");
  console.log("refreshStatus context:\n", s.slice(i, i + 280));
  throw new Error("refreshStatus pattern not found");
}
s = s.replace(oldRefresh, newRefresh);

// 2) startCrawl / stopCrawl optimistic + guard
const oldStart = `async function startCrawl() {
  const id = gameId();
  if (!id) return alert("请填写 gameId");`;

const newStart = `let crawlBusy = false;

async function startCrawl() {
  if (crawlBusy) return;
  const id = gameId();
  if (!id) return alert("请填写 gameId");
  crawlBusy = true;
  setRunningUI(true, false);`;

if (!s.includes(oldStart)) throw new Error("startCrawl pattern not found");
s = s.replace(oldStart, newStart);

const oldStartEnd = `  await api("/api/crawl/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  logLine({ level: "info", msg: \`已发起采集 mode=\${mode}\` });
}`;

const newStartEnd = `  try {
    await api("/api/crawl/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    logLine({ level: "info", msg: \`已发起采集 mode=\${mode}\` });
    setRunningUI(true, false);
  } catch (e) {
    setRunningUI(false, false);
    throw e;
  } finally {
    crawlBusy = false;
    // 立即对齐真实状态（带 gameId）
    refreshStatus().catch(() => {});
  }
}`;

if (!s.includes(oldStartEnd)) {
  const j = s.indexOf("api(\"/api/crawl/start\"");
  console.log("startCrawl end context:\n", s.slice(j, j + 350));
  throw new Error("startCrawl end pattern not found");
}
s = s.replace(oldStartEnd, newStartEnd);

const oldStop = `async function stopCrawl() {
  await api("/api/crawl/stop", { method: "POST" });
  logLine({ level: "warn", msg: "已请求停止" });
}`;

const newStop = `async function stopCrawl() {
  if (crawlBusy) return;
  crawlBusy = true;
  setRunningUI(true, true); // 停止中：锁开始、保持停止可点
  try {
    await api("/api/crawl/stop", { method: "POST" });
    logLine({ level: "warn", msg: "已请求停止" });
    setRunningUI(true, true);
  } catch (e) {
    setRunningUI(true, false);
    throw e;
  } finally {
    crawlBusy = false;
    refreshStatus().catch(() => {});
  }
}`;

if (!s.includes(oldStop)) throw new Error("stopCrawl pattern not found");
s = s.replace(oldStop, newStop);

fs.writeFileSync(p, s);
console.log("patched start/stop/refreshStatus");
