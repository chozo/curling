import { describe, expect, it } from 'vitest';
import { SHEET, STONE, THROW } from '../src/config';
import { distToButton, launch, makeStone, simulate, speedForDistance } from '../src/physics';

const powerToDist = (p: number) => {
  const c = THROW.powerCurve;
  for (let i = 1; i < c.length; i++) {
    if (p <= c[i][0]) return c[i - 1][1] + ((p - c[i - 1][0]) / (c[i][0] - c[i - 1][0])) * (c[i][1] - c[i - 1][1]);
  }
  return c[c.length - 1][1];
};

function throwAt(power: number, spin: 1 | -1, targetX = -spin * THROW.targetCurlOffset) {
  const s = makeStone(1, 0);
  launch(s, speedForDistance(powerToDist(power)), Math.atan2(targetX, SHEET.tee - STONE.startY), spin);
  simulate([s], 120);
  return s;
}

describe('パワーゲージと目印', () => {
  it('おすすめの目印・ゲージ真ん中なら、ボタン付近（30cm以内）に止まる', () => {
    for (const spin of [1, -1] as const) {
      const s = throwAt(0.5, spin);
      console.log(`spin ${spin}: x=${s.x.toFixed(2)} y=${s.y.toFixed(2)} d=${distToButton(s).toFixed(2)}`);
      expect(distToButton(s)).toBeLessThan(0.3);
    }
  });

  it('ゲージのハウスの範囲で止めれば、ハウスに入る', () => {
    // ハウスの手前の縁〜奥の縁に対応するゲージ範囲の内側
    for (const p of [0.35, 0.42, 0.5, 0.58, 0.65]) {
      const s = throwAt(p, 1);
      expect(distToButton(s) - STONE.radius).toBeLessThan(SHEET.houseR);
    }
  });

  it('ハウスに入るゲージの幅が、全体の3割以上ある（タイミングで狙える）', () => {
    let lo = 1;
    let hi = 0;
    for (let p = 0; p <= 1; p += 0.002) {
      const s = throwAt(p, 1);
      if (s.inPlay && distToButton(s) - STONE.radius <= SHEET.houseR) {
        lo = Math.min(lo, p);
        hi = Math.max(hi, p);
      }
    }
    console.log(`house window: ${lo.toFixed(3)}〜${hi.toFixed(3)} (${((hi - lo) * 100).toFixed(0)}%)`);
    expect(hi - lo).toBeGreaterThan(0.3);
  });
});
