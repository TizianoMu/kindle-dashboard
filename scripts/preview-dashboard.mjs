// Renders the dashboard on the host and opens the result as PNGs in a browser.
// No Kindle, no ImageMagick, no Python: the renderer writes P5 PGM and this
// script re-encodes it with node:zlib.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.PREVIEW_DIR || "/tmp/kdash-preview";
const fixture = process.env.PREVIEW_FIXTURE || "kindle/native/fixtures/dashboard-data.json";
const binary = "kindle/native/build/kindle-dashboard-local";

// "home" is the default screen; the rest are only reachable by touch on device.
const allViews = ["home", "challenge", "grocery", "chores", "recipe", "meal-recipe"];
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const views = requested.length > 0 ? requested : allViews;
const openBrowser = !process.argv.includes("--no-open");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// Grayscale PGM (P5, maxval 255) -> 8-bit grayscale PNG.
function pgmToPng(pgm) {
  const header = /^P5\s+(\d+)\s+(\d+)\s+(\d+)\s/.exec(pgm.subarray(0, 64).toString("latin1"));
  if (!header) throw new Error("not a binary P5 PGM");
  const [matched, w, h] = [header[0], Number(header[1]), Number(header[2])];
  const pixels = pgm.subarray(matched.length);

  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (w + 1)] = 0; // filter: none
    pixels.copy(raw, y * (w + 1) + 1, y * w, y * w + w);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

execFileSync("make", ["-C", "kindle/native", "local"], { cwd: repoRoot, stdio: "inherit" });
mkdirSync(outDir, { recursive: true });

const rendered = [];
for (const view of views) {
  const pgm = path.join(outDir, `${view}.pgm`);
  const args = ["--render", fixture, "--save-pgm", pgm];
  if (view !== "home") args.push("--view", view);
  // cwd must be the repo root: asset paths fall back to kindle/kual/... relatively.
  execFileSync(path.join(repoRoot, binary), args, { cwd: repoRoot, stdio: "ignore" });
  const png = path.join(outDir, `${view}.png`);
  writeFileSync(png, pgmToPng(readFileSync(pgm)));
  rendered.push(view);
  console.log(`rendered ${view} -> ${png}`);
}

const cards = rendered
  .map((v) => `<figure><img src="${v}.png?t=${Date.now()}"><figcaption>${v}</figcaption></figure>`)
  .join("\n  ");
const indexPath = path.join(outDir, "index.html");
writeFileSync(
  indexPath,
  `<!doctype html>
<meta charset="utf-8">
<title>kdashboard preview</title>
<style>
  body { background:#333; color:#eee; font:14px system-ui, sans-serif; margin:0; padding:24px; }
  h1 { font-size:15px; font-weight:600; margin:0 0 16px; }
  .grid { display:flex; flex-wrap:wrap; gap:24px; }
  figure { margin:0; }
  figcaption { text-align:center; padding:6px 0; font-family:monospace; }
  img { display:block; width:380px; height:auto; background:#fff; border:1px solid #666; }
</style>
<h1>kdashboard preview &middot; ${fixture} &middot; reload after re-running the script</h1>
<div class="grid">
  ${cards}
</div>
`,
);
console.log(`\n${indexPath}`);

if (openBrowser) {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [indexPath], { detached: true, stdio: "ignore" }).unref();
}
