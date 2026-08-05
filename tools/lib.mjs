// Единственный источник правды — index.html: там живут и геометрия спрайта,
// и библиотека клипов. Остальные файлы репозитория из них генерируются.
// Здесь мы вытаскиваем нужные функции прямо из редактора, чтобы код не разъезжался.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SRC = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const JS = SRC.slice(SRC.indexOf("<script>") + 8, SRC.lastIndexOf("</script>"));

function grabFn(name) {
  const start = JS.indexOf("function " + name + "(");
  if (start < 0) throw new Error("в index.html не найдена функция " + name);
  let depth = 0;
  for (let i = JS.indexOf("{", start); i < JS.length; i++) {
    if (JS[i] === "{") depth++;
    else if (JS[i] === "}") { depth--; if (depth === 0) return JS.slice(start, i + 1); }
  }
  throw new Error("не закрылась функция " + name);
}

const MODULE = [
  JS.slice(JS.indexOf("const N = 16;"), JS.indexOf("const LIMBS =")),
  'const LIMBS = ["armL","armR","legL","legR"];',
  'const GAZE = ["tl","tr","bl","br"];',
  "const D = 'down', U = 'up';",
  // projectJSON() читает state.clips — без них animations.json собирается пустым
  "const state = { clips: builtinClips(), palette: { bg: '#DB0000', fg: '#3B0000' } };",
  "const fmt = v => (Math.round(v*10000)/10000).toString();",
  "const totalTicks = c => c.frames.reduce((a,fr)=>a+Math.max(1,fr.hold||1),0);",
  grabFn("f"), grabFn("builtinClips"), grabFn("poseCells"), grabFn("cellsToRects"),
  grabFn("projectJSON"), grabFn("jsModule"), grabFn("clipToSVG"),
  grabFn("lzwBytes"), grabFn("clipToGIF"),
  "export { N, BODY, PARTS, EYES, LIMBS, GAZE, builtinClips, poseCells, cellsToRects,",
  "         projectJSON, jsModule, clipToSVG, clipToGIF, totalTicks };",
].join("\n");

const CACHE = path.join(ROOT, "tools", ".extracted.mjs");
fs.writeFileSync(CACHE, MODULE);
const api = await import(CACHE + "?v=" + MODULE.length);
fs.unlinkSync(CACHE);

export const {
  N, BODY, PARTS, EYES, LIMBS, GAZE,
  builtinClips, poseCells, cellsToRects, projectJSON, jsModule,
  clipToSVG, clipToGIF, totalTicks,
} = api;

/** Кадр как ASCII 16×16: █ — закрашено, · — фон. Так поза видна без браузера. */
export function ascii(pose, filled = "█", empty = "·") {
  const grid = Array.from({ length: N }, () => Array(N).fill(empty));
  for (const [x, y] of poseCells(pose)) grid[y][x] = filled;
  return grid.map(r => r.join(""));
}

/** Проверка позы на валидность. Возвращает список проблем — пустой, если всё хорошо. */
export function validatePose(pose, where = "кадр") {
  const bad = [];
  for (const k of LIMBS) {
    if (!["down", "up", "off"].includes(pose[k]))
      bad.push(`${where}: ${k} = ${JSON.stringify(pose[k])}, ожидалось down | up | off`);
  }
  for (const k of ["eyeL", "eyeR"]) {
    if (![...GAZE, "off", "shut"].includes(pose[k]))
      bad.push(`${where}: ${k} = ${JSON.stringify(pose[k])}, ожидалось tl | tr | bl | br | off | shut`);
  }
  for (const k of ["ox", "oy"]) {
    const v = pose[k] ?? 0;
    if (!Number.isInteger(v) || v < -8 || v > 8)
      bad.push(`${where}: ${k} = ${v}, ожидалось целое от -8 до 8`);
  }
  const h = pose.hold ?? 1;
  if (!Number.isInteger(h) || h < 1) bad.push(`${where}: hold = ${h}, ожидалось целое ≥ 1`);
  if (pose.flip !== undefined && typeof pose.flip !== "boolean")
    bad.push(`${where}: flip = ${JSON.stringify(pose.flip)}, ожидалось true | false`);
  return bad;
}

export function validateClip(name, clip) {
  const bad = [];
  if (!clip || !Array.isArray(clip.frames) || !clip.frames.length)
    return [`клип "${name}": нет кадров`];
  if (!Number.isInteger(clip.fps) || clip.fps < 1 || clip.fps > 60)
    bad.push(`клип "${name}": fps = ${clip.fps}, ожидалось целое от 1 до 60`);
  if (typeof clip.loop !== "boolean")
    bad.push(`клип "${name}": loop = ${JSON.stringify(clip.loop)}, ожидалось true | false`);
  clip.frames.forEach((p, i) => bad.push(...validatePose(p, `клип "${name}", кадр ${i + 1}`)));
  return bad;
}
