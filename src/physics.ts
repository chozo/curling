// カーリングの平面物理。x: 右(+)、y: シート奥(+)。投げる人から見て時計回り(spin=+1)は右へ曲がる。
import { PHYS, SHEET, STONE } from './config';

export type Team = 0 | 1;

export interface Stone {
  id: number;
  team: Team;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** +1: 時計回り（右へ曲がる） / -1: 反時計回り（左へ曲がる） / 0〜: 衝突後の弱い回転 */
  spin: number;
  /** 見た目用の回転角 */
  angle: number;
  inPlay: boolean;
  moving: boolean;
}

export interface SimEvent {
  type: 'hit' | 'out' | 'stop';
  id: number;
  other?: number;
  power?: number;
}

/** 摩擦だけで止まるまでの距離から初速を求める */
export function speedForDistance(dist: number, decel = PHYS.decel): number {
  return Math.sqrt(2 * decel * Math.max(0, dist));
}

export function distanceForSpeed(v: number, decel = PHYS.decel): number {
  return (v * v) / (2 * decel);
}

export function makeStone(id: number, team: Team): Stone {
  return { id, team, x: 0, y: STONE.startY, vx: 0, vy: 0, spin: 0, angle: 0, inPlay: false, moving: false };
}

export function launch(s: Stone, v0: number, aim: number, spin: number): void {
  s.x = 0;
  s.y = STONE.startY;
  s.vx = v0 * Math.sin(aim);
  s.vy = v0 * Math.cos(aim);
  s.spin = spin;
  s.inPlay = true;
  s.moving = true;
}

/**
 * dt 秒（シミュレーション時間）進める。sweep は「スイープ対象のストーンid → 強さ0〜1」。
 * 内部で固定刻みに分割する。
 */
export function step(
  stones: Stone[],
  dt: number,
  sweep: Map<number, number> | null,
  events: SimEvent[] = [],
  subStepLen = PHYS.subStep,
): SimEvent[] {
  const n = Math.max(1, Math.ceil(dt / subStepLen));
  const h = dt / n;
  for (let k = 0; k < n; k++) subStep(stones, h, sweep, events);
  return events;
}

function subStep(stones: Stone[], h: number, sweep: Map<number, number> | null, events: SimEvent[]): void {
  const R = STONE.radius;
  for (const s of stones) {
    if (!s.inPlay || !s.moving) continue;
    const v = Math.hypot(s.vx, s.vy);
    if (v < PHYS.stopSpeed) {
      s.vx = s.vy = 0;
      s.moving = false;
      events.push({ type: 'stop', id: s.id });
      continue;
    }
    const sw = sweep?.get(s.id) ?? 0;
    const dx = s.vx / v;
    const dy = s.vy / v;
    const a = PHYS.decel * (1 - PHYS.sweepFriction * sw);
    const vNew = Math.max(0, v - a * h);
    // 進行方向の右向き単位ベクトル
    const px = dy;
    const py = -dx;
    const aLat = (PHYS.curl * s.spin * (1 - PHYS.sweepCurl * sw)) / (v + PHYS.curlV0);
    s.vx = dx * vNew + px * aLat * h;
    s.vy = dy * vNew + py * aLat * h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    s.angle += s.spin * h * (0.6 + v * 0.4);
  }

  // 衝突（同じ質量の円）
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i];
    if (!a.inPlay) continue;
    for (let j = i + 1; j < stones.length; j++) {
      const b = stones[j];
      if (!b.inPlay || (!a.moving && !b.moving)) continue;
      let nx = b.x - a.x;
      let ny = b.y - a.y;
      const d = Math.hypot(nx, ny);
      if (d >= 2 * R || d === 0) continue;
      nx /= d;
      ny /= d;
      // めり込みを解消
      const push = (2 * R - d) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn <= 0) continue;
      const j2 = ((1 + PHYS.restitution) / 2) * vn;
      a.vx -= j2 * nx;
      a.vy -= j2 * ny;
      b.vx += j2 * nx;
      b.vy += j2 * ny;
      a.moving = b.moving = true;
      a.spin *= 0.5;
      b.spin = b.spin * PHYS.hitSpinKeep;
      events.push({ type: 'hit', id: a.id, other: b.id, power: vn });
    }
  }

  // 場外: バックラインを完全に越えた、サイドボードに当たった
  for (const s of stones) {
    if (!s.inPlay) continue;
    if (s.y - R > SHEET.backLine || Math.abs(s.x) + R > SHEET.halfWidth) {
      s.inPlay = false;
      s.moving = false;
      s.vx = s.vy = 0;
      events.push({ type: 'out', id: s.id });
    }
  }
}

export function anyMoving(stones: Stone[]): boolean {
  return stones.some((s) => s.inPlay && s.moving);
}

/** 全部止まったあとに呼ぶ: 奥のホッグラインを越えていないストーンを除外 */
export function removeHogged(stones: Stone[]): number[] {
  const out: number[] = [];
  for (const s of stones) {
    if (s.inPlay && s.y - STONE.radius < SHEET.farHog) {
      s.inPlay = false;
      out.push(s.id);
    }
  }
  return out;
}

export function distToButton(s: Stone): number {
  return Math.hypot(s.x, s.y - SHEET.tee);
}

export function inHouse(s: Stone): boolean {
  return s.inPlay && distToButton(s) - STONE.radius <= SHEET.houseR;
}

/** エンドの得点: ハウス内でボタンに最も近いチームが、相手の最も近い石より内側にある数だけ得点 */
export function scoreEnd(stones: Stone[]): { team: Team | null; points: number; counting: number[] } {
  const inside = stones.filter(inHouse).sort((a, b) => distToButton(a) - distToButton(b));
  if (inside.length === 0) return { team: null, points: 0, counting: [] };
  const team = inside[0].team;
  const counting: number[] = [];
  for (const s of inside) {
    if (s.team !== team) break;
    counting.push(s.id);
  }
  return { team, points: counting.length, counting };
}

/** 一投を最後まで計算する（テスト・CPU用）。sweepFn は時刻と石から強さを返す */
export function simulate(
  stones: Stone[],
  maxTime = 60,
  sweepFn?: (s: Stone, t: number) => number,
  dt = 1 / 60,
  subStepLen = PHYS.subStep,
): { time: number; events: SimEvent[] } {
  const events: SimEvent[] = [];
  let t = 0;
  const sw = new Map<number, number>();
  while (anyMoving(stones) && t < maxTime) {
    sw.clear();
    if (sweepFn) for (const s of stones) if (s.moving) sw.set(s.id, sweepFn(s, t));
    step(stones, dt, sw, events, subStepLen);
    t += dt;
  }
  return { time: t, events };
}

export function cloneStones(stones: Stone[]): Stone[] {
  return stones.map((s) => ({ ...s }));
}
