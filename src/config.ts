// 調整値はここにまとめる。単位は特記なければ m・秒（シミュレーション内の時間）。

/** シートの寸法（世界カーリング連盟の規格をもとにした値）。y はリリース地点（手前ホッグライン）からシート奥へ向かう距離 */
export const SHEET = {
  halfWidth: 2.375, // シート幅 4.75m の半分
  nearHog: 0,
  farHog: 21.95,
  tee: 28.35,
  backLine: 30.18,
  houseR: 1.829, // 12フィート
  ring8: 1.219,
  ring4: 0.61,
  button: 0.152,
  endOfSheet: 32.0,
};

export const STONE = {
  radius: 0.145,
  startY: -1.2, // 投げ出す位置（手前ホッグの少し前）
};

export const PHYS = {
  /** 摩擦による減速（m/s²）。実際の氷はおよそ 0.07〜0.09 */
  decel: 0.08,
  /** 曲がり（横向き加速度）= curl * spin / (v + curlV0)。ドローで約1.0〜1.3m曲がるように調整 */
  curl: 0.0103,
  curlV0: 0.4,
  /** スイープ最大時の効果: 摩擦の減少率、曲がりの減少率 */
  sweepFriction: 0.3,
  sweepCurl: 0.55,
  /** ストーン同士の反発係数 */
  restitution: 0.88,
  /** 衝突されたストーンに残る回転の割合 */
  hitSpinKeep: 0.0,
  stopSpeed: 0.004,
  subStep: 1 / 240,
};

export const GAME = {
  /** シミュレーション速度（実時間1秒あたり何秒進めるか）。本物の約25秒の滑走を7秒前後にする */
  simSpeed: 3.6,
  stonesPerTeam: 4,
};

export const THROW = {
  /**
   * パワーゲージの位置(0〜1) → 到達距離（リリースから止まるまでの直進距離 m）の折れ線。
   * ハウスの手前の縁（約27.7m）〜奥の縁（約31.4m）がゲージの約35%を占め、ティーライン（29.55m）がちょうど真ん中に来る。
   */
  powerCurve: [
    [0, 18],
    [0.3, 27.4],
    [0.7, 31.6],
    [1, 50],
  ] as [number, number][],
  /** ゲージが下→上→下と1往復する時間（実時間 秒）。動きは一定速度 */
  gaugePeriod: 2.2,
  /** 目印（ブルーム）: ドラッグで画面の幅いっぱい動かしたときに何m動くか、動ける範囲 */
  targetDragM: 3.2,
  targetMaxX: 1.9,
  /** 回転を選んだとき、目印を曲がる側と反対へずらす量（m）。ドローでの曲がりとほぼ同じ */
  targetCurlOffset: 1.1,
};

export const SWEEP = {
  /** スイープ最大になる擦る速さ（画面の幅/秒） */
  fullRate: 2.6,
  /** 効き目の立ち上がり・減衰の速さ（1/秒、実時間） */
  response: 7,
  /** スイープできる帯: ストーンの前方 near〜far m */
  zoneNear: 0.25,
  zoneFar: 2.2,
  zoneHalfWidthM: 1.1,
};

export const AI = {
  /** 候補の狙い角（ラジアン）の範囲と刻み */
  aimMax: 0.07,
  aimStep: 0.007,
  /** 候補の到達距離（リリースからの直進距離 m）。テイクアウトは盤面に石があるときだけ */
  guardDists: [24.3, 25.8],
  drawDists: [28.6, 29.6, 30.6],
  takeoutDists: [40, 52],
  /** 先読みの計算刻み（粗くして速くする） */
  simDt: 1 / 30,
  simSubStep: 1 / 120,
  /** 上位何個の候補を、ぶれを入れて確かめ直すか・何回ずつ */
  refineTop: 6,
  refineSamples: 6,
  /** CPU の投げのぶれ（標準偏差）。狙い角(rad) と 距離(m) */
  noiseAim: 0.0035,
  noiseDist: 0.6,
  /** ドロー・ガードは少し弱めに投げて、スイープで合わせる（m） */
  underThrow: 0.5,
  /** スイープ判断の間隔（シミュレーション秒） */
  sweepDecideEvery: 0.8,
  /** 1フレームで試す候補の数（画面が止まらないように分ける） */
  candidatesPerFrame: 40,
  /** 考えている演出の最短時間（実時間 秒） */
  minThinkSec: 0.9,
};
