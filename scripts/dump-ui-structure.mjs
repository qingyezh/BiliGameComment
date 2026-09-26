import fs from "node:fs";

const s = fs.readFileSync("src/web/app.js", "utf8");
const css = fs.readFileSync("src/web/style.css", "utf8");

console.log("=== bindEvents body ===");
const bi = s.indexOf("function bindEvents");
console.log(s.slice(bi, bi + 500));

console.log("\n=== layout CSS ===");
const li = css.indexOf(".layout");
console.log(css.slice(li, li + 250));

console.log("\n=== progress/panel/log/stats/trend CSS snippets ===");
for (const key of [".progress-panel", ".progress-left", ".ring ", ".progress-copy", ".metrics", ".progress-bar", ".panel-head", ".log ", ".stats-row", ".stat-card", ".grade-chart", ".trend-chart", ".table-wrap", ".pager"]) {
  const i = css.indexOf(key);
  if (i >= 0) console.log("---", key, "---\n" + css.slice(i, i + 180) + "\n");
}
