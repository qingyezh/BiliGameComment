import fs from "node:fs";
const p = "src/server.js";
let s = fs.readFileSync(p, "utf8");

const oldRun = `const running = crawl?.status === "running" || (cmd?.action === "start" && crawl?.status !== "stopped" && crawl?.status !== "done");`;

const newRun = `// running：本游戏 runtime 为 running，或 cmd 指向本游戏且 runtime 尚未终态
    const cmdTargetsThisGame =
      cmd?.action === "start" && (!cmd.gameId || String(cmd.gameId) === String(gameId));
    const statusFile = crawl?.status || "";
    const running =
      statusFile === "running" ||
      (cmdTargetsThisGame && statusFile !== "stopped" && statusFile !== "done" && statusFile !== "");`;

if (!s.includes(oldRun)) {
  const i = s.indexOf("const running = crawl");
  console.log(s.slice(i, i + 300));
  throw new Error("running pattern not found");
}
s = s.replace(oldRun, newRun);

// also surface stopping if stop cmd recently - optional; skip for now
fs.writeFileSync(p, s);
console.log("patched server running heuristic");
