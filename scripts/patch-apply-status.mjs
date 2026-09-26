import fs from "node:fs";
const p = "src/web/app.js";
let s = fs.readFileSync(p, "utf8");
const start = s.indexOf("function applyStatus");
const end = s.indexOf("function renderCursorBox");
if (start < 0 || end < 0) throw new Error("markers not found " + start + " " + end);

const replacement = `/** 只改按钮，不写左侧表单 */
function setRunningUI(running, stopping = false) {
  const busy = !!(running || stopping);
  const startBtn = $("#btnStart");
  const stopBtn = $("#btnStop");
  if (startBtn) startBtn.disabled = busy;
  if (stopBtn) stopBtn.disabled = !busy;
}

function applyStatus(st) {
  const running = !!(st && st.running);
  const stopping = !!(st && st.stopping);
  setRunningUI(running, stopping);

  const dot = $("#statusDot");
  const text = $("#statusText");
  if (dot) dot.className = "dot";
  if (text) {
    if (!st || (!st.running && !st.gameId)) {
      text.textContent = "空闲";
    } else if (st.stopping) {
      if (dot) dot.classList.add("paused");
      text.textContent = "正在停止…";
    } else if (running) {
      if (dot) dot.classList.add("running");
      text.textContent = \`采集中 · \${st.mode || ""}\`;
    } else if (st.stoppedByDup) {
      if (dot) dot.classList.add("paused");
      text.textContent = "增量已采完（重复自动停）";
    } else if (st.lastError && st.errorCount >= 8) {
      if (dot) dot.classList.add("error");
      text.textContent = "异常停止";
    } else if (st.gameId) {
      if (dot) dot.classList.add("paused");
      text.textContent = "已停止 / 可续爬";
    }
  }

  if (st && st.gameId) {
    const idInput = $("#gameId");
    if (idInput && !idInput.value && !isFormFocused()) idInput.value = st.gameId;
    const titleEl = $("#progressTitle");
    if (titleEl) titleEl.textContent = st.title || \`Game \${st.gameId}\`;
    const completed = st.pageCount
      ? Math.min(st.pageCount, Math.max(0, (st.pageNum || 1) - 1))
      : st.sessionPages;
    const pct = st.pageCount ? Math.min(100, (completed / st.pageCount) * 100) : 0;
    const pctText = $("#pctText");
    if (pctText) pctText.textContent = st.pageCount ? \`\${pct.toFixed(1)}%\` : "—";
    const barFg = $("#barFg");
    if (barFg) barFg.style.width = \`\${pct}%\`;
    const C = 2 * Math.PI * 52;
    const ringFg = $("#ringFg");
    if (ringFg) ringFg.style.strokeDashoffset = String(C * (1 - pct / 100));
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set("#mCount", fmt(st.seenCount ?? st.crawledCount));
    set("#mNew", fmt(st.sessionNew ?? 0));
    set(
      "#mPage",
      st.pageCount
        ? \`\${fmt(Math.max(0, (st.pageNum || 1) - 1))} / \${fmt(st.pageCount)}\`
        : \`\${fmt(st.sessionPages)} 页\`
    );
    set("#mRate", String(st.ratePerSec ?? 0));
    set("#mEta", fmtEta(st.etaSec));
    state.gameId = st.gameId;
  }
}

`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
console.log("patched applyStatus/setRunningUI, new length", s.length);
