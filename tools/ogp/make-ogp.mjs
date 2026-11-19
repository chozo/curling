// SNS 共有用の OGP 画像（public/ogp.png、1200×630）を作る。
// 実際のゲーム画面（ハウスへ滑り込むストーンをスイープしている場面）を撮って、
// タイトル画面と同じタッチのロゴ・ストーンのイラスト・遊び方・URL を重ねる。
// 使い方: npm run ogp（ビルド → vite preview → 撮影 → 合成）
//   --frames <dir> を付けると、候補のコマも保存する（選び直し用）
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const framesDir = opt('--frames', '');
const PORT = 4331;
const SLUG = 'curling';

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes(String(PORT)) && res());
  server.on('exit', () => rej(new Error('vite preview が起動しませんでした')));
});
const url = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });

// 撮影用に、ゲームの文字やボタンを隠し、画面いっぱいに描く
const HIDE_UI =
  '#hud,#hint,#toast,#cpu-think,#spin-btn,#throw-btn,#gauge,#sweep-zone,#sweep-meter,.overlay{display:none!important}' +
  '#stage{aspect-ratio:auto!important;width:100vw!important;height:100vh!important}';

// 1) 背景: ハウスの盤面へ、スイープしながら滑り込む赤いストーン
async function gameShot() {
  const page = await browser.newPage({ viewport: { width: 780, height: 630 }, deviceScaleFactor: 2 });
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.addStyleTag({ content: HIDE_UI });
  await page.evaluate(() => {
    Math.random = (() => {
      let s = 42;
      return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    })();
    window.__game.start();
    window.__game.manual(true);
    // 盤面: CPU（黄）2つ・自分（赤）1つ。後攻なので CPU から投げ、3投置くと自分の番
    window.__game.placeStones([
      { team: 1, x: 0.42, y: 28.35 + 0.3 },
      { team: 0, x: -0.78, y: 28.35 + 0.95 },
      { team: 1, x: -0.25, y: 28.35 - 1.35 },
    ]);
    window.__game.setSweep(1);
    window.__game.throwPower(0.5, -1.0);
  });
  const picks = [25.2, 25.8, 26.4, 27.0];
  const KEEP = 26.4;
  let keep = null;
  for (const y of picks) {
    for (let i = 0; i < 2000; i++) {
      const cy = await page.evaluate(() => {
        window.__game.step(1 / 60);
        return window.__game.state().current?.y ?? 99;
      });
      if (cy >= y) break;
    }
    const buf = await page.screenshot();
    if (framesDir) fs.writeFileSync(path.join(framesDir, `game-${y}.png`), buf);
    if (y === KEEP) keep = buf;
  }
  await page.close();
  return keep;
}

if (framesDir) fs.mkdirSync(framesDir, { recursive: true });
const bg = await gameShot();
const dataUrl = (b) => `data:image/png;base64,${b.toString('base64')}`;

// タイトル画面のイラスト（index.html のインライン SVG）をそのまま使う
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const art = indexHtml.match(/<div class="ts-art" aria-hidden="true">([\s\S]*?)<div class="ts-ice"><\/div>([\s\S]*?)<\/div>\s*<ul class="ts-howto">/);
if (!art) throw new Error('index.html からイラストを取り出せませんでした');
const artHtml = (art[1] + art[2]).replace(/<svg class="broom"[\s\S]*?<\/svg>/, '');

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=M+PLUS+Rounded+1c:wght@800;900&display=block" rel="stylesheet">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root { --red: #ff4b55; --yellow: #ffd23f; --navy: #1b2a52; }
body { width: 1200px; height: 630px; overflow: hidden; position: relative;
  font-family: 'M PLUS Rounded 1c', 'Hiragino Maru Gothic ProN', system-ui, sans-serif; color: var(--navy); background: #4aa8f0; }
.game { position: absolute; right: 0; top: 0; width: 780px; height: 630px;
  background: url(${dataUrl(bg)}) no-repeat; background-size: 1092px 882px; background-position: -150px -170px; filter: saturate(1.15); }
.panel { position: absolute; inset: 0 auto 0 0; width: 700px;
  clip-path: polygon(0 0, 100% 0, 78% 100%, 0 100%);
  background: radial-gradient(circle at 30% 42%, #ffffff 0%, #e2f6ff 34%, #9fdcff 70%, #5ab3f2 100%); }
.edge { position: absolute; inset: 0 auto 0 0; width: 716px;
  clip-path: polygon(0 0, 100% 0, 78.4% 100%, 0 100%); background: var(--navy); }
.house { position: absolute; left: -150px; top: 70px; width: 560px; height: 560px; border-radius: 50%; opacity: 0.16;
  background: radial-gradient(circle, #fff 0 4.5%, #d23a3f 4.5% 16.5%, #fff 16.5% 33%, #2f6fd0 33% 50%, transparent 50%); }
.house::after { content: ''; position: absolute; inset: 14%; border-radius: 50%; border: 6px dashed #fff; }
.spark { position: absolute; color: #fff; text-shadow: 0 0 10px #fff; }
.text { position: absolute; left: 58px; top: 46px; }
.catch { display: inline-block; padding: 8px 26px; border-radius: 40px; background: var(--navy); color: #fff;
  font-size: 30px; font-weight: 900; transform: rotate(-3deg); box-shadow: 0 6px 0 #0d1733; }
h1 { display: flex; gap: 2px; margin-top: 6px; font-size: 128px; line-height: 1.12; font-weight: 900; }
h1 span { -webkit-text-stroke: 22px var(--navy); paint-order: stroke fill; text-shadow: 0 13px 0 var(--navy); display: inline-block; }
h1 span:nth-child(odd) { color: var(--red); }
h1 span:nth-child(even) { color: var(--yellow); }
h1 span:nth-child(2) { transform: translateY(-6px) rotate(-4deg); }
h1 span:nth-child(4) { transform: translateY(-4px) rotate(3deg); }
.lead { margin-top: 16px; font-size: 34px; font-weight: 900; line-height: 1.45; }
.lead em { font-style: normal; color: var(--red); }
.steps { display: flex; gap: 12px; margin-top: 18px; }
.steps li { list-style: none; display: flex; align-items: center; gap: 8px; padding: 8px 16px 8px 8px; border-radius: 40px;
  background: #fff; font-size: 23px; font-weight: 900; box-shadow: 0 5px 0 #1b2a5233; }
.steps b { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; color: #fff; font-size: 21px; }
.url { position: absolute; right: 30px; bottom: 28px; padding: 8px 22px; border-radius: 30px; background: #ffffffd9;
  font-size: 25px; font-weight: 900; letter-spacing: 0.04em; border: 3px solid var(--navy); }
.art { position: absolute; left: 34px; top: 372px; width: 470px; height: 250px; }
.art .stone { position: absolute; overflow: visible; filter: drop-shadow(0 10px 0 rgba(27,42,82,0.25)); }
.art .stone-red { width: 290px; left: 0; bottom: 0; transform: rotate(-4deg); }
.art .stone-yellow { width: 215px; right: 0; bottom: 64px; transform: rotate(5deg); }
.badge { position: absolute; right: 36px; top: 30px; padding: 12px 22px; border-radius: 18px; background: var(--yellow);
  border: 4px solid var(--navy); box-shadow: 0 7px 0 var(--navy); font-size: 28px; font-weight: 900; transform: rotate(4deg); }
</style></head><body>
<div class="game"></div>
<div class="edge"></div>
<div class="panel"></div>
<div class="house"></div>
<span class="spark" style="left:612px;top:40px;font-size:40px">✦</span>
<span class="spark" style="left:560px;top:250px;font-size:26px">✧</span>
<span class="spark" style="left:520px;top:400px;font-size:30px">✦</span>
<div class="text">
  <div class="catch">CPU とガチンコ勝負！</div>
  <h1><span>カ</span><span>ー</span><span>リ</span><span>ン</span><span>グ</span></h1>
  <p class="lead">ねらって、<em>タップ</em>で投げて、<br>こすって伸ばせ！</p>
</div>
<div class="art">${artHtml}</div>
<div class="url">game.chozo.net/${SLUG}</div>
<div class="badge">3D カーリング</div>
</body></html>`;

const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const out = path.join(root, 'public/ogp.png');
await page.screenshot({ path: out, type: 'png' });
console.log('書き出し:', out);
await browser.close();
server.kill();
