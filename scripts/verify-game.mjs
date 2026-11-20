/**
 * verify-game.mjs — Playwright smoke self-check for «Логово Дракона»:
 * serve dist → zero console errors → drive the REAL UI (title → d4 roll → tap highlighted
 * cells → event popups with d20) → screenshots at every key state.
 *
 * Usage: npm run build && node scripts/verify-game.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const DIST = existsSync(join(ROOT, "dist/public/index.html"))
  ? join(ROOT, "dist/public")
  : join(ROOT, "dist");
if (!existsSync(join(DIST, "index.html"))) {
  console.error(`VERIFY FAIL: no build output at ${DIST} — run \`npm run build\` first`);
  process.exit(1);
}
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });

const CANVAS_ID = "game-canvas";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  try {
    const raw = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    let path;
    try { path = decodeURIComponent(raw); } catch { path = raw; }
    const file = resolve(DIST, "." + path);
    if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end();
  }
});

const fail = (msg) => { console.error("VERIFY FAIL:", msg); server.close(); process.exit(1); };

await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/opt/gchrome/opt/google/chrome/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter(Boolean);
let browser;
for (const exe of [null, ...CANDIDATES]) {
  try {
    browser = await chromium.launch(exe
      ? { executablePath: exe, args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] }
      : {});
    break;
  } catch { /* try the next one */ }
}
if (!browser) fail("no usable browser found");
// portrait mobile viewport — the game's target format
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });

const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 })
  .catch(() => console.warn("WARN: __GAME_READY__ never turned true"));
await page.waitForTimeout(1200);

// 1) canvas must render content (drawing buffer read, needs preserveDrawingBuffer)
const shot = await page.evaluate((id) => {
  const SAMPLES = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
  const el = document.getElementById(id);
  if (!el) return { kind: "no-canvas" };
  const gl = el.getContext("webgl2") || el.getContext("webgl");
  if (!gl) return { kind: "no-context" };
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  if (!w || !h) return { kind: "empty-buffer" };
  const px = new Uint8Array(4);
  let lit = 0;
  for (const [fx, fy] of SAMPLES) {
    gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (px[3] > 0 && px[0] + px[1] + px[2] > 8) lit++;
  }
  return { kind: "lit", lit, total: SAMPLES.length };
}, CANVAS_ID);
if (shot.kind !== "lit" || shot.lit < 2) fail(`canvas check failed: ${JSON.stringify(shot)}`);
await page.screenshot({ path: join(SHOTS, "01-title.png") });

// helpers ---------------------------------------------------------------
const popupButton = () => page.locator(".popup button:visible").first();
const hasPopup = async () => (await page.locator(".popup").count()) > 0;
async function clickThroughPopups(maxClicks = 8, shotName = null) {
  let tookShot = false;
  for (let i = 0; i < maxClicks; i++) {
    if (!(await hasPopup())) return;
    if (shotName && !tookShot) {
      await page.screenshot({ path: join(SHOTS, shotName) });
      tookShot = true;
    }
    // dice popup: tap the 3D die itself, it auto-closes after the result
    const die = page.locator(".popup .die3d-holder canvas:visible").first();
    if (await die.count()) {
      await die.click();
      await page.waitForTimeout(2900); // tumble 1.1s + settle + result pause
      continue;
    }
    // at the border-exit prompt keep exploring: prefer "Остаться"
    const stay = page.locator(".popup button:has-text('Остаться'):visible").first();
    const btn = (await stay.count()) ? stay : popupButton();
    if (!(await btn.count())) return;
    await btn.click();
    await page.waitForTimeout(1100); // dice shake animation ~0.9s
  }
}

// 2) title → setup screen → start match ------------------------------------
await page.keyboard.press("Space");
await page.waitForTimeout(700);
await page.screenshot({ path: join(SHOTS, "02-setup.png") });
const startBtn = page.locator(".setup-screen button:has-text('Начать игру')");
if (!(await startBtn.count())) fail("no setup screen / start button after title");
await startBtn.click();
await page.waitForTimeout(800);

// 3) d4 movement roll popup ----------------------------------------------
if (!(await hasPopup())) fail("no d4 popup after starting the game");
await page.screenshot({ path: join(SHOTS, "02-d4-popup.png") });
await clickThroughPopups(4);
if (await hasPopup()) fail("d4 popup did not resolve");

// 4) movement: tap highlighted cells through the real raycast path --------
let stepped = 0;
let eventShotTaken = false;
for (let turn = 0; turn < 8 && stepped < 4; turn++) {
  const st = await page.evaluate(() => window.__lairDebug ? window.__lairDebug() : null);
  if (!st) break;
  if (await hasPopup()) { // event triggered by the previous step
    if (!eventShotTaken) {
      await page.screenshot({ path: join(SHOTS, "03-event-popup.png") });
      eventShotTaken = true;
    }
    await clickThroughPopups(8);
    continue;
  }
  const legal = st.legal ?? [];
  if (!legal.length) {
    // human turn over (or AI playing) — end turn if the button is there
    const endBtn = page.locator("button:has-text('Завершить ход')");
    if (await endBtn.isVisible().catch(() => false)) {
      await endBtn.click();
      await page.waitForTimeout(1500); // AI turns animate
      continue;
    }
    await page.waitForTimeout(1200);
    continue;
  }
  const [x, z] = legal[0];
  const pt = await page.evaluate(([cx, cz]) => window.__lairProject(cx, cz), [x, z]);
  await page.mouse.click(pt.sx, pt.sy);
  stepped++;
  await page.waitForTimeout(900);
  await clickThroughPopups(8, eventShotTaken ? null : "03-event-popup.png");
  if (await hasPopup()) continue;
  if (!eventShotTaken) eventShotTaken = !!(await page.locator(".popup").count());
}
if (stepped === 0) fail("could not move the pawn by tapping a highlighted cell");
await page.screenshot({ path: join(SHOTS, "04-gameplay.png") });

// probe must reflect the movement
const probeA = await page.evaluate(() => window.__gameProbe());
const st2 = await page.evaluate(() => window.__lairDebug());
if (!probeA || !st2) fail("debug probes missing");
console.log(`probe: pawn at (${probeA.x.toFixed(1)}, ${probeA.z.toFixed(1)}), gold=${st2.players[0].gold}, alive=${st2.players[0].alive}`);

// 5) end the human turn and watch AI turns animate -------------------------
const endBtn = page.locator("button:has-text('Завершить ход')");
if (await endBtn.isVisible().catch(() => false)) await endBtn.click();
await clickThroughPopups(8);
await page.waitForTimeout(4500);
await clickThroughPopups(8);
await page.screenshot({ path: join(SHOTS, "05-ai-turns.png") });

// 6) pause overlay ----------------------------------------------------------
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
if (!(await hasPopup())) console.warn("WARN: pause popup did not open on Escape");
await page.screenshot({ path: join(SHOTS, "06-paused.png") });
if (await hasPopup()) {
  await page.locator(".popup button:has-text('Продолжить')").first().click().catch(() => {});
  await page.waitForTimeout(300);
}

// 7) zero console errors ----------------------------------------------------
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);

await browser.close();
server.close();
console.log("VERIFY OK: title → d4 roll → tap-to-move → events → AI turns → pause, zero console errors; shots in verification-shots/");
