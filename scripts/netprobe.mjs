
import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu-sandbox", "--use-gl=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const interesting = [];
page.on("response", (r) => {
  const u = r.url();
  if (/\.(glb|png)/i.test(u) && !u.includes("background") && !u.includes("avatars")) {
    interesting.push(`${r.status()} ${u.replace("https://grail286-collab.github.io/Dragla3d/","")} ${r.headers()["content-length"]||"?"}b`);
  }
});
page.on("requestfailed", (r) => {
  if (/\.(glb|png)/i.test(r.url())) interesting.push(`FAILED ${r.url().slice(-40)} ${r.failure()?.errorText}`);
});
await page.goto("https://grail286-collab.github.io/Dragla3d/", { waitUntil: "domcontentloaded", timeout: 40000 }).catch(e => console.log("goto:", String(e).slice(0,80)));
await page.waitForTimeout(25000);
const check = await page.evaluate(async () => {
  const out = [];
  for (const p of ["textures/tiles.png", "models/hero1.glb"]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const r = await fetch(p, { signal: ctrl.signal });
      const buf = await r.arrayBuffer();
      clearTimeout(t);
      out.push(`${p}: ${r.status} ${buf.byteLength}b`);
    } catch (e) { out.push(`${p}: FAIL ${String(e).slice(0,50)}`); }
  }
  return out;
}).catch(e => ["eval fail " + String(e).slice(0,60)]);
console.log("PAGE FETCH:", JSON.stringify(check));
console.log("ASSET RESPONSES:", interesting.length ? interesting.join("\n") : "none captured");
await browser.close();
console.log("NETPROBE DONE");
