import './style.css';
import * as THREE from 'three';
import { decideSweep, executeShot, planShot, shotLabel, type Shot } from './ai';
import { Sfx, renderSfx } from './audio';
import { AI, GAME, SHEET, STONE, SWEEP, THROW } from './config';
import {
  anyMoving,
  distToButton,
  launch,
  makeStone,
  removeHogged,
  scoreEnd,
  speedForDistance,
  step,
  type SimEvent,
  type Stone,
  type Team,
} from './physics';
import { TEAM_CSS, View, toWorld } from './scene';

type Phase = 'title' | 'aim' | 'power' | 'cpu' | 'run' | 'settle' | 'result';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $('stage');
const view = new View($<HTMLCanvasElement>('gl'));
const sfx = new Sfx();
const ui = {
  hint: $('hint'),
  toast: $('toast'),
  spin: $<HTMLButtonElement>('spin-btn'),
  zone: $('sweep-zone'),
  meter: $('sweep-meter'),
  meterBar: $('sweep-bar'),
  gauge: $('gauge'),
  gaugeBar: $('gauge-bar'),
  gaugeLabels: $('gauge-labels'),
  throwBtn: $<HTMLButtonElement>('throw-btn'),
  gaugeMarker: $('gauge-marker'),
  stonesLeft: $('stones-left'),
  minimap: $<HTMLCanvasElement>('minimap'),
  title: $('title'),
  result: $('result'),
  resultTitle: $('result-title'),
  resultDetail: $('result-detail'),
  resultBoard: $('result-board'),
  board: $('board'),
  cpuThink: $('cpu-think'),
  next: $<HTMLButtonElement>('next-btn'),
  again: $<HTMLButtonElement>('again-btn'),
  orderNote: $('order-note'),
};

/** 0: プレイヤー（赤） / 1: CPU（黄） */
const TEAM_NAME = ['あなた', 'CPU'];

const g = {
  phase: 'title' as Phase,
  stones: [] as Stone[],
  thrown: 0,
  current: null as Stone | null,
  spin: 1 as 1 | -1,
  sweep: 0,
  sweepAcc: 0,
  brushOffset: 0,
  settleT: 0,
  timeScale: 1,
  sweepOverride: null as number | null,
  events: [] as SimEvent[],
  lastThrow: null as null | { v0: number; aim: number; dist: number; power: number },
  /** 狙いの目印のx（ティーライン上） */
  targetX: -THROW.targetCurlOffset,
  /** パワーゲージの位置 0〜1 と経過時間 */
  power: 0,
  powerT: 0,
  // 試合
  playerFirst: false,
  ends: 2,
  endIdx: 0,
  scores: [[], []] as number[][],
  hammer: 1 as Team,
  // CPU
  cpuPlan: null as Generator<void, Shot> | null,
  cpuShot: null as Shot | null,
  cpuThinkT: 0,
  cpuShowT: 0,
  cpuSweepTimer: 0,
  cpuSweepTarget: 0,
  autoPlayer: false,
  /** 撮影用: true の間は自前のループで進めない（step で進める） */
  manual: false,
  /** ゲーム内の経過時間（演出用。実時刻の代わり） */
  clock: 0,
  W: 1,
  H: 1,
};

// ---------- 投げる強さ（パワーゲージ） ----------
function interp(c: [number, number][], x: number, from: 0 | 1): number {
  const to = (1 - from) as 0 | 1;
  if (x <= c[0][from]) return c[0][to];
  for (let i = 1; i < c.length; i++) {
    if (x <= c[i][from]) {
      const t = (x - c[i - 1][from]) / (c[i][from] - c[i - 1][from]);
      return c[i - 1][to] + t * (c[i][to] - c[i - 1][to]);
    }
  }
  return c[c.length - 1][to];
}
const powerToDist = (p: number) => interp(THROW.powerCurve, p, 0);
const distToPower = (d: number) => interp(THROW.powerCurve, d, 1);
/** シート上の y に止まるゲージの位置 */
const powerAtY = (y: number) => distToPower(y - STONE.startY);
const aimForTarget = (x: number) => Math.atan2(x, SHEET.tee - STONE.startY);

function buildGauge(): void {
  // ゲージの中に、ハウスの輪をそのまま描く（下=弱い、上=強い）
  const pc = (y: number) => `${(powerAtY(y) * 100).toFixed(2)}%`;
  const T = SHEET.tee;
  const { houseR: R12, ring8: R8, ring4: R4, button: RB } = SHEET;
  // [区間の始まり, 終わり, 色]（ティーからの距離）
  const segs: [number, number, string][] = [
    [-R12, -R8, '#2f6fd0'],
    [-R8, -R4, '#f4f8fb'],
    [-R4, -RB, '#d23a3f'],
    [-RB, RB, '#f4f8fb'],
    [RB, R4, '#d23a3f'],
    [R4, R8, '#f4f8fb'],
    [R8, R12, '#2f6fd0'],
  ];
  const stops = ['#8db8dd 0%', `#8db8dd ${pc(T - R12)}`];
  for (const [a, b, col] of segs) stops.push(`${col} ${pc(T + a)}`, `${col} ${pc(T + b)}`);
  stops.push(`#ff8a5c ${pc(T + R12)}`, '#ff8a5c 100%');
  ui.gaugeBar.style.background = `linear-gradient(to top, ${stops.join(', ')})`;
  const labels: [string, number, string][] = [
    ['ガード', (powerAtY(SHEET.farHog + 1) + powerAtY(T - SHEET.houseR)) / 2, '#bfe2ff'],
    ['ティー', powerAtY(T), '#ffffff'],
    ['テイクアウト', (powerAtY(SHEET.backLine + 1) + 1) / 2, '#ffb08f'],
  ];
  ui.gaugeLabels.innerHTML = labels
    .map(([t, p, c]) => `<span style="bottom:${(p * 100).toFixed(1)}%;color:${c}">${t}</span>`)
    .join('');
}

// ---------- 表示 ----------
// 字幕はゲーム内の時刻で消す（告知動画の撮影でも同じ長さで出る）
let toastLeft = 0;
function toast(msg: string, ms = 1200): void {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  toastLeft = ms / 1000;
}

/** 告知動画・確認用の出来事 */
let gameEvents: { type: string; [k: string]: unknown }[] = [];
const emit = (type: string, data: Record<string, unknown> = {}) => gameEvents.push({ type, ...data });

function turnTeam(): Team {
  const first = (1 - g.hammer) as Team;
  return ((first + g.thrown) % 2) as Team;
}
const total = (t: number) => g.scores[t].reduce((a, b) => a + b, 0);

function boardHTML(): string {
  const n = Math.max(g.ends, g.scores[0].length, g.endIdx + 1);
  const head = Array.from({ length: n }, (_, i) => `<th>${i < g.ends ? i + 1 : 'EX'}</th>`).join('');
  const rows = [0, 1].map((t) => {
    const cells = Array.from({ length: n }, (_, i) => {
      const v = g.scores[t][i];
      const cur = i === g.endIdx && g.phase !== 'result' ? ' class="cur"' : '';
      return `<td${cur}>${v === undefined ? '' : v}</td>`;
    }).join('');
    const ham = g.hammer === t && g.phase !== 'result' ? ' hammer' : '';
    return `<tr><td class="name${ham}" style="color:${TEAM_CSS[t]}">${TEAM_NAME[t]}</td>${cells}<td class="total">${total(t)}</td></tr>`;
  });
  return `<tr><th></th>${head}<th>計</th></tr>${rows.join('')}`;
}
function renderBoard(): void {
  ui.board.innerHTML = boardHTML();
}

function renderStonesLeft(): void {
  const rows = [0, 1].map((t) => {
    const used = g.stones.filter((s) => s.team === t).length;
    const dots = Array.from({ length: GAME.stonesPerTeam }, (_, i) =>
      `<span class="dot${i < used ? ' used' : ''}" style="background:${TEAM_CSS[t]}"></span>`,
    ).join('');
    const turn = g.phase === 'aim' && turnTeam() === t ? ' turn' : '';
    return `<div class="row${turn}">${dots}</div>`;
  });
  ui.stonesLeft.innerHTML = rows.join('');
  renderBoard();
}

function renderSpin(): void {
  ui.spin.textContent = g.spin === 1 ? '↻ 右に曲げる' : '↺ 左に曲げる';
}

let aimNow: number | null = null;
const MM = { yTop: SHEET.backLine + 0.55, yBottom: SHEET.backLine + 0.55 - 5.4 };
function drawMinimap(): void {
  const c = ui.minimap;
  const ctx = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const k = W / (SHEET.halfWidth * 2);
  const X = (x: number) => (x + SHEET.halfWidth) * k;
  const Y = (y: number) => (MM.yTop - y) * (H / (MM.yTop - MM.yBottom));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#e9f2f8';
  ctx.fillRect(0, 0, W, H);
  const rings: [number, string][] = [
    [SHEET.houseR, '#2f6fd0'],
    [SHEET.ring8, '#f4f8fb'],
    [SHEET.ring4, '#d23a3f'],
    [SHEET.button, '#f4f8fb'],
  ];
  for (const [r, col] of rings) {
    ctx.beginPath();
    ctx.arc(X(0), Y(SHEET.tee), r * k, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
  }
  ctx.fillStyle = '#1d2a3a';
  ctx.fillRect(0, Y(SHEET.tee) - 1, W, 2);
  ctx.fillRect(0, Y(SHEET.backLine) - 1, W, 2);
  ctx.fillRect(X(0) - 1, 0, 2, H);
  if (aimNow !== null) {
    // 狙いの方向（回転による曲がりは含まない、まっすぐの線）
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = '#1d2a3acc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const yA = MM.yBottom - 0.5;
    const yB = MM.yTop;
    const xAt = (y: number) => Math.tan(aimNow!) * (y - STONE.startY);
    ctx.moveTo(X(xAt(yA)), Y(yA));
    ctx.lineTo(X(xAt(yB)), Y(yB));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (g.phase === 'aim' || g.phase === 'power') {
    // 目印
    ctx.strokeStyle = '#e0b400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(X(g.targetX), Y(SHEET.tee), 0.2 * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (g.phase === 'power') {
    // 今のゲージで止まる位置（曲がりは含まない距離の目安）
    const y = STONE.startY + powerToDist(g.power);
    ctx.fillStyle = '#ffe14d';
    ctx.strokeStyle = '#0b1424';
    ctx.lineWidth = 1.5;
    if (y > MM.yTop) {
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▲ 奥へ', W / 2, 24);
    } else if (y >= MM.yBottom) {
      ctx.fillRect(0, Y(y) - 2.5, W, 5);
      ctx.strokeRect(0, Y(y) - 2.5, W, 5);
    } else {
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('▼ 手前', W / 2, H - 10);
    }
  }
  const sc = scoreEnd(g.stones);
  for (const s of g.stones) {
    if (!s.inPlay || s.y < MM.yBottom - 0.3) continue;
    ctx.beginPath();
    ctx.arc(X(s.x), Y(s.y), STONE.radius * k, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_CSS[s.team];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = sc.counting.includes(s.id) ? '#ffffff' : '#555c66';
    ctx.stroke();
  }
}

// ---------- カメラ ----------
const CAM = {
  aimPos: toWorld(0, STONE.startY - 3.5, 3.0),
  aimLook: toWorld(0, SHEET.tee - 1.5, 0),
  aimFov: 24,
  runFov: 42,
  housePos: toWorld(0, SHEET.tee - 6.2, 7.8),
  houseLook: toWorld(0, SHEET.tee + 0.1, 0),
};
const tmpP = new THREE.Vector3();
const tmpL = new THREE.Vector3();

function updateCamera(dtReal: number): void {
  if (g.phase === 'aim' || g.phase === 'power' || g.phase === 'title' || g.phase === 'cpu') {
    view.moveCamera(CAM.aimPos, CAM.aimLook, 1 - Math.exp(-dtReal * 3), CAM.aimFov);
    return;
  }
  const s = g.current;
  let t = 1;
  if (s && s.inPlay && g.phase === 'run') {
    t = Math.min(1, Math.max(0, (s.y - (SHEET.farHog - 5)) / 7));
    t = t * t * (3 - 2 * t);
    const follow = toWorld(s.x * 0.6, s.y - 3.4, 1.6);
    const look = toWorld(s.x * 0.7, s.y + 4.5, 0);
    tmpP.copy(follow).lerp(CAM.housePos, t);
    tmpL.copy(look).lerp(CAM.houseLook, t);
  } else {
    tmpP.copy(CAM.housePos);
    tmpL.copy(CAM.houseLook);
  }
  view.moveCamera(tmpP, tmpL, 1 - Math.exp(-dtReal * 5), CAM.runFov);
}

// ---------- 進行 ----------
function newGame(): void {
  g.scores = [[], []];
  g.endIdx = 0;
  // 先攻 = 1エンド目に最初に投げる = 相手がハンマー
  g.hammer = g.playerFirst ? 1 : 0;
  ui.title.classList.add('hidden');
  newEnd();
}

function newEnd(): void {
  for (const m of view.stoneMeshes.values()) view.scene.remove(m);
  view.stoneMeshes.clear();
  g.stones = [];
  g.thrown = 0;
  g.current = null;
  g.lastThrow = null;
  ui.result.classList.add('hidden');
  nextTurn();
  view.snapCamera(CAM.aimPos, CAM.aimLook, CAM.aimFov);
  const extra = g.endIdx >= g.ends;
  toast(`${extra ? 'エキストラエンド' : `第${g.endIdx + 1}エンド`}　${turnTeam() === 0 ? 'あなたから' : 'CPUから'}`, 1500);
}

function nextTurn(): void {
  g.current = null;
  g.sweep = 0;
  if (turnTeam() === 0 && !g.autoPlayer) toAim();
  else toCpu();
}

function toAim(): void {
  g.phase = 'aim';
  g.power = 0;
  ui.cpuThink.classList.remove('on');
  ui.spin.classList.add('on');
  ui.throwBtn.classList.add('on');
  ui.gauge.classList.add('on', 'idle');
  ui.gaugeMarker.style.bottom = '0%';
  const last = g.thrown >= GAME.stonesPerTeam * 2 - 2 && g.hammer === 0 ? '（最後の一投）' : '';
  ui.hint.textContent = `あなたの番${last}: 左右にドラッグして目印を動かす`;
  showAimGuide();
  renderStonesLeft();
}

function showAimGuide(): void {
  aimNow = aimForTarget(g.targetX);
  view.setTarget(g.targetX);
  view.setAim(aimNow, SHEET.tee - STONE.startY + 0.4);
}

function toPower(): void {
  g.phase = 'power';
  g.powerT = 0;
  g.power = 0;
  ui.spin.classList.remove('on');
  ui.throwBtn.classList.remove('on');
  ui.gauge.classList.remove('idle');
  ui.hint.textContent = 'いまだ！と思ったところでタップ';
}

function updatePower(dtReal: number): void {
  g.powerT += dtReal * g.timeScale;
  const u = (g.powerT / THROW.gaugePeriod) % 1;
  g.power = u < 0.5 ? u * 2 : 2 - u * 2;
  ui.gaugeMarker.style.bottom = `${(g.power * 100).toFixed(2)}%`;
}

function releasePower(p = g.power): void {
  if (g.phase !== 'power') return;
  const dist = powerToDist(p);
  const aim = aimForTarget(g.targetX);
  const v0 = speedForDistance(dist);
  g.lastThrow = { v0, aim, dist, power: p };
  doThrow(v0, aim, g.spin);
}

function stonesLeftOf(t: Team): number {
  return GAME.stonesPerTeam - g.stones.filter((s) => s.team === t).length;
}

function toCpu(): void {
  g.phase = 'cpu';
  const team = turnTeam();
  ui.spin.classList.remove('on');
  ui.throwBtn.classList.remove('on');
  ui.gauge.classList.remove('on');
  view.setTarget(null);
  ui.hint.textContent = team === 1 ? 'CPUの番' : 'あなたの番（自動）';
  ui.cpuThink.textContent = 'CPU 考え中…';
  ui.cpuThink.classList.add('on');
  g.cpuShot = null;
  g.cpuThinkT = 0;
  g.cpuShowT = 0;
  g.cpuPlan = planShot({
    stones: g.stones,
    team,
    selfLeft: stonesLeftOf(team),
    oppLeft: stonesLeftOf((1 - team) as Team),
    hammer: g.hammer === team,
  });
  renderStonesLeft();
}

function updateCpu(dtReal: number): void {
  g.cpuThinkT += dtReal * g.timeScale;
  if (g.cpuPlan) {
    // 1フレーム 8ms までずつ考える
    const t0 = performance.now();
    while (g.cpuPlan && performance.now() - t0 < 8) {
      const r = g.cpuPlan.next();
      if (r.done) {
        g.cpuShot = r.value;
        g.cpuPlan = null;
      }
    }
    return;
  }
  const shot = g.cpuShot;
  if (!shot || g.cpuThinkT < AI.minThinkSec) return;
  if (g.cpuShowT === 0) {
    // 狙いを一瞬見せてから投げる
    ui.cpuThink.textContent = `CPU: ${shotLabel(shot.kind)}（${shot.spin === 1 ? '右' : '左'}に曲げる）`;
    emit('cpuShot', { kind: shot.kind });
    view.setAim(shot.aim, Math.min(34, shot.dist));
    aimNow = shot.aim;
  }
  g.cpuShowT += dtReal * g.timeScale;
  if (g.cpuShowT < 0.9) return;
  view.setAim(null);
  aimNow = null;
  ui.cpuThink.classList.remove('on');
  const ex = executeShot(shot);
  doThrow(ex.v0, ex.aim, ex.spin);
  g.cpuSweepTimer = 0;
  g.cpuSweepTarget = 0;
}

function doThrow(v0: number, aim: number, spin: number): void {
  const s = makeStone(g.thrown + g.endIdx * 100, turnTeam());
  launch(s, v0, aim, spin);
  g.stones.push(s);
  g.current = s;
  g.thrown++;
  g.phase = 'run';
  sfx.throwSound();
  emit('throw', { team: s.team });
  g.sweep = 0;
  g.sweepAcc = 0;
  ui.spin.classList.remove('on');
  ui.throwBtn.classList.remove('on');
  ui.gauge.classList.remove('on');
  view.setTarget(null);
  view.setAim(null);
  aimNow = null;
  ui.hint.textContent = playerSweeps() ? 'ストーンの前を左右にこすってスイープ！' : '';
  renderStonesLeft();
}

/** プレイヤーがスイープできるのは自分の石だけ */
function playerSweeps(): boolean {
  return !!g.current && g.current.team === 0 && !g.autoPlayer;
}

function finishThrow(): void {
  const hogged = removeHogged(g.stones);
  const who = g.current?.team === 1 ? 'CPU: ' : '';
  let kind = 'stop';
  if (g.current && hogged.includes(g.current.id)) {
    toast(`${who}ホッグライン手前… 除外`);
    kind = 'hog';
  } else if (g.current && !g.current.inPlay) {
    toast(`${who}場外…`);
    kind = 'out';
  } else if (g.current) {
    const d = distToButton(g.current);
    if (d < SHEET.button + STONE.radius) {
      toast(`${who}ボタン！`, 1400);
      kind = 'button';
    } else if (d - STONE.radius <= SHEET.houseR) {
      toast(`${who}ハウスイン`);
      kind = 'house';
    }
  }
  emit('result', { team: g.current?.team, kind, score: scoreEnd(g.stones) });
  g.phase = 'settle';
  g.settleT = 1.1;
  ui.hint.textContent = '';
}

function endEnd(): void {
  g.phase = 'result';
  const r = scoreEnd(g.stones);
  for (const t of [0, 1]) g.scores[t][g.endIdx] = r.team === t ? r.points : 0;
  emit('end', { team: r.team, points: r.points });
  // 得点したチームは次のエンドで先に投げる（ハンマーは相手へ）。ブランクならハンマーはそのまま
  if (r.team !== null) g.hammer = (1 - r.team) as Team;
  g.endIdx++;
  const done = g.endIdx >= g.ends && total(0) !== total(1);
  if (r.team === null) {
    ui.resultTitle.textContent = 'ブランクエンド';
    ui.resultDetail.textContent = 'ハウスにストーンがなく 0点。ハンマーはそのまま。';
  } else {
    ui.resultTitle.innerHTML = `<span style="color:${TEAM_CSS[r.team]}">${TEAM_NAME[r.team]}</span> が ${r.points}点`;
    ui.resultDetail.textContent = done ? '' : `次のエンドは${TEAM_NAME[r.team]}が先に投げ、${TEAM_NAME[1 - r.team]}がハンマー（最後の一投）を持ちます。`;
  }
  if (done) {
    const win = total(0) > total(1);
    ui.resultTitle.innerHTML = win ? 'あなたの勝ち！' : 'CPUの勝ち…';
    ui.resultDetail.textContent = `${total(0)} - ${total(1)}`;
    sfx.chime(win);
  } else {
    if (g.endIdx >= g.ends) ui.resultDetail.textContent += ' 同点なのでエキストラエンドへ。';
    sfx.chime(r.team === 0);
  }
  ui.resultBoard.innerHTML = boardHTML();
  ui.next.classList.toggle('hidden', done);
  ui.again.classList.toggle('hidden', !done);
  ui.result.classList.remove('hidden');
  renderBoard();
}

// ---------- 入力 ----------
let aimPtr: { id: number; x: number } | null = null;
let sweepPtr: { id: number; x: number; inZoneStart: boolean } | null = null;
let zoneRect = { x: 0, y: 0, w: 0, h: 0, on: false };

function localXY(e: PointerEvent): { x: number; y: number } {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function inZone(x: number, y: number): boolean {
  const z = zoneRect;
  const pad = 20;
  return z.on && x >= z.x - pad && x <= z.x + z.w + pad && y >= z.y - pad && y <= z.y + z.h + pad;
}

/** ポインタを押した（ボタンの上なら onButton）。戻り値: 押さえ続ける操作を始めたか */
function touchDown(id: number, p: { x: number; y: number }, onButton: boolean): boolean {
  sfx.start();
  if (g.phase === 'power') {
    // ゲージを止めて投げる（どこをタップしてもよい）
    releasePower();
    return false;
  }
  if (onButton) return false;
  if (g.phase === 'aim' && !aimPtr) {
    aimPtr = { id, x: p.x };
    return true;
  } else if (g.phase === 'run' && !sweepPtr && playerSweeps()) {
    sweepPtr = { id, x: p.x, inZoneStart: inZone(p.x, p.y) };
    return true;
  }
  return false;
}

stage.addEventListener('pointerdown', (e) => {
  const onButton = !!(e.target as HTMLElement).closest('button');
  if (g.phase === 'power') e.preventDefault();
  if (touchDown(e.pointerId, localXY(e), onButton)) stage.setPointerCapture(e.pointerId);
});

stage.addEventListener('pointermove', (e) => touchMove(e.pointerId, localXY(e)));

function touchMove(id: number, p: { x: number; y: number }): void {
  const e = { pointerId: id };
  if (aimPtr && e.pointerId === aimPtr.id) {
    if (g.phase === 'aim') {
      g.targetX += ((p.x - aimPtr.x) / g.W) * THROW.targetDragM;
      g.targetX = Math.max(-THROW.targetMaxX, Math.min(THROW.targetMaxX, g.targetX));
      showAimGuide();
    }
    aimPtr.x = p.x;
  } else if (sweepPtr && e.pointerId === sweepPtr.id) {
    if (sweepPtr.inZoneStart || inZone(p.x, p.y)) {
      g.sweepAcc += Math.abs(p.x - sweepPtr.x) / g.W;
      const cx = zoneRect.x + zoneRect.w / 2;
      g.brushOffset = Math.max(-1, Math.min(1, (p.x - cx) / Math.max(40, zoneRect.w / 2)));
    }
    sweepPtr.x = p.x;
  }
}

function touchUp(id: number): void {
  if (aimPtr && id === aimPtr.id) aimPtr = null;
  else if (sweepPtr && id === sweepPtr.id) sweepPtr = null;
}
stage.addEventListener('pointerup', (e) => touchUp(e.pointerId));
stage.addEventListener('pointercancel', (e) => touchUp(e.pointerId));

ui.throwBtn.addEventListener('click', () => {
  if (g.phase === 'aim') toPower();
});
ui.spin.addEventListener('click', () => {
  g.spin = g.spin === 1 ? -1 : 1;
  // 曲がる分だけ、目印を反対側へ置き直す（おすすめの位置）
  g.targetX = -g.spin * THROW.targetCurlOffset;
  renderSpin();
  if (g.phase === 'aim') showAimGuide();
});
function setupSeg(id: string, onPick: (v: string) => void): void {
  const seg = $(id);
  seg.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onPick(b.dataset.v!);
    }),
  );
}
function renderOrderNote(): void {
  ui.orderNote.textContent = g.playerFirst
    ? '先攻: 先に投げる。最後の一投（ハンマー）は CPU。'
    : '後攻: 最後の一投（ハンマー）を持てるので有利。';
}
setupSeg('order-seg', (v) => {
  g.playerFirst = v === 'first';
  renderOrderNote();
});
setupSeg('ends-seg', (v) => (g.ends = Number(v)));
renderOrderNote();
$('start-btn').addEventListener('click', () => {
  sfx.start();
  newGame();
});
ui.next.addEventListener('click', () => newEnd());
ui.again.addEventListener('click', () => newGame());
$('title-btn').addEventListener('click', () => {
  g.phase = 'title';
  ui.result.classList.add('hidden');
  ui.title.classList.remove('hidden');
});

// ---------- ループ ----------
function updateSweepZone(): void {
  const s = g.current;
  const canSweep = g.phase === 'run' && s && s.inPlay && s.moving && s.y < SHEET.backLine && playerSweeps();
  if (!canSweep || !s) {
    zoneRect.on = false;
    ui.zone.classList.remove('on');
    // CPU のスイープ中もメーターは見せる
    const cpuSweeping = g.phase === 'run' && !!s?.moving && !playerSweeps();
    ui.meter.classList.toggle('on', cpuSweeping);
    ui.meterBar.style.width = `${Math.round(g.sweep * 100)}%`;
    return;
  }
  const v = Math.hypot(s.vx, s.vy) || 1;
  const dx = s.vx / v;
  const dy = s.vy / v;
  const pts = [SWEEP.zoneNear, SWEEP.zoneFar].flatMap((a) =>
    [-1, 1].map((side) =>
      view.project(
        s.x + dx * a + dy * side * SWEEP.zoneHalfWidthM,
        s.y + dy * a - dx * side * SWEEP.zoneHalfWidthM,
        g.W,
        g.H,
      ),
    ),
  );
  let x0 = Math.min(...pts.map((p) => p.x));
  let x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y));
  let y1 = Math.max(...pts.map((p) => p.y));
  // 小さすぎると指で狙えないので最小サイズを保証
  const minW = g.W * 0.55;
  const minH = g.H * 0.14;
  if (x1 - x0 < minW) {
    const c = (x0 + x1) / 2;
    x0 = c - minW / 2;
    x1 = c + minW / 2;
  }
  if (y1 - y0 < minH) {
    y0 = y1 - minH;
  }
  x0 = Math.max(4, x0);
  x1 = Math.min(g.W - 4, x1);
  zoneRect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0, on: true };
  Object.assign(ui.zone.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
  ui.zone.classList.add('on');
  ui.zone.classList.toggle('active', g.sweep > 0.15);
  ui.meter.classList.add('on');
  ui.meterBar.style.width = `${Math.round(g.sweep * 100)}%`;
}

let last = performance.now();
function frame(now: number): void {
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!g.manual) tick(dtReal);
  requestAnimationFrame(frame);
}

function tick(dtReal: number): void {
  g.clock += dtReal;
  if (toastLeft > 0) {
    toastLeft -= dtReal;
    if (toastLeft <= 0) ui.toast.classList.remove('show');
  }
  // スイープの強さ: 擦った速さ（画面の幅/秒）から
  if (g.phase === 'run') {
    const rate = dtReal > 0 ? g.sweepAcc / dtReal : 0;
    let target = g.sweepOverride ?? Math.min(1, rate / SWEEP.fullRate);
    if (!playerSweeps() && g.current) {
      // CPU（または自動プレイ）のスイープ判断
      g.cpuSweepTimer -= dtReal * GAME.simSpeed * g.timeScale;
      if (g.cpuSweepTimer <= 0 && g.current.moving) {
        g.cpuSweepTimer = AI.sweepDecideEvery;
        g.cpuSweepTarget = decideSweep(g.stones, g.current.id, g.cpuShot?.target ?? null);
      }
      target = g.cpuSweepTarget;
    }
    g.sweep += (target - g.sweep) * Math.min(1, SWEEP.response * dtReal);
  } else {
    g.sweep = 0;
  }
  g.sweepAcc = 0;

  if (g.phase === 'run') {
    const s = g.current;
    const sweepMap = new Map<number, number>();
    if (s && s.moving && s.y < SHEET.backLine) sweepMap.set(s.id, g.sweep);
    g.events.length = 0;
    step(g.stones, dtReal * GAME.simSpeed * g.timeScale, sweepMap, g.events);
    for (const ev of g.events) {
      if (ev.type === 'hit') {
        sfx.hit(ev.power ?? 0.5);
        emit('hit', { power: ev.power ?? 0 });
      }
    }
    if (!anyMoving(g.stones)) finishThrow();
  } else if (g.phase === 'settle') {
    g.settleT -= dtReal * g.timeScale;
    if (g.settleT <= 0) {
      if (g.thrown >= GAME.stonesPerTeam * 2) endEnd();
      else nextTurn();
    }
  } else if (g.phase === 'cpu') {
    updateCpu(dtReal);
  } else if (g.phase === 'power') {
    updatePower(dtReal);
  }

  const speedSum = g.stones.reduce((a, s) => a + (s.inPlay && s.moving ? Math.hypot(s.vx, s.vy) : 0), 0);
  sfx.update(speedSum, g.phase === 'run' ? g.sweep : 0);

  view.syncStones(g.stones);
  // 投げる前は、次に投げる石を手元に置いて見せる
  updateCamera(dtReal);
  const cur = g.phase === 'run' && g.current?.moving && g.current.y < SHEET.backLine ? g.current : null;
  const wobble =
    g.sweep > 0.05
      ? playerSweeps()
        ? g.brushOffset
        : Math.sin(g.clock / 0.07)
      : Math.sin(g.clock / 0.6) * 0.15;
  view.setBrush(cur, wobble, g.sweep, dtReal);
  updateSweepZone();
  drawMinimap();
  view.render();
}

// 次に投げる石のプレビュー
const preview = makeStone(-1, 0);
function syncPreview(): void {
  const show = g.phase === 'aim' || g.phase === 'cpu';
  preview.team = turnTeam();
  preview.inPlay = show;
  preview.angle = 0;
}
const origSync = view.syncStones.bind(view);
view.syncStones = (stones: Stone[]) => {
  syncPreview();
  const m = view.stoneMeshes.get(-1);
  if (m && (m.userData.team as number) !== preview.team) {
    view.scene.remove(m);
    view.stoneMeshes.delete(-1);
  }
  origSync([...stones, preview]);
  const m2 = view.stoneMeshes.get(-1);
  if (m2) m2.userData.team = preview.team;
};

function resize(): void {
  const r = stage.getBoundingClientRect();
  g.W = r.width;
  g.H = r.height;
  view.resize(r.width, r.height);
}
new ResizeObserver(resize).observe(stage);
resize();
buildGauge();
renderSpin();
renderStonesLeft();
view.snapCamera(CAM.aimPos, CAM.aimLook, CAM.aimFov);
requestAnimationFrame(frame);

// ---------- 確認用の入口 ----------
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  state: () => ({
    phase: g.phase,
    thrown: g.thrown,
    sweep: g.sweep,
    lastThrow: g.lastThrow,
    current: g.current && { ...g.current },
    stones: g.stones.map((s) => ({ ...s })),
    score: scoreEnd(g.stones),
    zone: zoneRect,
    turn: turnTeam(),
    hammer: g.hammer,
    endIdx: g.endIdx,
    ends: g.ends,
    scores: g.scores,
    cpuShot: g.cpuShot,
    power: g.power,
    targetX: g.targetX,
    spin: g.spin,
  }),
  start: () => $('start-btn').click(),
  manual: (on: boolean) => (g.manual = on),
  /** 本物と同じ処理を通るタッチ操作（座標はゲーム画面の CSS ピクセル） */
  touchDown: (x: number, y: number) => touchDown(1, { x, y }, false),
  touchMove: (x: number, y: number) => touchMove(1, { x, y }),
  touchUp: () => touchUp(1),
  /** 画面のボタンを押す（'throw-btn' / 'spin-btn' / 'start-btn' / 'next-btn' など） */
  press: (id: string) => $(id).click(),
  drainEvents: () => {
    const e = gameEvents;
    gameEvents = [];
    return e;
  },
  audio: {
    capture: (on: boolean) => sfx.capture(on),
    drain: () => sfx.drain(),
    render: renderSfx,
  },
  /** 撮影用: 目印の位置を決める */
  setTarget: (x: number) => {
    g.targetX = x;
    if (g.phase === 'aim') showAimGuide();
  },
  /** dt 秒進めて描画する（1/60 秒以下に分けて進める） */
  step: (dt: number) => {
    const n = Math.max(1, Math.ceil(dt / (1 / 60) - 1e-9));
    for (let i = 0; i < n; i++) tick(dt / n);
  },
  /** 撮影用: 盤面に石を置く（投げた数としても数える） */
  placeStones: (list: { team: Team; x: number; y: number }[]) => {
    for (const p of list) {
      const s = makeStone(g.thrown + g.endIdx * 100, p.team);
      Object.assign(s, { x: p.x, y: p.y, inPlay: true, moving: false, angle: Math.random() * 6 });
      g.stones.push(s);
      g.thrown++;
    }
    nextTurn();
  },
  /** プレイヤーの手番も CPU に投げさせる（通しの確認用） */
  setAuto: (on: boolean) => (g.autoPlayer = on),
  throwRaw: (v0: number, aim: number, spin: number) => g.phase === 'aim' && doThrow(v0, aim, spin),
  /** 目印の位置とゲージの値を指定して投げる */
  throwPower: (p: number, targetX = g.targetX) => {
    if (g.phase !== 'aim') return false;
    g.targetX = targetX;
    toPower();
    releasePower(p);
    return true;
  },
  powerToDist,
  powerAtY,
  throwDist: (dist: number, aim = 0, spin = 1) => g.phase === 'aim' && doThrow(speedForDistance(dist), aim, spin),
  setTimeScale: (k: number) => (g.timeScale = k),
  setSweep: (v: number | null) => (g.sweepOverride = v),
  setSpin: (s: 1 | -1) => {
    g.spin = s;
    renderSpin();
  },
};
