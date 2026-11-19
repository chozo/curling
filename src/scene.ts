// Three.js による描画。物理座標 (x, y) → 3D (X=x, Y=高さ, Z=-y)
import * as THREE from 'three';
import { SHEET, STONE } from './config';
import type { Stone } from './physics';

export const TEAM_COLORS = [0xd8343a, 0xf3c22e];
export const TEAM_CSS = ['#e0454b', '#f3c22e'];

const SHEET_Y0 = -6;
const SHEET_Y1 = SHEET.endOfSheet + 2;
const PX_PER_M = 96;

export function toWorld(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x, h, -y);
}

function makeSheetTexture(maxAniso: number): THREE.CanvasTexture {
  const W = Math.round(SHEET.halfWidth * 2 * PX_PER_M);
  const H = Math.round((SHEET_Y1 - SHEET_Y0) * PX_PER_M);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const X = (x: number) => (x + SHEET.halfWidth) * PX_PER_M;
  const Y = (y: number) => (SHEET_Y1 - y) * PX_PER_M;

  g.fillStyle = '#eef5fa';
  g.fillRect(0, 0, W, H);
  // ペブル（氷の粒）とうっすらしたムラ
  for (let i = 0; i < 9000; i++) {
    const a = Math.random() * 0.06;
    g.fillStyle = `rgba(150,180,205,${a})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }

  // ハウス（奥側）
  const ring = (r: number, color: string) => {
    g.beginPath();
    g.arc(X(0), Y(SHEET.tee), r * PX_PER_M, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };
  ring(SHEET.houseR, '#2f6fd0');
  ring(SHEET.ring8, '#f4f8fb');
  ring(SHEET.ring4, '#d23a3f');
  ring(SHEET.button, '#f4f8fb');

  const hLine = (y: number, color: string, w: number) => {
    g.fillStyle = color;
    g.fillRect(0, Y(y) - w / 2, W, w);
  };
  hLine(SHEET.nearHog, '#c8323a', 10);
  hLine(SHEET.farHog, '#c8323a', 10);
  hLine(SHEET.tee, '#1d2a3a', 3);
  hLine(SHEET.backLine, '#1d2a3a', 3);
  // センターライン
  g.fillStyle = '#1d2a3a';
  g.fillRect(X(0) - 1.5, Y(SHEET.endOfSheet), 3, Y(SHEET.nearHog - 4) - Y(SHEET.endOfSheet));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeStoneMesh(team: number): THREE.Group {
  const grp = new THREE.Group();
  const R = STONE.radius;
  const prof = [
    [0, 0],
    [R * 0.55, 0],
    [R * 0.8, 0.006],
    [R * 0.97, 0.03],
    [R, 0.055],
    [R * 0.97, 0.085],
    [R * 0.82, 0.108],
    [R * 0.7, 0.112],
    [0, 0.112],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const granite = new THREE.MeshStandardMaterial({ color: 0x6d7178, roughness: 0.45, metalness: 0.05 });
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), granite);
  body.castShadow = true;
  grp.add(body);
  // ストライキングバンド（明るい帯）
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 1.002, R * 1.002, 0.022, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x9a9ea5, roughness: 0.3 }),
  );
  band.position.y = 0.055;
  grp.add(band);
  const col = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.35 });
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.66, 0.012, 32), col);
  cap.position.y = 0.118;
  grp.add(cap);
  // ハンドル（回転が見えるよう片側に伸ばす）
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, R * 1.25), col);
  handle.position.set(0, 0.15, -R * 0.15);
  handle.castShadow = true;
  grp.add(handle);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), col);
  post.position.set(0, 0.13, R * 0.38);
  grp.add(post);
  return grp;
}

function makeBrush(): THREE.Group {
  const g = new THREE.Group();
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.04, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x23324a, roughness: 0.8 }),
  );
  head.position.y = 0.02;
  head.castShadow = true;
  g.add(head);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.012, 0.09),
    new THREE.MeshStandardMaterial({ color: 0x3fc1ff, roughness: 0.9 }),
  );
  pad.position.y = 0.002;
  g.add(pad);
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 1.3, 8),
    new THREE.MeshStandardMaterial({ color: 0xe8e8ea, roughness: 0.4 }),
  );
  stick.position.set(0, 0.55, 0.32);
  stick.rotation.x = Math.PI * 0.3;
  g.add(stick);
  g.visible = false;
  return g;
}

export class View {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 9 / 16, 0.05, 120);
  stoneMeshes = new Map<number, THREE.Group>();
  brush = makeBrush();
  aimLine = new THREE.Group();
  target = new THREE.Group();
  fov = 42;
  sun: THREE.DirectionalLight;
  camPos = new THREE.Vector3();
  camLook = new THREE.Vector3();
  private sprayPts: THREE.Points;
  private sprayVel: Float32Array;
  private sprayLife: Float32Array;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0e1626);
    this.scene.fog = new THREE.Fog(0x0e1626, 30, 70);

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x334055, 1.4));
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -4;
    sc.right = sc.top = 4;
    sc.near = 1;
    sc.far = 20;
    this.scene.add(this.sun, this.sun.target);

    // シート
    const len = SHEET_Y1 - SHEET_Y0;
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(SHEET.halfWidth * 2, len),
      new THREE.MeshStandardMaterial({
        map: makeSheetTexture(this.renderer.capabilities.getMaxAnisotropy()),
        roughness: 0.18,
        metalness: 0,
      }),
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(0, 0, -(SHEET_Y0 + len / 2));
    sheet.receiveShadow = true;
    this.scene.add(sheet);
    // サイドボード
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x1b2a44, roughness: 0.6 });
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, len), boardMat);
      b.position.set(sx * (SHEET.halfWidth + 0.06), 0.09, sheet.position.z);
      this.scene.add(b);
    }
    // 奥の壁
    const back = new THREE.Mesh(new THREE.BoxGeometry(SHEET.halfWidth * 2 + 0.24, 0.4, 0.15), boardMat);
    back.position.set(0, 0.2, -SHEET_Y1);
    this.scene.add(back);
    // 周囲の床（暗め）
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 120),
      new THREE.MeshStandardMaterial({ color: 0x18233a, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -0.01, -20);
    this.scene.add(floor);
    // 天井の照明列（雰囲気）
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6dd });
    for (let y = -4; y < 36; y += 6) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.3), lampMat);
      l.position.set(0, 7, -y);
      this.scene.add(l);
    }

    this.scene.add(this.brush);

    // 狙いの破線（細い板を並べる）
    const dashMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    const dashGeo = new THREE.PlaneGeometry(0.05, 0.45);
    dashGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 48; i++) this.aimLine.add(new THREE.Mesh(dashGeo, dashMat));
    this.aimLine.visible = false;
    this.scene.add(this.aimLine);

    // 狙いの目印（スキップが置くブルーム）: 光る輪 + 立てたブラシ
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.95, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.24, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    this.target.add(ring);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.2, 8),
      new THREE.MeshStandardMaterial({ color: 0xffe14d, emissive: 0x6b5400 }),
    );
    pole.position.y = 0.6;
    this.target.add(pole);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.05, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x23324a }),
    );
    head.position.y = 1.2;
    this.target.add(head);
    this.target.visible = false;
    this.scene.add(this.target);

    // スイープの氷しぶき
    const N = 160;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3).fill(-999), 3));
    this.sprayVel = new Float32Array(N * 3);
    this.sprayLife = new Float32Array(N);
    this.sprayPts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0x9fd8ff, size: 0.05, transparent: true, opacity: 0.95 }),
    );
    this.scene.add(this.sprayPts);
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  syncStones(stones: Stone[]): void {
    for (const s of stones) {
      let m = this.stoneMeshes.get(s.id);
      if (!m) {
        m = makeStoneMesh(s.team);
        this.stoneMeshes.set(s.id, m);
        this.scene.add(m);
      }
      m.visible = s.inPlay;
      m.position.copy(toWorld(s.x, s.y));
      m.rotation.y = -s.angle;
    }
  }

  setAim(aim: number | null, dist = 30): void {
    if (aim === null) {
      this.aimLine.visible = false;
      return;
    }
    const step = 0.8;
    this.aimLine.children.forEach((m, i) => {
      const d = 0.6 + i * step;
      m.visible = d < dist;
      m.position.copy(toWorld(Math.sin(aim) * d, STONE.startY + Math.cos(aim) * d, 0.004));
      m.rotation.y = -aim;
    });
    this.aimLine.visible = true;
  }

  setTarget(x: number | null, y = SHEET.tee): void {
    this.target.visible = x !== null;
    if (x !== null) this.target.position.copy(toWorld(x, y));
  }

  /** ブラシを石の前に置く。offset は左右の位置(-1..1)、power はスイープの強さ */
  setBrush(s: Stone | null, offset: number, power: number, dtReal: number): void {
    if (!s) {
      this.brush.visible = false;
    } else {
      const v = Math.hypot(s.vx, s.vy) || 1;
      const dx = s.vx / v;
      const dy = s.vy / v;
      const ahead = 0.55;
      const px = s.x + dx * ahead + dy * offset * 0.18;
      const py = s.y + dy * ahead - dx * offset * 0.18;
      this.brush.visible = true;
      this.brush.position.copy(toWorld(px, py));
      this.brush.rotation.y = Math.atan2(dx, dy) * -1 + offset * 0.25;
      if (power > 0.05) this.emitSpray(px, py, power, dtReal);
    }
    this.updateSpray(dtReal);
  }

  private sprayIdx = 0;
  private emitSpray(x: number, y: number, power: number, dt: number): void {
    const pos = this.sprayPts.geometry.attributes.position as THREE.BufferAttribute;
    const n = Math.ceil(power * 220 * dt);
    for (let k = 0; k < n; k++) {
      const i = this.sprayIdx++ % this.sprayLife.length;
      pos.setXYZ(i, x + (Math.random() - 0.5) * 0.4, 0.02, -y + (Math.random() - 0.5) * 0.08);
      this.sprayVel[i * 3] = (Math.random() - 0.5) * 1.6;
      this.sprayVel[i * 3 + 1] = 0.4 + Math.random() * 0.6;
      this.sprayVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      this.sprayLife[i] = 0.35 + Math.random() * 0.25;
    }
  }

  private updateSpray(dt: number): void {
    const pos = this.sprayPts.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.sprayLife.length; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      this.sprayVel[i * 3 + 1] -= 4 * dt;
      pos.setXYZ(
        i,
        pos.getX(i) + this.sprayVel[i * 3] * dt,
        Math.max(0.005, pos.getY(i) + this.sprayVel[i * 3 + 1] * dt),
        pos.getZ(i) + this.sprayVel[i * 3 + 2] * dt,
      );
      if (this.sprayLife[i] <= 0) pos.setXYZ(i, 0, -999, 0);
    }
    pos.needsUpdate = true;
  }

  /** カメラを目標へなめらかに寄せる。k は追従の強さ */
  moveCamera(pos: THREE.Vector3, look: THREE.Vector3, k: number, fov = this.fov): void {
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.fov += (fov - this.fov) * k;
    if (Math.abs(this.camera.fov - this.fov) > 1e-3) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // 影は注目点の周りだけ
    this.sun.position.set(this.camLook.x + 2, 8, this.camLook.z + 3);
    this.sun.target.position.copy(this.camLook);
  }

  snapCamera(pos: THREE.Vector3, look: THREE.Vector3, fov = this.fov): void {
    this.camPos.copy(pos);
    this.camLook.copy(look);
    this.moveCamera(pos, look, 1, fov);
  }

  /** 物理座標を画面座標（CSSピクセル、キャンバス左上原点）へ */
  project(x: number, y: number, w: number, h: number): { x: number; y: number; behind: boolean } {
    const v = toWorld(x, y).project(this.camera);
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, behind: v.z > 1 };
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
