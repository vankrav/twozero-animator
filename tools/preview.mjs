// Показывает клип в терминале: кадры рядом друг с другом, ASCII 16×16.
// Так анимацию видно и проверяемо без браузера.
//
//   node tools/preview.mjs run
//   node tools/preview.mjs            — список клипов
//   node tools/preview.mjs run --gif  — заодно положить GIF в /tmp и открыть
import fs from "node:fs";
import { builtinClips, ascii, validateClip, totalTicks, clipToGIF, N } from "./lib.mjs";

const clips = builtinClips();
const name = process.argv[2];
const wantGif = process.argv.includes("--gif");

if (!name || !clips[name]) {
  if (name) console.error(`Нет клипа "${name}".\n`);
  console.log("Клипы:\n");
  for (const [n, c] of Object.entries(clips)) {
    const ticks = totalTicks(c);
    console.log(`  ${n.padEnd(14)} ${String(c.frames.length).padStart(2)} кадр(ов)  `
      + `${String(c.fps).padStart(2)} fps  цикл ${(ticks / c.fps).toFixed(2)}s`
      + (c.loop ? "" : "  (без повтора)"));
  }
  console.log("\nnode tools/preview.mjs <клип>");
  process.exit(name ? 1 : 0);
}

const clip = clips[name];
const problems = validateClip(name, clip);
if (problems.length) {
  console.error("Клип не проходит проверку:\n" + problems.map(p => "  " + p).join("\n"));
  process.exit(1);
}

const rows = clip.frames.map(p => ascii(p));
const GAP = "  ";
const head = clip.frames.map((p, i) => {
  const tag = `${i + 1}${(p.hold || 1) > 1 ? "×" + p.hold : ""}${p.flip ? " ⇄" : ""}`
    + (p.ox || p.oy ? ` ${p.ox || 0},${p.oy || 0}` : "");
  return tag.padEnd(N, " ").slice(0, N);
}).join(GAP);

console.log(`\n${name} — ${clip.frames.length} кадр(ов), ${clip.fps} fps, `
  + `цикл ${(totalTicks(clip) / clip.fps).toFixed(2)}s${clip.loop ? ", зациклен" : ""}\n`);
console.log(head);
for (let y = 0; y < N; y++) console.log(rows.map(r => r[y]).join(GAP));

// что меняется от кадра к кадру — быстрая проверка, что цикл вообще движется
const keys = ["armL", "armR", "legL", "legR", "eyeL", "eyeR"];
const moving = keys.filter(k => new Set(clip.frames.map(p => p[k])).size > 1);
const shifts = new Set(clip.frames.map(p => `${p.ox || 0},${p.oy || 0}`));
console.log("\nменяется: " + (moving.length ? moving.join(", ") : "— ничего")
  + (shifts.size > 1 ? ", сдвиг" : "")
  + (new Set(clip.frames.map(p => !!p.flip)).size > 1 ? ", зеркало" : ""));

const holds = clip.frames.map(p => p.hold || 1);
console.log("длительности: [" + holds.join(", ") + "]"
  + (holds.every(h => h === holds[0]) ? " — равномерные, годятся для CSS steps()" : " — разные, для CSS steps() не подойдёт"));

if (wantGif) {
  const out = `/tmp/twozero-${name}.gif`;
  fs.writeFileSync(out, Buffer.from(clipToGIF(clip, 8, false)));
  console.log("\nGIF: " + out);
}
