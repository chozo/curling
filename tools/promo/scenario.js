// カーリングの告知動画の台本。
// 時刻を決め打ちせず、ゲームの出来事（p.on）や状態（p.until）に合わせて字幕を出す。
// 使える操作はスキルの references/scenario-api.md。

const T = 28.35; // ティーラインの位置（src/config.ts の SHEET.tee）

export const config = {
  slug: 'curling',
  url: 'https://game.chozo.net/curling/',
  orientation: 'portrait',
  game: { width: 405, height: 720 },
  serveDir: 'dist',
  gamePath: '/curling/',
  music: { file: 'tools/promo/bgm.wav', volume: 0.04 }, // 効果音（滑走音中心で静か）より約 13 dB 小さく
};

/** タイトル画面の設定を選んで試合を始める（後攻 = CPU から投げる、エンド数） */
async function newGame(p, { first, ends }) {
  await p.eval(
    ([first, ends]) => {
      const d = document;
      d.querySelector(`#order-seg button[data-v="${first ? 'first' : 'second'}"]`).click();
      d.querySelector(`#ends-seg button[data-v="${ends}"]`).click();
    },
    [first, ends],
  );
  await p.call('start');
}

/** ゲージがねらいの値に来るまで進める（直前はスローで細かく進める） */
async function tapGaugeAt(p, target) {
  await p.until((s) => s.phase === 'power' && s.power > target - 0.12 && s.power < target, { max: 4 });
  p.speed(0.2, { badge: false });
  await p.until((s) => s.power >= target - 0.004, { max: 3 });
  p.speed(1, { badge: false });
  await p.tap(200, 420, 0.03);
}

export default async function scenario(p) {
  await p.seed(Number(process.env.PROMO_SEED ?? 6));
  await p.call('audio.capture', true);

  let fxOn = true;
  p.on('hit', () => {
    if (!fxOn) return;
    p.fx('カコーン！', { y: 0.36, size: 84 });
    p.shake(14, 0.4);
    p.flash({ strength: 0.6 });
  });

  // ---- 0〜2秒: つかみ（ダブルテイクアウトをスローで）----
  await newGame(p, { first: false, ends: 1 });
  await p.call('placeStones', [
    { team: 1, x: 0.15, y: T + 0.1 },
    { team: 1, x: -0.45, y: T + 0.75 },
    { team: 0, x: 0.75, y: T - 0.9 },
  ]);
  await p.call('setSpin', 1);
  await p.call('throwPower', 0.8, -0.55);
  // ストーンがハウスの手前に来るまで撮らずに進める
  for (let i = 0; i < 80; i++) {
    const s = await p.state();
    if (s.current && s.current.y > 25.6) break;
    await p.skip(0.05);
  }
  p.zoom(1.25, 0.3, { x: 0.5, y: 0.45 });
  p.speed(0.3, { badge: false });
  await p.until((s, ev) => ev.some((e) => e.type === 'hit'), { max: 2 });
  await p.wait(0.9);
  p.speed(1, { badge: false });
  p.zoom(1, 0.3);
  fxOn = false;
  await p.wait(0.2);

  // ---- 2〜6秒: タイトルと一言 ----
  p.title({ title: 'カーリング', sub: 'CPU とガチンコ勝負！', logo: '/curling/favicon.svg', dur: 2.5 });
  await p.wait(2.8);

  // ---- 6〜24秒: 実際のプレイ ----
  await newGame(p, { first: true, ends: 1 });
  // 目印はおすすめの位置（曲がる分だけ左）
  await p.call('setTarget', -1.15);
  await p.wait(0.3);
  // 1) ねらう
  p.caption('ドラッグで\nねらって', { y: 0.15, dur: 2.0 });
  await p.drag([[200, 470], [270, 470], [130, 470], [200, 470]], 1.6);
  await p.wait(0.3);
  // 2) ゲージをタップ
  p.caption('ゲージを\nタップ！', { y: 0.15, dur: 1.8 });
  await p.call('press', 'throw-btn');
  await tapGaugeAt(p, 0.42);
  p.fx('いけっ！', { y: 0.4 });
  // 滑っていく区間は早送り
  p.speed(2.5);
  await p.until((s) => s.current && s.current.y > 18, { max: 6 });
  p.speed(1);
  // 3) こする
  p.caption('こすって\nのばせ！', { y: 0.15, dur: 2.4 });
  const st = await p.state();
  const z = st.zone;
  const zy = z.y + z.h * 0.5;
  const pts = [];
  for (let i = 0; i < 22; i++) pts.push([z.x + z.w * (i % 2 ? 0.2 : 0.8), zy]);
  p.fx('ゴシゴシ！', { y: 0.62, size: 62, dur: 1.4 });
  await p.drag(pts, 2.6);
  // 止まるまで
  await p.until((s, ev) => ev.some((e) => e.type === 'result'), { max: 6 });
  const r = await p.state();
  const last = r.stones.at(-1);
  const d = Math.hypot(last.x, last.y - T);
  console.log(`  [台本] 1投目: x=${last.x.toFixed(2)} y=${last.y.toFixed(2)} ボタンから ${d.toFixed(2)}m`);
  if (d < 0.3) {
    p.fx('ボタン！', { y: 0.3, size: 90, color: '#ff4b55' });
    p.flash({ strength: 0.5 });
  } else {
    p.fx('ハウスイン！', { y: 0.3, size: 80 });
  }
  await p.wait(1.2);

  // 4) CPU の番（早送り）
  p.caption('CPU も\n本気でくる！', { y: 0.15, dur: 2.2 });
  p.speed(4);
  await p.until((s) => s.phase === 'aim' && s.thrown >= 2, { max: 6 });
  const c = await p.state();
  console.log(`  [台本] CPU: ${c.cpuShot?.kind} → ${JSON.stringify(c.stones.map((x) => [x.team, x.inPlay, +x.x.toFixed(2), +x.y.toFixed(2)]))}`);
  p.speed(1);

  // ---- 24〜27秒: クライマックス（最後の一投で大量得点）----
  await newGame(p, { first: false, ends: 1 });
  await p.call('placeStones', [
    { team: 1, x: 0.02, y: T + 0.05 },
    { team: 0, x: -0.6, y: T + 0.5 },
    { team: 1, x: -1.0, y: 25.2 },
    { team: 0, x: 0.55, y: T - 0.45 },
    { team: 1, x: 1.25, y: T + 0.9 },
    { team: 0, x: 0.35, y: T + 1.0 },
    { team: 1, x: -0.2, y: T - 1.6 },
  ]);
  await p.call('setSpin', 1);
  await p.call('setTarget', -0.39);
  p.caption('ラスト一投！', { y: 0.15, dur: 1.6, size: 56 });
  await p.wait(0.5);
  await p.call('press', 'throw-btn');
  await tapGaugeAt(p, 0.75);
  p.speed(2.5, { badge: false });
  await p.until((s) => s.current && s.current.y > 24.5, { max: 5 });
  p.speed(0.4, { badge: false });
  p.zoom(1.2, 0.3, { x: 0.5, y: 0.42 });
  fxOn = true;
  await p.until((s, ev) => ev.some((e) => e.type === 'hit'), { max: 3 });
  await p.wait(0.5);
  fxOn = false;
  p.speed(2, { badge: false });
  p.zoom(1, 0.4);
  await p.until((s) => s.phase === 'result', { max: 6 });
  p.speed(1, { badge: false });
  p.flash();
  p.caption('大量得点！', { y: 0.15, dur: 2, size: 64, color: '#ffd23f' });
  await p.wait(2.0);

  // ---- 27〜30秒: エンドカード ----
  p.endCard({
    title: 'カーリング',
    sub: 'CPU とガチンコ勝負！',
    cta: '今すぐ遊べる！',
    logo: '/curling/favicon.svg',
  });
  await p.wait(3);
}
