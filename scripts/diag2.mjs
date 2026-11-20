
import { chromium } from "playwright";
const URL = "https://grail286-collab.github.io/Dragla3d/";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
page.on("console", m => { if (m.type()==="error") console.log("CERR:", m.text().slice(0,200)); });
page.on("pageerror", e => console.log("PERR:", String(e).slice(0,200)));
for (let a=1;a<=3;a++){ try{ await page.goto(URL,{waitUntil:"domcontentloaded",timeout:90000}); break;}catch(e){ console.log("retry",a); }}
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(1200);
await page.keyboard.press("Space");
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/preview/after-space.png" });
const st = await page.evaluate(() => ({
  setup: !!document.querySelector(".setup-screen"),
  title: !!document.querySelector(".title-screen"),
  popup: !!document.querySelector(".popup"),
  html: document.body.innerHTML.slice(0,600),
}));
console.log("ST:", JSON.stringify(st));
await browser.close();
