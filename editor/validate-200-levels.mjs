import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(decodeURIComponent(new URL(import.meta.url).pathname)), "..");
const dir = path.join(root, "level_configs_200");
const report = JSON.parse(fs.readFileSync(path.join(dir, "generation_report.json"), "utf8"));
const files = fs.readdirSync(dir).filter(name => /^Level_\d{3}\.json$/.test(name)).sort();
const errors = [];
const counts = {};
const colorUsageCounts = Array(8).fill(0);
let totalTargetHidden = 0;
let totalMapHidden = 0;

if (files.length !== 200) errors.push(`expected 200 files, got ${files.length}`);
if (report.length !== 200) errors.push(`expected 200 report rows, got ${report.length}`);

files.forEach((file, index) => {
  const expectedLevel = index + 1;
  const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  if (data.Level !== expectedLevel) errors.push(`${file}: Level mismatch`);
  if (!Array.isArray(data.TargetColumns) || data.TargetColumns.length < 2 || data.TargetColumns.length > 5) errors.push(`${file}: TargetColumns out of range`);
  if (!Array.isArray(data.MapColumns) || data.MapColumns.length < 2 || data.MapColumns.length > 5) errors.push(`${file}: MapColumns out of range`);
  const usedColors = new Set([
    ...data.TargetColumns.flat(),
    ...data.MapColumns.flat().map(segment => segment[0])
  ]);
  const row = report.find(item => item.Level === expectedLevel);
  if (row && usedColors.size !== row.Colors) errors.push(`${file}: expected ${row.Colors} colors, got ${usedColors.size}`);
  usedColors.forEach(color => {
    if (!Number.isInteger(color) || color < 0 || color >= colorUsageCounts.length) errors.push(`${file}: invalid color id ${color}`);
    else colorUsageCounts[color] += 1;
  });
  const targetHidden = data.TargetHidden?.length || 0;
  const mapHidden = data.MapHidden?.length || 0;
  totalTargetHidden += targetHidden;
  totalMapHidden += mapHidden;
  if (expectedLevel < 10 && mapHidden) errors.push(`${file}: map hiding starts too early`);
  if (expectedLevel < 15 && targetHidden) errors.push(`${file}: target hiding starts too early`);
  if (row) counts[row.Difficulty] = (counts[row.Difficulty] || 0) + 1;
});

const colorSpread = Math.max(...colorUsageCounts) - Math.min(...colorUsageCounts);
if (colorSpread > 8) errors.push(`color usage is too uneven: spread ${colorSpread}`);

if (errors.length) {
  console.error(JSON.stringify({ errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  files: files.length,
  reportRows: report.length,
  difficultyCounts: counts,
  colorUsageCounts,
  colorUsageSpread: colorSpread,
  totalTargetHidden,
  totalMapHidden,
  firstMapHiddenLevel: files.map((file, i) => ({ file, data: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) })).find(item => item.data.MapHidden?.length)?.data.Level || null,
  firstTargetHiddenLevel: files.map((file, i) => ({ file, data: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) })).find(item => item.data.TargetHidden?.length)?.data.Level || null
}, null, 2));
