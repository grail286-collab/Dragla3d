/**
 * preview-deployed.mjs — снять превью-скриншоты с ЖИВОГО деплоя
 * https://grail286-collab.github.io/Dragla3d/
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const URL = "https://grail286-collab.github.io/Dragla3d/";
const OUT = "/tmp/preview";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("pageerror", (e) => console.warn("pageerror:", String(e).slice(0, 120)));

for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 90000 });
    break;
  } catch (e) {
    console.warn(`goto attempt ${attempt} failed: ${String(e).slice(0, 80)}`);
    if (attempt === 4) throw e;
    await page.waitForTimeout(5000);
  }
}
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, "01-title.png") });

// setup screen
await page.keyboard.press("Space");
await page.waitForTimeout(900);
await page.screenshot({ path: join(OUT, "02-setup.png") });

// start → d4 popup
await page.locator(".setup-screen button:has-text('Начать игру')").click();
await page.waitForTimeout(1600);
await page.locator(".popup .die3d-holder canvas").first().waitFor({ timeout: 15000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, "03-d4-popup.png") });

// roll → movement highlights
await page.locator(".popup .die3d-holder canvas").first().click();
await page.waitForFunction(() => !document.querySelector(".popup"), null, { timeout: 12000 });
await page.waitForTimeout(700);
await page.screenshot({ path: join(OUT, "04-movement.png") });

async function clickThrough(max = 8) {
  for (let i = 0; i < max; i++) {
    if (!(await page.locator(".popup").count())) return;
    try {
      const d = page.locator(".popup .die3d-holder canvas:visible").first();
      if (await d.count()) { await d.click({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(2900); continue; }
      const stay = page.locator(".popup button:has-text('Остаться'):visible").first();
      const btn = (await stay.count()) ? stay : page.locator(".popup button:visible").first();
      if (!(await btn.count())) return;
      await btn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(900);
    } catch { /* попап закрылся */ }
  }
}

async function shootEncounter(kind, file) {
  const ev = await page.evaluate((k) => {
    const st = window.__lairDebug();
    const e = st.events.find((x) => x.kind === k);
    if (!e) return null;
    const dirs = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
    for (const [dx, dz, bit] of dirs) {
      if (e.open & bit) return { from: [e.x + dx, e.z + dz], to: [e.x, e.z] };
    }
    return null;
  }, kind);
  if (!ev) { console.warn("no event", kind); return; }

  await page.evaluate(([x, z]) => window.__lairTeleport(x, z, 0), ev.from);
  await page.waitForTimeout(800);
  await clickThrough(4);
  const legal = await page.evaluate(() => window.__lairDebug().legal.length);
  if (!legal) {
    const endBtn = page.locator(".hud-bottom button:has-text('Завершить ход'):visible").first();
    if (await endBtn.count()) { await endBtn.click().catch(() => {}); await page.waitForTimeout(600); }
    const d4 = page.locator(".popup .die3d-holder canvas:visible").first();
    await d4.waitFor({ timeout: 60000 }).catch(() => {});
    await d4.click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => !document.querySelector(".popup"), null, { timeout: 12000 }).catch(() => {});
    await clickThrough(4);
  }
  const pt = await page.evaluate(([cx, cz]) => window.__lairProject(cx, cz), ev.to);
  await page.mouse.click(pt.sx, pt.sy);
  await page.waitForTimeout(1500);
  if (!(await page.locator(".enc-card").count())) {
    console.warn("encounter did not open:", kind);
    return;
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, file) });
  await page.locator(".enc-roll").click();
  await page.waitForTimeout(3600);
  await clickThrough(6);
}

await shootEncounter("monster", "05-battle.png");
await shootEncounter("trap", "06-trap.png");

// overview board
await page.evaluate(() => { window.__lairTeleport(11, 8, 0); });
await page.waitForTimeout(900);
await clickThrough(3);
await page.screenshot({ path: join(OUT, "07-board.png") });

await browser.close();
console.log("PREVIEW OK");
