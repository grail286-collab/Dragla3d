
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("C:", m.text().slice(0, 180)); });
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));
for (let a = 1; a <= 3; a++) {
  try { await page.goto("https://grail286-collab.github.io/Dragla3d/", { waitUntil: "domcontentloaded", timeout: 90000 }); break; }
  catch (e) { console.log("goto retry", a); }
}
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 60000 }).catch(() => console.log("not ready"));
await page.waitForTimeout(2500);
await page.keyboard.press("Space");
await page.waitForTimeout(2500);
const state = await page.evaluate(() => ({
  ready: window.__GAME_READY__,
  setup: !!document.querySelector(".setup-screen"),
  title: !!document.querySelector(".title-screen"),
  banner: document.querySelector(".turn-banner")?.textContent,
  canvases: document.querySelectorAll("canvas").length,
}));
console.log("STATE:", JSON.stringify(state));
await page.screenshot({ path: "/tmp/preview/dbg.png" });
await browser.close();
console.log("DBG DONE");
