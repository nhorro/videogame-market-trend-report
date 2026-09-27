import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  accumulate,
  cutWindow,
  createCatalog,
  performance,
  idsFor,
  readTrend,
  selectionMatrix,
  ranking,
  summarizeSeries,
  averageRanks,
} from "../js/analysis.js";
import { openInNode, prepareTables } from "../js/motor.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function nearly(actual, esperado, margin, message) {
  assert.ok(
    Math.abs(actual - esperado) <= margin,
    `${message}: ${actual} ≠ ${esperado} (±${margin})`,
  );
}

function byName(cat, tax, name) {
  const bit = cat.meta.labels[tax].indexOf(name);
  assert.ok(bit >= 0, name);
  return { tax, bit, name: name };
}

const ranges = averageRanks([10, 10, 30, 40]);
assert.deepEqual(ranges, [0.375, 0.375, 0.75, 1]);

const meta = JSON.parse(fs.readFileSync(path.join(rootDir, "data", "meta.json"), "utf8"));
const motor = await openInNode();
await motor.loadFile(path.join(rootDir, "data", "games.json"));
await prepareTables(motor.query, meta);
const cat = createCatalog(meta, motor);
assert.equal(meta.source.sourceTitles, 114172);
assert.equal(meta.source.titles, 114172);
assert.equal(cat.count, 114172);
for (const name of ["Hentai", "NSFW", "Sexual Content", "Nudity"]) {
  assert.equal(meta.labels.Tags.includes(name), true, name);
}
for (const name of ["Sexual Content", "Nudity"]) {
  assert.equal(meta.labels.Genres.includes(name), true, name);
}

const point = byName(cat, "Tags", "Point & Click");
const story = byName(cat, "Tags", "Story Rich");
assert.equal(meta.labelCounts.Tags[point.bit], 5440);
assert.equal(meta.labelCounts.Tags[story.bit], 13294);

const allIds = await idsFor(cat, [point, story], "all", meta.yearMin, meta.yearMax);
assert.equal(allIds.length, 2050);
const matriz = await selectionMatrix(cat, [point, story], meta.yearMin, meta.yearMax);
assert.equal(matriz.countsGrid[0][1], 2050);
nearly(matriz.jaccard[0][1], 2050 / (5440 + 13294 - 2050), 1e-12, "jaccard");

const cohort = await idsFor(cat, [point, story], "all", 2010, 2024);
assert.equal(cohort.length, 1888);
const seriesData = await summarizeSeries(cat, cohort, ["Tags"], 2010, 2024);
const corte = cutWindow(seriesData, 2010, 2024, 2024, 3);
assert.equal(corte.prev.releases, 556);
assert.equal(corte.recentSlice.releases, 791);
nearly(corte.prev.share, 2.393868939981056, 1e-9, "participación previa");
nearly(corte.recentSlice.share, 2.545126934586055, 1e-9, "participación reciente");
assert.equal(readTrend(corte).key, "more-titles");

const model = await performance(cat, cohort, { minReviews: 20, origin: 2010 });
const countRow = Object.fromEntries(model.segments.map((row) => [row.name, row.games]));
assert.equal(model.eligible, 1363);
assert.equal(countRow["Breakout bien recibido"], 125);
assert.equal(countRow["Éxito con recepción débil"], 67);
assert.equal(countRow["Joya oculta"], 61);
assert.equal(countRow["Bajo desempeño"], 48);
assert.equal(countRow["Típico"], 460);
assert.equal(countRow.Intermedio, 602);
assert.equal(countRow["Evidencia insuficiente"], 525);
assert.deepEqual(
  model.sensitivity.map((row) => [row.minimum, row.evaluated, row.breakouts, row.gems, row.weak, row.low]),
  [
    [10, 1564, 125, 98, 70, 55],
    [20, 1363, 125, 61, 67, 48],
    [50, 1101, 124, 42, 67, 35],
    [100, 935, 122, 31, 70, 21],
  ],
);

const movement = await ranking(cat, "Tags", 2024, 3);
const storyRow = movement.rows.find((row) => row.name === "Story Rich");
const pointRow = movement.rows.find((row) => row.name === "Point & Click");
assert.equal(storyRow.prevReleases, 3585);
assert.equal(storyRow.recentReleases, 6026);
assert.equal(pointRow.prevReleases, 1386);
assert.equal(pointRow.recentReleases, 2264);
const storyOnly = await summarizeSeries(cat, await idsFor(cat, [story], "all", 2010, 2024), ["Tags"], 2010, 2024);
assert.equal(readTrend(cutWindow(storyOnly, 2010, 2024, 2024, 3)).key, "rising");
const period = accumulate(seriesData, 2010, 2024);
assert.equal(period.releases, 1888);

const breakoutNames = new Set(model.lists.breakouts.map((row) => row.name));
assert.ok(breakoutNames.size === 8, "la lista de breakouts tiene que traer 8 títulos");
console.log("control ok");
console.log("breakouts:", [...breakoutNames].join(" | "));
