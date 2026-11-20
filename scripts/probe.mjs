
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text().slice(0, 150)));
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 200)));
const t0 = Date.now();
await page.goto("https://grail286-collab.github.io/Dragla3d/", { waitUntil: "domcontentloaded", timeout: 60000 });
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(5000);
  const ready = await page.evaluate(() => window.__GAME_READY__);
  const probe = await page.evaluate(() => {
    const p = window.__gameProbe && window.__gameProbe();
    return p ? JSON.stringify(p) : "no probe";
  }).catch((e) => "eval fail: " + String(e).slice(0, 80));
  console.log(`t=${((Date.now()-t0)/1000).toFixed(0)}s ready=${ready} probe=${probe}`);
  if (ready) break;
}
await page.screenshot({ path: "/tmp/preview/probe.png" });
await browser.close();
console.log("PROBE DONE");
