import fs from "node:fs";
const p = "src/web/index.html";
let s = fs.readFileSync(p, "utf8");
const a = s.indexOf('<aside class="panel controls">');
const b = s.indexOf("</aside>");
if (a < 0 || b < 0) throw new Error("aside not found");

const aside = `<aside class="panel controls">
        <section>
          <h2>目标游戏</h2>
          <label class="field">
            <span>Game ID</span>
            <div class="row">
              <input id="gameId" type="text" value="103496" placeholder="如 103496" />
              <button id="btnPreview" class="btn" type="button">预览</button>
            </div>
          </label>
          <div id="gameCard" class="game-card hidden">
            <img id="gameIcon" alt="" />
            <div>
              <div id="gameTitle" class="game-title"></div>
              <div id="gameMeta" class="game-meta"></div>
            </div>
          </div>
        </section>

        <section>
          <h2>任务类型</h2>
          <label class="field">
            <span>采集模式</span>
            <select id="mode">
              <option value="full_resume">全量续爬（从断点继续）</option>
              <option value="full_restart">全量重来（从第 1 页）</option>
              <option value="incremental">增量更新（重复自动停）</option>
            </select>
          </label>
        </section>

        <section class="actions">
          <button id="btnStart" class="btn primary" type="button">开始采集</button>
          <button id="btnStop" class="btn danger" type="button" disabled>停止</button>
        </section>

        <section>
          <h2>断点</h2>
          <div id="cursorBox" class="cursor-box">读取中…</div>
        </section>

        <section>
          <h2>已存数据</h2>
          <ul id="gameList" class="game-list"></ul>
        </section>

        <section>
          <h2>Cookie</h2>
          <label class="field">
            <span>浏览器 Cookie（含 SESSDATA）</span>
            <textarea id="cookie" rows="4" placeholder="SESSDATA=...; bili_jct=...; buvid3=..."></textarea>
          </label>
          <div class="row">
            <button id="btnSaveCookie" class="btn" type="button">保存到本地</button>
            <span id="cookieState" class="hint"></span>
          </div>
        </section>

        <section>
          <h2>采集参数</h2>
          <div class="grid2">
            <label class="field">
              <span>page_size（≤20）</span>
              <input id="pageSize" type="number" min="1" max="20" value="20" />
            </label>
            <label class="field">
              <span>rank_type</span>
              <input id="rankType" type="number" value="3" />
            </label>
            <label class="field">
              <span>间隔 ms（≥600 + 抖动 0–200）</span>
              <input id="delayMs" type="number" min="600" value="600" />
            </label>
            <label class="field">
              <span>试跑页数（空=不限）</span>
              <input id="maxPages" type="number" min="1" placeholder="例如 5" />
            </label>
          </div>
          <label class="check">
            <input id="dupStop" type="checkbox" checked />
            <span>增量：大量重复自动停</span>
          </label>
          <div class="grid2">
            <label class="field">
              <span>重复窗口</span>
              <input id="dupWindow" type="number" min="5" value="50" />
            </label>
            <label class="field">
              <span>重复阈值</span>
              <input id="dupThreshold" type="number" min="1" value="45" />
            </label>
          </div>
          <label class="check">
            <input id="saveRaw" type="checkbox" />
            <span>额外保存 raw 页 JSONL</span>
          </label>
        </section>
      </aside>`;

s = s.slice(0, a) + aside + s.slice(b + "</aside>".length);
fs.writeFileSync(p, s);
console.log("left panel reordered 1-7");
