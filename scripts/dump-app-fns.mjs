import fs from "node:fs";
const s = fs.readFileSync("src/web/index.html", "utf8");
const a = s.indexOf('<aside class="panel controls">');
const b = s.indexOf("</aside>");
console.log(s.slice(a, b + 10));
