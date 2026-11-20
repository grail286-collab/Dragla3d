/**
 * boot.ts — «Логово Дракона»: сборка сцены, UI, звука и контроллера игры.
 * Contract with the React shell (src/pages/Home.tsx):
 *   startGame(canvas)  mounts renderer + loop onto an existing <canvas>
 *   stopGame()         tears everything down (loop, renderer, listeners, probe)
 */

import { GameLoop } from "./engine";
import { AudioSystem } from "./audio";
import { Scene3D, cellToWorld } from "./lair/scene3d";
import { GameUI } from "./lair/ui";
import { DragonLairGame, RESTART } from "./lair/game";

declare global {
  interface Window {
    __gameProbe?: () => { x: number; y: number; z: number };
    __GAME_READY__?: boolean;
    __lairDebug?: () => unknown;
    __lairProject?: (x: number, z: number) => { sx: number; sy: number };
    __lairPath?: (toBorder: boolean, playerId?: number) => [number, number][];
  }
}

const BEST_KEY = "lair.bestGold";

function readBest(): number {
  try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { return 0; }
}
function writeBest(v: number): void {
  try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* storage blocked */ }
}

let session: { dispose: () => void } | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();

  const scene = new Scene3D(canvas);
  const uiRoot = document.getElementById("ui-overlay");
  const ui = new GameUI(uiRoot ?? document.body);
  const audio = new AudioSystem();
  ui.onMute = () => audio.toggleMute();
  // двойной тап по портрету искателя — переключить обзор на него
  ui.onPlayerFocus = (id) => {
    const p = game.players[id];
    if (p && p.alive && !p.escaped) scene.focusOn(p.x, p.z);
  };
  const game = new DragonLairGame(scene, ui, audio);

  game.onBestGold = (v) => {
    const best = Math.max(readBest(), v);
    writeBest(best);
    return best;
  };

  let alive = true;
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const orchestrate = async () => {
    await ui.title(readBest());
    for (;;) {
      try {
        if (!alive) return;
        const setup = await ui.setup();
        if (!alive) return;
        audio.startMusic();
        game.newGame(setup);
        await scene.buildBoard(game.cells, game.players);
        scene.showOverview();
        ui.setSteps(null);
        ui.setEndTurnVisible(false);
        ui.hint(null);
        ui.setBanner("Логово Дракона");
        ui.setPlayers(game.players, 0);
        // intro camera sequence
        await wait(2000);
        scene.focusOn(11, 11);
        await wait(2500);
        scene.focusOn(game.players[0].x, game.players[0].z);
        await wait(1500);
        await game.playMatch();
      } catch (e) {
        if (e !== RESTART) {
          console.error(e);
          // keep the app alive: fall through to a fresh match
        }
      }
    }
  };
  void orchestrate();

  const onKey = (e: KeyboardEvent) => {
    if (e.code === "Escape") void game.togglePause();
  };
  window.addEventListener("keydown", onKey);

  const loop = new GameLoop({
    update: (dt) => {
      // a throwing frame must never kill the RAF loop — tweens/promises depend on it
      try {
        if (!game.paused) scene.update(dt);
      } catch (e) {
        console.error(e);
      }
    },
    render: () => {
      try {
        scene.render();
      } catch (e) {
        console.error(e);
      }
      window.__GAME_READY__ = true;
    },
  });
  loop.start();

  // self-check probes
  window.__gameProbe = () => {
    const p = game.players[0];
    const { wx, wz } = cellToWorld(p.x, p.z);
    return { x: wx, y: 0, z: wz };
  };
  window.__lairDebug = () => game.debugState();
  window.__lairProject = (x, z) => scene.projectCell(x, z);
  window.__lairPath = (toBorder, playerId) => game.debugPath(toBorder, playerId);
  (window as unknown as Record<string, unknown>).__lairTeleport = (x: number, z: number, playerId?: number) => game.debugTeleport(x, z, playerId);

  session = {
    dispose: () => {
      alive = false;
      loop.stop();
      window.removeEventListener("keydown", onKey);
      audio.dispose();
      ui.dispose();
      scene.dispose();
      delete window.__gameProbe;
      delete window.__lairDebug;
      delete window.__lairProject;
      delete window.__lairPath;
      window.__GAME_READY__ = false;
    },
  };
}

export function stopGame(): void {
  session?.dispose();
  session = null;
}
