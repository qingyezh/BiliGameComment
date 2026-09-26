import fs from "node:fs";

function check(label, htmlPath, appPath) {
  const s = fs.readFileSync(appPath, "utf8");
  const html = fs.readFileSync(htmlPath, "utf8");
  const ids = [...new Set([...s.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)].map((m) => m[1]))].sort();
  const missing = ids.filter((id) => !html.includes(`id="${id}"`));
  console.log(label, "missing:", missing.join(", ") || "(none)");
  console.log(label, "lines:", html.split(/\r?\n/).length, "has main:", /class="main"/.test(html));
}

check("current", "src/web/index.html", "src/web/app.js");
if (fs.existsSync("scripts/index.backup.html")) {
  check("backup", "scripts/index.backup.html", "src/web/app.js");
}
const s = fs.readFileSync("src/web/app.js", "utf8");
console.log(
  "bindEvents():",
  (s.match(/function bindEvents\s*\(/g) || []).length,
  "defs /",
  (s.match(/(?<!function )bindEvents\s*\(/g) || []).length,
  "calls"
);
