// CPU の思考。同じ物理計算で候補の一投を試し、投げたあとの盤面を評価して選ぶ。
import { AI, GAME, SHEET, STONE } from './config';
import {
  cloneStones,
  distToButton,
  launch,
  makeStone,
  removeHogged,
  scoreEnd,
  simulate,
  speedForDistance,
  type Stone,
  type Team,
} from './physics';

export type ShotKind = 'guard' | 'draw' | 'takeout';

export interface Shot {
  kind: ShotKind;
  /** 狙った到達距離（ぶれ・弱め調整を入れる前） */
  dist: number;
  aim: number;
  spin: 1 | -1;
  /** ドロー・ガードで、止めたい地点（スイープ判断に使う） */
  target: { x: number; y: number } | null;
  value: number;
}

export interface AiContext {
  stones: Stone[];
  team: Team;
  /** この一投を含めた、自分の残り投数 */
  selfLeft: number;
  oppLeft: number;
  /** 自分がこのエンドの最後の一投（ハンマー）を持っているか */
  hammer: boolean;
}

const SHOT_LABEL: Record<ShotKind, string> = { guard: 'ガード', draw: 'ドロー', takeout: 'テイクアウト' };
export const shotLabel = (k: ShotKind) => SHOT_LABEL[k];

/** 投げたあとの盤面の価値（team から見た値。大きいほど良い） */
export function evaluate(stones: Stone[], ctx: AiContext): number {
  const sc = scoreEnd(stones);
  const pts = sc.team === null ? 0 : sc.team === ctx.team ? sc.points : -sc.points;
  const left = ctx.selfLeft - 1 + ctx.oppLeft; // この一投のあとに残る投数
  if (left === 0) {
    // 最後の一投: 得点そのもの。ハンマー側が1点だけ取るより、0点（ブランク）でハンマーを残す方を少し好む
    if (ctx.hammer && pts === 1) return 0.8;
    return pts;
  }
  // 途中: 得点の見込み + 位置の良さ（残りが多いほど位置を重視）
  const posW = Math.min(1, left / 6);
  let pos = 0;
  const own = (s: Stone) => (s.team === ctx.team ? 1 : -1);
  let ownInHouse = 0;
  for (const s of stones) {
    if (!s.inPlay) continue;
    const d = distToButton(s);
    if (d - STONE.radius <= SHEET.houseR) {
      pos += own(s) * (0.45 - 0.2 * (d / SHEET.houseR));
      if (s.team === ctx.team) ownInHouse++;
    }
  }
  for (const s of stones) {
    if (!s.inPlay) continue;
    const isGuard = s.y < SHEET.tee - SHEET.houseR - STONE.radius && Math.abs(s.x) < 1.3;
    if (!isGuard) continue;
    if (s.team === ctx.team) {
      // 自分のガード: ハウスに自分の石があるとき、またはハンマーを持たない側のセンターガードに価値
      pos += ownInHouse > 0 ? 0.18 : ctx.hammer ? 0.03 : 0.12;
    } else {
      pos -= 0.08;
    }
  }
  // ハンマーを持つ側は、ハウスに石が少ない展開（相手に盤面を作らせない）を好む
  const oppInHouse = stones.filter((s) => s.inPlay && s.team !== ctx.team && distToButton(s) - STONE.radius <= SHEET.houseR).length;
  if (ctx.hammer) pos -= oppInHouse * 0.05;
  return pts * (1 - posW * 0.5) + pos * posW;
}

/** 一投を先読みで試す（投げたあとの盤面を返す） */
export function tryShot(stones: Stone[], team: Team, dist: number, aim: number, spin: number): Stone[] {
  const all = cloneStones(stones);
  const s = makeStone(-100, team);
  launch(s, speedForDistance(dist), aim, spin);
  all.push(s);
  simulate(all, 80, undefined, AI.simDt, AI.simSubStep);
  removeHogged(all);
  return all;
}

function gauss(rand: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 候補を作って評価する。ジェネレーター: 一定数ごとに yield して、画面を止めずに少しずつ考える。
 */
export function* planShot(ctx: AiContext, rand: () => number = Math.random): Generator<void, Shot> {
  const hasTargets = ctx.stones.some((s) => s.inPlay && s.y > SHEET.farHog);
  const dists: { d: number; kind: ShotKind }[] = [
    ...AI.guardDists.map((d) => ({ d, kind: 'guard' as const })),
    ...AI.drawDists.map((d) => ({ d, kind: 'draw' as const })),
    ...(hasTargets ? AI.takeoutDists.map((d) => ({ d, kind: 'takeout' as const })) : []),
  ];
  const cands: Shot[] = [];
  let n = 0;
  for (const { d, kind } of dists) {
    for (let aim = -AI.aimMax; aim <= AI.aimMax + 1e-9; aim += AI.aimStep) {
      for (const spin of [1, -1] as const) {
        const after = tryShot(ctx.stones, ctx.team, d, aim, spin);
        const thrown = after[after.length - 1];
        cands.push({
          kind,
          dist: d,
          aim,
          spin,
          target: kind !== 'takeout' && thrown.inPlay ? { x: thrown.x, y: thrown.y } : null,
          value: evaluate(after, ctx),
        });
        if (++n % AI.candidatesPerFrame === 0) yield;
      }
    }
  }
  // 上位の候補を、ぶれを入れて試し直す（狙いが際どすぎる一投を避ける）
  cands.sort((a, b) => b.value - a.value);
  const top = cands.slice(0, AI.refineTop);
  let best = top[0];
  let bestMean = -Infinity;
  for (const c of top) {
    let sum = c.value;
    for (let k = 0; k < AI.refineSamples; k++) {
      const after = tryShot(
        ctx.stones,
        ctx.team,
        c.dist + gauss(rand) * AI.noiseDist,
        c.aim + gauss(rand) * AI.noiseAim,
        c.spin,
      );
      sum += evaluate(after, ctx);
    }
    const mean = sum / (AI.refineSamples + 1);
    if (mean > bestMean) {
      bestMean = mean;
      best = c;
    }
    yield;
  }
  return best;
}

/** 実際に投げる値（ぶれと、スイープ前提の弱め調整を入れる） */
export function executeShot(shot: Shot, rand: () => number = Math.random): { v0: number; aim: number; spin: 1 | -1 } {
  const under = shot.kind === 'takeout' ? 0 : AI.underThrow;
  const dist = shot.dist - under + gauss(rand) * AI.noiseDist;
  const aim = shot.aim + gauss(rand) * AI.noiseAim;
  return { v0: speedForDistance(dist), aim, spin: shot.spin };
}

/**
 * 滑走中のスイープ判断: 「次の判断まで掃く」「掃かない」を先読みし、狙いの地点に近く止まる方を選ぶ。
 * 戻り値は 0（掃かない）か 1（掃く）。
 */
export function decideSweep(
  stones: Stone[],
  currentId: number,
  target: { x: number; y: number } | null,
  interval = AI.sweepDecideEvery,
): number {
  if (!target) return 0;
  const res = [0, 1].map((sw) => {
    const all = cloneStones(stones);
    simulate(
      all,
      80,
      (s, t) => (sw && s.id === currentId && t < interval && s.y < SHEET.backLine ? 1 : 0),
      AI.simDt,
      AI.simSubStep,
    );
    const s = all.find((x) => x.id === currentId)!;
    if (!s.inPlay || s.y - STONE.radius < SHEET.farHog) return 99;
    return Math.hypot(s.x - target.x, s.y - target.y);
  });
  return res[1] + 0.05 < res[0] ? 1 : 0;
}

/** テスト・自動プレイ用: 同期的に最後まで考える */
export function planShotSync(ctx: AiContext, rand: () => number = Math.random): Shot {
  const it = planShot(ctx, rand);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

export const STONES_PER_END = GAME.stonesPerTeam * 2;
