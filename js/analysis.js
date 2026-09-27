// Heavy queries run in DuckDB. A label's index is its position in meta.labels.

const COLUMN = {
  Genres: "genres",
  Categories: "categories",
  Tags: "tags",
};

export const SEGMENTS = [
  "Breakout bien recibido",
  "Éxito con recepción débil",
  "Joya oculta",
  "Bajo desempeño",
  "Típico",
  "Intermedio",
  "Evidencia insuficiente",
];

export const READING_CUTS = { points: 0.5, volumen: 15 };

const EVIDENCE_LABELS = ["0", "1–9", "10–19", "20–49", "50–99", "100–499", "500–999", "1.000+"];

function asInt(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new Error(`Valor inválido en ${name}`);
  return number;
}

function containsSql(item) {
  const column = COLUMN[item.tax];
  if (!column) throw new Error(`Taxonomía desconocida: ${item.tax}`);
  return `list_contains(${column}, ${asInt(item.bit, "label")})`;
}

function whereSql(selection, match, yearFrom, yearTo) {
  const period = `year BETWEEN ${asInt(yearFrom, "yearFrom")} AND ${asInt(yearTo, "yearTo")}`;
  if (!selection.length) return period;
  const parts = selection.map(containsSql);
  const filterSql = match === "any" ? `(${parts.join(" OR ")})` : parts.join(" AND ");
  return `${period} AND ${filterSql}`;
}

function idsSql(ids) {
  if (!ids.length) return "NULL";
  return ids.map((id) => asInt(id, "id")).join(", ");
}

export function createCatalog(meta, motor) {
  return {
    meta,
    count: meta.source.titles,
    query: motor.query,
  };
}

export function averageRanks(values) {
  const count = values.length;
  const order = values.map((value, index) => ({ value, index }));
  order.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  const output_dir = new Array(count);
  let startAt = 0;
  while (startAt < count) {
    let fin = startAt;
    while (fin + 1 < count && order[fin + 1].value === order[startAt].value) fin += 1;
    const average = (startAt + 1 + (fin + 1)) / 2;
    const percentil = average / count;
    for (let position = startAt; position <= fin; position += 1) output_dir[order[position].index] = percentil;
    startAt = fin + 1;
  }
  return output_dir;
}

export function quantile(values, q) {
  if (!values.length) return null;
  const sortedItems = values.slice().sort((a, b) => a - b);
  if (sortedItems.length === 1) return sortedItems[0];
  const position = (sortedItems.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.ceil(position);
  if (below === above) return sortedItems[below];
  const weight = position - below;
  return sortedItems[below] * (1 - weight) + sortedItems[above] * weight;
}

export function taxonomiesOf(selection) {
  return [...new Set(selection.map((item) => item.tax))];
}

export async function idsFor(cat, selection, match, yearFrom, yearTo) {
  const rows = await cat.query(`SELECT id FROM games WHERE ${whereSql(selection, match, yearFrom, yearTo)} ORDER BY id`);
  return rows.map((row) => row.id);
}

function emptyAnnual(yearFrom, yearTo) {
  const lengthCount = yearTo - yearFrom + 1;
  return {
    yearFrom,
    yearTo,
    years: Array.from({ length: lengthCount }, (_, i) => yearFrom + i),
    releases: Array(lengthCount).fill(0),
    medianReviews: Array(lengthCount).fill(null),
    p75Reviews: Array(lengthCount).fill(null),
    positiveRate: Array(lengthCount).fill(null),
    medianOwners: Array(lengthCount).fill(null),
    medianPrice: Array(lengthCount).fill(null),
    medianCcu: Array(lengthCount).fill(null),
    medianPlay: Array(lengthCount).fill(null),
    totals: {
      games: 0,
      medianReviews: null,
      medianOwners: null,
      medianPrice: null,
      medianCcu: null,
      medianPlay: null,
      positiveRate: null,
      reviewSum: 0,
      positiveSum: 0,
    },
  };
}

export async function annualSeries(cat, ids, yearFrom, yearTo) {
  const seriesData = emptyAnnual(yearFrom, yearTo);
  if (!ids.length) return seriesData;
  const list = idsSql(ids);
  const rows = await cat.query(`
    SELECT
      year,
      count(*) AS releases,
      sum(positive) AS positives,
      sum(positive + negative) AS reviews,
      median(positive + negative) AS median_reviews,
      quantile_cont(positive + negative, 0.75) AS p75_reviews,
      median(owners_mid) AS median_owners,
      median(price_cents) AS median_price,
      median(ccu) AS median_ccu,
      median(play) AS median_play
    FROM games
    WHERE id IN (${list})
    GROUP BY year
  `);
  let positiveSum = 0;
  let reviewSum = 0;
  for (const row of rows) {
    const position = row.year - yearFrom;
    if (position < 0 || position >= seriesData.years.length) continue;
    seriesData.releases[position] = row.releases;
    seriesData.medianReviews[position] = row.median_reviews;
    seriesData.p75Reviews[position] = row.p75_reviews;
    seriesData.positiveRate[position] = row.reviews ? row.positives / row.reviews : null;
    seriesData.medianOwners[position] = row.median_owners;
    seriesData.medianPrice[position] = row.median_price;
    seriesData.medianCcu[position] = row.median_ccu;
    seriesData.medianPlay[position] = row.median_play;
    positiveSum += row.positives;
    reviewSum += row.reviews;
  }
  const [total] = await cat.query(`
    SELECT
      count(*) AS games,
      median(positive + negative) AS median_reviews,
      median(owners_mid) AS median_owners,
      median(price_cents) AS median_price,
      median(ccu) AS median_ccu,
      median(play) AS median_play
    FROM games
    WHERE id IN (${list})
  `);
  seriesData.totals = {
    games: total.games,
    medianReviews: total.median_reviews,
    medianOwners: total.median_owners,
    medianPrice: total.median_price,
    medianCcu: total.median_ccu,
    medianPlay: total.median_play,
    positiveRate: reviewSum ? positiveSum / reviewSum : null,
    reviewSum,
    positiveSum,
  };
  return seriesData;
}

export async function eligibleSeries(cat, taxonomies, yearFrom, yearTo) {
  const lengthCount = yearTo - yearFrom + 1;
  const eligible = new Array(lengthCount).fill(0);
  const market = new Array(lengthCount).fill(0);
  const filterSql = taxonomies.map((tax) => `length(${COLUMN[tax]}) > 0`).join(" AND ") || "TRUE";
  const rows = await cat.query(`
    SELECT year, count(*) AS market, count(*) FILTER (WHERE ${filterSql}) AS eligible
    FROM games
    WHERE year BETWEEN ${asInt(yearFrom, "yearFrom")} AND ${asInt(yearTo, "yearTo")}
    GROUP BY year
  `);
  for (const row of rows) {
    const position = row.year - yearFrom;
    if (position < 0 || position >= lengthCount) continue;
    market[position] = row.market;
    eligible[position] = row.eligible;
  }
  return { eligible, market };
}

export async function summarizeSeries(cat, ids, taxonomies, yearFrom, yearTo) {
  const seriesData = await annualSeries(cat, ids, yearFrom, yearTo);
  const base = await eligibleSeries(cat, taxonomies, yearFrom, yearTo);
  seriesData.eligible = base.eligible;
  seriesData.market = base.market;
  seriesData.share = seriesData.releases.map((value, i) =>
    base.eligible[i] ? (value / base.eligible[i]) * 100 : null,
  );
  seriesData.marketShare = seriesData.releases.map((value, i) =>
    base.market[i] ? (value / base.market[i]) * 100 : null,
  );
  seriesData.ids = ids;
  return seriesData;
}

export function accumulate(seriesData, yearFrom, yearTo) {
  let releases = 0;
  let eligible = 0;
  let market = 0;
  for (let year = yearFrom; year <= yearTo; year += 1) {
    const position = year - seriesData.yearFrom;
    if (position < 0 || position >= seriesData.releases.length) return null;
    releases += seriesData.releases[position];
    eligible += seriesData.eligible[position];
    market += seriesData.market[position];
  }
  return {
    releases,
    eligible,
    market,
    share: eligible ? (releases / eligible) * 100 : null,
    marketShare: market ? (releases / market) * 100 : null,
    coverage: market ? (eligible / market) * 100 : null,
  };
}

export function cutWindow(seriesData, yearFrom, yearTo, recommendedAnchor, windowLength) {
  const anchor = Math.min(yearTo, recommendedAnchor);
  const recentStart = anchor - windowLength + 1;
  const previousStart = anchor - 2 * windowLength + 1;
  const previousEnd = anchor - windowLength;
  const complete = previousStart >= yearFrom && anchor <= yearTo;
  return {
    complete,
    previousStart,
    previousEnd,
    recentStart,
    anchor,
    prev: complete ? accumulate(seriesData, previousStart, previousEnd) : null,
    recentSlice: complete ? accumulate(seriesData, recentStart, anchor) : null,
  };
}

export function readTrend(corte) {
  const base = {
    previousStart: corte.previousStart,
    previousEnd: corte.previousEnd,
    recentStart: corte.recentStart,
    anchor: corte.anchor,
    prev: corte.prev,
    recentSlice: corte.recentSlice,
    dVol: null,
    dPart: null,
  };
  if (!corte.complete || !corte.prev || !corte.recentSlice) return { ...base, key: "incomplete" };
  const { prev, recentSlice } = corte;
  if (prev.releases < 10 && recentSlice.releases >= 25) return { ...base, key: "emerging" };
  if (recentSlice.releases < 25 && prev.releases < 25) return { ...base, key: "thin" };
  if (!prev.releases || prev.share == null || recentSlice.share == null) {
    return { ...base, key: "no-baseline" };
  }
  const dVol = (recentSlice.releases / prev.releases - 1) * 100;
  const dPart = recentSlice.share - prev.share;
  const flatShare = Math.abs(dPart) < READING_CUTS.points;
  let key = "flat";
  if (!flatShare && dPart > 0) key = "rising";
  else if (!flatShare && dPart < 0) key = "falling";
  else if (flatShare && dVol >= READING_CUTS.volumen) key = "more-titles";
  else if (flatShare && dVol <= -READING_CUTS.volumen) key = "fewer-titles";
  return { ...base, key, dVol, dPart };
}

export async function countsInPeriod(cat, tax, yearFrom, yearTo) {
  const column = COLUMN[tax];
  const rows = await cat.query(`
    SELECT bit, count(*) AS games
    FROM (SELECT unnest(${column}) AS bit FROM games
          WHERE year BETWEEN ${asInt(yearFrom, "yearFrom")} AND ${asInt(yearTo, "yearTo")}
            AND length(${column}) > 0)
    GROUP BY bit
  `);
  const sizes = new Uint32Array(cat.meta.labels[tax].length);
  for (const row of rows) sizes[row.bit] = row.games;
  return sizes;
}

export async function companions(cat, ids, tax, excludeBits, sizes, top = 12) {
  if (!ids.length) return [];
  const column = COLUMN[tax];
  const sqlRows = await cat.query(`
    SELECT bit, count(*) AS games
    FROM (SELECT unnest(${column}) AS bit FROM games WHERE id IN (${idsSql(ids)}))
    GROUP BY bit
  `);
  const base = ids.length;
  const rows = [];
  for (const row of sqlRows) {
    if (excludeBits.has(row.bit) || !row.games) continue;
    const union = base + (sizes[row.bit] || 0) - row.games;
    rows.push({
      bit: row.bit,
      name: cat.meta.labels[tax][row.bit],
      games: row.games,
      share: base ? (row.games / base) * 100 : 0,
      jaccard: union ? row.games / union : 0,
    });
  }
  rows.sort((a, b) => b.games - a.games || b.jaccard - a.jaccard || a.name.localeCompare(b.name, "es"));
  return rows.slice(0, top);
}

export async function selectionMatrix(cat, selection, yearFrom, yearTo) {
  const count = selection.length;
  const countsGrid = Array.from({ length: count }, () => new Uint32Array(count));
  if (!count) return { countsGrid, jaccard: [] };
  const columns = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      columns.push(`count(*) FILTER (WHERE ${containsSql(selection[row])} AND ${containsSql(selection[column])}) AS c_${row}_${column}`);
    }
  }
  const [outcome] = await cat.query(`
    SELECT ${columns.join(", ")}
    FROM games
    WHERE year BETWEEN ${asInt(yearFrom, "yearFrom")} AND ${asInt(yearTo, "yearTo")}
  `);
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      countsGrid[row][column] = outcome[`c_${row}_${column}`];
    }
  }
  const jaccard = Array.from({ length: count }, () => new Array(count).fill(0));
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const union = countsGrid[row][row] + countsGrid[column][column] - countsGrid[row][column];
      jaccard[row][column] = union ? countsGrid[row][column] / union : 0;
    }
  }
  return { countsGrid, jaccard };
}

export async function ranking(cat, tax, anchor, windowLength) {
  const recentStart = anchor - windowLength + 1;
  const previousStart = anchor - 2 * windowLength + 1;
  const previousEnd = anchor - windowLength;
  const column = COLUMN[tax];
  const count = cat.meta.labels[tax].length;
  const previousCounts = new Uint32Array(count);
  const recentCounts = new Uint32Array(count);
  const [denominators] = await cat.query(`
    SELECT
      count(*) FILTER (WHERE year BETWEEN ${previousStart} AND ${previousEnd}) AS market_prev,
      count(*) FILTER (WHERE year BETWEEN ${recentStart} AND ${anchor}) AS market_recent,
      count(*) FILTER (WHERE year BETWEEN ${previousStart} AND ${previousEnd} AND length(${column}) > 0) AS eligible_prev,
      count(*) FILTER (WHERE year BETWEEN ${recentStart} AND ${anchor} AND length(${column}) > 0) AS eligible_rec
    FROM games
  `);
  const counts = await cat.query(`
    SELECT bit,
      count(*) FILTER (WHERE year BETWEEN ${previousStart} AND ${previousEnd}) AS releases_prev,
      count(*) FILTER (WHERE year BETWEEN ${recentStart} AND ${anchor}) AS releases_recent
    FROM (
      SELECT year, unnest(${column}) AS bit
      FROM games
      WHERE year BETWEEN ${previousStart} AND ${anchor} AND length(${column}) > 0
    )
    GROUP BY bit
  `);
  for (const row of counts) {
    previousCounts[row.bit] = row.releases_prev;
    recentCounts[row.bit] = row.releases_recent;
  }
  const eligiblePrev = denominators.eligible_prev;
  const eligibleRec = denominators.eligible_rec;
  const prevMarket = denominators.market_prev;
  const recentMarket = denominators.market_recent;
  const rows = [];
  for (let bit = 0; bit < count; bit += 1) {
    const partPrev = eligiblePrev ? (previousCounts[bit] / eligiblePrev) * 100 : null;
    const partRec = eligibleRec ? (recentCounts[bit] / eligibleRec) * 100 : null;
    rows.push({
      bit,
      name: cat.meta.labels[tax][bit],
      prevReleases: previousCounts[bit],
      recentReleases: recentCounts[bit],
      partPrev,
      partRec,
      dPart: partPrev == null || partRec == null ? null : partRec - partPrev,
      dVol: previousCounts[bit] ? (recentCounts[bit] / previousCounts[bit] - 1) * 100 : null,
    });
  }
  return {
    rows,
    prevCoverage: prevMarket ? (eligiblePrev / prevMarket) * 100 : null,
    recentCoverage: recentMarket ? (eligibleRec / recentMarket) * 100 : null,
    prevMarket,
    recentMarket,
    eligiblePrev,
    eligibleRec,
    previousStart,
    previousEnd,
    recentStart,
    anchor,
  };
}

export function wilsonLower(positives, total, z = 1.96) {
  if (!total) return null;
  const proportion = positives / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = proportion + z2 / (2 * total);
  const margin = z * Math.sqrt((proportion * (1 - proportion) + z2 / (4 * total)) / total);
  return (center - margin) / denominator;
}

function bayes(positives, reviews, media, strength) {
  return (positives + media * strength) / (reviews + strength);
}

function ranksByBin(bins, values, mask) {
  const groups = new Map();
  for (let index = 0; index < values.length; index += 1) {
    if (mask && !mask[index]) continue;
    const block = bins[index];
    let list = groups.get(block);
    if (!list) {
      list = [];
      groups.set(block, list);
    }
    list.push(index);
  }
  const output_dir = new Array(values.length).fill(null);
  for (const list of groups.values()) {
    const sub = list.map((index) => values[index]);
    const percentiles = averageRanks(sub);
    for (let position = 0; position < list.length; position += 1) output_dir[list[position]] = percentiles[position];
  }
  return output_dir;
}

function classify(elegible, alcance, satisfaction, parameters) {
  if (!elegible) return "Evidencia insuficiente";
  if (alcance == null || satisfaction == null) return "Intermedio";
  if (alcance >= parameters.reachHigh && satisfaction >= 0.5) return "Breakout bien recibido";
  if (alcance >= 0.75 && satisfaction <= parameters.satisfactionLow) return "Éxito con recepción débil";
  if (alcance <= 0.5 && satisfaction >= parameters.satisfactionHigh) return "Joya oculta";
  if (alcance <= parameters.reachLow && satisfaction <= parameters.satisfactionLow) return "Bajo desempeño";
  if (
    alcance >= parameters.reachLow &&
    alcance <= 0.75 &&
    satisfaction >= parameters.satisfactionLow &&
    satisfaction <= parameters.satisfactionHigh
  ) {
    return "Típico";
  }
  return "Intermedio";
}

function evidenceBin(reviews) {
  if (reviews <= 0) return 0;
  if (reviews <= 9) return 1;
  if (reviews <= 19) return 2;
  if (reviews <= 49) return 3;
  if (reviews <= 99) return 4;
  if (reviews <= 499) return 5;
  if (reviews <= 999) return 6;
  return 7;
}

export async function performance(cat, ids, options) {
  const parameters = { ...cat.meta.parameters, ...options };
  const count = ids.length;
  const porId = new Map();
  if (count) {
    const loadedRows = await cat.query(`
      SELECT id, year, positive, negative, owner, price_cents, ccu, play, appid, name, owners_mid
      FROM games
      WHERE id IN (${idsSql(ids)})
    `);
    for (const row of loadedRows) porId.set(row.id, row);
  }
  const reviews = new Float64Array(count);
  const positives = new Float64Array(count);
  const ownerMids = new Float64Array(count);
  const bins = new Int16Array(count);
  let positiveSum = 0;
  let reviewSum = 0;
  for (let position = 0; position < count; position += 1) {
    const row = porId.get(ids[position]);
    const rev = row.positive + row.negative;
    reviews[position] = rev;
    positives[position] = row.positive;
    ownerMids[position] = row.owners_mid;
    bins[position] = parameters.origin + Math.floor((row.year - parameters.origin) / parameters.binYears) * parameters.binYears;
    positiveSum += row.positive;
    reviewSum += rev;
  }
  const mediaPrevia = reviewSum > 0 ? positiveSum / reviewSum : 0.5;
  const percentilReviews = ranksByBin(bins, reviews, null);
  const ownerPercentile = ranksByBin(bins, ownerMids, null);
  const alcance = new Float64Array(count);
  const smoothed = new Float64Array(count);
  for (let position = 0; position < count; position += 1) {
    alcance[position] =
      parameters.reviewWeight * percentilReviews[position] + (1 - parameters.reviewWeight) * ownerPercentile[position];
    smoothed[position] = bayes(positives[position], reviews[position], mediaPrevia, parameters.priorStrength);
  }

  function evaluate(minimum) {
    const mask = new Array(count);
    for (let position = 0; position < count; position += 1) mask[position] = reviews[position] >= minimum;
    const satisfaction = ranksByBin(bins, smoothed, mask);
    const segments = Object.fromEntries(SEGMENTS.map((name) => [name, 0]));
    const code = new Array(count);
    let eligible = 0;
    for (let position = 0; position < count; position += 1) {
      const name = classify(mask[position], alcance[position], satisfaction[position], parameters);
      code[position] = name;
      segments[name] += 1;
      if (mask[position]) eligible += 1;
    }
    return { mask, satisfaction, code, segments, eligible };
  }

  const primary = evaluate(parameters.minReviews);
  const sensitivity = [10, 20, 50, 100].map((minimum) => {
    const outcome = minimum === parameters.minReviews ? primary : evaluate(minimum);
    return {
      minimum,
      evaluated: outcome.eligible,
      breakouts: outcome.segments["Breakout bien recibido"],
      gems: outcome.segments["Joya oculta"],
      weak: outcome.segments["Éxito con recepción débil"],
      low: outcome.segments["Bajo desempeño"],
    };
  });

  const wilson = new Array(count);
  for (let position = 0; position < count; position += 1) {
    wilson[position] = reviews[position] ? wilsonLower(positives[position], reviews[position]) : null;
  }

  function row(position) {
    const rawRow = porId.get(ids[position]);
    return {
      index: rawRow.id,
      appid: rawRow.appid,
      year: rawRow.year,
      ownerMids: cat.meta.owners[rawRow.owner],
      positives: rawRow.positive,
      reviews: rawRow.positive + rawRow.negative,
      ccu: rawRow.ccu,
      playtime: rawRow.play,
      priceCents: rawRow.price_cents,
      name: rawRow.name,
      alcance: alcance[position],
      satisfaction: primary.satisfaction[position],
      wilson: wilson[position],
      segment: primary.code[position],
      rate: reviews[position] ? positives[position] / reviews[position] : null,
    };
  }

  function take(predicate, comparar, limit) {
    const list = [];
    for (let position = 0; position < count; position += 1) {
      if (predicate(position)) list.push(position);
    }
    list.sort(comparar);
    return list.slice(0, limit).map(row);
  }

  const bySegment = (name) => (position) => primary.code[position] === name;
  const desc = (field, second) => (a, b) => second[b] - second[a] || (field[b] ?? -1) - (field[a] ?? -1);
  const lists = {
    breakouts: take(bySegment("Breakout bien recibido"), desc(wilson, alcance), 8),
    gems: take(bySegment("Joya oculta"), desc(wilson, primary.satisfaction), 8),
    weak: take(bySegment("Éxito con recepción débil"), desc(wilson, alcance), 8),
    low: take(
      bySegment("Bajo desempeño"),
      (a, b) => alcance[a] - alcance[b] || (primary.satisfaction[a] ?? 1) - (primary.satisfaction[b] ?? 1),
      8,
    ),
    typical: take(
      (position) => primary.mask[position] && primary.satisfaction[position] != null,
      (a, b) => {
        const da = (alcance[a] - 0.5) ** 2 + (primary.satisfaction[a] - 0.5) ** 2;
        const db = (alcance[b] - 0.5) ** 2 + (primary.satisfaction[b] - 0.5) ** 2;
        return da - db;
      },
      8,
    ),
  };

  const evidenceCounts = new Array(EVIDENCE_LABELS.length).fill(0);
  for (let position = 0; position < count; position += 1) evidenceCounts[evidenceBin(reviews[position])] += 1;
  const evidencia = EVIDENCE_LABELS.map((label, position) => ({
    label,
    games: evidenceCounts[position],
    pct: count ? (evidenceCounts[position] / count) * 100 : 0,
  }));

  const allPoints = [];
  for (let position = 0; position < count; position += 1) {
    if (!primary.mask[position] || primary.satisfaction[position] == null) continue;
    if (!Number.isFinite(alcance[position])) continue;
    allPoints.push({
      alcance: alcance[position],
      satisfaction: primary.satisfaction[position],
      segment: primary.code[position],
    });
  }
  const pointCap = 8000;
  const pointsSampled = allPoints.length > pointCap;
  const points = pointsSampled
    ? Array.from({ length: pointCap }, (_, index) => allPoints[Math.floor(index * allPoints.length / pointCap)])
    : allPoints;

  const segmentIds = {};
  const eligibleIds = [];
  for (let position = 0; position < count; position += 1) {
    const name = primary.code[position];
    if (!segmentIds[name]) segmentIds[name] = [];
    segmentIds[name].push(ids[position]);
    if (primary.mask[position]) eligibleIds.push(ids[position]);
  }

  return {
    games: count,
    eligible: primary.eligible,
    mediaPrevia,
    segments: SEGMENTS.map((name) => ({
      name,
      games: primary.segments[name],
      pct: count ? (primary.segments[name] / count) * 100 : 0,
    })),
    sensitivity,
    lists,
    evidencia,
    points,
    pointsSampled,
    segmentIds,
    eligibleIds,
  };
}

async function countTags(cat, ids) {
  const countRow = new Uint32Array(cat.meta.labels.Tags.length);
  if (!ids.length) return countRow;
  const rows = await cat.query(`
    SELECT bit, count(*) AS games
    FROM (SELECT unnest(tags) AS bit FROM games WHERE id IN (${idsSql(ids)}))
    GROUP BY bit
  `);
  for (const row of rows) countRow[row.bit] = row.games;
  return countRow;
}

export async function liftTags(cat, group, referencia, excludeBits, minimum) {
  if (!group.length || !referencia.length) return [];
  const count = cat.meta.labels.Tags.length;
  const enGrupo = await countTags(cat, group);
  const enReferencia = await countTags(cat, referencia);
  const rows = [];
  for (let bit = 0; bit < count; bit += 1) {
    if (excludeBits.has(bit) || enGrupo[bit] < minimum) continue;
    const groupPct = (enGrupo[bit] / group.length) * 100;
    const referenciaPct = (enReferencia[bit] / referencia.length) * 100;
    if (!referenciaPct) continue;
    rows.push({
      bit,
      name: cat.meta.labels.Tags[bit],
      group: enGrupo[bit],
      referencia: enReferencia[bit],
      groupPct,
      referenciaPct,
      lift: groupPct / referenciaPct,
      pp: groupPct - referenciaPct,
    });
  }
  rows.sort((a, b) => b.lift - a.lift || b.group - a.group);
  return rows;
}
