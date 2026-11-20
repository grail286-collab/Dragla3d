
import { chromium } from "playwright";
const URL = "https://grail286-collab.github.io/Dragla3d/";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("pageerror", e => console.log("PERR:", String(e).slice(0,200)));
for (let a=1;a<=3;a++){ try{ await page.goto(URL,{waitUntil:"domcontentloaded",timeout:90000}); break;}catch(e){ console.log("retry",a); }}
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.keyboard.press("Space");
await page.waitForTimeout(1000);
await page.locator(".setup-screen button").first().click();
await page.waitForTimeout(6000);
await page.evaluate(() => { const el = document.querySelector(".setup-screen"); if (el) { el.style.transition="none"; el.style.opacity="0"; el.style.pointerEvents="none"; } });
await page.waitForTimeout(500);
await page.screenshot({ path: "/tmp/preview/gh-start.png" });
await page.evaluate(() => window.__lairTeleport(1, 1, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/gh-c1.png" });
await page.evaluate(() => window.__lairTeleport(1, 18, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/gh-c2.png" });
await page.evaluate(() => window.__lairTeleport(18, 1, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/gh-c3.png" });
await browser.close();
console.log("GH SHOTS DONE");
