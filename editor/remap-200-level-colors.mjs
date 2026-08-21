import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "..");
const dir = path.join(root, "level_configs_200");
const colorRing = [0, 8, 5, 2, 9, 6, 3, 10, 1, 7, 4, 11];
const colorUsage = Array(12).fill(0);
let slotsBefore = 0;

function usedColorIds(level) {
  return [...new Set([
    ...level.TargetColumns.flat(),
    ...level.MapColumns.flat().map(segment => segment[0])
  ])].sort((a, b) => a - b);
}

for (let levelNumber = 1; levelNumber <= 200; levelNumber += 1) {
  const file = path.join(dir, `Level_${String(levelNumber).padStart(3, "0")}.json`);
  const level = JSON.parse(fs.readFileSync(file, "utf8"));
  const oldIds = usedColorIds(level);
  const newIds = Array.from({ length: oldIds.length }, (_, index) => colorRing[(slotsBefore + index) % colorRing.length]);
  const colorMap = new Map(oldIds.map((id, index) => [id, newIds[index]]));
  const beforeTarget = JSON.stringify(level.TargetColumns.map(column => column.length));
  const beforeMap = JSON.stringify(level.MapColumns.map(column => column.map(segment => segment[1])));

  level.TargetColumns = level.TargetColumns.map(column => column.map(color => colorMap.get(color)));
  level.MapColumns = level.MapColumns.map(column => column.map(([color, count]) => [colorMap.get(color), count]));

  if (JSON.stringify(level.TargetColumns.map(column => column.length)) !== beforeTarget
    || JSON.stringify(level.MapColumns.map(column => column.map(segment => segment[1]))) !== beforeMap
    || usedColorIds(level).length !== oldIds.length) {
    throw new Error(`Level ${levelNumber}: color remap changed its configuration`);
  }

  newIds.forEach(color => {
    colorUsage[color] += 1;
  });
  slotsBefore += oldIds.length;
  fs.writeFileSync(file, `${JSON.stringify(level, null, 2)}\n`);
}

const reportPath = path.join(dir, "generation_report.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
slotsBefore = 0;
report.forEach(row => {
  const colorIds = Array.from({ length: row.Colors }, (_, index) => colorRing[(slotsBefore + index) % colorRing.length]);
  row.ColorIds = colorIds;
  slotsBefore += row.Colors;
});
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(JSON.stringify({ colorUsage, spread: Math.max(...colorUsage) - Math.min(...colorUsage) }, null, 2));
