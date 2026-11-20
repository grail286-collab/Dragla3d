/**
 * ui.ts — DOM-интерфейс «Логова Дракона»: HUD, всплывающие окна
 * (бросок d4/d20, находки, бой, логово), титульный экран, итоги, пауза.
 * Все попапы — promise-based: await ui.dice(...) вернёт результат после клика.
 */
import { AVATARS, ITEMS, avatarUrl, type GameSetup, type HumanSetup, type Player } from "./model";
import { Dice3D } from "./dice3d";

const PLAYER_COLORS = ["#ffc94d", "#5aa9ff", "#ff6b8a", "#7dff8a"];

export interface DiceOpts {
  title: string;
  sub?: string;
  die: 4 | 20;
  button: string;
  dc?: number;        // показать сложность
  bonus?: number;     // показать бонус
  avatar?: string;    // портрет игрока над окном
  skippable?: boolean;  // кнопка «Пропустить ход» под окном (резолвит 0)
}
export interface InfoOpts { title: string; icon?: string; image?: string; text: string; button?: string }
export interface ChoiceBtn { id: string; label: string; sub?: string; danger?: boolean; ghost?: boolean }

export interface EncounterOpts {
  kind: "monster" | "trap";
  id: string;
  name: string;
  icon: string;
  image?: string;      // путь к картинке монстра (monsters/xxx.png)
  desc: string;        // атмосферное описание
  fail: string;        // «При поражении / При срабатывании…»
  dc: number;          // успех при total > dc
  bonus?: number;      // бонус игрока
  deadly?: boolean;
  button?: string;     // подпись кнопки броска
}

/** Атмосферная SVG-иллюстрация для экрана встречи (монстр/ловушка). */
function encounterArt(kind: "monster" | "trap", id: string): string {
  const rim: Record<string, string> = {
    gremlin: "#7ac74f", rat: "#b09a72", skeleton: "#cfd4dd", vampire: "#a02838",
    darts: "#e0b34c", pit: "#c46a4a", quicksand: "#c9a55a",
  };
  const c = rim[id] ?? "#9aa4b8";
  const torch = (x: number) => `
    <circle cx="${x}" cy="58" r="34" fill="url(#glow)"/>
    <rect x="${x - 2.5}" y="52" width="5" height="16" rx="2" fill="#1a130c"/>
    <path d="M${x} 34 q7 10 0 19 q-7 -9 0 -19" fill="#ffd27a"/>
    <path d="M${x} 41 q4 6 0 11 q-4 -5 0 -11" fill="#fff3c4"/>`;
  const bg = `
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#14231d"/><stop offset=".62" stop-color="#0b130f"/><stop offset="1" stop-color="#060a08"/>
      </linearGradient>
      <radialGradient id="glow" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#ffb347" stop-opacity=".75"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vg" cx=".5" cy=".5" r=".65">
        <stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".72"/>
      </radialGradient>
    </defs>
    <rect width="320" height="150" fill="url(#bg)"/>
    <g stroke="#ffffff10" stroke-width="2">
      <path d="M0 34 h320 M0 66 h320 M40 18 v84 M96 18 v84 M180 18 v84 M248 18 v84"/>
    </g>
    ${torch(26)}${torch(294)}
    <path d="M0 108 L320 96 V150 H0 Z" fill="#0a0f0c"/>
    <g stroke="#ffffff0d" stroke-width="2">
      <path d="M0 122 L320 112 M0 138 L320 130 M60 110 l-8 40 M150 104 l-4 46 M240 100 l6 50"/>
    </g>`;
  // силуэт искателя справа — маленькая фигура с мечом и щитом
  const hero = `
    <g>
      <ellipse cx="252" cy="128" rx="17" ry="4" fill="#00000088"/>
      <path d="M244 126 q-3 -22 6 -30 q4 -7 10 -6 q7 1 8 8 q6 9 3 28 Z" fill="#101823"/>
      <path d="M250 96 q4 -9 12 -6 q7 3 5 11 q-3 6 -9 5 q-7 -1 -8 -10" fill="#0b1119"/>
      <path d="M266 104 l17 -13" stroke="#8a97ac" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M246 108 q-9 4 -8 14 l8 1 Z" fill="#1c2735"/>
    </g>
    <path d="M244 126 q-3 -22 6 -30" stroke="#3d5a78" stroke-width="1.4" fill="none" opacity=".8"/>`;
  let scene = "";
  if (kind === "monster") {
    let m = "";
    if (id === "gremlin") m = `
      <path d="M112 92 l-26 -20 8 30 Z M148 92 l26 -20 -8 30 Z" fill="#0a0f08"/>
      <circle cx="130" cy="88" r="21" fill="#0a0f08"/>
      <path d="M112 108 q18 -12 36 0 l8 22 h-52 Z" fill="#0a0f08"/>
      <circle cx="123" cy="86" r="3.4" fill="${c}"/><circle cx="139" cy="86" r="3.4" fill="${c}"/>
      <path d="M112 92 l-26 -20 M148 92 l26 -20" stroke="${c}" stroke-width="2" opacity=".85"/>`;
    else if (id === "rat") m = `
      <path d="M96 118 q60 -26 108 4 q-8 10 -52 8 q-44 -2 -56 -12" fill="#0a0f08"/>
      <path d="M98 118 q-30 4 -38 -12" stroke="#0a0f08" stroke-width="5" fill="none" stroke-linecap="round"/>
      <circle cx="212" cy="106" r="15" fill="#0a0f08"/>
      <circle cx="205" cy="92" r="6" fill="#0a0f08"/><circle cx="218" cy="91" r="6" fill="#0a0f08"/>
      <circle cx="216" cy="104" r="2.6" fill="${c}"/>
      <path d="M100 116 q58 -24 106 4" stroke="${c}" stroke-width="2" fill="none" opacity=".8"/>`;
    else if (id === "skeleton") m = `
      <g stroke="${c}" stroke-width="1.2" fill="#0a0f08" opacity=".95">
        <circle cx="140" cy="66" r="13"/>
        <path d="M134 78 h12 l4 34 h-20 Z"/>
        <g stroke="#0a0f08" stroke-width="4" stroke-linecap="round">
          <path d="M136 86 l-18 22 M150 86 l20 14 M138 112 l-8 18 M148 112 l10 18"/>
        </g>
      </g>
      <g stroke="${c}" stroke-width="2.4" stroke-linecap="round" opacity=".8">
        <path d="M136 86 l-18 22 M150 86 l20 14 M138 112 l-8 18 M148 112 l10 18"/>
      </g>
      <path d="M170 74 l26 -22" stroke="${c}" stroke-width="3.4" stroke-linecap="round" opacity=".9"/>
      <path d="M133 62 h5 M142 62 h5" stroke="${c}" stroke-width="3"/>
      <circle cx="140" cy="66" r="13" fill="none" stroke="${c}" stroke-width="1.6" opacity=".85"/>`;
    else m = ` <!-- vampire -->
      <path d="M128 122 q-16 -56 12 -78 q10 -10 20 0 q28 22 12 78 Z" fill="#0a0f08"/>
      <circle cx="150" cy="52" r="12" fill="#0a0f08"/>
      <path d="M132 122 q-4 -40 6 -62 M168 122 q4 -40 -6 -62" stroke="${c}" stroke-width="2" fill="none" opacity=".85"/>
      <path d="M145 50 h4 M152 50 h4" stroke="${c}" stroke-width="2.6"/>`;
    scene = `<g>${m}</g>${hero}`;
  } else {
    if (id === "darts") scene = `
      <g>
        <rect x="118" y="44" width="84" height="46" rx="5" fill="#0c120e" stroke="#ffffff14"/>
        <path d="M126 56 h68 M126 68 h68 M126 80 h68" stroke="#1e2a22" stroke-width="4"/>
        ${[56, 68, 80].map((y) => `
          <path d="M130 ${y} L206 ${y - 4}" stroke="${c}" stroke-width="2" stroke-dasharray="7 5"/>
          <path d="M206 ${y - 4} l-8 -3.4 v6.8 Z" fill="${c}"/>`).join("")}
      </g>
      ${hero}`;
    else if (id === "pit") scene = `
      <g>
        <ellipse cx="150" cy="122" rx="66" ry="17" fill="#020403"/>
        <ellipse cx="150" cy="120" rx="66" ry="17" fill="none" stroke="${c}" stroke-width="2" opacity=".7"/>
        ${[96, 122, 150, 178, 204].map((x, i) => `<path d="M${x - 7} 128 L${x} ${100 - (i % 2) * 8} L${x + 7} 128 Z" fill="#131a16" stroke="#000"/>`).join("")}
      </g>
      ${hero}`;
    else scene = ` <!-- quicksand -->
      <g>
        <ellipse cx="150" cy="124" rx="70" ry="16" fill="#171207"/>
        <path d="M92 122 q58 -20 116 0 M104 126 q46 -13 92 0 M118 130 q32 -8 64 0" stroke="${c}" stroke-width="2" fill="none" opacity=".8"/>
        <path d="M150 122 q-4 -18 6 -26 q6 -5 12 0 l-4 26 Z" fill="#0a0f08"/>
        <path d="M168 96 q8 -12 4 -20" stroke="#0a0f08" stroke-width="5" fill="none" stroke-linecap="round"/>
        <path d="M172 76 q4 -4 2 -8" stroke="${c}" stroke-width="2.4" fill="none"/>
      </g>
      ${hero}`;
  }
  return `<svg class="enc-svg" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${bg}${scene}<rect width="320" height="150" fill="url(#vg)"/></svg>`;
}

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class GameUI {
  private root: HTMLElement;
  private popupEl: HTMLElement | null = null;
  private screenEl: HTMLElement | null = null;
  private hudChips: HTMLElement[] = [];
  private stepsChip: HTMLElement;
  private endTurnBtn: HTMLButtonElement;
  private hintEl: HTMLElement | null = null;
  private logBox: HTMLElement;
  private banner: HTMLElement;
  private dice3d = new Dice3D();

  onEndTurn: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onMute: (() => boolean) | null = null; // returns new muted state
  onInventory: (() => void) | null = null;
  onPlayerFocus: ((id: number) => void) | null = null; // double-tap on a portrait

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = "";

    // top player chips
    const top = el("div", "hud-top");
    for (let i = 0; i < 4; i++) {
      const chip = el("div", "pchip");
      chip.style.display = "none";
      chip.innerHTML = `<img class="avatar" style="border-color:${PLAYER_COLORS[i]}" alt="">
        <span style="min-width:0"><span class="nm"></span><br><span class="gold">0 💰</span> <span class="lives"></span></span>`;
      // двойной клик / двойной тап по портрету — переключить обзор на искателя
      let lastTap = 0;
      chip.addEventListener("pointerup", () => {
        const now = performance.now();
        if (now - lastTap < 380) this.onPlayerFocus?.(i);
        lastTap = now;
      });
      top.appendChild(chip);
      this.hudChips.push(chip);
    }
    this.root.appendChild(top);

    // side buttons
    const btns = el("div", "hud-btns");
    const muteBtn = el("button", "icon-btn", "🔊") as HTMLButtonElement;
    muteBtn.setAttribute("aria-label", "Звук");
    muteBtn.onclick = () => {
      if (!this.onMute) return;
      const muted = this.onMute();
      muteBtn.textContent = muted ? "🔇" : "🔊";
    };
    const pauseBtn = el("button", "icon-btn", "⏸") as HTMLButtonElement;
    pauseBtn.setAttribute("aria-label", "Пауза");
    pauseBtn.onclick = () => this.onPause?.();
    const invBtn = el("button", "icon-btn", "🎒") as HTMLButtonElement;
    invBtn.setAttribute("aria-label", "Инвентарь");
    invBtn.onclick = () => this.onInventory?.();
    btns.append(muteBtn, invBtn, pauseBtn);
    this.root.appendChild(btns);

    this.banner = el("div", "turn-banner", "Логово Дракона");
    // баннер скрыт по запросу
    this.banner.style.display = "none";

    this.logBox = el("div", "event-log");
    this.root.appendChild(this.logBox);

    // bottom bar
    const bottom = el("div", "hud-bottom");
    this.stepsChip = el("div", "steps-chip", "Ходов: <b>—</b>");
    this.endTurnBtn = el("button", "big-btn ghost", "Завершить ход") as HTMLButtonElement;
    this.endTurnBtn.style.display = "none";
    this.endTurnBtn.onclick = () => this.onEndTurn?.();
    bottom.append(this.stepsChip, this.endTurnBtn);
    this.root.appendChild(bottom);
  }

  // ---------- HUD ----------
  setPlayers(players: Player[], currentId: number): void {
    this.hudChips.forEach((chip, i) => {
      const p = players[i];
      if (!p) { chip.style.display = "none"; return; }
      chip.style.display = "";
      (chip.querySelector(".avatar") as HTMLImageElement).src = avatarUrl(p.avatar);
      chip.querySelector(".nm")!.textContent = p.name;
      chip.querySelector(".gold")!.textContent = `${p.gold} 💰`;
      chip.querySelector(".lives")!.textContent = p.alive ? "❤️".repeat(Math.max(0, p.lives)) : "💀";
      chip.classList.toggle("active", i === currentId && p.alive && !p.escaped);
      chip.classList.toggle("dead", !p.alive);
      chip.classList.toggle("out", p.escaped);
    });
  }

  setBanner(text: string): void { this.banner.textContent = text; }

  setSteps(n: number | null): void {
    this.stepsChip.innerHTML = n === null ? "Ходов: <b>—</b>" : `Ходов: <b>${n}</b>`;
  }

  setEndTurnVisible(v: boolean): void {
    this.endTurnBtn.style.display = v ? "" : "none";
  }

  log(text: string, kind: "" | "good" | "bad" | "gold" = ""): void {
    const line = el("div", `log-line ${kind}`, text);
    this.logBox.appendChild(line);
    while (this.logBox.children.length > 4) this.logBox.firstChild!.remove();
    setTimeout(() => line.classList.add("fade"), 4200);
    setTimeout(() => line.remove(), 5000);
  }

  hint(text: string | null): void {
    this.hintEl?.remove();
    this.hintEl = null;
    if (text) {
      this.hintEl = el("div", "hint-chip", text);
      this.root.appendChild(this.hintEl);
    }
  }

  // ---------- generic popup plumbing ----------
  private openPopup(node: HTMLElement, opts?: { bare?: boolean; below?: HTMLElement }): void {
    this.closePopup();
    const bg = el("div", "popup-backdrop");
    const pop = el("div", `popup${opts?.bare ? " bare" : ""}`);
    pop.appendChild(node);
    if (opts?.below) pop.appendChild(opts.below);
    bg.appendChild(pop);
    this.root.appendChild(bg);
    this.popupEl = bg;
  }

  closePopup(): void {
    this.popupEl?.remove();
    this.popupEl = null;
  }

  /** Info popup with a single OK button. */
  info(o: InfoOpts): Promise<void> {
    return new Promise((resolve) => {
      const node = el("div");
      if (o.image) {
        const imgWrap = el("div", "info-img-wrap");
        const img = document.createElement("img");
        img.src = o.image; img.alt = o.title; img.className = "info-img";
        imgWrap.appendChild(img); node.appendChild(imgWrap);
      } else if (o.icon) {
        node.appendChild(el("div", "icon", o.icon));
      }
      node.appendChild(el("h2", "", o.title));
      node.appendChild(el("div", "sub", o.text));
      const btns = el("div", "btns");
      const ok = el("button", "big-btn", o.button ?? "Продолжить") as HTMLButtonElement;
      ok.onclick = () => { this.closePopup(); resolve(); };
      btns.appendChild(ok);
      node.appendChild(btns);
      this.openPopup(node);
      ok.focus();
    });
  }

  /** Popup with several buttons; resolves with the chosen id. */
  choice(title: string, sub: string, buttons: ChoiceBtn[], icon?: string, extra?: HTMLElement): Promise<string> {
    return new Promise((resolve) => {
      const node = el("div");
      if (icon) node.appendChild(el("div", "icon", icon));
      node.appendChild(el("h2", "", title));
      if (sub) node.appendChild(el("div", "sub", sub));
      if (extra) node.appendChild(extra);
      const btns = el("div", "btns");
      for (const b of buttons) {
        const btn = el("button", `big-btn${b.danger ? " danger" : ""}${b.ghost ? " ghost" : ""}`,
          b.sub ? `${b.label}<br><span style="font-size:11px;font-weight:600;opacity:.75">${b.sub}</span>` : b.label) as HTMLButtonElement;
        btn.onclick = () => { this.closePopup(); resolve(b.id); };
        btns.appendChild(btn);
      }
      node.appendChild(btns);
      this.openPopup(node);
    });
  }

  /** Dice-roll popup: tap the 3D die → it tumbles → result → popup closes itself. */
  dice(o: DiceOpts, roller: () => number, onTick?: () => void): Promise<number> {
    return new Promise((resolve) => {
      // карточка броска по референсу: портрет над окном, имя, кубик, «нажми, чтобы бросить»
      const card = el("div", "roll-card");
      if (o.avatar) {
        const av = document.createElement("img");
        av.className = "rc-avatar";
        av.src = o.avatar;
        av.alt = "";
        card.appendChild(av);
      }
      card.appendChild(el("div", "rc-name", o.title));
      if (o.sub) card.appendChild(el("div", "rc-sub", o.sub));
      const dieHolder = el("div", "die3d-holder");
      card.appendChild(dieHolder);
      const result = el("div", "die-result", "");
      card.appendChild(result);
      if (o.dc !== undefined) {
        const bonusTxt = o.bonus ? ` · ваш бонус +${o.bonus}` : "";
        card.appendChild(el("div", "rc-dc", `Сложность <b>${o.dc}</b>${bonusTxt}`));
      }
      const tapHint = el("div", "rc-hint", "Нажми, чтобы бросить");
      card.appendChild(tapHint);

      let skip: HTMLButtonElement | null = null;
      if (o.skippable) {
        skip = el("button", "rc-skip", "Пропустить ход") as HTMLButtonElement;
      }
      this.openPopup(card, { bare: true, below: skip ?? undefined });
      this.dice3d.attach(dieHolder, o.die);
      this.dice3d.canvas.style.cursor = "pointer";
      dieHolder.classList.add("awaiting");

      const close = () => { this.dice3d.detach(); this.closePopup(); };
      let rolled = false;

      const finish = (value: number) => { close(); resolve(value); };

      skip?.addEventListener("click", () => {
        if (rolled) return;
        rolled = true;
        finish(0); // пропуск хода: ни шагов, ни броска
      });

      this.dice3d.canvas.addEventListener("pointerdown", () => {
        if (rolled) return;
        rolled = true;
        skip && (skip.style.visibility = "hidden");
        dieHolder.classList.remove("awaiting");
        tapHint.style.visibility = "hidden"; // сохраняем высоту окна — кубик не «прыгает»
        const final = roller();
        const tick = setInterval(() => onTick?.(), 100);
        void this.dice3d.roll(final).then(() => {
          clearInterval(tick);
          const total = final + (o.bonus ?? 0);
          const won = o.dc !== undefined && total > o.dc;
          result.textContent = o.dc !== undefined
            ? (won ? `✓ ${total} > ${o.dc} — успех!` : `✗ ${total} ≤ ${o.dc} — провал…`)
            : `Выпало: ${total}`;
          result.className = `die-result ${o.dc !== undefined ? (won ? "win" : "fail") : "win"}`;
          // показать результат и закрыть окно автоматически
          setTimeout(() => { finish(final); }, o.dc !== undefined ? 1400 : 1100);
        });
      });
    });
  }

  /**
   * Экран встречи (бой с монстром / ловушка) по референсу: арт, имя, описание,
   * панель проверки d20 и золотая кнопка броска. Возвращает сырое значение d20.
   */
  encounter(o: EncounterOpts, roller: () => number, onTick?: () => void): Promise<number> {
    return new Promise((resolve) => {
      const need = o.dc + 1;
      const card = el("div", `enc-card${o.kind === "trap" ? " trap" : ""}`);
      card.innerHTML = `
        <div class="enc-art">${o.image ? `<img src="${o.image}" alt="${o.name}" class="enc-img">` : encounterArt(o.kind, o.id)}</div>
        <div class="enc-body">
          <div class="enc-head">
            <span class="enc-ico">${o.icon}</span>
            <span><span class="enc-name">${o.name}</span><br>
            <span class="enc-kind">${o.kind === "monster" ? "МОНСТР · БОЙ" : "ЛОВУШКА · ПРОВЕРКА"}</span></span>
          </div>
          <p class="enc-desc">${o.desc}</p>
          <p class="enc-fail">${o.fail}</p>
          <div class="enc-check">
            <div class="enc-die-holder"></div>
            <div class="enc-need">Нужно <b>${need}</b> или больше
              ${o.bonus ? `<br><span class="enc-bonus">Ваш бонус +${o.bonus}</span>` : ""}
              <br><span class="enc-curse">Заговор на неудачу: выпадет 1</span>
            </div>
          </div>
          <div class="enc-result"></div>
          <button class="enc-roll">${o.button ?? "Бросить d20"}</button>
        </div>`;
      const dieHolder = card.querySelector(".enc-die-holder") as HTMLElement;
      const rollBtn = card.querySelector(".enc-roll") as HTMLButtonElement;
      const resultEl = card.querySelector(".enc-result") as HTMLElement;
      this.openPopup(card, { bare: true });
      this.dice3d.attach(dieHolder, 20);
      this.dice3d.canvas.style.cursor = "pointer";
      dieHolder.classList.add("awaiting");

      let rolled = false;
      const finish = (v: number) => { this.dice3d.detach(); this.closePopup(); resolve(v); };
      const doRoll = () => {
        if (rolled) return;
        rolled = true;
        rollBtn.disabled = true;
        dieHolder.classList.remove("awaiting");
        const final = roller();
        const tick = setInterval(() => onTick?.(), 100);
        void this.dice3d.roll(final).then(() => {
          clearInterval(tick);
          const total = final + (o.bonus ?? 0);
          const won = total > o.dc;
          resultEl.textContent = won ? `✓ ${total} > ${o.dc} — успех!` : `✗ ${total} ≤ ${o.dc} — провал…`;
          resultEl.className = `enc-result ${won ? "win" : "fail"}`;
          setTimeout(() => finish(final), 1500);
        });
      };
      rollBtn.addEventListener("click", doRoll);
      this.dice3d.canvas.addEventListener("pointerdown", doRoll);
    });
  }

  // ---------- full screens ----------
  title(bestGold: number): Promise<void> {
    return new Promise((resolve) => {
      const scr = el("div", "title-screen");
      scr.appendChild(el("div", "game-logo", `Логово<br>Дракона`));
      scr.appendChild(el("div", "rules",
        `Четверо искателей проникают в подземелье <b>24×24</b> с четырёх сторон.
         Коснитесь <b>d4</b> и идите по клеткам к центру — под ногами открываются тайлы,
         а в них: <b>золото</b>, <b>артефакты</b>, <b>ловушки</b> и <b>монстры</b> (проверка <b>d20</b>).<br><br>
         У каждого искателя <b>3 жизни ❤️</b> — каждая неудачная проверка отнимает одну.
         Логово окружено <b>бездонным рвом</b>: внутрь — прыжок <b>d20 &gt; 15</b> или спуск по <b>верёвке 🪢</b>.
         В логове каждая кража приносит золото, но будит дракона: <b>+10%</b> за каждую попытку.
         Покинуть подземелье можно <b>только побывав в логове</b>: награбил — и к краю!
         Побеждает тот, кто <b>выбрался с наибольшим золотом</b>. Погибшие теряют всё.`));
      if (bestGold > 0) scr.appendChild(el("div", "best-gold", `🏆 Рекорд добычи: ${bestGold} золота`));
      const btn = el("button", "big-btn", "⚔️ В подземелье") as HTMLButtonElement;
      btn.style.fontSize = "17px";
      btn.onclick = () => { scr.remove(); this.screenEl = null; resolve(); };
      scr.appendChild(btn);
      scr.appendChild(el("div", "sub", "Нажмите кнопку или Space"));
      const onKey = (e: KeyboardEvent) => {
        if (e.code === "Space" || e.code === "Enter") { window.removeEventListener("keydown", onKey); btn.click(); }
      };
      window.addEventListener("keydown", onKey);
      this.root.appendChild(scr);
      this.screenEl = scr;
    });
  }

  /** Экран настройки партии: режим, число игроков, аватарки и имена. */
  setup(): Promise<GameSetup> {
    return new Promise((resolve) => {
      const state = {
        mode: "ai" as "ai" | "hotseat",
        count: 4,
        humans: [{ name: "", avatar: "male_face1" }] as HumanSetup[],
      };
      const humanSlots = () => (state.mode === "ai" ? 1 : state.count);
      const defaultName = (i: number) => `Искатель ${i + 1}`;

      const scr = el("div", "title-screen setup-screen");
      scr.appendChild(el("div", "game-logo small", `Настройка экспедиции`));

      const modeRow = el("div", "mode-row");
      const modeAi = el("button", "mode-btn sel", `🤖 Против ИИ<br><span class="mode-sub">вы + соперники-ИИ</span>`) as HTMLButtonElement;
      const modeHot = el("button", "mode-btn", `👥 На одном устройстве<br><span class="mode-sub">хот-сит с друзьями</span>`) as HTMLButtonElement;
      modeRow.append(modeAi, modeHot);
      scr.appendChild(modeRow);

      const countRow = el("div", "count-row");
      countRow.appendChild(el("span", "count-label", "Игроков:"));
      const countBtns: HTMLButtonElement[] = [];
      for (const n of [2, 3, 4]) {
        const b = el("button", `count-btn${n === 4 ? " sel" : ""}`, String(n)) as HTMLButtonElement;
        b.onclick = () => {
          state.count = n;
          countBtns.forEach((cb) => cb.classList.toggle("sel", cb === b));
          renderSlots();
        };
        countBtns.push(b);
        countRow.appendChild(b);
      }
      scr.appendChild(countRow);

      const slotsBox = el("div", "players-setup");
      scr.appendChild(slotsBox);

      const renderSlots = () => {
        slotsBox.innerHTML = "";
        const slots = humanSlots();
        while (state.humans.length < slots) {
          const i = state.humans.length;
          state.humans.push({ name: "", avatar: AVATARS[i % AVATARS.length].id });
        }
        state.humans.length = slots;
        state.humans.forEach((h, i) => {
          const card = el("div", "pset");
          card.appendChild(el("div", "pset-title",
            state.mode === "ai" ? "Ваш герой" : `Игрок ${i + 1}`));
          const avRow = el("div", "avatars-row");
          for (const a of AVATARS) {
            const img = document.createElement("img");
            img.src = avatarUrl(a.id);
            img.className = `av-pick${h.avatar === a.id ? " sel" : ""}`;
            img.alt = a.id;
            img.onclick = () => {
              h.avatar = a.id;
              avRow.querySelectorAll(".av-pick").forEach((x) => x.classList.remove("sel"));
              img.classList.add("sel");
            };
            avRow.appendChild(img);
          }
          card.appendChild(avRow);
          const input = document.createElement("input");
          input.className = "name-input";
          input.maxLength = 14;
          input.placeholder = defaultName(i);
          input.value = h.name;
          input.style.borderColor = PLAYER_COLORS[i];
          input.oninput = () => { h.name = input.value; };
          card.appendChild(input);
          slotsBox.appendChild(card);
        });
        if (state.mode === "ai") {
          slotsBox.appendChild(el("div", "sub", `Остальные ${state.count - 1} — соперники-ИИ со своими героями`));
        }
      };

      modeAi.onclick = () => {
        state.mode = "ai";
        modeAi.classList.add("sel");
        modeHot.classList.remove("sel");
        renderSlots();
      };
      modeHot.onclick = () => {
        state.mode = "hotseat";
        modeHot.classList.add("sel");
        modeAi.classList.remove("sel");
        renderSlots();
      };
      renderSlots();

      const start = el("button", "big-btn", "⚔️ Начать игру") as HTMLButtonElement;
      start.style.fontSize = "16px";
      start.onclick = () => {
        scr.remove();
        this.screenEl = null;
        resolve({ mode: state.mode, count: state.count, humans: state.humans });
      };
      scr.appendChild(start);
      this.root.appendChild(scr);
      this.screenEl = scr;
    });
  }

  results(players: Player[], bestGold: number): Promise<void> {
    return new Promise((resolve) => {
      const scr = el("div", "results-screen");
      const escaped = players.filter((p) => p.escaped);
      const humansCount = players.filter((p) => p.isHuman).length;
      let winner: Player | null = null;
      for (const p of escaped) if (!winner || p.gold > winner.gold) winner = p;
      const winTitle = !winner
        ? `<span class="dragon">💀</span>Все погибли`
        : winner.isHuman && humansCount === 1
          ? `<span class="dragon">🏆</span>Победа!`
          : `<span class="dragon">🏆</span>${winner.name} победил!`;
      scr.appendChild(el("div", "game-logo", winTitle));
      const list = el("div", "results-list");
      const sorted = [...players].sort((a, b) => b.gold - a.gold);
      for (const p of sorted) {
        const row = el("div", `result-row${winner === p ? " winner" : ""}`);
        const status = p.escaped ? "выбрался" : "погиб";
        row.innerHTML = `<img class="avatar" src="${avatarUrl(p.avatar)}" style="border-color:${PLAYER_COLORS[p.id]}" alt="">
          <span class="nm">${p.name}</span><span class="st">${status}</span>
          <span class="gold">${p.escaped ? p.gold : 0} 💰</span>`;
        list.appendChild(row);
      }
      scr.appendChild(list);
      scr.appendChild(el("div", "best-gold", `🏆 Рекорд добычи: ${bestGold} золота`));
      const btn = el("button", "big-btn", "🔄 Играть снова") as HTMLButtonElement;
      btn.onclick = () => { scr.remove(); this.screenEl = null; resolve(); };
      scr.appendChild(btn);
      this.root.appendChild(scr);
      this.screenEl = scr;
    });
  }

  pause(): Promise<"resume" | "restart"> {
    return new Promise((resolve) => {
      const node = el("div");
      node.appendChild(el("div", "icon", "⏸️"));
      node.appendChild(el("h2", "", "Пауза"));
      const btns = el("div", "btns");
      const resume = el("button", "big-btn", "▶️ Продолжить") as HTMLButtonElement;
      resume.onclick = () => { this.closePopup(); resolve("resume"); };
      const restart = el("button", "big-btn ghost", "🔄 Начать заново") as HTMLButtonElement;
      restart.onclick = () => { this.closePopup(); resolve("restart"); };
      btns.append(resume, restart);
      node.appendChild(btns);
      this.openPopup(node);
    });
  }

  /** Инвентарь: предметы героя и зелья здоровья. onUsePotion вызывается при выпивании. */
  inventory(p: Player, onUsePotion: () => void): Promise<void> {
    return new Promise((resolve) => {
      const node = el("div");
      node.appendChild(el("h2", "", `🎒 Инвентарь: ${p.name}`));
      const list = el("div", "inv-list");
      node.appendChild(list);

      const render = () => {
        list.innerHTML = "";
        list.appendChild(el("div", "inv-row",
          `<span class="inv-ico">❤️</span><span class="inv-nm">Жизни</span><span class="inv-ds">${"❤️".repeat(Math.max(0, p.lives)) || "—"} (${p.lives}/3)</span>`));
        if (!p.items.length && !p.potions) {
          list.appendChild(el("div", "sub", "Пока пусто — исследуйте подземелье."));
        }
        for (const id of p.items) {
          const def = ITEMS[id];
          if (!def) continue;
          list.appendChild(el("div", "inv-row",
            `<img src="${def.image}" class="inv-img" alt=""><span class="inv-nm">${def.name}</span><span class="inv-ds">${def.desc}</span>`));
        }
        if (p.potions > 0) {
          const row = el("div", "inv-row");
          row.innerHTML = `<span class="inv-ico">🧪</span><span class="inv-nm">Зелье здоровья ×${p.potions}</span><span class="inv-ds">+1 жизнь</span>`;
          const useBtn = el("button", "inv-use", "Выпить") as HTMLButtonElement;
          useBtn.disabled = p.lives >= 3 || !p.alive;
          useBtn.onclick = () => { onUsePotion(); render(); };
          row.appendChild(useBtn);
          list.appendChild(row);
        }
      };
      render();

      const btns = el("div", "btns");
      const ok = el("button", "big-btn", "Закрыть") as HTMLButtonElement;
      ok.onclick = () => { this.closePopup(); resolve(); };
      btns.appendChild(ok);
      node.appendChild(btns);
      this.openPopup(node);
    });
  }

  /** Danger meter element for the lair popup. */
  dangerMeter(danger: number): HTMLElement {
    const wrap = el("div");
    const meter = el("div", "danger-meter");
    const fill = el("div");
    fill.style.width = `${Math.min(100, danger)}%`;
    meter.appendChild(fill);
    wrap.appendChild(meter);
    wrap.appendChild(el("div", "danger-label", `🔥 Вероятность пробуждения дракона: ${danger}%`));
    return wrap;
  }

  dispose(): void {
    this.dice3d.dispose();
    this.root.innerHTML = "";
  }
}
