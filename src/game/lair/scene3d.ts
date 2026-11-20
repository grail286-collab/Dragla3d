/**
 * scene3d.ts — Three.js сцена «Логова Дракона».
 * Инстансированные полы/стены/неоткрытые блоки, фишки игроков, дракон,
 * подсветка доступных клеток, плавная камера, частицы, рейкаст-тапы.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { W, H, CELL, N, E, S, WE, idx, inBounds, LAIR_CELLS, PIT_CELLS, avatarUrl, AVATAR_MODEL, type Cell, type Player } from "./model";

const HALF = (W * CELL) / 2;
/** Нулевая матрица: полностью убирает инстанс (не оставляет плоских «донышек»). */
const ZERO_M4 = new THREE.Matrix4().makeScale(0, 0, 0);
export const cellToWorld = (x: number, z: number) => ({
  wx: x * CELL - HALF + CELL / 2,
  wz: z * CELL - HALF + CELL / 2,
});

interface Tween { t: number; dur: number; update: (k: number) => void; done: () => void }

interface Burst {
  points: THREE.Points; vel: Float32Array; life: number; maxLife: number; active: boolean;
}

export class Scene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pickPlane: THREE.Mesh;

  private floorMeshes: THREE.InstancedMesh[] = [];
  private overMeshes: THREE.InstancedMesh[] = [];
  private overLoc: ({ mesh: THREE.InstancedMesh; k: number; base: THREE.Matrix4 } | null)[] = [];
  private assetsReady: Promise<void>;
  private heroTemplates: (THREE.Group | null)[] = [];
  private dragonTemplate: THREE.Group | null = null;
  private tilesTex: THREE.Texture | null = null;
  private walls!: THREE.InstancedMesh;
  private wallMeta: { horizontal: boolean; px: number; pz: number; ca: number; cb: number; h1: number; h2: number; bh?: number; byaw?: number; bjx?: number; bjz?: number }[] = [];
  private borderBlocks!: THREE.InstancedMesh;
  private cellWalls = new Map<number, number[]>();
  private revealed = new Uint8Array(W * H);
  private revealAnim: { i: number; k: number }[] = [];

  private boardGroup: THREE.Group | null = null;
  private pawns: THREE.Group[] = [];
  private pawnLights: THREE.PointLight[] = [];
  private activeRing!: THREE.Mesh;
  private highlights: THREE.Mesh[] = [];
  private highlightGlows: THREE.Mesh[] = [];
  private jumpHighlights: THREE.Mesh[] = [];
  private jumpGlows: THREE.Mesh[] = [];
  private glowTex: THREE.Texture | null = null;
  private dragon!: THREE.Group;
  private dragonEyeMat: THREE.MeshStandardMaterial | null = null;
  private dragonLight!: THREE.PointLight;
  private dragonAwake = false;
  private tweens: Tween[] = [];
  private bursts: Burst[] = [];
  private time = 0;

  private camTarget = new THREE.Vector3(0, 0, 0);
  private camDir = new THREE.Vector3(0, 0, 1); // unit vector: centre → pawn (camera sits behind the pawn)
  private camDist = 7.6;
  private camHeight = 17.5;
  private zoomK = 1;                       // pinch / wheel zoom multiplier
  private panOff = new THREE.Vector3();    // ручной сдвиг обзора (сбрасывается при фокусе на героя)
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: "none" | "maybe-tap" | "pan" | "pinch" = "none";
  private tapStart = { x: 0, y: 0, t: 0 };
  private pinchDist = 0;
  private camCur = new THREE.Vector3(0, 30, 30);
  private camLook = new THREE.Vector3(0, 0, 0);
  private lookGoal = new THREE.Vector3();
  private overview = true;

  onCellClick: ((x: number, z: number) => void) | null = null;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = false;

    this.scene.background = new THREE.Color(0x07080f);
    this.scene.fog = new THREE.FogExp2(0x07080f, 0.0085);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 300);
    this.camera.position.copy(this.camCur);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x9aa0cc, 0.9));
    const hemi = new THREE.HemisphereLight(0x9898c8, 0x35302a, 1.0);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffe8c0, 1.35);
    sun.position.set(18, 30, 12);
    this.scene.add(sun);

    // giant invisible pick plane
    this.pickPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL + 20, H * CELL + 20),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    this.pickPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.pickPlane);

    // ground under everything
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(W * CELL + 60, H * CELL + 60),
      new THREE.MeshStandardMaterial({ color: 0x0a0b14, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.25;
    this.scene.add(ground);

    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("resize", this.handleResize);

    this.assetsReady = this.preloadAssets();
  }

  // ---------------- assets ----------------
  private preloadAssets(): Promise<void> {
    const texP = new Promise<void>((res) => {
      new THREE.TextureLoader().load(
        "textures/tiles.png",
        (t) => { t.colorSpace = THREE.SRGBColorSpace; this.tilesTex = t; res(); },
        undefined,
        () => res(),
      );
    });
    const gltf = new GLTFLoader();
    const modelPs = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (n) =>
        new Promise<void>((res) => {
          gltf.load(
            `models/hero${n}.glb`,
            (g) => {
              const root = g.scene;
              root.scale.setScalar(1.5);
              root.position.y = 0.72; // model feet sit at -0.48 · 1.5
              this.heroTemplates[n - 1] = root;
              res();
            },
            undefined,
            () => res(),
          );
        }),
    );
    const dragonP = new Promise<void>((res) => {
      gltf.load(
        "models/dragon.glb",
        (g) => {
          const root = g.scene;
          root.scale.setScalar(3.1);        // спящий дракон ~3 клетки в поперечнике
          root.position.y = 0.62;           // брюхо на плитах (-0.2 · 3.1)
          this.dragonTemplate = root;
          res();
        },
        undefined,
        () => res(),
      );
    });
    return Promise.all([texP, ...modelPs, dragonP]).then(() => undefined);
  }

  /** Радиальная белая текстура для мягкого свечения подсвеченных клеток. */
  private glowTexture(): THREE.Texture {
    if (this.glowTex) return this.glowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, "rgba(255,255,255,0.85)");
    g.addColorStop(0.45, "rgba(255,255,255,0.28)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    this.glowTex = new THREE.CanvasTexture(c);
    return this.glowTex;
  }

  /** One of the 9 tile variants from textures/tiles.png (3×3 atlas) as a material. */
  private tileMaterial(variant: number, roughness = 0.95): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ roughness, metalness: 0.02 });
    if (this.tilesTex) {
      const t = this.tilesTex.clone();
      t.repeat.set(1 / 3, 1 / 3);
      t.offset.set((variant % 3) / 3, (2 - Math.floor(variant / 3)) / 3);
      t.needsUpdate = true;
      mat.map = t;
    }
    return mat;
  }

  // ---------------- board construction ----------------
  async buildBoard(cells: Cell[], players: Player[]): Promise<void> {
    await this.assetsReady;
    // teardown of the previous match's board
    if (this.boardGroup) {
      this.scene.remove(this.boardGroup);
      this.boardGroup.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) {
            const sm = mm as THREE.MeshStandardMaterial;
            if (sm.map && sm.map !== this.tilesTex) sm.map.dispose(); // cloned atlas slices
            mm.dispose();
          }
        }
      });
    }
    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.pawns = [];
    this.pawnLights = [];
    this.highlights = [];
    this.highlightGlows = [];
    this.jumpHighlights = [];
    this.jumpGlows = [];
    this.bursts = [];
    this.revealAnim = [];
    this.revealed.fill(0);
    this.tweens = [];
    this.wallMeta = [];
    this.cellWalls = new Map();
    this.dragonAwake = false;

    const rnd = mulberryLite(12345);
    const add = (o: THREE.Object3D) => this.boardGroup!.add(o);

    // floors — 9 stone-tile variants from the 3×3 atlas, random per cell
    const floorGeo = new THREE.BoxGeometry(CELL, 0.22, CELL);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const buckets: number[][] = Array.from({ length: 9 }, () => []);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (cells[idx(x, z)].pit) continue; // во рву пола нет — бездна
        buckets[Math.floor(rnd() * 9)].push(idx(x, z));
      }
    }
    this.floorMeshes = [];
    for (let v = 0; v < 9; v++) {
      if (!buckets[v].length) continue;
      const im = new THREE.InstancedMesh(floorGeo, this.tileMaterial(v), buckets[v].length);
      buckets[v].forEach((ci, k) => {
        const cx = ci % W, cz = Math.floor(ci / W);
        const { wx, wz } = cellToWorld(cx, cz);
        m4.makeTranslation(wx, -0.11, wz);
        im.setMatrixAt(k, m4);
        const lair = cells[ci].lair;
        const s = 1.05 + rnd() * 0.35; // открытые плиты — светлее, игра была слишком тёмной
        if (lair) col.setRGB(1.5 * s, 0.6 * s, 0.5 * s); // красноватые плиты логова
        else col.setRGB(s, s, s);
        im.setColorAt(k, col);
      });
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false; // instanced: origin-centred bounds would cull the whole board
      this.floorMeshes.push(im);
      add(im);
    }

    // бездонный ров: чёрная шахта + оранжевое свечение глубины
    {
      const shaftGeo = new THREE.BoxGeometry(CELL * 1.02, 2.4, CELL * 1.02);
      const shaftMat = new THREE.MeshStandardMaterial({ color: 0x04050a, roughness: 1 });
      const shaft = new THREE.InstancedMesh(shaftGeo, shaftMat, PIT_CELLS.length);
      shaft.frustumCulled = false;
      const glowGeo = new THREE.CircleGeometry(0.5, 12);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xff5a22, transparent: true, opacity: 0.85 });
      const glow = new THREE.InstancedMesh(glowGeo, glowMat, PIT_CELLS.length);
      glow.frustumCulled = false;
      PIT_CELLS.forEach(([px, pz], k) => {
        const { wx, wz } = cellToWorld(px, pz);
        m4.makeTranslation(wx, -1.45, wz); // верх шахты ниже уровня пола
        shaft.setMatrixAt(k, m4);
        m4.makeRotationX(-Math.PI / 2);
        m4.setPosition(wx, -0.9, wz);
        glow.setMatrixAt(k, m4);
      });
      add(shaft); add(glow);
    }

    // unexplored overlays — плоские тёмные каменные плиты (референс: закрытые тайлы)
    const overGeo = new THREE.BoxGeometry(CELL * 0.98, 0.42, CELL * 0.98);
    const overBuckets: number[][] = Array.from({ length: 9 }, () => []);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        if (cells[idx(x, z)].pit) continue; // ров виден сразу
        overBuckets[Math.floor(rnd() * 9)].push(idx(x, z));
      }
    }
    this.overMeshes = [];
    this.overLoc = new Array(W * H).fill(null);
    for (let v = 0; v < 9; v++) {
      if (!overBuckets[v].length) continue;
      const mat = this.tileMaterial(v, 1);
      mat.color.setHex(0x383c46); // глубокий тёмно-серый камень закрытых тайлов
      const im = new THREE.InstancedMesh(overGeo, mat, overBuckets[v].length);
      overBuckets[v].forEach((ci, k) => {
        const cx = ci % W, cz = Math.floor(ci / W);
        const { wx, wz } = cellToWorld(cx, cz);
        // лёгкий разнобой: плиты повёрнуты и лежат на разной высоте
        m4.makeRotationY((rnd() - 0.5) * 0.3);
        const sy = 1 + (rnd() - 0.5) * 0.14;
        m4.scale(new THREE.Vector3(0.95 + rnd() * 0.07, sy, 0.95 + rnd() * 0.07));
        m4.setPosition(wx, 0.21 * sy, wz);
        im.setMatrixAt(k, m4);
        const s = 0.7 + rnd() * 0.5;
        col.setRGB(s, s, s);
        im.setColorAt(k, col);
        this.overLoc[ci] = { mesh: im, k, base: m4.clone() };
      });
      im.instanceMatrix.needsUpdate = true;
      im.frustumCulled = false;
      this.overMeshes.push(im);
      add(im);
    }

    // walls — каждый пролёт из двух каменных блоков разной высоты (неровная кладка)
    const wallGeo = new THREE.BoxGeometry(CELL / 2 - 0.05, 1.25, 0.34);
    const wallMat = this.tileMaterial(1, 0.92);
    wallMat.color.setHex(0x625e6a); // тёмно-серый камень
    const segs: typeof this.wallMeta = [];
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) {
        const c = cells[idx(x, z)];
        const { wx, wz } = cellToWorld(x, z);
        // each segment records up to two adjacent cell indices; wall shows when either is revealed
        // у пропасти стен нет — открытый обрыв
        const notPit = (ci: number) => ci >= 0 && !cells[ci].pit;
        if (!(c.open & N) && notPit(idx(x, z)) && (inBounds(x, z - 1) ? notPit(idx(x, z - 1)) : true))
          segs.push({ horizontal: true, px: wx, pz: wz - CELL / 2, ca: idx(x, z), cb: inBounds(x, z - 1) ? idx(x, z - 1) : -1, h1: 0.82 + rnd() * 0.36, h2: 0.82 + rnd() * 0.36 });
        if (!(c.open & WE) && notPit(idx(x, z)) && (inBounds(x - 1, z) ? notPit(idx(x - 1, z)) : true))
          segs.push({ horizontal: false, px: wx - CELL / 2, pz: wz, ca: idx(x, z), cb: inBounds(x - 1, z) ? idx(x - 1, z) : -1, h1: 0.82 + rnd() * 0.36, h2: 0.82 + rnd() * 0.36 });
        if (x === W - 1 && !(c.open & E) && notPit(idx(x, z)))
          segs.push({ horizontal: false, px: wx + CELL / 2, pz: wz, ca: idx(x, z), cb: -1, h1: 0.82 + rnd() * 0.36, h2: 0.82 + rnd() * 0.36 });
        if (z === H - 1 && !(c.open & S) && notPit(idx(x, z)))
          segs.push({ horizontal: true, px: wx, pz: wz + CELL / 2, ca: idx(x, z), cb: -1, h1: 0.82 + rnd() * 0.36, h2: 0.82 + rnd() * 0.36 });
      }
    }
    this.wallMeta = segs;
    this.cellWalls = new Map();
    segs.forEach((s, wi) => {
      for (const ci of [s.ca, s.cb]) {
        if (ci < 0) continue;
        if (!this.cellWalls.has(ci)) this.cellWalls.set(ci, []);
        this.cellWalls.get(ci)!.push(wi);
      }
    });
    this.walls = new THREE.InstancedMesh(wallGeo, wallMat, segs.length * 2);
    this.walls.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < segs.length * 2; i++) this.walls.setMatrixAt(i, zero);
    add(this.walls);

    // край подземелья — крупные неровные блоки-«скалы», как стена на референсе
    const borderGeo = new THREE.BoxGeometry(CELL * 0.98, 1, CELL * 0.42);
    const borderMat = this.tileMaterial(2, 0.9);
    borderMat.color.setHex(0x3c4150);
    this.borderBlocks = new THREE.InstancedMesh(borderGeo, borderMat, segs.length);
    this.borderBlocks.frustumCulled = false;
    for (let i = 0; i < segs.length; i++) this.borderBlocks.setMatrixAt(i, zero);
    add(this.borderBlocks);
    for (const s of segs) {
      if (s.cb === -1) {
        s.bh = 1.15 + rnd() * 1.15;   // высота блока
        s.byaw = (rnd() - 0.5) * 0.3; // поворот
        s.bjx = (rnd() - 0.5) * 0.25; // сдвиг
        s.bjz = (rnd() - 0.5) * 0.25;
      }
    }

    // lair gold hoard — emissive pile in the centre
    const hoard = new THREE.Group();
    const gm = new THREE.MeshStandardMaterial({ color: 0xd8a020, emissive: 0x8a5a00, emissiveIntensity: 0.95, roughness: 0.35, metalness: 0.8 });
    for (let i = 0; i < 26; i++) {
      const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.06, 10), gm);
      const a = rnd() * Math.PI * 2, r = rnd() * 1.5;
      coin.position.set(Math.cos(a) * r, 0.05 + rnd() * 0.22, Math.sin(a) * r);
      coin.rotation.set(rnd() * 0.6, rnd() * 6, rnd() * 0.6);
      hoard.add(coin);
    }
    const { wx: hx, wz: hz } = cellToWorld(11, 11);
    hoard.position.set(hx + CELL / 2, 0, hz + CELL / 2);
    add(hoard);

    // dragon
    this.dragon = this.buildDragon();
    this.dragon.position.set(hx + CELL / 2, 0, hz + CELL / 2);
    add(this.dragon);

    // player start portals (colored corner markers) + pawns with avatar sprites
    const texLoader = new THREE.TextureLoader();
    for (const p of players) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.8, 24),
        new THREE.MeshBasicMaterial({ color: p.color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      const { wx, wz } = cellToWorld(p.x, p.z);
      ring.position.set(wx, 0.13, wz);
      add(ring);

      const pawn = this.buildPawn(p.color, p.avatar);
      const tex = texLoader.load(avatarUrl(p.avatar));
      tex.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true }));
      sprite.scale.set(0.72, 0.72, 1);
      sprite.position.y = 2.15;
      pawn.add(sprite);
      this.pawns.push(pawn);
      add(pawn);
      // face the dungeon centre from the start
      const dl = Math.hypot(wx, wz);
      if (dl > 0.1) pawn.rotation.y = Math.atan2(-wx, -wz);
    }

    // active-player ring
    this.activeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.78, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.activeRing.rotation.x = -Math.PI / 2;
    add(this.activeRing);

    // highlight markers pool — светящееся кольцо + мягкое свечение плитки (по референсу)
    const glowGeo = new THREE.PlaneGeometry(2.15, 2.15);
    const mkGlow = (color: number) => {
      const m = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
        map: this.glowTexture(), color, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      return m;
    };
    const hlGeo = new THREE.RingGeometry(0.5, 0.84, 40);
    for (let i = 0; i < 4; i++) {
      const hl = new THREE.Mesh(
        hlGeo,
        new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
      );
      hl.rotation.x = -Math.PI / 2;
      hl.visible = false;
      this.highlights.push(hl);
      add(hl);
      const gl = mkGlow(0x86e86a);
      this.highlightGlows.push(gl);
      add(gl);
    }
    // jump targets (прыжок через пропасть) — ледяно-голубые
    const jlGeo = new THREE.RingGeometry(0.44, 0.76, 40);
    for (let i = 0; i < 4; i++) {
      const jl = new THREE.Mesh(
        jlGeo,
        new THREE.MeshBasicMaterial({ color: 0x8ae8ff, transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
      );
      jl.rotation.x = -Math.PI / 2;
      jl.visible = false;
      this.jumpHighlights.push(jl);
      add(jl);
      const gl = mkGlow(0x4db8ff);
      this.jumpGlows.push(gl);
      add(gl);
    }

    // particle bursts pool
    for (let i = 0; i < 10; i++) this.bursts.push(this.makeBurst());

    // reveal lair + the pit ring + the players' entrance cells from старта
    for (const [lx, lz] of LAIR_CELLS) this.reveal(lx, lz, cells, true);
    for (const [px, pz] of PIT_CELLS) this.reveal(px, pz, cells, true);
    for (const p of players) this.reveal(p.x, p.z, cells, true);
  }

  private buildPawn(color: number, avatarId: string): THREE.Group {
    const g = new THREE.Group();

    // GLB hero model matching the chosen avatar (fallback: procedural figure)
    const tpl = this.heroTemplates[(AVATAR_MODEL[avatarId] ?? 1) - 1];
    if (tpl) {
      const inst = tpl.clone(true);
      // clone materials so per-pawn fades (escape/death) never touch the shared template
      inst.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) {
          m.material = Array.isArray(m.material)
            ? m.material.map((mm) => mm.clone())
            : (m.material as THREE.Material).clone();
        }
      });
      g.add(inst);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 6, 12), mat);
      body.position.y = 0.68;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0xf2d8b8, roughness: 0.7 }),
      );
      head.position.y = 1.22;
      g.add(body, head);
      g.scale.setScalar(1.25);
    }

    // player-colored base ring + warm torch glow
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.52, 0.58, 0.08, 22),
      new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.2 }),
    );
    base.position.y = 0.04;
    const light = new THREE.PointLight(0xffa64d, 6, 7, 1.6);
    light.position.set(0.45, 1.5, 0);
    this.pawnLights.push(light);
    g.add(base, light);
    return g;
  }

  private buildDragon(): THREE.Group {
    // спящий дракон из GLB; процедурная заглушка — если модель не загрузилась
    if (this.dragonTemplate) {
      const inst = this.dragonTemplate.clone(true);
      const g = new THREE.Group();
      g.add(inst);
      this.dragonLight = new THREE.PointLight(0xff3300, 9, 14, 1.8);
      this.dragonLight.position.set(0, 2.2, 0);
      g.add(this.dragonLight);
      return g;
    }
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a1a12, roughness: 0.55, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.05, 16, 12), mat);
    body.scale.set(1.25, 0.75, 1.6);
    body.position.y = 0.75;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 1.1, 10), mat);
    neck.position.set(0, 1.15, -1.35);
    neck.rotation.x = 0.7;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 10), mat);
    head.position.set(0, 1.62, -1.95);
    head.rotation.x = Math.PI / 2 + 0.5;
    const wingGeo = new THREE.ConeGeometry(0.9, 1.7, 4);
    const wingL = new THREE.Mesh(wingGeo, mat);
    wingL.scale.set(1, 1, 0.18);
    wingL.position.set(-1.0, 1.25, 0.2);
    wingL.rotation.z = 0.9;
    const wingR = wingL.clone();
    wingR.position.x = 1.0;
    wingR.rotation.z = -0.9;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.6, 8), mat);
    tail.position.set(0, 0.6, 1.7);
    tail.rotation.x = -Math.PI / 2 - 0.25;
    this.dragonEyeMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2200, emissiveIntensity: 0.25 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), this.dragonEyeMat);
    eyeL.position.set(-0.16, 1.75, -2.15);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.16;
    this.dragonLight = new THREE.PointLight(0xff3300, 9, 14, 1.8);
    this.dragonLight.position.set(0, 2.2, 0);
    g.add(body, neck, head, wingL, wingR, tail, eyeL, eyeR, this.dragonLight);
    return g;
  }

  private makeBurst(): Burst {
    const n = 40;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const mat = new THREE.PointsMaterial({ color: 0xffd24a, size: 0.16, transparent: true, opacity: 1, depthWrite: false });
    const points = new THREE.Points(geo, mat);
    points.visible = false;
    (this.boardGroup ?? this.scene).add(points);
    return { points, vel: new Float32Array(n * 3), life: 0, maxLife: 1, active: false };
  }

  spawnBurst(x: number, z: number, color: number, count = 40, speed = 3.2, up = 3.4): void {
    const b = this.bursts.find((bb) => !bb.active);
    if (!b) return;
    const { wx, wz } = cellToWorld(x, z);
    const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      pos.setXYZ(i, wx, 0.5, wz);
      const a = Math.random() * Math.PI * 2;
      const s = (0.3 + Math.random() * 0.7) * speed;
      b.vel[i * 3] = Math.cos(a) * s;
      b.vel[i * 3 + 1] = Math.random() * up;
      b.vel[i * 3 + 2] = Math.sin(a) * s;
    }
    pos.needsUpdate = true;
    (b.points.material as THREE.PointsMaterial).color.setHex(color);
    (b.points.material as THREE.PointsMaterial).opacity = 1;
    b.points.visible = true;
    b.active = true;
    b.life = 0;
    b.maxLife = 0.9;
  }

  // ---------------- reveal ----------------
  reveal(x: number, z: number, cells: Cell[], instant = false): void {
    const i = idx(x, z);
    if (this.revealed[i]) return;
    this.revealed[i] = 1;
    if (instant) {
      const loc = this.overLoc[i];
      if (loc) {
        const zero = new THREE.Matrix4().makeScale(0, 0, 0);
        loc.mesh.setMatrixAt(loc.k, zero);
        loc.mesh.instanceMatrix.needsUpdate = true;
      }
    } else {
      this.revealAnim.push({ i, k: 0 });
    }
    // show wall segments adjacent to the newly revealed cell
    const m4 = new THREE.Matrix4();
    const around = this.cellWalls.get(i) ?? [];
    for (const wi of around) {
      const s = this.wallMeta[wi];
      const otherRevealed =
        (s.ca >= 0 && this.revealed[s.ca] === 1) || (s.cb >= 0 && this.revealed[s.cb] === 1);
      if (s.cb === -1) {
        // край подземелья — виден всегда, это естественная граница, а не секрет
        const h = s.bh ?? 1.6;
        m4.makeRotationY((s.horizontal ? 0 : Math.PI / 2) + (s.byaw ?? 0));
        m4.scale(new THREE.Vector3(1, h, 1));
        m4.setPosition(s.px + (s.bjx ?? 0), 0.5 * h, s.pz + (s.bjz ?? 0));
        this.borderBlocks.setMatrixAt(wi, m4);
        this.borderBlocks.instanceMatrix.needsUpdate = true;
        this.walls.setMatrixAt(wi * 2, ZERO_M4);
        this.walls.setMatrixAt(wi * 2 + 1, ZERO_M4);
        this.walls.instanceMatrix.needsUpdate = true;
        continue;
      }
      if (!otherRevealed) continue;
      // два блока на пролёт, разная высота — неровная кромка кладки
      for (let half = 0; half < 2; half++) {
        const h = half === 0 ? s.h1 : s.h2;
        const off = half === 0 ? -CELL / 4 : CELL / 4;
        m4.makeRotationY(s.horizontal ? 0 : Math.PI / 2);
        m4.scale(new THREE.Vector3(1, h, 1));
        const ox = s.horizontal ? off : 0;
        const oz = s.horizontal ? 0 : off;
        m4.setPosition(s.px + ox, 0.62 * h, s.pz + oz);
        this.walls.setMatrixAt(wi * 2 + half, m4);
      }
    }
    this.walls.instanceMatrix.needsUpdate = true;
    void cells;
  }

  // ---------------- pawns ----------------
  placePawn(id: number, x: number, z: number): void {
    const { wx, wz } = cellToWorld(x, z);
    this.pawns[id].position.set(wx, 0, wz);
  }

  movePawn(id: number, fromX: number, fromZ: number, toX: number, toZ: number, dur: number): Promise<void> {
    return new Promise((resolve) => {
      const a = cellToWorld(fromX, fromZ);
      const b = cellToWorld(toX, toZ);
      const pawn = this.pawns[id];
      const dir = Math.atan2(b.wx - a.wx, b.wz - a.wz);
      this.tweens.push({
        t: 0, dur,
        update: (k) => {
          pawn.position.set(
            a.wx + (b.wx - a.wx) * k,
            Math.sin(k * Math.PI) * 0.35,
            a.wz + (b.wz - a.wz) * k,
          );
          pawn.rotation.y = dir;
        },
        done: () => { pawn.position.set(b.wx, 0, b.wz); resolve(); },
      });
    });
  }

  killPawn(id: number): Promise<void> {
    return new Promise((resolve) => {
      const pawn = this.pawns[id];
      this.tweens.push({
        t: 0, dur: 0.7,
        update: (k) => { pawn.rotation.z = k * Math.PI / 2; pawn.scale.setScalar(1 - k * 0.4); },
        done: () => { pawn.visible = false; resolve(); },
      });
    });
  }

  escapePawn(id: number): Promise<void> {
    return new Promise((resolve) => {
      const pawn = this.pawns[id];
      const startY = pawn.position.y;
      this.tweens.push({
        t: 0, dur: 0.8,
        update: (k) => {
          pawn.position.y = startY + k * 2.4;
          pawn.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.material) {
              (m.material as THREE.Material).transparent = true;
              (m.material as THREE.Material).opacity = 1 - k;
            }
          });
        },
        done: () => { pawn.visible = false; resolve(); },
      });
    });
  }

  wakeDragon(): void {
    this.dragonAwake = true;
    if (this.dragonEyeMat) this.dragonEyeMat.emissiveIntensity = 3.2;
    this.dragonLight.intensity = 24;
    this.tweens.push({
      t: 0, dur: 0.8,
      update: (k) => { this.dragon.position.y = k * 1.6; this.dragon.scale.setScalar(1 + k * 0.5); },
      done: () => {},
    });
  }

  setActivePlayer(id: number, x: number, z: number): void {
    const { wx, wz } = cellToWorld(x, z);
    this.activeRing.position.set(wx, 0.14, wz);
    (this.activeRing.material as THREE.MeshBasicMaterial).color.setHex([0xffc94d, 0x5aa9ff, 0xff6b8a, 0x7dff8a][id]);
  }

  moveActiveRing(x: number, z: number): void {
    const { wx, wz } = cellToWorld(x, z);
    this.activeRing.position.set(wx, 0.14, wz);
  }

  setHighlights(cells: [number, number][]): void {
    for (let i = 0; i < this.highlights.length; i++) {
      const hl = this.highlights[i];
      const gl = this.highlightGlows[i];
      if (i < cells.length) {
        const { wx, wz } = cellToWorld(cells[i][0], cells[i][1]);
        hl.position.set(wx, 0.48, wz); // выше крышки закрытой плиты (0.42)
        gl.position.set(wx, 0.47, wz);
        hl.visible = true;
        gl.visible = true;
      } else {
        hl.visible = false;
        gl.visible = false;
      }
    }
  }

  setJumpHighlights(cells: [number, number][]): void {
    for (let i = 0; i < this.jumpHighlights.length; i++) {
      const jl = this.jumpHighlights[i];
      const gl = this.jumpGlows[i];
      if (i < cells.length) {
        const { wx, wz } = cellToWorld(cells[i][0], cells[i][1]);
        jl.position.set(wx, 0.48, wz);
        gl.position.set(wx, 0.47, wz);
        jl.visible = true;
        gl.visible = true;
      } else {
        jl.visible = false;
        gl.visible = false;
      }
    }
  }

  /** Прыжок через пропасть: высокая дуга над рвом (2 клетки). */
  jumpPawn(id: number, fromX: number, fromZ: number, toX: number, toZ: number, dur = 0.7): Promise<void> {
    return new Promise((resolve) => {
      const a = cellToWorld(fromX, fromZ);
      const b = cellToWorld(toX, toZ);
      const pawn = this.pawns[id];
      const dir = Math.atan2(b.wx - a.wx, b.wz - a.wz);
      this.tweens.push({
        t: 0, dur,
        update: (k) => {
          pawn.position.set(
            a.wx + (b.wx - a.wx) * k,
            Math.sin(k * Math.PI) * 1.5,
            a.wz + (b.wz - a.wz) * k,
          );
          pawn.rotation.y = dir;
        },
        done: () => { pawn.position.set(b.wx, 0, b.wz); resolve(); },
      });
    });
  }

  focusOn(x: number, z: number, instant = false): void {
    this.overview = false;
    this.panOff.set(0, 0, 0); // фокус на герое отменяет ручную панораму
    const { wx, wz } = cellToWorld(x, z);
    this.camTarget.set(wx, 0, wz);
    if (instant) {
      const len = Math.hypot(wx, wz);
      if (len > 3) this.camDir.set(wx / len, 0, wz / len);
      this.camCur.set(
        wx + this.camDir.x * this.camDist,
        this.camHeight,
        wz + this.camDir.z * this.camDist,
      );
      this.camLook.set(wx - this.camDir.x * 2.6, 0, wz - this.camDir.z * 2.6);
    }
  }

  showOverview(): void { this.overview = true; }

  // ---------------- picking & camera gestures ----------------
  private handlePick = (e: { clientX: number; clientY: number }): void => {
    if (!this.onCellClick) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.pickPlane)[0];
    if (!hit) return;
    const x = Math.floor((hit.point.x + HALF) / CELL);
    const z = Math.floor((hit.point.z + HALF) / CELL);
    if (inBounds(x, z)) this.onCellClick(x, z);
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.gesture = "maybe-tap";
      this.tapStart = { x: e.clientX, y: e.clientY, t: performance.now() };
    } else if (this.pointers.size === 2) {
      this.gesture = "pinch";
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.gesture === "maybe-tap" && this.pointers.size === 1) {
      if (Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y) > 12) this.gesture = "pan";
      else return;
    }

    if (this.gesture === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) {
        this.zoomK = THREE.MathUtils.clamp(this.zoomK * (this.pinchDist / d), 0.45, 2.2);
      }
      this.pinchDist = d;
      // двумя пальцами тоже можно таскать карту — по дельте средней точки
      this.panBy(dx / 2, dy / 2);
    } else if (this.gesture === "pan") {
      this.panBy(dx, dy);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const wasTap =
      this.gesture === "maybe-tap" &&
      this.pointers.size === 1 &&
      performance.now() - this.tapStart.t < 600 &&
      Math.hypot(e.clientX - this.tapStart.x, e.clientY - this.tapStart.y) <= 12;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.gesture = "none";
    else if (this.pointers.size === 1) this.gesture = "pan";
    if (wasTap) this.handlePick(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomK = THREE.MathUtils.clamp(this.zoomK * (e.deltaY > 0 ? 1.12 : 0.89), 0.45, 2.2);
  };

  /** Сдвинуть обзор: контент «следует за пальцем» (перетаскивание карты). */
  private panBy(dx: number, dy: number): void {
    const k = (this.camHeight * this.zoomK * 1.15) / Math.max(1, window.innerHeight);
    const right = new THREE.Vector3(this.camDir.z, 0, -this.camDir.x); // экранное «вправо» на земле
    this.panOff.addScaledVector(right, -dx * k);
    this.panOff.addScaledVector(this.camDir, -dy * k);
    this.overview = false; // ручной обзор выходит из режима оглядывания арены
  }

  /** Полный сброс ручного обзора (двойной тап по портрету / новый фокус). */
  resetView(): void {
    this.panOff.set(0, 0, 0);
    this.zoomK = 1;
  }

  private handleResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  // ---------------- frame ----------------
  update(dt: number): void {
    this.time += dt;
    if (!this.boardGroup || !this.dragon || !this.activeRing) return; // board still loading

    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.update(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.done(); }
    }

    // reveal animations (blocks sink into the ground)
    if (this.revealAnim.length) {
      const m4 = new THREE.Matrix4();
      const mShrink = new THREE.Matrix4();
      for (let i = this.revealAnim.length - 1; i >= 0; i--) {
        const ra = this.revealAnim[i];
        ra.k += dt * 2.6;
        const k = Math.min(1, ra.k);
        const s = 1 - k;
        const loc = this.overLoc[ra.i];
        if (loc) {
          if (k >= 1) {
            // убрать блок полностью — плоское «донышко» на уровне пола мерцало (z-fighting)
            loc.mesh.setMatrixAt(loc.k, ZERO_M4);
          } else {
            m4.copy(loc.base).multiply(mShrink.makeScale(1, Math.max(0.0001, s), 1));
            loc.mesh.setMatrixAt(loc.k, m4);
          }
        }
        if (k >= 1) this.revealAnim.splice(i, 1);
      }
      for (const m of this.overMeshes) m.instanceMatrix.needsUpdate = true;
    }

    // dragon breathing / awake
    const breathe = this.dragonAwake ? Math.sin(this.time * 6) * 0.05 : Math.sin(this.time * 1.4) * 0.03;
    this.dragon.scale.set((this.dragonAwake ? 1.5 : 1) * (1 + breathe), (this.dragonAwake ? 1.5 : 1) * (1 + breathe * 1.4), this.dragonAwake ? 1.5 : 1);
    if (!this.dragonAwake) this.dragonLight.intensity = 7 + Math.sin(this.time * 1.4) * 2.2;
    else this.dragonLight.intensity = 20 + Math.sin(this.time * 9) * 6;

    // torch flicker
    for (const l of this.pawnLights) l.intensity = 5 + Math.sin(this.time * 11 + l.id) * 1.2;

    // highlight pulse — кольцо ярче, свечение мягче
    const pulse = 0.55 + Math.sin(this.time * 5) * 0.3;
    for (const hl of [...this.highlights, ...this.jumpHighlights]) {
      if (!hl.visible) continue;
      (hl.material as THREE.MeshBasicMaterial).opacity = pulse;
      hl.scale.setScalar(1 + Math.sin(this.time * 5) * 0.08);
    }
    for (const gl of [...this.highlightGlows, ...this.jumpGlows]) {
      if (!gl.visible) continue;
      (gl.material as THREE.MeshBasicMaterial).opacity = 0.30 + Math.sin(this.time * 5) * 0.10;
    }
    (this.activeRing.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(this.time * 4) * 0.25;

    // bursts
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.life += dt;
      const k = b.life / b.maxLife;
      if (k >= 1) { b.active = false; b.points.visible = false; continue; }
      const pos = b.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        b.vel[i * 3 + 1] -= 6 * dt;
        pos.setXYZ(i,
          pos.getX(i) + b.vel[i * 3] * dt,
          Math.max(0.05, pos.getY(i) + b.vel[i * 3 + 1] * dt),
          pos.getZ(i) + b.vel[i * 3 + 2] * dt,
        );
      }
      pos.needsUpdate = true;
      (b.points.material as THREE.PointsMaterial).opacity = 1 - k;
    }

    // camera
    if (this.overview) {
      const a = this.time * 0.12;
      const target = new THREE.Vector3(Math.sin(a) * 34, 34, Math.cos(a) * 34);
      this.camCur.lerp(target, 1 - Math.exp(-1.6 * dt));
      this.camLook.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-2 * dt));
    } else {
      // desired camera direction: from board centre out through the pawn — the camera
      // stays "behind" the pawn and always looks INTO the dungeon, on every edge
      const effX = this.camTarget.x + this.panOff.x;
      const effZ = this.camTarget.z + this.panOff.z;
      const len = Math.hypot(this.camTarget.x, this.camTarget.z);
      if (len > 3) {
        this.lookGoal.set(this.camTarget.x / len, 0, this.camTarget.z / len);
        this.camDir.lerp(this.lookGoal, 1 - Math.exp(-2.2 * dt)).normalize();
      }
      const dist = this.camDist * this.zoomK;
      const target = new THREE.Vector3(
        effX + this.camDir.x * dist,
        this.camHeight * this.zoomK,
        effZ + this.camDir.z * dist,
      );
      this.camCur.lerp(target, 1 - Math.exp(-4.2 * dt));
      // look slightly toward the centre so the pawn sits in the lower third (portrait framing)
      this.camLook.lerp(
        this.lookGoal.set(effX - this.camDir.x * 2.6 * this.zoomK, 0, effZ - this.camDir.z * 2.6 * this.zoomK),
        1 - Math.exp(-5 * dt),
      );
    }
    this.camera.position.copy(this.camCur);
    this.camera.lookAt(this.camLook);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  projectCell(x: number, z: number): { sx: number; sy: number } {
    const { wx, wz } = cellToWorld(x, z);
    const v = new THREE.Vector3(wx, 0.2, wz).project(this.camera);
    return {
      sx: (v.x * 0.5 + 0.5) * window.innerWidth,
      sy: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("resize", this.handleResize);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) mm.dispose();
      }
    });
    this.renderer.dispose();
  }

  get isDisposed(): boolean { return this.disposed; }
}

function mulberryLite(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
