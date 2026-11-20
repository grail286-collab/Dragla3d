
import { chromium } from "playwright";
const URL = "https://grail286-collab.github.io/Dragla3d/";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("pageerror", e => console.log("PERR:", String(e).slice(0,200)));
for (let a=1;a<=3;a++){ try{ await page.goto(URL,{waitUntil:"domcontentloaded",timeout:90000}); break;}catch(e){ console.log("retry",a); }}
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.keyboard.press("Space");
// ждём появления setup-screen в DOM
await page.waitForFunction(() => !!document.querySelector(".setup-screen"), null, { timeout: 15000 });
await page.waitForTimeout(800);
await page.locator(".setup-screen button").first().click();
await page.waitForTimeout(3500);
await page.screenshot({ path: "/tmp/preview/live-start.png" });
const skip = page.locator(".rc-skip");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(1500); }
await page.screenshot({ path: "/tmp/preview/live-board.png" });
await page.evaluate(() => window.__lairTeleport(11, 17, 0));
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/preview/live-mid.png" });
await browser.close();
console.log("LIVE SHOTS DONE");
