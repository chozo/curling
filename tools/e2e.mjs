// ブラウザでの動作確認。playwright-core + インストール済み Chrome（ヘッドレス）
// 使い方: npm run build && npm run e2e [-- --url http://...] [--shots 出力先]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const shots = opt('--shots', 'e2e-shots');
let url = opt('--url', '');
let server;
if (!url) {
  server = spawn('npx', ['vite', 'preview', '--port', '4327', '--strictPort'], { stdio: 'pipe' });
  await new Promise((res) => {
    server.stdout.on('data', (d) => String(d).includes('4327') && res());
    setTimeout(res, 5000);
  });
  url = 'http://localhost:4327/';
}
mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-unsafe-swiftshader'],
});
let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK ' : 'NG '} ${msg}`);
  if (!ok) failed++;
};
const st = (page) => page.evaluate(() => window.__game.state());
const waitPhase = (page, phase, timeout = 30000) =>
  page.waitForFunction((p) => window.__game.state().phase === p, phase, { timeout });

async function run(viewport, tag) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForFunction(() => window.__game);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/${tag}-1-title.png` });

  const box = await page.locator('#stage').boundingBox();
  check(
    box.y >= -1 && box.y + box.height <= viewport.height + 1 && box.x >= -1 && box.x + box.width <= viewport.width + 1,
    `${tag}: 画面に収まる ${Math.round(box.width)}x${Math.round(box.height)}`,
  );

  // 先攻・1エンドを選ぶ
  await page.click('#order-seg button[data-v="first"]');
  await page.click('#ends-seg button[data-v="1"]');
  await page.screenshot({ path: `${shots}/${tag}-1b-title-first.png` });
  await page.click('#start-btn', { force: true });
  await waitPhase(page, 'aim');
  let s = await st(page);
  check(s.turn === 0 && s.hammer === 1, `${tag}: 先攻を選ぶと自分から投げ、ハンマーは CPU`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/${tag}-2-aim.png` });

  // 狙う: 左右にドラッグで目印が動く
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.6;
  const tx0 = s.targetX;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + box.width * 0.2, cy, { steps: 6 });
  await page.mouse.up();
  s = await st(page);
  check(s.targetX > tx0 + 0.3, `${tag}: ドラッグで目印が動く ${tx0.toFixed(2)} → ${s.targetX.toFixed(2)}`);
  // 回転を切り替えると、目印がおすすめの位置へ
  await page.click('#spin-btn');
  s = await st(page);
  check(s.spin === -1 && Math.abs(s.targetX - 1.1) < 1e-6, `${tag}: 回転を切り替えると目印が反対側へ (${s.targetX.toFixed(2)})`);
  await page.screenshot({ path: `${shots}/${tag}-2b-aim-target.png` });

  // 投げる: ボタンでゲージが動き、ゲージがハウスの範囲に来たらタップ
  await page.click('#throw-btn');
  check((await st(page)).phase === 'power', `${tag}: 「投げる」でゲージが動き出す`);
  const [lo, hi] = await page.evaluate(() => [window.__game.powerAtY(28.35 - 1.2), window.__game.powerAtY(28.35 + 1.2)]);
  await page.waitForFunction(([lo, hi]) => {
    const p = window.__game.state().power;
    return p > lo && p < hi;
  }, [lo, hi]);
  await page.screenshot({ path: `${shots}/${tag}-3-power.png` });
  await page.mouse.click(cx, cy);
  s = await st(page);
  check(s.phase === 'run', `${tag}: タップで投げる（ゲージ ${s.lastThrow?.power.toFixed(2)}, 到達距離 ${s.lastThrow?.dist.toFixed(1)}m）`);

  // スイープ: ゾーン内を左右にこする
  await page.waitForTimeout(700);
  s = await st(page);
  check(s.zone.on, `${tag}: スイープの帯が出る`);
  const z = s.zone;
  const zy = box.y + z.y + z.h / 2;
  await page.mouse.move(box.x + z.x + z.w * 0.3, zy);
  await page.mouse.down();
  for (let i = 0; i < 24; i++) {
    await page.mouse.move(box.x + z.x + z.w * (i % 2 ? 0.25 : 0.75), zy, { steps: 3 });
    await page.waitForTimeout(25);
  }
  s = await st(page);
  await page.screenshot({ path: `${shots}/${tag}-4-sweep.png` });
  await page.mouse.up();
  check(s.sweep > 0.3, `${tag}: こするとスイープが効く (${s.sweep.toFixed(2)})`);

  await page.evaluate(() => window.__game.setTimeScale(5));
  // CPU の手番: 考えて、狙いを見せて、投げる
  await waitPhase(page, 'cpu');
  await page.waitForFunction(() => window.__game.state().cpuShot);
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${shots}/${tag}-5-cpu-aim.png` });
  await waitPhase(page, 'run');
  s = await st(page);
  check(s.current.team === 1, `${tag}: CPU が投げる（${s.cpuShot.kind}）`);
  // CPU の石が動いている間、プレイヤーはスイープできない
  check(!s.zone.on, `${tag}: CPU の石ではスイープの帯が出ない`);
  await page.waitForFunction(() => window.__game.state().current?.y > 24, null, { timeout: 30000 });
  await page.screenshot({ path: `${shots}/${tag}-6-cpu-run.png` });

  // 残りの自分の手番はフックで投げる
  for (let i = 0; i < 3; i++) {
    await waitPhase(page, 'aim');
    await page.evaluate((i) => window.__game.throwPower([0.5, 0.2, 0.55][i], [-1.1, 0, 0.9][i]), i);
  }
  await waitPhase(page, 'result', 60000);
  s = await st(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${shots}/${tag}-7-result.png` });
  const cpuStones = s.stones.filter((x) => x.team === 1).length;
  check(s.thrown === 8 && cpuStones === 4, `${tag}: 1エンド8投（CPU 4投）で終了 得点 ${s.scores[0].join(',')} - ${s.scores[1].join(',')}`);
  const tied = s.scores[0][0] === s.scores[1][0];
  const nextVisible = await page.isVisible('#next-btn');
  check(tied ? nextVisible : await page.isVisible('#again-btn'), `${tag}: 1エンド戦の終わり（${tied ? '同点→エキストラエンド' : '勝敗表示'}）`);

  // 後攻・2エンドを自動で通す（ハンマーの受け渡しを確認）
  await page.click('#title-btn');
  await page.click('#order-seg button[data-v="second"]');
  await page.click('#ends-seg button[data-v="2"]');
  await page.evaluate(() => {
    window.__game.setAuto(true);
    window.__game.setTimeScale(8);
  });
  await page.click('#start-btn', { force: true });
  s = await st(page);
  check(s.hammer === 0, `${tag}: 後攻を選ぶとハンマーは自分`);
  await waitPhase(page, 'result', 120000);
  s = await st(page);
  const r1 = [s.scores[0][0], s.scores[1][0]];
  const expectHammer = r1[0] > 0 ? 1 : r1[1] > 0 ? 0 : 0;
  check(s.hammer === expectHammer, `${tag}: 1エンド目 ${r1.join('-')} → 次のハンマーは ${['自分', 'CPU'][s.hammer]}`);
  await page.click('#next-btn');
  await page.waitForFunction(() => window.__game.state().endIdx >= 2 && window.__game.state().phase === 'result', null, { timeout: 120000 });
  s = await st(page);
  await page.screenshot({ path: `${shots}/${tag}-8-final.png` });
  const t0 = s.scores[0].reduce((a, b) => a + b, 0);
  const t1 = s.scores[1].reduce((a, b) => a + b, 0);
  check(t0 !== t1 ? await page.isVisible('#again-btn') : await page.isVisible('#next-btn'), `${tag}: 2エンド終了 ${t0}-${t1}`);
  await page.evaluate(() => window.__game.setAuto(false));
  if (t0 !== t1) {
    await page.click('#again-btn');
    s = await st(page);
    check(s.stones.length === 0 && s.scores[0].length === 0, `${tag}: もう一度で試合が最初から`);
  }
  check(errors.length === 0, `${tag}: コンソールエラーなし ${errors.slice(0, 3).join(' / ')}`);
  await page.close();
}

try {
  await run({ width: 360, height: 640 }, 'phone');
  await run({ width: 1280, height: 800 }, 'pc');
} finally {
  await browser.close();
  server?.kill();
}
console.log(failed ? `\n${failed} 件失敗` : '\nすべてOK');
process.exit(failed ? 1 : 0);
