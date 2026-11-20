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
await page.waitForTimeout(1500);
await page.evaluate(() => { const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes("Начать")); if (btn) btn.click(); });

const killUI = async () => {
  await page.evaluate(() => {
    document.querySelectorAll(".setup-screen, .ui-layer, .dice-overlay, .encounter-overlay, .info-overlay, .pause-overlay, .top-bar, .bottom-bar").forEach(e => e.remove());
  });
  await page.waitForTimeout(200);
};

// shot 1: overview (1.5s after start)
await page.waitForTimeout(1500);
await killUI();
await page.screenshot({ path: "/tmp/preview/intro-overview.png" });

// shot 2: lair focus (2s later = 3.5s after start)
await page.waitForTimeout(2000);
await killUI();
await page.screenshot({ path: "/tmp/preview/intro-lair.png" });

// shot 3: player focus (2.5s later = 6s after start)
await page.waitForTimeout(2500);
await killUI();
await page.screenshot({ path: "/tmp/preview/intro-player.png" });

await browser.close(); server.close();
console.log("SHOTS DONE");
