/**
 * shoot-encounters.mjs — снять скриншоты экранов боя и ловушки (enc-card),
 * плюс подсветку ходов. Драйвит реальный UI: title → setup → d4 → телепорт
 * рядом с событием → тап по клетке → экран встречи → бросок d20.
 *
 * Usage: npm run build && node scripts/shoot-encounters.mjs
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
const SHOTS = join(ROOT, "verification-shots");
mkdirSync(SHOTS, { recursive: true });
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
const fail = (msg) => { console.error("SHOOT FAIL:", msg); server.close(); process.exit(1); };
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
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1200);
await page.keyboard.press("Space");
await page.waitForTimeout(700);
await page.locator(".setup-screen button:has-text('Начать игру')").click();
await page.waitForTimeout(900);

// бросок d4 (подсветка ходов видна после закрытия попапа)
const die = () => page.locator(".popup .die3d-holder canvas:visible").first();
await die().click();
await page.waitForFunction(() => !document.querySelector(".popup"), null, { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
await page.screenshot({ path: join(SHOTS, "07-move-highlight.png") });

async function clickThrough(max = 8) {
  for (let i = 0; i < max; i++) {
    if (!(await page.locator(".popup").count())) return;
    try {
      const d = page.locator(".popup .die3d-holder canvas:visible").first();
      if (await d.count()) {
        await d.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(2900);
        continue;
      }
      const stay = page.locator(".popup button:has-text('Остаться'):visible").first();
      const btn = (await stay.count()) ? stay : page.locator(".popup button:visible").first();
      if (!(await btn.count())) return;
      await btn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
    } catch {
      // попап закрылся посреди клика — переспросим DOM на следующей итерации
    }
  }
}

async function shootEncounter(kind) {
  const ev = await page.evaluate((k) => {
    const st = window.__lairDebug();
    const e = st.events.find((x) => x.kind === k);
    if (!e) return null;
    // N=1 E=2 S=4 W=8 — ищем соседнюю клетку с проходом к событию
    const dirs = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
    for (const [dx, dz, bit] of dirs) {
      if (e.open & bit) return { from: [e.x + dx, e.z + dz], to: [e.x, e.z] };
    }
    return null;
  }, kind);
  if (!ev) { console.warn(`WARN: no '${kind}' event on the board`); return; }

  await page.evaluate(([x, z]) => window.__lairTeleport(x, z, 0), ev.from);
  await page.waitForTimeout(700);
  // телепорт открыл новую плиту — закрыть возможный попап находки
  await clickThrough(4);
  // если шаги кончились — завершаем ход и ждём следующий ход человека с новым d4
  const legal = await page.evaluate(() => window.__lairDebug().legal.length);
  if (!legal) {
    const endBtn = page.locator(".hud-bottom button:has-text('Завершить ход'):visible").first();
    if (await endBtn.count()) { await endBtn.click().catch(() => {}); await page.waitForTimeout(600); }
    const d4 = page.locator(".popup .die3d-holder canvas:visible").first();
    await d4.waitFor({ timeout: 40000 }).catch(() => {});
    await d4.click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".popup"), null, { timeout: 10000 }).catch(() => {});
    await clickThrough(4);
    // движение могло не начаться, если ИИ ходит первым — попробуем ещё раз
    const legal2 = await page.evaluate(() => window.__lairDebug().legal.length);
    if (!legal2) {
      const d4b = page.locator(".popup .die3d-holder canvas:visible").first();
      await d4b.waitFor({ timeout: 40000 }).catch(() => {});
      await d4b.click({ timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector(".popup"), null, { timeout: 10000 }).catch(() => {});
      await clickThrough(4);
    }
  }
  const pt = await page.evaluate(([cx, cz]) => window.__lairProject(cx, cz), ev.to);
  await page.mouse.click(pt.sx, pt.sy);
  await page.waitForTimeout(1400);
  if (!(await page.locator(".enc-card").count())) {
    console.warn(`WARN: encounter card did not open for '${kind}'`);
    await page.screenshot({ path: join(SHOTS, `08-enc-${kind}-miss.png`) });
    return;
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, `08-enc-${kind}.png`) });
  // бросок d20 по золотой кнопке
  await page.locator(".enc-roll").click();
  await page.waitForTimeout(3400);
  await page.screenshot({ path: join(SHOTS, `08-enc-${kind}-after.png`) });
  await clickThrough(6);
}

await shootEncounter("monster");
await shootEncounter("trap");

if (consoleErrors.length) console.warn("console errors:", consoleErrors.slice(0, 3));
await browser.close();
server.close();
console.log("SHOOT OK: encounter screens captured");
