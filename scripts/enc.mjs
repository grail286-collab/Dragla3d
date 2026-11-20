
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const DIST = "/tmp/deploy/dist";
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".jpeg":"image/jpeg",".webp":"image/webp",".glb":"model/gltf-binary" };
const server = createServer(async (req,res)=>{ try { let p = req.url==="/"?"/index.html":req.url.split("?")[0];
  const f = resolve(DIST,"."+p); if(!f.startsWith(DIST+sep)){res.writeHead(403).end();return;}
  const d = await readFile(f); res.writeHead(200,{"content-type":MIME[extname(f)]||"application/octet-stream"}); res.end(d);} catch{res.writeHead(404).end();} });
await new Promise(r=>server.listen(0,r));
const browser = await chromium.launch({ executablePath:"/usr/bin/chromium", args:["--no-sandbox","--disable-gpu-sandbox","--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__GAME_READY__ === true, null, { timeout: 30000 });
await page.waitForTimeout(1000);
await page.keyboard.press("Space");
await page.waitForTimeout(800);
await page.locator(".setup-screen button").first().click();
await page.waitForTimeout(5000);
await page.evaluate(() => { const el = document.querySelector(".setup-screen"); if (el) { el.style.transition="none"; el.style.opacity="0"; el.style.pointerEvents="none"; } });
await page.waitForTimeout(500);
// телепорт рядом с монстром, d4
const ev = await page.evaluate(() => {
  const st = window.__lairDebug();
  const e = st.events.find(x => x.kind === "monster");
  const dirs = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
  for (const [dx,dz,bit] of dirs) if (e.open & bit) return { from: [e.x+dx,e.z+dz], to: [e.x,e.z] };
});
await page.evaluate(([x,z]) => window.__lairTeleport(x, z, 0), ev.from);
await page.waitForTimeout(1500);
// закрываем d4
const skip = page.locator(".rc-skip");
if (await skip.count()) { await skip.click(); await page.waitForTimeout(1500); }
// кликаем на клетку с монстром
const pt = await page.evaluate(([cx,cz]) => window.__lairProject(cx, cz), ev.to);
await page.mouse.click(pt.sx, pt.sy);
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/preview/encounter-local.png" });
await browser.close(); server.close();
console.log("ENCOUNTER DONE");
