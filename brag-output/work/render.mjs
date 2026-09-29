// Rendu image par image de composition.html (chaque image = render(t)).
// node render.mjs stills 1.0,2.5,…   → work/stills/t-XX.png
// node render.mjs video               → work/video.mp4 (sans son)
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const FFMPEG = "/usr/local/lib/python3.11/dist-packages/imageio_ffmpeg/binaries/ffmpeg-linux-x86_64-v7.0.2";
const here = new URL(".", import.meta.url).pathname;
const [mode = "stills", list = ""] = process.argv.slice(2);
const FPS = 30, END = 22.8;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--force-color-profile=srgb"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`file://${here}composition.html`);
await page.evaluate(() => window.ready);
await page.waitForTimeout(300);

const frame = async (t) => { await page.evaluate((t) => window.render(t), t); return page.screenshot({ type: "png" }); };

if (mode === "stills") {
  mkdirSync(`${here}stills`, { recursive: true });
  for (const t of list.split(",").map(Number)) {
    await page.evaluate((t) => window.render(t), t);
    await page.screenshot({ path: `${here}stills/t-${t.toFixed(2)}.png` });
  }
} else {
  const n = Math.round(END * FPS);
  const ff = spawn(FFMPEG, ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${here}video.mp4`]);
  ff.stderr.on("data", (d) => process.stderr.write(d));
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    const buf = await frame(i / FPS);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 60 === 0) console.log(`image ${i}/${n} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
}
console.log("erreurs :", JSON.stringify(errors.slice(0, 5)));
await browser.close();
