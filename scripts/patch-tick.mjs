import fs from "node:fs";
const p = "src/web/app.js";
let s = fs.readFileSync(p, "utf8");

// tick: 状态/按钮始终刷新；表单字段由 applyStatus 内部防写回
const oldTick = `  try {
    // stats 扫全库很贵，不进 1.5s 心跳；单独低频刷新
    await Promise.all([refreshStatus(), refreshState(), loadTimeline()]);
    setConn(true, "已连接");`;

const newTick = `  try {
    // stats 扫全库很贵，不进 1.5s 心跳；单独低频刷新
    // 状态/按钮必须始终刷新（左侧表单由 applyStatus 防写回）
    await Promise.all([refreshStatus(), refreshState(), loadTimeline()]);
    setConn(true, "已连接");`;

if (!s.includes(oldTick)) {
  const i = s.indexOf("async function tick");
  console.log(s.slice(i, i + 500));
  throw new Error("tick pattern not found");
}
s = s.replace(oldTick, newTick);

// remove isFormFocused early return from tick if still present
s = s.replace(
  `async function tick() {
  if (isFormFocused() || tickBusy) return;`,
  `async function tick() {
  if (tickBusy) return;`
);

fs.writeFileSync(p, s);
console.log("patched tick");
