import { describe, expect, it } from 'vitest';
import { SHEET, STONE } from '../src/config';
import { launch, makeStone, removeHogged, scoreEnd, simulate, speedForDistance, type Stone } from '../src/physics';

function throwOne(dist: number, spin: number, aim = 0, sweep = 0, others: Stone[] = []) {
  const s = makeStone(99, 0);
  launch(s, speedForDistance(dist), aim, spin);
  const all = [...others, s];
  const r = simulate(all, 120, sweep ? () => sweep : undefined);
  return { s, all, ...r };
}

describe('滑走', () => {
  it('回転なしならまっすぐ、狙った距離で止まる', () => {
    const { s } = throwOne(SHEET.tee - STONE.startY, 0);
    expect(Math.abs(s.x)).toBeLessThan(1e-6);
    expect(Math.abs(s.y - SHEET.tee)).toBeLessThan(0.05);
  });

  it('ドローは 0.8〜1.5m 曲がり、時計回りは右へ', () => {
    const { s, time } = throwOne(SHEET.tee - STONE.startY, 1);
    console.log(`draw curl=${s.x.toFixed(2)}m y=${s.y.toFixed(2)} time=${time.toFixed(1)}s`);
    expect(s.x).toBeGreaterThan(0.8);
    expect(s.x).toBeLessThan(1.5);
    const l = throwOne(SHEET.tee - STONE.startY, -1).s;
    expect(l.x).toBeCloseTo(-s.x, 6);
  });

  it('曲がりは終盤に大きい（後半の横ずれが前半より大きい）', () => {
    const s = makeStone(1, 0);
    launch(s, speedForDistance(SHEET.tee - STONE.startY), 0, 1);
    const xs: number[] = [];
    let t = 0;
    while (s.moving) {
      simulate([s], 1);
      t++;
      xs.push(s.x);
      if (t > 200) break;
    }
    const half = Math.floor(xs.length / 2);
    expect(xs[xs.length - 1] - xs[half]).toBeGreaterThan(xs[half]);
  });

  it('スイープすると伸びて、曲がりが減る', () => {
    const base = throwOne(SHEET.tee - STONE.startY, 1).s;
    const swept = throwOne(SHEET.tee - STONE.startY, 1, 0, 1).s;
    console.log(`sweep full: +${(swept.y - base.y).toFixed(2)}m, curl ${base.x.toFixed(2)}→${swept.x.toFixed(2)}`);
    expect(swept.y - base.y).toBeGreaterThan(1.5);
    expect(swept.x).toBeLessThan(base.x);
  });
});

describe('衝突', () => {
  it('正面のテイクアウトで的の石が出て、投げた石が残る', () => {
    const target = makeStone(1, 1);
    target.inPlay = true;
    target.y = SHEET.tee;
    const { s, all } = throwOne(SHEET.tee - STONE.startY + 30, 0, 0, 0, [target]);
    expect(all[0].inPlay).toBe(false);
    expect(s.inPlay).toBe(true);
    expect(s.y).toBeGreaterThan(SHEET.tee - 1);
  });
});

describe('得点', () => {
  it('近い順に同じチームの石を数える', () => {
    const mk = (id: number, team: 0 | 1, x: number, dy: number) => {
      const s = makeStone(id, team);
      s.inPlay = true;
      s.x = x;
      s.y = SHEET.tee + dy;
      return s;
    };
    const r = scoreEnd([mk(1, 0, 0, 0.1), mk(2, 0, 0.5, 0), mk(3, 1, 0, 0.8), mk(4, 0, 1.2, 0)]);
    expect(r).toMatchObject({ team: 0, points: 2 });
    expect(scoreEnd([mk(5, 1, 3, 0)]).points).toBe(0);
  });

  it('ホッグラインを越えない石は除外', () => {
    const s = makeStone(1, 0);
    s.inPlay = true;
    s.y = SHEET.farHog;
    expect(removeHogged([s])).toEqual([1]);
  });
});
