import { parentPort, workerData } from "node:worker_threads";
import { buildWordFreq } from "./wordfreq.js";

const { gameId, root, from, to, limit, source, sample } = workerData;

buildWordFreq(gameId, root, {
  from,
  to,
  limit,
  source,
  sample,
  onProgress: (n) => parentPort.postMessage({ type: "progress", n }),
})
  .then((data) => parentPort.postMessage({ type: "done", data }))
  .catch((e) => parentPort.postMessage({ type: "error", message: e.message }));
