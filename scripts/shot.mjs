
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
await page.waitForTimeout(1000);
await page.keyboard.press("Space");
await page.waitForTimeout(700);
await page.locator(".setup-screen button:has-text('Начать игру')").click();
await page.waitForTimeout(2500);
await page.screenshot({ path: "/tmp/preview/edge-start.png" });
// телепорт к середине, край на юге
await page.evaluate(() => window.__lairTeleport(11, 17, 0));
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/preview/edge-mid.png" });
await browser.close(); server.close();
console.log("SHOTS DONE");
