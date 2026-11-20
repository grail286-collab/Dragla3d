
import { chromium } from "playwright";
const URL = "https://grail286-collab.github.io/Dragla3d/";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("console", m => console.log("C:", m.type(), m.text().slice(0,180)));
page.on("pageerror", e => console.log("PERR:", String(e).slice(0,200)));
for (let a=1;a<=3;a++){ try{ await page.goto(URL,{waitUntil:"domcontentloaded",timeout:90000}); break;}catch(e){ console.log("retry",a); }}
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/preview/diag.png" });
const html = await page.content();
console.log("HTML len:", html.length);
console.log("has setup:", html.includes("setup-screen"));
console.log("has title:", html.includes("title-screen"));
console.log("has popup:", html.includes("popup"));
const state = await page.evaluate(() => ({
  ready: window.__GAME_READY__,
  body: document.body.innerHTML.slice(0,400),
}));
console.log("STATE:", JSON.stringify(state));
await browser.close();
