/**
 * model.ts — чистая логика «Логова Дракона»: генерация подземелья 24×24,
 * события клеток, предметы, игроки, правила проверок. Без рендера и DOM.
 */

// ---------------- PRNG (seeded, mulberry32) ----------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------- Board ----------------
export const W = 24;
export const H = 24;
export const CELL = 2; // world units per cell

export const N = 1, E = 2, S = 4, WE = 8; // opening bitmask

export type EventKind = "gold" | "item" | "trap" | "monster";

export interface CellEvent {
  kind: EventKind;
  id: string;          // monster/trap/item id
  name: string;
  dc: number;          // difficulty for d20 checks (0 if none)
  deadly: boolean;     // failure kills
  amount: number;      // gold amount for gold piles
  resolved: boolean;
}

export interface Cell {
  idx: number;
  x: number;
  z: number;
  open: number;        // bitmask of open sides
  lair: boolean;
  pit: boolean;        // бездонная пропасть вокруг логова (ров)
  event: CellEvent | null;
}

export const idx = (x: number, z: number) => z * W + x;
export const inBounds = (x: number, z: number) => x >= 0 && x < W && z >= 0 && z < H;
export const isBorder = (x: number, z: number) => x === 0 || z === 0 || x === W - 1 || z === H - 1;

export const LAIR_CELLS: [number, number][] = [[11, 11], [12, 11], [11, 12], [12, 12]];

/** 12 клеток рва вокруг логова (кольцо 4×4 без центральных 2×2) — бездонная пропасть. */
export const PIT_CELLS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let z = 10; z <= 13; z++)
    for (let x = 10; x <= 13; x++)
      if (!LAIR_CELLS.some(([lx, lz]) => lx === x && lz === z)) out.push([x, z]);
  return out;
})();
export const JUMP_DC = 15; // сложность прыжка через пропасть в логово

/** Perfect maze over the whole board (iterative backtracker) + lair carved in the centre. */
export function genBoard(rnd: () => number): Cell[] {
  const cells: Cell[] = [];
  for (let z = 0; z < H; z++)
    for (let x = 0; x < W; x++)
      cells.push({ idx: idx(x, z), x, z, open: 0, lair: false, pit: false, event: null });

  const visited = new Uint8Array(W * H);
  const stack: [number, number][] = [[Math.floor(rnd() * W), Math.floor(rnd() * H)]];
  visited[idx(stack[0][0], stack[0][1])] = 1;
  const dirs: [number, number, number, number][] = [
    [0, -1, N, S], [1, 0, E, WE], [0, 1, S, N], [-1, 0, WE, E],
  ];
  while (stack.length) {
    const [cx, cz] = stack[stack.length - 1];
    const options = dirs.filter(([dx, dz]) => {
      const nx = cx + dx, nz = cz + dz;
      return inBounds(nx, nz) && !visited[idx(nx, nz)];
    });
    if (!options.length) { stack.pop(); continue; }
    const [dx, dz, bit, opp] = options[Math.floor(rnd() * options.length)];
    const nx = cx + dx, nz = cz + dz;
    cells[idx(cx, cz)].open |= bit;
    cells[idx(nx, nz)].open |= opp;
    visited[idx(nx, nz)] = 1;
    stack.push([nx, nz]);
  }

  // Lair: centre 2×2, fully interconnected internally only — around it lies the pit.
  for (const [lx, lz] of LAIR_CELLS) cells[idx(lx, lz)].lair = true;
  const link = (x1: number, z1: number, x2: number, z2: number) => {
    if (x2 > x1) { cells[idx(x1, z1)].open |= E; cells[idx(x2, z2)].open |= WE; }
    if (x2 < x1) { cells[idx(x1, z1)].open |= WE; cells[idx(x2, z2)].open |= E; }
    if (z2 > z1) { cells[idx(x1, z1)].open |= S; cells[idx(x2, z2)].open |= N; }
    if (z2 < z1) { cells[idx(x1, z1)].open |= N; cells[idx(x2, z2)].open |= S; }
  };
  link(11, 11, 12, 11); link(11, 12, 12, 12); link(11, 11, 11, 12); link(12, 11, 12, 12);

  // Ров: кольцо 4×4 вокруг логова — бездонная пропасть. У пропасти нет проходов:
  // ни из коридоров в неё, ни из неё в логово. Внутрь — только прыжком.
  for (const [px, pz] of PIT_CELLS) {
    cells[idx(px, pz)].pit = true;
    cells[idx(px, pz)].open = 0;
  }
  const unlink = (x: number, z: number) => {
    const c = cells[idx(x, z)];
    if (inBounds(x, z - 1) && cells[idx(x, z - 1)].pit) c.open &= ~N;
    if (inBounds(x + 1, z) && cells[idx(x + 1, z)].pit) c.open &= ~E;
    if (inBounds(x, z + 1) && cells[idx(x, z + 1)].pit) c.open &= ~S;
    if (inBounds(x - 1, z) && cells[idx(x - 1, z)].pit) c.open &= ~WE;
  };
  for (let z = 9; z <= 14; z++)
    for (let x = 9; x <= 14; x++) unlink(x, z);

  // Починка связности: кольцо рва могло разрезать лабиринт на части.
  // Пока есть недостижимые коридорные клетки — пробиваем стену между
  // достижимой и соседней недостижимой клеткой (ров и логово не трогаем).
  {
    const reach = new Uint8Array(W * H);
    const passable = (i: number) => !cells[i].pit && !cells[i].lair;
    const bfs = () => {
      reach.fill(0);
      const q = [idx(11, 0)];
      reach[idx(11, 0)] = 1;
      while (q.length) {
        const cur = q.pop()!;
        const cx = cur % W, cz = Math.floor(cur / W);
        for (const [dx, dz, bit, opp] of [
          [0, -1, N, S], [1, 0, E, WE], [0, 1, S, N], [-1, 0, WE, E],
        ] as const) {
          const nx = cx + dx, nz = cz + dz;
          if (!inBounds(nx, nz)) continue;
          const ni = idx(nx, nz);
          if (reach[ni] || !passable(ni)) continue;
          if (!(cells[cur].open & bit) || !(cells[ni].open & opp)) continue;
          reach[ni] = 1;
          q.push(ni);
        }
      }
    };
    for (let guard = 0; guard < 64; guard++) {
      bfs();
      let opened = false;
      for (let z = 0; z < H && !opened; z++) {
        for (let x = 0; x < W && !opened; x++) {
          const i = idx(x, z);
          if (!passable(i) || reach[i]) continue;
          // ищем достижимого соседа и пробиваем проход
          for (const [dx, dz, bit, opp] of [
            [0, -1, N, S], [1, 0, E, WE], [0, 1, S, N], [-1, 0, WE, E],
          ] as const) {
            const nx = x + dx, nz = z + dz;
            if (!inBounds(nx, nz)) continue;
            const ni = idx(nx, nz);
            if (!passable(ni) || !reach[ni]) continue;
            cells[i].open |= bit;
            cells[ni].open |= opp;
            opened = true;
            break;
          }
        }
      }
      if (!opened) break;
    }
  }

  assignEvents(cells, rnd);
  return cells;
}

// ---------------- Events ----------------
export interface MonsterDef { id: string; name: string; dc: number; deadly: boolean; reward: [number, number]; stealPct: number; icon: string; desc: string; fail: string; image: string }
const MONSTERS: MonsterDef[] = [
  { id: "goblin",   name: "Гоблин-воришка",   dc: 8,  deadly: false, reward: [8, 20],  stealPct: 0.20,
    icon: "👹", image: "monsters/goblin.png",
    desc: "Худощавая тень с красными глазами — уже перебралась через ваши карманы, пока вы доставали меч.",
    fail: "При поражении: −1 ❤, гоблин утаскивает часть золота в подполье." },
  { id: "kobold",   name: "Кобольд",          dc: 9,  deadly: false, reward: [10, 25], stealPct: 0.25,
    icon: "🦎", image: "monsters/cobold.png",
    desc: "Мелкий ящер с острыми когтями бросается из тени и вгрызается в дорожные сумки.",
    fail: "При поражении: −1 ❤, кобольд тащит часть золота в свою нору." },
  { id: "rat",      name: "Гигантская крыса", dc: 10, deadly: false, reward: [15, 30], stealPct: 0.30,
    icon: "🐀", image: "monsters/rat.png",
    desc: "Размером с волкодава. Шерсть клоками, а глаза горят голодным огнём — она уже слышала ваши шаги.",
    fail: "При поражении: −1 ❤ и откушенная котомка: крыса утаскивает часть золота." },
  { id: "spider",   name: "Гигантский паук",  dc: 10, deadly: false, reward: [18, 35], stealPct: 0.35,
    icon: "🕷️", image: "monsters/spider.png",
    desc: "Паутина в коридоре не просто грязь — это сети охотника, что свисает с потолка каменной глыбой.",
    fail: "При поражении: −1 ❤, яд сжимает мышцы — паук тащит золото в гнездо." },
  { id: "slime",    name: "Слизень",          dc: 9,  deadly: false, reward: [12, 25], stealPct: 0.25,
    icon: "🟢", image: "monsters/slime.png",
    desc: "Живая лужа кислотной слизи медленно ползёт по стене. Не касайтесь — плоть шипит.",
    fail: "При поражении: −1 ❤, кислота растворяет часть снаряжения и золота." },
  { id: "ghost",    name: "Призрак",          dc: 11, deadly: false, reward: [20, 40], stealPct: 0.40,
    icon: "👻", image: "monsters/ghost.png",
    desc: "Полупрозрачный силуэт сквозит сквозь стены. Его крик — ледяной нож в ушах.",
    fail: "При поражении: −1 ❤, холод высасывает силы — призрак забирает часть золота." },
  { id: "skeleton", name: "Скелет-страж",     dc: 12, deadly: false, reward: [25, 50], stealPct: 0.40,
    icon: "💀", image: "monsters/skeleton.jpeg",
    desc: "Ржавый меч не ржавеет лишь от частого употребления. Страж до сих пор честно служит своему склепу.",
    fail: "При поражении: −1 ❤ и половина золота оседает в его склепе." },
  { id: "cultist",  name: "Культист",         dc: 12, deadly: false, reward: [25, 50], stealPct: 0.40,
    icon: "🐍", image: "monsters/cultist.png",
    desc: "Последователь Змея вышел из тени с жезлом. В глазах безумие, в улыбке — призыв.",
    fail: "При поражении: −1 ❤, культист забирает часть золота в жертву." },
  { id: "witch",    name: "Ведьма",           dc: 13, deadly: false, reward: [30, 60], stealPct: 0.45,
    icon: "🧙", image: "monsters/witch.jpeg",
    desc: "Кривая фигура с косой и заплечной сумкой зелий. Глаза горят жёлтым, как лампады в склепе.",
    fail: "При поражении: −1 ❤, ведьма проклинает кошелёк — часть золота исчезает." },
  { id: "kobold_shaman", name: "Кобольд-шаман", dc: 13, deadly: false, reward: [30, 60], stealPct: 0.45,
    icon: "🔮", image: "monsters/kobold_shaman.png",
    desc: "Шаман в костяных доспехах жонглирует огненными шарами. Тотемы на стенах загораются.",
    fail: "При поражении: −1 ❤, шаман забирает золото как дань духам." },
  { id: "zombie",   name: "Зомби-воин",       dc: 13, deadly: false, reward: [30, 60], stealPct: 0.45,
    icon: "🧟", image: "monsters/zombie_warrior.jpeg",
    desc: "Восставший воин в прогнившей броне. Медленный, но упорный — как сама смерть.",
    fail: "При поражении: −1 ❤, зомби вырывает часть золота из рук." },
  { id: "troll",    name: "Пещерный троль",   dc: 14, deadly: false, reward: [35, 70], stealPct: 0.50,
    icon: "🧌", image: "monsters/troll.png",
    desc: "Громадина с дубиной размером с колонну. Земля дрожит под его шагами.",
    fail: "При поражении: −1 ❤, троль давит золото в пыль." },
  { id: "mimic",    name: "Мимик",            dc: 14, deadly: false, reward: [35, 70], stealPct: 0.50,
    icon: "📦", image: "monsters/mimic.png",
    desc: "Сундук приоткрылся — и оказалось, что внутри зубов больше, чем сокровищ.",
    fail: "При поражении: −1 ❤, мимик заглатывает часть золота." },
  { id: "minotaur", name: "Минотавр",         dc: 15, deadly: true,  reward: [50, 90], stealPct: 0.70,
    icon: "🐂", image: "monsters/minotaur.png",
    desc: "Бык с топором в лабиринте. Его рёв заглушает даже крики жертв.",
    fail: "При поражении: смерть — минотавр не оставляет ничего." },
  { id: "fire_imp", name: "Огненный бес",     dc: 14, deadly: true,  reward: [45, 85], stealPct: 0.60,
    icon: "🔥", image: "monsters/fire_imp.png",
    desc: "Маленький демон из раскалённых углей. Там, где он пролетает — пепел.",
    fail: "При поражении: смерть — пламем поглощает всё." },
  { id: "dragon_baby", name: "Дракончик",     dc: 15, deadly: true,  reward: [55, 100], stealPct: 0.80,
    icon: "🐉", image: "monsters/dragon_baby.png",
    desc: "Молодой дракон размером с лошадь. Его когти царапают камень, а дыхание — раскаляет сталь.",
    fail: "При поражении: смерть — дракончик добавляет золото в свою кладку." },
  { id: "vampire",  name: "Вампир",           dc: 16, deadly: true,  reward: [60, 110], stealPct: 1,
    icon: "🧛", image: "monsters/vampire.png",
    desc: "Лорд тьмы не отпускает добычу. Его когти — как десять кинжалов, а взгляд стынет ледяной тоской.",
    fail: "При поражении: смерть — вампир забирает все сокровища." },
];
export interface TrapDef { id: string; name: string; dc: number; deadly: boolean; losePct: number; endsTurn: boolean; icon: string; image: string; desc: string; fail: string }
const TRAPS: TrapDef[] = [
  { id: "poison_darts", name: "Отравленные дротики", dc: 9,  deadly: false, losePct: 0.12, endsTurn: false,
    icon: "🎯", image: "traps/poison_darts.png",
    desc: "Плита под ногой едва слышно щёлкает — и весь коридор встречает вас шквалом отравленных дротиков.",
    fail: "При срабатывании: −1 ❤ и 12% золота рассыпается по щелям пола." },
  { id: "spike_pit",    name: "Яма с кольями",       dc: 10, deadly: false, losePct: 0.25, endsTurn: true,
    icon: "🕳️", image: "traps/spike_pit.png",
    desc: "Крадучись по коридору, вы проваливаетесь в яму, дно которой усеяно обломками кольев.",
    fail: "При срабатывании: −1 ❤, 25% золота выронено в темноту. Ход окончен." },
  { id: "poison_gas",   name: "Ядовитый газ",        dc: 10, deadly: false, losePct: 0.20, endsTurn: true,
    icon: "☠️", image: "traps/poison_gas.png",
    desc: "Из щелей в полу вырывается зелёное облако. Горло сжимает, глаза слезятся — яд в воздухе.",
    fail: "При срабатывании: −1 ❤, 20% золота рассыпалось пока вы задыхались. Ход окончен." },
  { id: "wall_spikes",  name: "Шипы из стены",       dc: 11, deadly: false, losePct: 0.25, endsTurn: false,
    icon: "🔺", image: "traps/wall_spikes.png",
    desc: "Каменная плита под ногой утопает — и из стен со свистом выдвигаются ржавые шипы.",
    fail: "При срабатывании: −1 ❤, 25% золота осталось на шипах." },
  { id: "boulder",      name: "Каменный шар",        dc: 11, deadly: false, losePct: 0.30, endsTurn: true,
    icon: "🪨", image: "traps/boulder.png",
    desc: "Натянутая верёвка щёлкает, и за спиной загремел камень. Коридор слишком узок для уворота.",
    fail: "При срабатывании: −1 ❤, 30% золота придавлено камнем. Ход окончен." },
  { id: "fire_rune",    name: "Руна огня",           dc: 12, deadly: false, losePct: 0.30, endsTurn: true,
    icon: "🔥", image: "traps/fire_rune.png",
    desc: "На полу вспыхает алый символ. Прежде чем вы моргнете — огненная волна накрывает коридор.",
    fail: "При срабатывании: −1 ❤, 30% золота расплавлено. Ход окончен." },
  { id: "ceiling_net",  name: "Сеть под потолком",   dc: 12, deadly: false, losePct: 0.35, endsTurn: true,
    icon: "🕸️", image: "traps/ceiling_net.png",
    desc: "Трос срывается, и сверху обрушивается тяжёлая сеть с грузилами. Пойманный в сети — лёгкая добыча.",
    fail: "При срабатывании: −1 ❤, 35% золота вытряхнуто из карманов. Ход окончен." },
  { id: "falling_gate", name: "Падающая решётка",    dc: 13, deadly: false, losePct: 0.40, endsTurn: true,
    icon: "⛓️", image: "traps/falling_gate.png",
    desc: "Сверху с грохотом падает железная решётка с шипами. Западня захлопнулась.",
    fail: "При срабатывании: −1 ❤, 40% золота разбросано. Ход окончен." },
  { id: "pendulum",     name: "Лезвие-маятник",      dc: 13, deadly: false, losePct: 0.40, endsTurn: true,
    icon: "⚔️", image: "traps/pendulum.png",
    desc: "Из потолка срывается массивное лезвие на цепи. Оно качается, рассекая воздух со свистом.",
    fail: "При срабатывании: −1 ❤, 40% золота потеряно. Ход окончен." },
  { id: "collapse",     name: "Обвал потолка",       dc: 14, deadly: true,  losePct: 0.60, endsTurn: true,
    icon: "🏚️", image: "traps/collapse.png",
    desc: "Камни потрескались, пыль посыпалась — и тоннель рухнул, погребая всё под грудой обломков.",
    fail: "При срабатывании: смерть — обвал не щадит никого." },
  { id: "quicksand",    name: "Зыбучий песок",       dc: 14, deadly: true,  losePct: 1,    endsTurn: true,
    icon: "🌀", image: "traps/quicksand.png",
    desc: "Пол выглядит твёрдым, но тянет вниз, как жадная тина. Чем больше бьёшься — тем глубже.",
    fail: "При срабатывании: смерть — песок не отпускает." },
];

export interface ItemDef { id: string; name: string; desc: string; icon: string; artifact: boolean }
export const ITEMS: Record<string, ItemDef> = {
  boots:    { id: "boots",    name: "Сапоги ветра",      desc: "+1 к броску d4 на движение", icon: "🥾", artifact: false },
  amulet:   { id: "amulet",   name: "Амулет тени",       desc: "+2 к проверкам у спящего дракона", icon: "🧿", artifact: false },
  blade:    { id: "blade",    name: "Клинок истребителя", desc: "+4 к проверкам против монстров", icon: "🗡️", artifact: true },
  cloak:    { id: "cloak",    name: "Плащ ночи",         desc: "+4 к проверкам против ловушек", icon: "🧥", artifact: true },
  ring:     { id: "ring",     name: "Кольцо невидимости", desc: "один раз спасает от проснувшегося дракона", icon: "💍", artifact: true },
  dragonEye:{ id: "dragonEye",name: "Драконий глаз",     desc: "+50% золота при грабеже логова", icon: "🔮", artifact: true },
  rope:     { id: "rope",     name: "Верёвка",           desc: "спуск в логово без проверки прыжка через пропасть", icon: "🪢", artifact: false },
  potion:   { id: "potion",   name: "Зелье здоровья",    desc: "восстанавливает 1 жизнь (из инвентаря)", icon: "🧪", artifact: false },
};
const COMMON_ITEMS = ["boots", "amulet", "rope"];
const ARTIFACTS = ["blade", "cloak", "ring", "dragonEye"];

function assignEvents(cells: Cell[], rnd: () => number): void {
  const cx = 11.5, cz = 11.5;
  const starts = STARTS.map(([sx, sz]) => idx(sx, sz));
  for (const c of cells) {
    if (c.lair || c.pit || starts.includes(c.idx)) continue;
    // keep a small safe ring around each start
    if (starts.some((s) => Math.abs(cells[s].x - c.x) + Math.abs(cells[s].z - c.z) <= 1)) continue;
    const r = rnd();
    const depth = 1 - Math.min(1, Math.hypot(c.x - cx, c.z - cz) / 16); // richer toward centre
    if (r < 0.16) {
      const m = MONSTERS[Math.floor(rnd() * MONSTERS.length)];
      c.event = { kind: "monster", id: m.id, name: m.name, dc: m.dc, deadly: m.deadly, amount: 0, resolved: false };
    } else if (r < 0.30) {
      const t = TRAPS[Math.floor(rnd() * TRAPS.length)];
      c.event = { kind: "trap", id: t.id, name: t.name, dc: t.dc, deadly: t.deadly, amount: 0, resolved: false };
    } else if (r < 0.48) {
      const base = 15 + Math.floor(rnd() * 45);
      c.event = { kind: "gold", id: "gold", name: "Золото", dc: 0, deadly: false, amount: Math.round(base * (0.8 + depth * 1.1)), resolved: false };
    } else if (r < 0.55) {
      const id = COMMON_ITEMS[Math.floor(rnd() * COMMON_ITEMS.length)];
      c.event = { kind: "item", id, name: ITEMS[id].name, dc: 0, deadly: false, amount: 0, resolved: false };
    } else if (r < 0.59) {
      const id = ARTIFACTS[Math.floor(rnd() * ARTIFACTS.length)];
      c.event = { kind: "item", id, name: ITEMS[id].name, dc: 0, deadly: false, amount: 0, resolved: false };
    } else if (r < 0.65) {
      c.event = { kind: "item", id: "potion", name: ITEMS.potion.name, dc: 0, deadly: false, amount: 0, resolved: false };
    }
  }
}

export function monsterDef(id: string) { return MONSTERS.find((m) => m.id === id)!; }
export function trapDef(id: string) { return TRAPS.find((t) => t.id === id)!; }

// ---------------- Players ----------------
export interface Player {
  id: number;
  name: string;
  color: number;
  avatar: string;   // avatar file id, e.g. "female_face1"
  isHuman: boolean;
  x: number; z: number;
  gold: number;
  items: string[];
  potions: number;   // зелья здоровья в инвентаре
  lives: number;     // 3 жизни; неудачная проверка монстра/ловушки отнимает одну
  visitedLair: boolean; // выбраться из подземелья можно только побывав в логове
  alive: boolean;
  escaped: boolean;
  danger: number;   // текущая вероятность пробуждения дракона, %
  thefts: number;
  ringUsed: boolean;
  // AI personality
  aiGreed: number;  // danger % threshold at which AI stops stealing
}

export const STARTS: [number, number][] = [
  [0, 0],       // левый верхний угол
  [W - 1, 0],   // правый верхний угол
  [0, H - 1],   // левый нижний угол
  [W - 1, H - 1], // правый нижний угол
];
/** which STARTS slots are used for a given player count (spread out for 2 players) */
const START_PICK: Record<number, number[]> = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

export const PLAYER_COLORS = [0xffc94d, 0x5aa9ff, 0xff6b8a, 0x7dff8a];

export const AVATARS: { id: string; gender: "m" | "f" }[] = [
  { id: "male_face1", gender: "m" },
  { id: "male_face2", gender: "m" },
  { id: "male_face3", gender: "m" },
  { id: "male_face4", gender: "m" },
  { id: "female_face1", gender: "f" },
  { id: "female_face2", gender: "f" },
  { id: "female_face3", gender: "f" },
  { id: "female_face4", gender: "f" },
];
export const avatarUrl = (id: string) => `avatars/${id}.png`;

// avatar id → GLB hero model (public/models/heroN.glb), matched by appearance
export const AVATAR_MODEL: Record<string, number> = {
  male_face1: 4, // седой в богатой мантии
  male_face2: 7, // синяя мантия, тёмные волосы
  male_face3: 5, // тёмный доспех
  male_face4: 6, // орк
  female_face1: 3, // зелёный плащ, светлые волосы
  female_face2: 1, // худощавая в капюшоне
  female_face3: 2, // фиолетовый капюшон
  female_face4: 8, // красный капюшон
};
export const heroModelUrl = (id: string) => `models/hero${AVATAR_MODEL[id] ?? 1}.glb`;

const AI_NAMES: Record<"m" | "f", string[]> = {
  m: ["Борин", "Торин", "Эларион", "Каэль", "Фенрис", "Даэрон", "Грим", "Халдор"],
  f: ["Вельза", "Лориэль", "Нимраэль", "Эльвина", "Сильма", "Айлин", "Морвен", "Тинувиэль"],
};

export interface HumanSetup { name: string; avatar: string }
export interface GameSetup {
  mode: "ai" | "hotseat";
  count: number;          // total players at the table (2..4)
  humans: HumanSetup[];   // one entry per human (1 for "ai", count for "hotseat")
}

export function makePlayers(setup?: GameSetup): Player[] {
  const count = setup?.count ?? 4;
  const humans = setup?.humans ?? [{ name: "Вы", avatar: "male_face1" }];
  const picks = START_PICK[count] ?? START_PICK[4];
  const usedAvatars = new Set(humans.map((h) => h.avatar));
  const usedNames = new Set(humans.map((h) => h.name));

  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    const isHuman = i < humans.length;
    let name: string, avatar: string;
    if (isHuman) {
      name = humans[i].name.trim() || `Искатель ${i + 1}`;
      avatar = humans[i].avatar;
    } else {
      // AI: first unused avatar, name matching its gender
      const free = AVATARS.find((a) => !usedAvatars.has(a.id)) ?? AVATARS[i % AVATARS.length];
      avatar = free.id;
      usedAvatars.add(avatar);
      const pool = AI_NAMES[free.gender].filter((n) => !usedNames.has(n));
      name = pool[0] ?? `Искатель ${i + 1}`;
      usedNames.add(name);
    }
    const [sx, sz] = STARTS[picks[i]];
    players.push({
      id: i, name, color: PLAYER_COLORS[i], avatar, isHuman,
      x: sx, z: sz,
      gold: 0, items: [], potions: 0, lives: 3, visitedLair: false, alive: true, escaped: false,
      danger: 10, thefts: 0, ringUsed: false,
      aiGreed: 30 + Math.floor(Math.random() * 35),
    });
  }
  return players;
}

// derived stats
export const bonusVsMonster = (p: Player) => (p.items.includes("blade") ? 4 : 0);
export const bonusVsTrap = (p: Player) => (p.items.includes("cloak") ? 4 : 0);
export const bonusDice = (p: Player) => (p.items.includes("boots") ? 1 : 0);
export const bonusLair = (p: Player) => (p.items.includes("amulet") ? 2 : 0);
export const lairGoldMult = (p: Player) => (p.items.includes("dragonEye") ? 1.5 : 1);
export const hasRing = (p: Player) => p.items.includes("ring") && !p.ringUsed;
export const hasRope = (p: Player) => p.items.includes("rope");

// ---------------- Movement helpers ----------------
const STEP_DIRS: [number, number, number][] = [
  [0, -1, N], [1, 0, E], [0, 1, S], [-1, 0, WE],
];

/** Клетки логова, куда можно прыгнуть через ров из (x,z): ров по прямой, за ним логово. */
export function jumpTargets(cells: Cell[], x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const mx = x + dx, mz = z + dz;   // клетка рва
    const tx = x + 2 * dx, tz = z + 2 * dz; // клетка за рвом
    if (!inBounds(tx, tz)) continue;
    if (cells[idx(mx, mz)]?.pit && cells[idx(tx, tz)].lair) out.push([tx, tz]);
  }
  return out;
}

/** Клетки коридора, куда можно выпрыгнуть ИЗ логова через ров. */
export function jumpOutTargets(cells: Cell[], x: number, z: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
    const mx = x + dx, mz = z + dz;
    const tx = x + 2 * dx, tz = z + 2 * dz;
    if (!inBounds(tx, tz)) continue;
    const t = cells[idx(tx, tz)];
    if (cells[idx(mx, mz)]?.pit && !t.pit && !t.lair) out.push([tx, tz]);
  }
  return out;
}

/** Open neighbour cells of (x,z). */
export function legalMoves(cells: Cell[], x: number, z: number): [number, number][] {
  const c = cells[idx(x, z)];
  const out: [number, number][] = [];
  for (const [dx, dz, bit] of STEP_DIRS) {
    if (!(c.open & bit)) continue;
    const nx = x + dx, nz = z + dz;
    if (inBounds(nx, nz)) out.push([nx, nz]);
  }
  return out;
}

/** BFS path through openings. `goal` predicate on (x,z). Returns list of steps (excluding start). */
export function bfsPath(cells: Cell[], sx: number, sz: number, goal: (x: number, z: number) => boolean): [number, number][] | null {
  if (goal(sx, sz)) return [];
  const prev = new Int32Array(W * H).fill(-1);
  const q: number[] = [idx(sx, sz)];
  prev[idx(sx, sz)] = idx(sx, sz);
  while (q.length) {
    const cur = q.shift()!;
    const cx = cur % W, cz = Math.floor(cur / W);
    for (const [nx, nz] of legalMoves(cells, cx, cz)) {
      const ni = idx(nx, nz);
      if (prev[ni] !== -1) continue;
      prev[ni] = cur;
      if (goal(nx, nz)) {
        const path: [number, number][] = [[nx, nz]];
        let p = cur;
        while (p !== idx(sx, sz)) { path.unshift([p % W, Math.floor(p / W)]); p = prev[p]; }
        return path;
      }
      q.push(ni);
    }
  }
  return null;
}

// ---------------- Dice ----------------
export const rollD = (sides: number) => 1 + Math.floor(Math.random() * sides);

/** Dragon steal outcome. */
export function dragonCheck(p: Player): { roll: number; woke: boolean; loot: number } {
  const roll = rollD(20) + bonusLair(p);
  const threshold = Math.ceil(p.danger / 5); // 10% -> wake on ≤2 of d20
  const woke = roll <= threshold;
  const loot = woke ? 0 : Math.round((25 + Math.floor(Math.random() * 26) + p.thefts * 12) * lairGoldMult(p));
  return { roll, woke, loot };
}
