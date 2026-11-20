/**
 * game.ts — контроллер «Логова Дракона»: очерёдность ходов, ввод игрока,
 * ИИ-соперники, разрешение событий, логово дракона, конец игры.
 */
import * as M from "./model";
import { Scene3D } from "./scene3d";
import { GameUI } from "./ui";
import { AudioSystem } from "../audio";

export const RESTART = Symbol("restart");
type StepResult = "OK" | "END" | "DEAD" | "LAIR" | "ESCAPED";

export class DragonLairGame {
  cells: M.Cell[] = [];
  players: M.Player[] = [];
  scene: Scene3D;
  ui: GameUI;
  audio: AudioSystem;

  currentId = 0;
  paused = false;
  private pendingRestart = false;
  private pendingPick: [number, number] | null = null;
  private endTurnRequested = false;
  private currentLegal: [number, number][] = [];

  onBestGold: (v: number) => number = (v) => v; // returns (possibly updated) best

  constructor(scene: Scene3D, ui: GameUI, audio: AudioSystem) {
    this.scene = scene;
    this.ui = ui;
    this.audio = audio;
    this.newGame();

    ui.onEndTurn = () => { this.endTurnRequested = true; };
    ui.onPause = () => { void this.togglePause(); };
    ui.onInventory = () => { void this.openInventory(); };
  }

  /** Инвентарь активного человека-игрока: предметы и зелья. */
  private async openInventory(): Promise<void> {
    const p = this.players[this.currentId] && this.players[this.currentId].isHuman
      ? this.players[this.currentId]
      : this.players.find((pl) => pl.isHuman && pl.alive) ?? this.players[0];
    this.audio.sfx("ui");
    await this.ui.inventory(p, () => {
      if (p.potions > 0 && p.lives < 3 && p.alive) {
        p.potions--;
        p.lives = Math.min(3, p.lives + 1);
        this.audio.sfx("pickup");
        this.ui.log(`${p.name} выпил зелье здоровья (+1 ❤)`, "good");
        this.ui.setPlayers(this.players, this.currentId);
      }
    });
  }

  newGame(setup?: M.GameSetup): void {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    this.cells = M.genBoard(M.mulberry32(seed));
    this.players = M.makePlayers(setup);
    this.currentId = 0;
    this.pendingRestart = false;
    this.pendingPick = null;
    this.endTurnRequested = false;
    this.currentLegal = [];
  }

  // ---------- async helpers ----------
  private nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

  private async wait(ms: number): Promise<void> {
    const t0 = performance.now();
    for (;;) {
      await this.nextFrame();
      if (this.pendingRestart) throw RESTART;
      if (!this.paused && performance.now() - t0 >= ms) return;
    }
  }

  private checkpoint(): void {
    if (this.pendingRestart) throw RESTART;
  }

  async togglePause(): Promise<void> {
    if (this.paused) return;
    this.paused = true;
    this.audio.sfx("ui");
    const r = await this.ui.pause();
    this.paused = false;
    if (r === "restart") this.pendingRestart = true;
  }

  requestRestart(): void { this.pendingRestart = true; }

  // ---------- main loop ----------
  /** One full match: turns until everyone is dead or escaped. Resolves when results screen is closed. */
  async playMatch(): Promise<void> {
    this.scene.showOverview();
    await this.wait(300);

    for (const p of this.players) {
      this.scene.placePawn(p.id, p.x, p.z);
      this.scene.reveal(p.x, p.z, this.cells);
      this.scene.focusOn(p.x, p.z);
    }
    this.scene.focusOn(this.players[0].x, this.players[0].z, true);
    this.ui.setPlayers(this.players, 0);

    for (let guard = 0; guard < 2000; guard++) {
      if (this.players.every((p) => !p.alive || p.escaped)) break;
      const p = this.players[this.currentId];
      if (p.alive && !p.escaped) {
        this.ui.setPlayers(this.players, this.currentId);
        this.scene.setActivePlayer(p.id, p.x, p.z);
        this.scene.focusOn(p.x, p.z);
        this.ui.setBanner(p.isHuman ? `✨ Ваш ход: ${p.name}` : `Ход: ${p.name}`);
        await this.takeTurn(p);
        this.checkpoint();
      }
      this.currentId = (this.currentId + 1) % this.players.length;
      this.ui.setPlayers(this.players, this.currentId);
    }

    await this.finishMatch();
  }

  private async finishMatch(): Promise<void> {
    this.scene.showOverview();
    this.ui.setBanner("Экспедиция завершена");
    this.ui.setSteps(null);
    this.ui.setEndTurnVisible(false);
    const humanBest = Math.max(0, ...this.players.filter((p) => p.isHuman && p.escaped).map((p) => p.gold));
    const best = this.onBestGold(humanBest);
    this.audio.sfx(this.players.some((p) => p.isHuman && p.escaped) ? "win" : "lose");
    await this.ui.results(this.players, best);
  }

  // ---------- turns ----------
  private async takeTurn(p: M.Player): Promise<void> {
    const inLair = this.cells[M.idx(p.x, p.z)].lair;
    if (inLair) await this.lairTurn(p);
    else await this.moveTurn(p, null);
  }

  /** Movement phase. `preRolled` lets the lair "leave" path skip a second popup. */
  private async moveTurn(p: M.Player, preRolled: number | null): Promise<void> {
    let steps: number;
    if (p.isHuman) {
      const raw = preRolled ?? await this.ui.dice(
        { title: p.name, sub: "Кубик d4 решит, сколько клеток вы пройдёте", die: 4, button: "Бросить d4", bonus: M.bonusDice(p) || undefined, avatar: M.avatarUrl(p.avatar), skippable: true },
        () => M.rollD(4),
        () => this.audio.sfx("ui"),
      );
      if (raw === 0) {
        steps = 0;
        this.ui.log(`${p.name} пропустил ход`, "");
      } else {
        steps = raw + M.bonusDice(p);
        this.ui.log(`${p.name} выбросил ${steps} на d4`, "");
        this.audio.sfx("move");
      }
    } else {
      steps = (preRolled ?? M.rollD(4)) + M.bonusDice(p);
      this.ui.log(`${p.name} выбросил ${steps} на d4`, "");
      await this.wait(350);
    }

    if (p.isHuman) {
      await this.humanMovement(p, steps);
    } else {
      await this.aiMovement(p, steps);
    }
  }

  private async humanMovement(p: M.Player, steps: number): Promise<void> {
    this.ui.setEndTurnVisible(true);
    this.endTurnRequested = false;

    let lastX = p.x, lastZ = p.z;
    while (steps > 0 && p.alive && !p.escaped) {
      this.ui.setSteps(steps);
      let moves: [number, number][] = [];
      let jumps: [number, number][] = [];
      const setupChoices = () => {
        moves = M.legalMoves(this.cells, p.x, p.z);
        const inLair = this.cells[M.idx(p.x, p.z)].lair;
        jumps = inLair ? M.jumpOutTargets(this.cells, p.x, p.z) : M.jumpTargets(this.cells, p.x, p.z);
        const dirNames = moves.map(([mx, mz]) => (mx > p.x ? "В" : mx < p.x ? "З" : mz > p.z ? "Ю" : "С")).join(" ");
        this.ui.hint(`Шагов: ${steps}. Развилка — выбери клетку.${dirNames ? ` Выходы плитки: ${dirNames}.` : ""}`);
        this.currentLegal = [...moves, ...jumps];
        this.scene.setHighlights(moves);
        this.scene.setJumpHighlights(jumps);
        if (jumps.length) this.ui.hint(inLair ? "Голубая клетка — прыжок из логова через пропасть" : "Голубая клетка — прыжок в логово через пропасть");
      };
      setupChoices();
      if (!moves.length && !jumps.length) break;
      let jumpPick: [number, number] | null = null;
      this.scene.onCellClick = (x, z) => {
        if (moves.some(([lx, lz]) => lx === x && lz === z)) this.pendingPick = [x, z];
        else if (jumps.some(([lx, lz]) => lx === x && lz === z)) jumpPick = [x, z];
      };

      // poll for a pick / jump / end-turn / pause / restart
      let picked: [number, number] | null = null;
      for (;;) {
        await this.nextFrame();
        this.checkpoint();
        if (p.x !== lastX || p.z !== lastZ) {
          // внешнее перемещение фишки (debug-телепорт) — пересчитать доступные клетки
          lastX = p.x; lastZ = p.z;
          setupChoices();
        }
        if (this.pendingPick) { picked = this.pendingPick; this.pendingPick = null; break; }
        if (jumpPick) break;
        if (this.endTurnRequested) { this.endTurnRequested = false; break; }
      }
      this.scene.onCellClick = null;
      this.scene.setHighlights([]);
      this.scene.setJumpHighlights([]);
      this.currentLegal = [];
      if (!picked && !jumpPick) break;

      if (jumpPick) {
        const r = await this.jumpAcross(p, jumpPick, false);
        if (r === "LAIR" || r === "DEAD") break;
        steps--; // попытка прыжка тратит один шаг
        continue;
      }

      this.audio.sfx("move");
      const r = await this.stepTo(p, picked!, false);
      if (r !== "OK") break;
      steps--;
    }

    this.ui.setSteps(null);
    this.ui.setEndTurnVisible(false);
    this.ui.hint(null);
    this.scene.setHighlights([]);
    this.scene.setJumpHighlights([]);
  }

  /** Прыжок через бездонный ров — в логово или обратно. Верёвка = без проверки. */
  private async jumpAcross(p: M.Player, [tx, tz]: [number, number], ai: boolean): Promise<StepResult> {
    const fromX = p.x, fromZ = p.z;
    const target = this.cells[M.idx(tx, tz)];
    const intoLair = target.lair;

    if (M.hasRope(p)) {
      if (!ai) await this.ui.info({ title: "🪢 Верёвка", icon: "🪢", text: "Вы закрепили верёвку и спокойно перебрались через пропасть — никаких проверок." });
      else this.ui.log(`${p.name} перебрался через пропасть по верёвке`, "good");
    } else {
      let total: number;
      if (!ai) {
        total = await this.ui.dice(
          { title: p.name, sub: "Прыжок через пропасть: внизу — бездна! Переберетесь ли вы?", die: 20, dc: M.JUMP_DC, button: "Прыгать", avatar: M.avatarUrl(p.avatar) },
          () => M.rollD(20),
          () => this.audio.sfx("ui"),
        );
      } else {
        total = M.rollD(20) + 1;
        await this.wait(500);
      }
      if (total <= M.JUMP_DC) {
        p.lives -= 1;
        this.audio.sfx("hit");
        this.ui.setPlayers(this.players, this.currentId);
        if (p.lives <= 0) {
          await this.kill(p, fromX, fromZ, "Сорвался в бездонную пропасть");
          return "DEAD";
        }
        if (!ai) await this.ui.info({ title: "Срыв!", icon: "🕳️",
          text: `Вы сорвались, но успели ухватиться за край и выбраться обратно.<br>Потеряна <b>1 жизнь</b> — осталось: ${"❤️".repeat(p.lives)}` });
        else this.ui.log(`${p.name} сорвался с пропасти (−1 ❤)`, "bad");
        this.checkpoint();
        return "OK"; // остался на месте
      }
    }

    // успех: перелёт над пропастью
    p.x = tx; p.z = tz;
    this.audio.sfx("move");
    await this.scene.jumpPawn(p.id, fromX, fromZ, tx, tz);
    this.scene.moveActiveRing(tx, tz);
    this.scene.focusOn(tx, tz);
    this.scene.reveal(tx, tz, this.cells);
    if (intoLair) {
      p.visitedLair = true;
      this.ui.log(p.isHuman ? "Вы в логове дракона… он спит на горе золота" : `${p.name} проник в логово!`, "gold");
      this.audio.sfx("pickup");
      return "LAIR";
    }
    this.ui.log(p.isHuman ? "Вы перепрыгнули пропасть!" : `${p.name} выпрыгнул из логова`, "good");
    return "OK";
  }

  private async aiMovement(p: M.Player, steps: number): Promise<void> {
    const inLair = this.cells[M.idx(p.x, p.z)].lair;
    // target: flee to the nearest border if leaving the lair or rich enough, else to the lair
    const fleeing = inLair;

    // ИИ в логове сначала выпрыгивает через ров наружу
    if (inLair) {
      const outs = M.jumpOutTargets(this.cells, p.x, p.z);
      if (outs.length) {
        const r = await this.jumpAcross(p, outs[Math.floor(Math.random() * outs.length)], true);
        steps--;
        if (r === "DEAD") return;
        await this.wait(400);
      }
    }

    const goal = (x: number, z: number) =>
      fleeing ? M.isBorder(x, z) : M.jumpTargets(this.cells, x, z).length > 0;
    const path = M.bfsPath(this.cells, p.x, p.z, goal) ?? [];
    let walked = 0;
    for (const [nx, nz] of path) {
      if (walked >= steps) break;
      this.audio.sfx("move");
      const r = await this.stepTo(p, [nx, nz], true, fleeing);
      walked++;
      if (r !== "OK") return;
      // deliberate escape: only an AI that is fleeing the lair leaves at the border
      if (fleeing && M.isBorder(p.x, p.z)) {
        await this.escape(p);
        return;
      }
      await this.wait(320);
    }
    // дошёл до края пропасти — прыгает в логово
    if (!fleeing && walked < steps) {
      const jumps = M.jumpTargets(this.cells, p.x, p.z);
      if (jumps.length) {
        await this.wait(500);
        await this.jumpAcross(p, jumps[Math.floor(Math.random() * jumps.length)], true);
        return;
      }
    }
    await this.wait(450);
  }

  /** Move pawn one cell, reveal tile, trigger event. `ignoreLair` lets a fleeing AI pass through lair cells. */
  private async stepTo(p: M.Player, [x, z]: [number, number], ai: boolean, ignoreLair = false): Promise<StepResult> {
    const fromX = p.x, fromZ = p.z;
    const wasRevealed = (this.scene as unknown as { revealed?: Uint8Array }).revealed?.[M.idx(x, z)] === 1;
    p.x = x; p.z = z;
    await this.scene.movePawn(p.id, fromX, fromZ, x, z, ai ? 0.4 : 0.26);
    this.scene.moveActiveRing(x, z);
    this.scene.focusOn(x, z);
    this.scene.reveal(x, z, this.cells);
    if (!wasRevealed) this.scene.spawnBurst(x, z, 0x8a86a0, 18, 2.2, 2.2);

    const cell = this.cells[M.idx(x, z)];
    if (cell.lair && !ignoreLair) {
      p.visitedLair = true; // только после логова можно покинуть подземелье
      this.ui.log(p.isHuman ? "Вы в логове дракона… он спит на горе золота" : `${p.name} проник в логово!`, "gold");
      this.audio.sfx("pickup");
      return "LAIR";
    }

    if (cell.event && !cell.event.resolved) {
      const r = await this.resolveEvent(p, cell.event, x, z, ai);
      if (r !== "OK") return r;
    }

    if (!ai && M.isBorder(x, z)) {
      if (!p.visitedLair) {
        // выход заперт, пока искатель не побывал в логове
        this.ui.hint("Выход заперт: сначала доберитесь до логова дракона!");
        this.ui.log("Страж подземелья не выпускает пустого искателя — вперёд, к логову!", "bad");
        return "OK";
      }
      const ans = await this.ui.choice(
        "🚪 Край подземелья",
        `Вы можете выбраться наружу со своим золотом (${p.gold} 💰) — или продолжить путь.`,
        [
          { id: "exit", label: `Выйти с ${p.gold} золота` },
          { id: "stay", label: "Остаться в подземелье", ghost: true },
        ],
      );
      this.checkpoint();
      if (ans === "exit") {
        await this.escape(p);
        return "ESCAPED";
      }
    }
    return "OK";
  }

  private async escape(p: M.Player): Promise<void> {
    p.escaped = true;
    this.ui.log(p.isHuman ? `Вы выбрались с ${p.gold} золота!` : `${p.name} выбрался с ${p.gold} золота`, "gold");
    this.audio.sfx("win");
    await this.scene.escapePawn(p.id);
  }

  private async kill(p: M.Player, x: number, z: number, reason: string): Promise<void> {
    p.alive = false;
    p.gold = 0;
    this.audio.sfx("lose");
    this.scene.spawnBurst(x, z, 0xff4444, 40, 3.4, 3.8);
    await this.scene.killPawn(p.id);
    this.ui.log(`💀 ${p.name} погиб: ${reason}`, "bad");
    if (p.isHuman) {
      await this.ui.info({ title: `💀 ${p.name} погиб`, text: `${reason}.<br>Всё награбленное золото осталось в подземелье.`, icon: "☠️" });
      this.checkpoint();
    }
  }

  // ---------- events ----------
  private async resolveEvent(p: M.Player, ev: M.CellEvent, x: number, z: number, ai: boolean): Promise<StepResult> {
    if (ev.kind === "gold") {
      ev.resolved = true;
      p.gold += ev.amount;
      this.audio.sfx("pickup");
      this.scene.spawnBurst(x, z, 0xffd24a, 42, 3.0, 4.2);
      if (!ai) await this.ui.info({ title: `+${ev.amount} золота!`, icon: "💰", text: `Вы нашли тайник. Теперь у вас <b>${p.gold}</b> золота.` });
      else this.ui.log(`${p.name} нашёл ${ev.amount} золота`, "gold");
      this.checkpoint();
      return "OK";
    }

    if (ev.kind === "item") {
      ev.resolved = true;
      const def = M.ITEMS[ev.id];
      if (ev.id === "potion") {
        p.potions++;
        this.ui.setPlayers(this.players, this.currentId);
      } else {
        p.items.push(ev.id);
      }
      this.audio.sfx("pickup");
      this.scene.spawnBurst(x, z, 0x9fd8ff, 36, 2.6, 4.0);
      if (!ai) await this.ui.info({ title: def.name, icon: def.icon, text: `${def.artifact ? "Артефакт! " : "Полезная вещь: "}${def.desc}.${ev.id === "potion" ? " Лежит в инвентаре (🎒)." : ""}` });
      else this.ui.log(`${p.name} подобрал: ${def.name}`, "good");
      this.checkpoint();
      return "OK";
    }

    if (ev.kind === "monster") {
      const def = M.monsterDef(ev.id);
      const bonus = M.bonusVsMonster(p);
      let total: number;
      if (!ai) {
        const roll = await this.ui.encounter(
          { kind: "monster", id: ev.id, name: ev.name, icon: def.icon, desc: def.desc, fail: def.fail, dc: ev.dc, bonus: bonus || undefined, deadly: def.deadly },
          () => M.rollD(20),
          () => this.audio.sfx("ui"),
        );
        total = roll + bonus;
      } else {
        total = M.rollD(20) + bonus + 1; // AI is a seasoned dungeoneer: small flat edge
        await this.wait(500);
      }
      if (total > ev.dc) {
        ev.resolved = true;
        const reward = def.reward[0] + Math.floor(Math.random() * (def.reward[1] - def.reward[0] + 1));
        p.gold += reward;
        this.audio.sfx("win");
        this.scene.spawnBurst(x, z, 0xffd24a, 40, 3.0, 4.0);
        if (!ai) await this.ui.info({ title: "Победа!", icon: "🏆", text: `${ev.name} повержен. В его тайнике: <b>+${reward} золота</b>.` });
        else this.ui.log(`${p.name} убил ${ev.name} (+${reward} золота)`, "good");
        this.checkpoint();
        return "OK";
      }
      // провал броска: −1 жизнь и часть золота; жизни кончились — гибель
      const lost = Math.ceil(p.gold * (def.deadly ? 0.5 : def.stealPct));
      p.gold -= lost;
      p.lives -= 1;
      ev.resolved = true;
      this.audio.sfx("hit");
      this.ui.setPlayers(this.players, this.currentId);
      if (p.lives <= 0) {
        await this.kill(p, x, z, `${ev.name} оказался сильнее`);
        return "DEAD";
      }
      if (!ai) await this.ui.info({ title: "Поражение…", icon: "🩸",
        text: `${ev.name} отбросил вас и забрал <b>${lost} золота</b>.<br>Потеряна <b>1 жизнь</b> — осталось: ${"❤️".repeat(p.lives)}` });
      else this.ui.log(`${p.name} проиграл ${ev.name} (−${lost} золота, −1 ❤)`, "bad");
      this.checkpoint();
      return "OK";
    }

    // trap
    const def = M.trapDef(ev.id);
    const bonus = M.bonusVsTrap(p);
    let total: number;
    if (!ai) {
      const roll = await this.ui.encounter(
        { kind: "trap", id: ev.id, name: ev.name, icon: def.icon, desc: def.desc, fail: def.fail, dc: ev.dc, bonus: bonus || undefined, deadly: def.deadly },
        () => M.rollD(20),
        () => this.audio.sfx("ui"),
      );
      total = roll + bonus;
    } else {
      total = M.rollD(20) + bonus + 1;
      await this.wait(500);
    }
    if (total > ev.dc) {
      ev.resolved = true;
      this.audio.sfx("ui");
      if (!ai) await this.ui.info({ title: "Удалось увернуться!", icon: "✨", text: `Вы благополучно миновали: ${ev.name}.` });
      else this.ui.log(`${p.name} избежал ловушки (${ev.name})`, "good");
      this.checkpoint();
      return "OK";
    }
    ev.resolved = true;
    const lost = Math.ceil(p.gold * (def.deadly ? 0.5 : def.losePct));
    p.gold -= lost;
    p.lives -= 1;
    this.audio.sfx("hit");
    this.ui.setPlayers(this.players, this.currentId);
    if (p.lives <= 0) {
      await this.kill(p, x, z, `${ev.name} поглотил вас`);
      return "DEAD";
    }
    if (!ai) await this.ui.info({ title: "Ловушка сработала!", icon: "💥",
      text: `${ev.name}: потеряно <b>${lost} золота</b> и <b>1 жизнь</b> — осталось: ${"❤️".repeat(p.lives)}.${def.endsTurn || def.deadly ? " Ход окончен." : ""}` });
    else this.ui.log(`${p.name} попал в ловушку (${ev.name}, −${lost} золота, −1 ❤)`, "bad");
    this.checkpoint();
    return def.endsTurn || def.deadly ? "END" : "OK";
  }

  // ---------- dragon lair ----------
  private async lairTurn(p: M.Player): Promise<void> {
    if (p.isHuman) {
      for (;;) {
        this.checkpoint();
        const ans = await this.ui.choice(
          "🐉 Логово дракона",
          `Дракон спит. Ваше золото: <b>${p.gold}</b> 💰.<br>Каждая кража будит его всё сильнее (+10%).`,
          [
            { id: "steal", label: "💰 Красть золото", sub: `проверка: проснётся при броске ≤ ${Math.ceil(p.danger / 5)} на d20`, danger: true },
            { id: "leave", label: "🏃 Уходить", sub: "бросить d4 и двигаться к выходу", ghost: true },
          ],
          "🐉",
          this.ui.dangerMeter(p.danger),
        );
        this.checkpoint();
        if (ans === "leave") break;

        const roll = await this.ui.dice(
          { title: p.name, sub: "Тихо-тихо… тянитесь к сокровищам. Не разбудите его!", die: 20, button: "Красть золото", bonus: M.bonusLair(p) || undefined, avatar: M.avatarUrl(p.avatar) },
          () => M.rollD(20),
          () => this.audio.sfx("ui"),
        );
        const total = roll + M.bonusLair(p);
        const woke = total <= Math.ceil(p.danger / 5);
        if (woke) {
          if (M.hasRing(p)) {
            p.ringUsed = true;
            this.audio.sfx("hit");
            await this.ui.info({ title: "💍 Кольцо невидимости!", text: "Дракон приоткрыл глаз… но кольцо скрыло вас. Кольцо разрушено, а дракон настороже." });
            p.danger = Math.min(100, p.danger + 10);
            this.checkpoint();
            continue;
          }
          await this.dragonKills(p);
          return;
        }
        const loot = Math.round((25 + Math.floor(Math.random() * 26) + p.thefts * 12) * M.lairGoldMult(p));
        p.thefts++;
        p.gold += loot;
        p.danger = Math.min(100, p.danger + 10);
        this.audio.sfx("pickup");
        this.scene.spawnBurst(p.x, p.z, 0xffd24a, 46, 3.4, 4.6);
        await this.ui.info({ title: `+${loot} золота!`, icon: "💰", text: `Дракон не проснулся. У вас <b>${p.gold}</b> золота.<br>Опасность выросла до <b>${p.danger}%</b>.` });
        this.ui.setPlayers(this.players, this.currentId);
        this.checkpoint();
      }
      // leaving the lair: normal movement this turn
      this.ui.log("Вы выскальзываете из логова…", "");
      await this.moveTurn(p, null);
      return;
    }

    // --- AI in the lair: steal while greed allows, then leave ---
    while (p.alive && p.danger <= p.aiGreed && p.thefts < 8) {
      await this.wait(420);
      const total = M.rollD(20) + M.bonusLair(p);
      const woke = total <= Math.ceil(p.danger / 5);
      if (woke) {
        if (M.hasRing(p)) {
          p.ringUsed = true;
          p.danger = Math.min(100, p.danger + 10);
          this.ui.log(`${p.name}: кольцо невидимости спасло от дракона!`, "good");
          continue;
        }
        await this.dragonKills(p);
        return;
      }
      const loot = Math.round((25 + Math.floor(Math.random() * 26) + p.thefts * 12) * M.lairGoldMult(p));
      p.thefts++;
      p.gold += loot;
      p.danger = Math.min(100, p.danger + 10);
      this.ui.log(`${p.name} украл у дракона ${loot} золота (опасность ${p.danger}%)`, "gold");
      this.audio.sfx("pickup");
    }
    if (p.alive && !p.escaped) {
      this.ui.log(`${p.name} уходит из логова`, "");
      await this.moveTurn(p, null);
    }
  }

  private async dragonKills(p: M.Player): Promise<void> {
    this.scene.wakeDragon();
    this.audio.sfx("explosion");
    this.scene.spawnBurst(p.x, p.z, 0xff5522, 60, 4.5, 5.5);
    this.ui.log(`🐉 ДРАКОН ПРОСНУЛСЯ!`, "bad");
    await this.wait(1000);
    await this.kill(p, p.x, p.z, "Дракон проснулся и испепелил воришку");
  }

  // ---------- debug hooks for the self-check ----------
  debugState() {
    return {
      players: this.players.map((p) => ({
        id: p.id, x: p.x, z: p.z, gold: p.gold, alive: p.alive, escaped: p.escaped,
        danger: p.danger, thefts: p.thefts, inLair: this.cells[M.idx(p.x, p.z)].lair,
      })),
      legal: this.currentLegal,
      currentId: this.currentId,
      paused: this.paused,
      events: this.cells
        .map((c, i): { x: number; z: number; kind: string; id: string; open: number } | null =>
          (c.event && !c.event.resolved
            ? { x: i % M.W, z: Math.floor(i / M.W), kind: c.event.kind as string, id: c.event.id, open: c.open }
            : null))
        .filter((e): e is { x: number; z: number; kind: string; id: string; open: number } => e !== null),
    };
  }

  /** Debug/self-check helper: teleport a pawn (visual test of the moat / jump). */
  debugTeleport(x: number, z: number, playerId = 0): void {
    const p = this.players[playerId] ?? this.players[0];
    p.x = x; p.z = z;
    this.scene.placePawn(p.id, x, z);
    this.scene.reveal(x, z, this.cells);
    this.scene.focusOn(x, z, true);
  }

  /** Debug/self-check helper: BFS path to the moat's edge before the lair (or to the border). */
  debugPath(toBorder: boolean, playerId = 0): [number, number][] {
    const p = this.players[playerId] ?? this.players[0];
    return M.bfsPath(this.cells, p.x, p.z, (x, z) =>
      toBorder ? M.isBorder(x, z) : M.jumpTargets(this.cells, x, z).length > 0) ?? [];
  }
}
