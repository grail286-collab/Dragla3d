
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const DIST = "/tmp/deploy/dist";
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".glb":"model/gltf-binary",".jpeg":"image/jpeg" };
const server = createServer(async (req,res)=>{ try { let p = req.url==="/"?"/index.html":req.url.split("?")[0];
  const f = resolve(DIST,"."+p); if(!f.startsWith(DIST+sep)){res.writeHead(403).end();return;}
  const d = await readFile(f); res.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"}); res.end(d);} catch{res.writeHead(404).end();} });
await new Promise(r=>server.listen(0,r));
const browser = await chromium.launch({ executablePath:"/usr/bin/chromium", args:["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport:{width:420,height:860} });
page.on("pageerror", e => console.log("PERR:", String(e).slice(0,200)));
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(800);
await page.keyboard.press("Space");
await page.waitForTimeout(700);
await page.locator(".setup-screen button:has-text('Начать игру')").click();
const die = page.locator(".popup .die3d-holder canvas").first();
await die.waitFor({ timeout: 15000 });
await die.click();
await page.waitForFunction(() => (document.querySelector(".die-result")?.textContent || "").length > 0, null, { timeout: 25000 });
// телепорт к монстру
const ev = await page.evaluate(() => {
  const st = window.__lairDebug();
  const e = st.events.find(x => x.kind === "monster");
  const dirs = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  for (const [dx,dz,bit] of dirs) if (e.open & bit) return { from: [e.x+dx,e.z+dz], to: [e.x,e.z] };
});
await page.waitForTimeout(1500);
await page.evaluate(([x,z]) => window.__lairTeleport(x, z, 0), ev.from);
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i++) {
  if (!(await page.locator(".popup").count())) break;
  const d = page.locator(".popup .die3d-holder canvas:visible").first();
  if (await d.count()) { await d.click().catch(()=>{}); await page.waitForTimeout(6000); }
  else { await page.locator(".popup button:visible").first().click().catch(()=>{}); await page.waitForTimeout(1500); }
}
const pt = await page.evaluate(([cx,cz]) => window.__lairProject(cx, cz), ev.to);
await page.mouse.click(pt.sx, pt.sy);
await page.waitForTimeout(2500);
await page.locator(".enc-roll").click();
for (let i = 1; i <= 10; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => document.querySelector(".enc-result")?.textContent || "");
  if (st) { console.log("ENC:", st); await page.screenshot({ path: "/tmp/preview/face-d20.png" }); break; }
}
await browser.close(); server.close();
console.log("D20 DONE");
