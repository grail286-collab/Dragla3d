
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const DIST = "/tmp/deploy/dist";
const MIME = { ".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".glb":"model/gltf-binary",".jpeg":"image/jpeg",".webp":"image/webp" };
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
await page.screenshot({ path: "/tmp/preview/local-start.png" });
// угол 0,0
await page.evaluate(() => window.__lairTeleport(1, 1, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/local-c1.png" });
// угол 0,18
await page.evaluate(() => window.__lairTeleport(1, 18, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/local-c2.png" });
// угол 18,0
await page.evaluate(() => window.__lairTeleport(18, 1, 0));
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/local-c3.png" });
await browser.close(); server.close();
console.log("LOCAL SHOTS DONE");
