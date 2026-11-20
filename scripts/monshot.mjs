
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
await page.waitForTimeout(5000);
await page.evaluate(() => { const el = document.querySelector(".setup-screen"); if (el) { el.style.transition="none"; el.style.opacity="0"; el.style.pointerEvents="none"; } });
await page.waitForTimeout(500);
// телепорт к монстру
const ev = await page.evaluate(() => {
  const st = window.__lairDebug();
  const e = st.events.find(x => x.kind === "monster");
  const dirs = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  for (const [dx,dz,bit] of dirs) if (e.open & bit) return { from: [e.x+dx,e.z+dz], to: [e.x,e.z] };
});
await page.evaluate(([x,z]) => window.__lairTeleport(x, z, 0), ev.from);
await page.waitForTimeout(1500);
for (let i = 0; i < 6; i++) {
  if (!(await page.locator(".popup").count())) break;
  const d = page.locator(".popup .die3d-holder canvas:visible").first();
  if (await d.count()) { await d.click().catch(()=>{}); await page.waitForTimeout(4000); }
  else { await page.locator(".popup button:visible").first().click().catch(()=>{}); await page.waitForTimeout(1000); }
}
const pt = await page.evaluate(([cx,cz]) => window.__lairProject(cx, cz), ev.to);
await page.mouse.click(pt.sx, pt.sy);
await page.waitForTimeout(2000);
await page.screenshot({ path: "/tmp/preview/monster-enc.png" });
await browser.close();
console.log("MONSTER SHOT DONE");
