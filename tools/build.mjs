// Пересобирает всё, что выводится из index.html:
//   twozero-sprite.js · animations.json · clips/*.svg · clips/*.gif · demo/assets/*
// Запускать после любой правки геометрии или библиотеки клипов.
//
//   node tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  ROOT, N, builtinClips, poseCells, projectJSON, jsModule,
  clipToSVG, clipToGIF, validateClip,
} from "./lib.mjs";

const clips = builtinClips();

// ── 1. проверка клипов ────────────────────────────────────────
const problems = Object.entries(clips).flatMap(([n, c]) => validateClip(n, c));
if (problems.length) {
  console.error("Сборка остановлена, клипы не проходят проверку:\n"
    + problems.map(p => "  " + p).join("\n"));
  process.exit(1);
}

// ── 2. модуль и JSON ──────────────────────────────────────────
fs.writeFileSync(path.join(ROOT, "twozero-sprite.js"), jsModule());
fs.writeFileSync(path.join(ROOT, "animations.json"), JSON.stringify(projectJSON(), null, 2) + "\n");

// ── 3. клипы в SVG и GIF ──────────────────────────────────────
const clipsDir = path.join(ROOT, "clips");
fs.mkdirSync(clipsDir, { recursive: true });
for (const f of fs.readdirSync(clipsDir)) fs.unlinkSync(path.join(clipsDir, f));
for (const [name, c] of Object.entries(clips)) {
  fs.writeFileSync(path.join(clipsDir, name + ".svg"), clipToSVG(c, false));
  fs.writeFileSync(path.join(clipsDir, name + ".gif"), Buffer.from(clipToGIF(c, 8, false)));
}

// ── 4. PNG-лист для демо (минимальный кодировщик, без зависимостей) ──
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = b => {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function pngRGBA(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;                                   // 8 бит на канал, RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++)
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function sheetPNG(clip, hex) {
  const n = clip.frames.length, W = N * n;
  const rgba = Buffer.alloc(W * N * 4);                        // по умолчанию прозрачно
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  clip.frames.forEach((p, i) => {
    for (const [x, y] of poseCells(p)) {
      const o = (y * W + i * N + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  });
  return pngRGBA(W, N, rgba);
}

// ── 5. ассеты демо — прозрачные, чтобы садились на любой фон ──
const demo = path.join(ROOT, "demo", "assets");
fs.mkdirSync(demo, { recursive: true });
fs.writeFileSync(path.join(demo, "run.svg"), clipToSVG(clips.run, true));
fs.writeFileSync(path.join(demo, "idle.svg"), clipToSVG(clips.idle, true));
fs.writeFileSync(path.join(demo, "run.gif"), Buffer.from(clipToGIF(clips.run, 8, true)));
fs.writeFileSync(path.join(demo, "run-sheet.png"), sheetPNG(clips.run, "#3B0000"));

// ── 6. самопроверка: собранное должно совпадать с исходником ──
const names = Object.keys(clips);
const json = JSON.parse(fs.readFileSync(path.join(ROOT, "animations.json"), "utf8"));
const jsonNames = Object.keys(json.clips || {});
if (jsonNames.length !== names.length)
  fail(`в animations.json ${jsonNames.length} клипов вместо ${names.length}`);

const mod = (await import(path.join(ROOT, "twozero-sprite.js") + "?v=" + Date.now())).default
  ?? (await import("node:module")).createRequire(import.meta.url)(path.join(ROOT, "twozero-sprite.js"));
if (Object.keys(mod.clips).length !== names.length)
  fail(`в twozero-sprite.js ${Object.keys(mod.clips).length} клипов вместо ${names.length}`);

const key = cells => cells.map(c => c.join(",")).sort().join(" ");
let checked = 0;
for (const n of names) for (const p of clips[n].frames) {
  if (key(mod.cells(p)) !== key(poseCells(p))) fail(`кадр клипа "${n}" рисуется модулем иначе, чем редактором`);
  checked++;
}
for (const n of names) {
  for (const ext of ["svg", "gif"]) {
    const size = fs.statSync(path.join(clipsDir, `${n}.${ext}`)).size;
    if (size < 200) fail(`clips/${n}.${ext} подозрительно мал: ${size} б`);
  }
}
function fail(msg) { console.error("Сборка испорчена: " + msg); process.exit(1); }

const holds = clips.run.frames.map(p => p.hold || 1);
if (!holds.every(h => h === holds[0]))
  console.warn("! у клипа run разные длительности кадров — пример с CSS steps() в demo/ станет неверным");

console.log(`Собрано: ${Object.keys(clips).length} клипов, сверено кадров: ${checked}`);
console.log("  twozero-sprite.js, animations.json");
console.log("  clips/ — " + fs.readdirSync(clipsDir).length + " файлов");
console.log("  demo/assets/ — " + fs.readdirSync(demo).join(", "));
