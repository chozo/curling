import { describe, expect, it } from 'vitest';
import { decideSweep, executeShot, planShotSync, tryShot, evaluate, type AiContext } from '../src/ai';
import { SHEET, STONE } from '../src/config';
import { launch, makeStone, removeHogged, scoreEnd, simulate, type Stone, type Team } from '../src/physics';

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}
function placed(id: number, team: Team, x: number, y: number): Stone {
  const s = makeStone(id, team);
  s.inPlay = true;
  s.x = x;
  s.y = y;
  return s;
}

describe('CPU の一投', () => {
  it('最後の一投: 相手の石がボタンにあれば、はじき出すか内側に入れて得点する（ぶれなし）', () => {
    const stones = [placed(1, 0, 0.05, SHEET.tee + 0.05)];
    const ctx: AiContext = { stones, team: 1, selfLeft: 1, oppLeft: 0, hammer: true };
    const shot = planShotSync(ctx, rng(1));
    const after = tryShot(stones, 1, shot.dist, shot.aim, shot.spin);
    const sc = scoreEnd(after);
    console.log(`last stone: ${shot.kind} aim=${shot.aim.toFixed(3)} spin=${shot.spin} → ${JSON.stringify(sc)}`);
    expect(sc.team).toBe(1);
  });

  it('空の盤面で考える時間が短い（候補全部で 400ms 未満）', () => {
    const stones = [placed(1, 0, 0.3, SHEET.tee - 0.4), placed(2, 1, -0.5, SHEET.tee + 0.6), placed(3, 0, 0.1, 25)];
    const t0 = performance.now();
    planShotSync({ stones, team: 1, selfLeft: 3, oppLeft: 2, hammer: true }, rng(2));
    const ms = performance.now() - t0;
    console.log(`plan time: ${ms.toFixed(0)}ms`);
    expect(ms).toBeLessThan(400);
  });

  it('スイープ判断: 短いドローは掃く、狙い通りなら掃かない', () => {
    const s = makeStone(5, 1);
    launch(s, Math.sqrt(2 * 0.08 * 28.3), 0, 0); // 少し短い（ティーより約1m手前で止まる）
    simulate([s], 3);
    expect(decideSweep([s], 5, { x: 0, y: SHEET.tee })).toBe(1);
    const s2 = makeStone(6, 1);
    launch(s2, Math.sqrt(2 * 0.08 * (SHEET.tee - STONE.startY)), 0, 0);
    simulate([s2], 3);
    expect(decideSweep([s2], 6, { x: 0, y: SHEET.tee })).toBe(0);
  });
});

describe('自動対戦（CPU の強さの目安）', () => {
  it('CPU（ぶれ・スイープあり）は、ドローだけの相手に勝ち越す', () => {
    const rand = rng(7);
    let cpuPts = 0;
    let oppPts = 0;
    const ENDS = 8;
    for (let e = 0; e < ENDS; e++) {
      const stones: Stone[] = [];
      for (let i = 0; i < 8; i++) {
        const team = ((i + (e % 2)) % 2) as Team; // ハンマーを交互に
        const hammerTeam = ((1 + (e % 2)) % 2) as Team;
        const s = makeStone(i, team);
        stones.push(s);
        if (team === 1) {
          const left = 4 - stones.filter((x) => x.team === 1).length + 1;
          const oppLeft = 4 - stones.filter((x) => x.team === 0).length;
          const shot = planShotSync(
            { stones: stones.filter((x) => x !== s), team: 1, selfLeft: left, oppLeft, hammer: hammerTeam === 1 },
            rand,
          );
          const ex = executeShot(shot, rand);
          launch(s, ex.v0, ex.aim, ex.spin);
          // 簡易スイープ制御: 1秒ごとに判断
          let sw = 0;
          let t = 0;
          while (stones.some((x) => x.moving) && t < 80) {
            if (Math.abs(t % 0.8) < 1e-6 || t === 0) sw = decideSweep(stones, s.id, shot.target);
            simulate(stones, 1 / 30 + 1e-9, (x) => (x.id === s.id ? sw : 0), 1 / 30);
            t = Math.round((t + 1 / 30) * 1000) / 1000;
          }
        } else {
          // 相手: ボタン狙いのドロー（人間程度のぶれ）
          const spin = rand() < 0.5 ? 1 : -1;
          const aim = -spin * 0.039 + (rand() - 0.5) * 0.02;
          launch(s, Math.sqrt(2 * 0.08 * (SHEET.tee - STONE.startY + (rand() - 0.5) * 4)), aim, spin);
          simulate(stones, 80);
        }
        removeHogged(stones);
      }
      const sc = scoreEnd(stones);
      if (sc.team === 1) cpuPts += sc.points;
      if (sc.team === 0) oppPts += sc.points;
    }
    console.log(`self-play ${ENDS} ends: CPU ${cpuPts} - ${oppPts} draw-bot`);
    expect(cpuPts).toBeGreaterThan(oppPts);
  }, 30000); // 8 エンドの自動対戦は重いので長めに待つ

  it('評価: 自分の石がボタンにある盤面は、相手の石がある盤面より高い', () => {
    const ctx = { team: 1 as Team, selfLeft: 2, oppLeft: 2, hammer: false };
    const a = evaluate([placed(1, 1, 0, SHEET.tee)], { ...ctx, stones: [] });
    const b = evaluate([placed(1, 0, 0, SHEET.tee)], { ...ctx, stones: [] });
    expect(a).toBeGreaterThan(b);
  });
});
