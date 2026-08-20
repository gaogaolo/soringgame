import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fs = require("fs");
const path = require("path");
const { chromium } = require("/Users/xmiles/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "level_configs_200");
const editorUrl = process.env.EDITOR_URL || "http://127.0.0.1:8133/index.html";
const startLevel = Number(process.env.START_LEVEL || 1);
const endLevel = Number(process.env.END_LEVEL || 200);

function allocateColumnByQuota(level, startLevel, quotas) {
  const entries = Object.entries(quotas).map(([columns, quota]) => ({
    columns: Number(columns),
    quota,
    used: 0
  }));
  const offset = level - startLevel;

  for (let index = 0; index <= offset; index += 1) {
    entries.sort((a, b) => (a.used / a.quota) - (b.used / b.quota) || a.columns - b.columns);
    entries[0].used += 1;
    if (index === offset) return entries[0].columns;
  }

  throw new Error(`No map column allocation for Level ${level}`);
}

function mapColumnCountForLevel(level) {
  if (level <= 3) return 2;
  if (level <= 15) return 3;
  // Introduce 4-column maps early, then increase their frequency in stages while
  // preserving the established overall distribution: 100 x 3-col, 80 x 4-col.
  if (level <= 80) return allocateColumnByQuota(level, 16, { 3: 40, 4: 25 });
  if (level <= 140) return allocateColumnByQuota(level, 81, { 3: 30, 4: 30 });
  if (level <= 183) return allocateColumnByQuota(level, 141, { 3: 18, 4: 25 });
  return 5;
}

function difficultyWaveScore(level) {
  const progress = (level - 1) / 199;
  const position = (level - 1) % 10;
  const recovery = [0, 3, 7].includes(position);
  const spike = [6, 9].includes(position);
  const wave = recovery ? -0.18 : (spike ? 0.07 : 0);
  return Math.max(0, Math.min(1, progress + wave));
}

function colorCountForLevel(level) {
  const score = difficultyWaveScore(level);
  return score < 0.14 ? 3 : score < 0.42 ? 4 : score < 0.72 ? 5 : 6;
}

function balancedColorIdsForLevel(level, colorCount) {
  // Lay all color slots into one rotating eight-color ring. This keeps the 200-level
  // campaign balanced globally while the seeded level generation still varies layouts.
  const colorRing = [0, 5, 2, 7, 1, 6, 3, 4];
  let slotsBefore = 0;
  for (let previousLevel = 1; previousLevel < level; previousLevel += 1) {
    slotsBefore += colorCountForLevel(previousLevel);
  }
  return Array.from({ length: colorCount }, (_, index) => colorRing[(slotsBefore + index) % colorRing.length]);
}

function levelProfile(level) {
  const progress = (level - 1) / 199;
  const chapter = Math.floor((level - 1) / 10);
  const position = (level - 1) % 10;
  const spike = [6, 9].includes(position);
  const recovery = [0, 3, 7].includes(position);
  const score = difficultyWaveScore(level);

  const hardLevels = new Set([88, 112, 136, 160, 176, 184, 192, 196]);
  const hellLevels = new Set([200]);
  let difficulty = "normal";
  if (level <= 6) difficulty = "easy";
  else if (hellLevels.has(level)) difficulty = "hell";
  else if (hardLevels.has(level)) difficulty = "hard";
  else if (level >= 22) difficulty = [0, 1, 3, 5, 7].includes(position) ? "normal" : "medium";
  else difficulty = [0, 1, 5, 8].includes(position) ? "normal" : "medium";

  const colorCount = colorCountForLevel(level);
  const targetColumns = score < 0.18 ? 2 : score < 0.52 ? 3 : score < 0.86 ? 4 : 5;
  // Keep the map focused on the 3- and 4-column core format after onboarding.
  const mapColumns = mapColumnCountForLevel(level);
  const rawTargetBoxCount = Math.max(targetColumns + 2, Math.round(6 + progress * 23 + (spike ? 1 : 0) - (recovery ? 2 : 0)));
  // Keep the late-game search space bounded while difficulty still rises through ordering,
  // finer splits, extra colors and hiding.
  const targetBoxCount = level >= 48 ? Math.min(18, rawTargetBoxCount) : rawTargetBoxCount;

  let minSplit = 2;
  let maxSplit = 6;
  if (difficulty === "easy") {
    minSplit = 3;
    maxSplit = 6;
  } else if (difficulty === "normal") {
    minSplit = 2;
    maxSplit = 5;
  } else if (difficulty === "medium") {
    minSplit = 2;
    maxSplit = 4;
  } else {
    minSplit = 2;
    maxSplit = 3;
  }

  // 17% guarantees one hidden target when the first eligible row has three boxes.
  const targetHideRatio = level < 15 ? 0 : Math.min(35, 17 + Math.floor((level - 15) * 0.1) + (spike ? 2 : 0));
  const mapHideRatio = level < 10 ? 0 : Math.min(45, 7 + Math.floor((level - 10) * 0.2) + (spike ? 4 : 0));
  const variantMode = position === 3 || position === 8 ? "spread" : (position === 6 ? "frontload" : "balanced");

  return {
    chapter,
    score,
    difficulty,
    colorCount,
    colorIds: balancedColorIdsForLevel(level, colorCount),
    targetColumns,
    mapColumns,
    targetBoxCount,
    minSplit,
    maxSplit,
    targetHideRatio,
    mapHideRatio,
    variantMode,
    seed: 810000 + level * 7919
  };
}

const difficultyOrder = ["easy", "normal", "medium", "hard", "hell"];

function retryProfile(profile, retry) {
  const difficultyIndex = difficultyOrder.indexOf(profile.difficulty);
  // Preserve the onboarding label: generation retries may lower hard tiers to normal,
  // but never turn a normal level into an extra easy level later in the campaign.
  const relaxedDifficulty = retry >= 8 && difficultyIndex > 1
    ? difficultyOrder[difficultyIndex - 1]
    : profile.difficulty;
  const boxReduction = retry >= 16 ? Math.min(3, Math.floor((retry - 15) / 4)) : 0;
  return {
    ...profile,
    difficulty: relaxedDifficulty,
    targetBoxCount: Math.max(profile.targetColumns + 2, profile.targetBoxCount - boxReduction),
    seed: profile.seed + retry * 104729
  };
}

async function generateLevel(page, level, profile) {
  return page.evaluate(({ level, profile }) => {
    const setValue = (selector, value) => {
      const element = document.querySelector(selector);
      element.value = String(value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    };

    setValue("#levelNumber", level);
    setValue("#colorCount", profile.colorCount);
    setValue("#targetColumnCount", profile.targetColumns);
    setValue("#targetBoxCount", profile.targetBoxCount);
    setValue("#mapColumnCount", profile.mapColumns);
    setValue("#seedInput", profile.seed);
    setValue("#minSplitCount", profile.minSplit);
    setValue("#maxSplitCount", profile.maxSplit);
    setValue("#targetHideRatio", profile.targetHideRatio);
    setValue("#mapHideRatio", profile.mapHideRatio);

    const difficulty = document.querySelector("#difficulty");
    difficulty.value = profile.difficulty;
    const variantMode = document.querySelector("#variantMode");
    variantMode.value = profile.variantMode;
    state.colorSelection = profile.colorIds.slice();
    autoArrangeTargets();
    generateControlData();

    const json = JSON.parse(document.querySelector("#jsonOutput").value);
    const verification = state.lastSolvability;
    const eligibleTargetHidden = state.targetColumns.reduce((sum, column) => sum + Math.max(0, column.length - 1), 0);
    const eligibleMapHidden = state.controlColumns.reduce((sum, column) => sum + Math.max(0, column.length - 1), 0);
    return {
      json,
      verification,
      generated: state.controlColumns.length > 0,
      colorIds: activeColors().map(color => color.id),
      targetHidden: json.TargetHidden?.length || 0,
      mapHidden: json.MapHidden?.length || 0,
      eligibleTargetHidden,
      eligibleMapHidden
    };
  }, { level, profile });
}

async function main() {
  if (startLevel === 1) fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${editorUrl}?batch=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const reportPath = path.join(outputDir, "generation_report.json");
  const report = startLevel > 1 && fs.existsSync(reportPath)
    ? JSON.parse(fs.readFileSync(reportPath, "utf8"))
    : [];
  try {
    for (let level = startLevel; level <= endLevel; level += 1) {
      const profile = levelProfile(level);
      let result = null;
      let runProfile = profile;
      let lastFailure = "no_level";
      for (let retry = 0; retry < 28; retry += 1) {
        runProfile = retryProfile(profile, retry);
        result = await generateLevel(page, level, runProfile);
        const mapHidingValid = level >= 10
          ? result.eligibleMapHidden === 0 || result.mapHidden > 0
          : result.mapHidden === 0;
        const targetHidingValid = level >= 15
          ? result.eligibleTargetHidden === 0 || result.targetHidden > 0
          : result.targetHidden === 0;
        if (result.generated && result.verification?.guaranteed && mapHidingValid && targetHidingValid) break;
        lastFailure = result.verification?.status || "no_level";
      }
      if (!result?.generated || !result.verification?.guaranteed) {
        throw new Error(`Level ${level} generation failed after retries: ${lastFailure}`);
      }

      const fileName = `Level_${String(level).padStart(3, "0")}.json`;
      fs.writeFileSync(path.join(outputDir, fileName), `${JSON.stringify(result.json, null, 2)}\n`);
      const reportEntry = {
        Level: level,
        Difficulty: runProfile.difficulty,
        Colors: runProfile.colorCount,
        ColorIds: result.colorIds,
        TargetColumns: runProfile.targetColumns,
        MapColumns: runProfile.mapColumns,
        TargetBoxes: runProfile.targetBoxCount,
        MinSplit: runProfile.minSplit,
        MaxSplit: runProfile.maxSplit,
        TargetHideRatio: runProfile.targetHideRatio,
        MapHideRatio: runProfile.mapHideRatio,
        TargetHidden: result.targetHidden,
        MapHidden: result.mapHidden,
        PeakBuffer: result.verification.peakBuffer,
        SolutionMoves: result.verification.solutionMoveCount,
        GenerationAttempts: result.verification.generationAttempts,
        FallbackUsed: result.verification.fallbackUsed
      };
      const existingIndex = report.findIndex(entry => entry.Level === level);
      if (existingIndex >= 0) report[existingIndex] = reportEntry;
      else report.push(reportEntry);
      if (level % 10 === 0) console.log(`Generated ${level}/200`);
    }
  } finally {
    await browser.close();
  }

  if (errors.length) throw new Error(`Editor page errors: ${errors.join(" | ")}`);
  report.sort((a, b) => a.Level - b.Level);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Complete: ${report.length} levels in ${outputDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
