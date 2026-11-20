/**
 * dice3d.ts — настоящие 3D-кубики для всплывающих окон бросков.
 * d4 — тетраэдр, d20 — икосаэдр. Кубик кувыркается ~1.1с и останавливается,
 * после чего попап показывает числовой результат (общий цикл в ui.dice).
 * Один переиспользуемый рендерер; RAF крутится только пока кубик на экране.
 */
import * as THREE from "three";

const SIZE = 150;

export class Dice3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private die: THREE.Group | null = null;
  private raf = 0;
  private rolling = false;
  private idleSpin = 0.4;
  private attached = false;
  readonly canvas: HTMLCanvasElement;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.style.width = `${SIZE}px`;
    this.canvas.style.height = `${SIZE}px`;
    this.canvas.style.display = "block";
    this.canvas.style.margin = "0 auto";
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 20);
    this.camera.position.set(0, 0.5, 3.6);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xfff2d8, 1.6);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8ab4ff, 0.7);
    rim.position.set(-3, 1, -2);
    this.scene.add(rim);
  }

  /** Текстура грани с числом: рисуем на canvas, число ближе к центроиду треугольника. */
  private faceTexture(n: number, bg: string, fg: string): THREE.CanvasTexture {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = fg;
    ctx.font = "900 58px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), 64, 80);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  /** Данные граней: наружная нормаль и «верх цифры» (в сторону угла с UV 0.5,0.97). */
  private faceData: { n: THREE.Vector3; up: THREE.Vector3 }[] = [];

  private buildDie(sides: 4 | 20): THREE.Group {
    const g = new THREE.Group();
    const geo = sides === 4 ? new THREE.TetrahedronGeometry(0.78) : new THREE.IcosahedronGeometry(0.78);
    // полиэдры three.js неиндексированные: каждая грань — 3 вершины.
    // разбиваем на группы по граням и разворачиваем UV каждой грани на всю текстуру
    const pos = geo.getAttribute("position");
    const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    this.faceData = [];
    {
      const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
      for (let f = 0; f < pos.count / 3; f++) {
        v0.fromBufferAttribute(pos, f * 3);
        v1.fromBufferAttribute(pos, f * 3 + 1);
        v2.fromBufferAttribute(pos, f * 3 + 2);
        const n = e1.subVectors(v1, v0).cross(e2.subVectors(v2, v0)).clone().normalize();
        const up = v0.clone().sub(v1.clone().add(v2).multiplyScalar(0.5));
        up.addScaledVector(n, -up.dot(n)).normalize();
        this.faceData.push({ n, up });
      }
    }
    const faceCount = pos.count / 3;
    for (let f = 0; f < faceCount; f++) {
      geo.addGroup(f * 3, 3, f);
      uv.setXY(f * 3 + 0, 0.5, 0.97);
      uv.setXY(f * 3 + 1, 0.06, 0.06);
      uv.setXY(f * 3 + 2, 0.94, 0.06);
    }
    uv.needsUpdate = true;
    const bg = sides === 4 ? "#f2ead8" : "#c03325";
    const fg = sides === 4 ? "#4a3410" : "#ffe8d8";
    const mats: THREE.Material[] = [];
    for (let f = 0; f < faceCount; f++) {
      mats.push(new THREE.MeshStandardMaterial({
        map: this.faceTexture(f + 1, bg, fg),
        flatShading: true,
        roughness: 0.35,
        metalness: 0.1,
      }));
    }
    const body = new THREE.Mesh(geo, mats);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: sides === 4 ? 0x9a7a3a : 0xffb0a0 }),
    );
    edges.scale.setScalar(1.002);
    g.add(body, edges);
    return g;
  }

  attach(holder: HTMLElement, sides: 4 | 20): void {
    if (this.die) {
      this.scene.remove(this.die);
      this.die.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const sm = mm as THREE.MeshStandardMaterial;
            if (sm.map) sm.map.dispose();
            mm.dispose();
          }
        }
      });
    }
    this.die = this.buildDie(sides);
    this.die.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this.settled = false;
    this.scene.add(this.die);
    holder.appendChild(this.canvas);
    this.attached = true;
    this.startLoop();
  }

  detach(): void {
    this.attached = false;
    this.canvas.remove();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * Кватернион, при котором грань `value` смотрит на камеру цифрой вверх.
   * Локальный базис грани (up, right, normal) поворачивается в мировой
   * (экранный «верх», боковая ось, направление на камеру).
   */
  private faceQuaternion(value: number): THREE.Quaternion {
    const f = this.faceData[value - 1];
    const camDir = new THREE.Vector3(0, 0.14, 0.99).normalize(); // направление от кубика к камере
    const wA = new THREE.Vector3(0, 1, 0).addScaledVector(camDir, -camDir.y).normalize(); // «верх» на грани
    const wB = new THREE.Vector3().crossVectors(camDir, wA); // боковая ось
    const W = new THREE.Matrix4().makeBasis(wA, wB, camDir);
    const lB = new THREE.Vector3().crossVectors(f.n, f.up);
    const L = new THREE.Matrix4().makeBasis(f.up, lB, f.n);
    return new THREE.Quaternion().setFromRotationMatrix(W.multiply(L.invert()));
  }

  /**
   * Кувыркание с затуханием; кубик останавливается гранью `value` к игроку.
   * Резолвится, когда кубик замер на выпавшей грани.
   */
  roll(value: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.die || value < 1 || value > this.faceData.length) { resolve(); return; }
      const die = this.die;
      const DUR = 1.1;
      const SETTLE = 0.4;
      let t = 0;
      let last = performance.now();
      const vx = (10 + Math.random() * 8) * (Math.random() < 0.5 ? -1 : 1);
      const vy = (10 + Math.random() * 8) * (Math.random() < 0.5 ? -1 : 1);
      const vz = (8 + Math.random() * 6) * (Math.random() < 0.5 ? -1 : 1);
      const qTarget = this.faceQuaternion(value);
      const q0 = new THREE.Quaternion();
      let captured = false;
      this.rolling = true;

      const step = (now: number) => {
        if (!this.attached) { resolve(); return; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        t += dt;
        if (t <= DUR) {
          const k = Math.min(1, t / DUR);
          const ease = 1 - Math.pow(1 - k, 3); // ease-out cubic
          const spin = 1 - ease;
          die.rotation.x += vx * spin * dt;
          die.rotation.y += vy * spin * dt;
          die.rotation.z += vz * spin * dt;
          die.position.y = Math.abs(Math.sin(k * Math.PI * 3)) * 0.45 * (1 - k);
          if (k >= 1 && !captured) { captured = true; q0.copy(die.quaternion); }
          return;
        }
        // плавная доводка: кубик разворачивается выпавшей гранью к игроку и замирает
        const ks = Math.min(1, (t - DUR) / SETTLE);
        const e = ks * ks * (3 - 2 * ks); // smoothstep
        die.quaternion.slerpQuaternions(q0, qTarget, e);
        die.position.y = 0;
        if (ks >= 1) {
          this.rolling = false;
          this.settled = true; // никакого холостого вращения — кубик стоит неподвижно
          this.rollStep = null;
          resolve();
        }
      };
      this.rollStep = step;
    });
  }

  private rollStep: ((now: number) => void) | null = null;
  private settled = false;

  private startLoop(): void {
    if (this.raf) return;
    let last = performance.now();
    const frame = (now: number) => {
      if (!this.attached) { this.raf = 0; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // холостое вращение — только до броска; упавший кубик остаётся неподвижным
      if (this.die && !this.rolling && !this.settled) this.die.rotation.y += this.idleSpin * dt;
      this.rollStep?.(now);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  dispose(): void {
    this.detach();
    if (this.die) {
      this.scene.remove(this.die);
      this.die.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const sm = mm as THREE.MeshStandardMaterial;
            if (sm.map) sm.map.dispose();
            mm.dispose();
          }
        }
      });
      this.die = null;
    }
    this.renderer.dispose();
  }
}
