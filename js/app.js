import { openInBrowser, prepareTables } from "./motor.js";
import {
  READING_CUTS,
  accumulate,
  companions,
  cutWindow,
  createCatalog,
  performance,
  idsFor,
  readTrend,
  liftTags,
  selectionMatrix,
  ranking,
  summarizeSeries,
  countsInPeriod,
  taxonomiesOf,
} from "./analysis.js";
import {
  SEGMENT_COLOR,
  PALETTE,
  drawScatter,
  chartStacked,
  chartBars,
  chartBarsLine,
  chartColumns,
  chartHeatmap,
  chartLines,
  chartMultiples,
} from "./charts.js";
import {
  TAX_LABEL,
  TAX_PLURAL,
  yearSpan,
  decimal,
  shortDate,
  signedPct,
  denominatorPhrase,
  foldText,
  num,
  pct,
  pp,
  rate,
  usd,
} from "./format.js";

const VIEWS = ["overview", "explore", "moves", "method"];
const PRESETS = [
  {
    title: "Point & click narrativo",
    text: "Point & Click y Story Rich a la vez.",
    mode: "cohort",
    match: "all",
    selected: [["Tags", "Point & Click"], ["Tags", "Story Rich"]],
  },
  {
    title: "Misterio vecino",
    text: "Mystery, Detective e Investigation, cada uno por su lado.",
    mode: "labels",
    match: "all",
    selected: [["Tags", "Mystery"], ["Tags", "Detective"], ["Tags", "Investigation"]],
  },
  {
    title: "Rogue-like",
    text: "Sólo el tag Rogue-like.",
    mode: "labels",
    match: "all",
    selected: [["Tags", "Rogue-like"]],
  },
  {
    title: "Novela visual",
    text: "El tag Visual Novel.",
    mode: "labels",
    match: "all",
    selected: [["Tags", "Visual Novel"]],
  },
  {
    title: "Metroidvania",
    text: "Un tag de mecánica, más chico que un género.",
    mode: "labels",
    match: "all",
    selected: [["Tags", "Metroidvania"]],
  },
  {
    title: "Simulación",
    text: "El género Simulation, amplio a propósito.",
    mode: "labels",
    match: "all",
    selected: [["Genres", "Simulation"]],
  },
  {
    title: "Cooperativo",
    text: "La categoría de Steam Co-op, no el tag.",
    mode: "labels",
    match: "all",
    selected: [["Categories", "Co-op"]],
  },
];
const STATUS_LABEL = {
  rising: "Gana lugar",
  falling: "Pierde lugar",
  "more-titles": "Más títulos, misma participación",
  "fewer-titles": "Menos títulos, misma participación",
  flat: "Participación quieta",
  emerges: "Aparece en el mapa",
  thin: "Muestra chica",
  incomplete: "Ventana incompleta",
  "no-baseline": "Sin base previa",
};
const FLOORS = {
  Genres: { recent: 50, previous: 25 },
  Categories: { recent: 50, previous: 25 },
  Tags: { recent: 40, previous: 20 },
};

const state = {
  meta: null,
  cat: null,
  bits: new Map(),
  view: "overview",
  mode: "labels",
  match: "all",
  selection: [],
  yearFrom: 2010,
  yearTo: 2024,
  yearWindow: 3,
  minReviews: 20,
  movTax: "Tags",
  movesWindow: 3,
  movesAnchor: 2024,
  movesSmall: false,
  movesQuery: "",
  suggestionIndex: -1,
  suggestions: [],
};
const cacheRanking = new Map();
let exploreTicket = 0;
let movesTicket = 0;
const tooltip = () => document.getElementById("tooltip");

function el(tag, attrs = {}, children = []) {
  const svgEl = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") svgEl.className = value;
    else if (key === "text") svgEl.textContent = value;
    else if (key === "ariaLabel") svgEl.setAttribute("aria-label", value);
    else if (key === "ariaSelected") svgEl.setAttribute("aria-selected", value);
    else if (key.startsWith("on") && typeof value === "function") svgEl.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) svgEl.setAttribute(key, "");
    else if (value != null && value !== false) svgEl.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    svgEl.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return svgEl;
}

function statusClass(key) {
  if (key === "rising") return "rising";
  if (key === "falling") return "falling";
  if (key === "more-titles" || key === "fewer-titles" || key === "flat") return "flat";
  return "thin";
}

function pill(key) {
  return el("span", { class: `status ${statusClass(key)}`, text: STATUS_LABEL[key] || key });
}

function clampYear(text, fallback) {
  const value = Number(text);
  if (text == null || text === "" || !Number.isFinite(value)) return fallback;
  return Math.min(state.meta.yearMax, Math.max(state.meta.yearMin, Math.round(value)));
}

function selectionTitle(selection, match) {
  return selection.map((item) => item.name).join(match === "any" ? " o " : " + ");
}

function coverageFor(tax, year) {
  const index = state.meta.years.indexOf(year);
  if (index < 0) return null;
  return state.meta.coverage[tax][index];
}

function resolveSelection(pairs) {
  const output_dir = [];
  const seen = new Set();
  for (const pair of pairs) {
    const mapa = state.bits.get(pair.tax);
    if (!mapa?.has(pair.name)) continue;
    const key = `${pair.tax}:${pair.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output_dir.push({ tax: pair.tax, bit: mapa.get(pair.name), name: pair.name });
  }
  return output_dir.slice(0, 8);
}

function buildHash() {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  params.set("match", state.match);
  params.set("yearFrom", String(state.yearFrom));
  params.set("yearTo", String(state.yearTo));
  params.set("yearWindow", String(state.yearWindow));
  params.set("min", String(state.minReviews));
  for (const item of state.selection) params.append("sel", `${item.tax}:${item.name}`);
  params.set("tax", state.movTax);
  params.set("mv", String(state.movesWindow));
  params.set("ma", String(state.movesAnchor));
  if (state.movesSmall) params.set("small", "1");
  return `#/${state.view}?${params.toString()}`;
}

function writeHash() {
  const nextHash = buildHash();
  if (location.hash !== nextHash) history.replaceState(null, "", nextHash);
}

function readHash() {
  const raw = (location.hash || "#/overview").slice(1);
  const corte = raw.indexOf("?");
  const path = (corte === -1 ? raw : raw.slice(0, corte)).replace(/^\//, "");
  const query = corte === -1 ? "" : raw.slice(corte + 1);
  state.view = VIEWS.includes(path) ? path : "overview";
  if (!state.meta) return;
  const params = new URLSearchParams(query);
  if (params.has("mode")) state.mode = params.get("mode") === "cohort" ? "cohort" : "labels";
  if (params.has("match")) state.match = params.get("match") === "any" ? "any" : "all";
  if (params.has("yearFrom")) state.yearFrom = clampYear(params.get("yearFrom"), state.yearFrom);
  if (params.has("yearTo")) state.yearTo = clampYear(params.get("yearTo"), state.yearTo);
  if (state.yearFrom > state.yearTo) state.yearTo = state.yearFrom;
  if (params.has("yearWindow")) state.yearWindow = [2, 3, 5].includes(Number(params.get("yearWindow"))) ? Number(params.get("yearWindow")) : 3;
  if (params.has("min")) state.minReviews = [10, 20, 50, 100].includes(Number(params.get("min"))) ? Number(params.get("min")) : 20;
  if (params.has("tax") && state.bits.has(params.get("tax"))) state.movTax = params.get("tax");
  if (params.has("mv")) state.movesWindow = [2, 3, 5].includes(Number(params.get("mv"))) ? Number(params.get("mv")) : 3;
  if (params.has("ma")) state.movesAnchor = clampYear(params.get("ma"), state.movesAnchor);
  state.movesSmall = params.get("small") === "1";
  if (params.has("sel") || query.includes("sel=")) {
    state.selection = resolveSelection(
      params.getAll("sel").map((value) => {
        const separator = value.indexOf(":");
        if (separator < 0) return null;
        return { tax: value.slice(0, separator), name: value.slice(separator + 1) };
      }).filter(Boolean),
    );
  }
}

function showView(view) {
  for (const id of VIEWS) document.getElementById(id).hidden = id !== view;
  for (const link of document.querySelectorAll("nav a")) {
    if (link.dataset.view === view) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

function syncControls() {
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.checked = radio.value === state.mode;
  for (const radio of document.querySelectorAll('input[name="match"]')) radio.checked = radio.value === state.match;
  document.getElementById("yearFrom").value = String(state.yearFrom);
  document.getElementById("yearTo").value = String(state.yearTo);
  document.getElementById("yearWindow").value = String(state.yearWindow);
  document.getElementById("min-reviews").value = String(state.minReviews);
  document.getElementById("moves-tax").value = state.movTax;
  document.getElementById("moves-window").value = String(state.movesWindow);
  document.getElementById("moves-anchor").value = String(state.movesAnchor);
  document.getElementById("moves-small").checked = state.movesSmall;
  document.getElementById("match-field").hidden = state.mode !== "cohort";
}

function renderChips() {
  const host = document.getElementById("chips");
  host.replaceChildren();
  state.selection.forEach((item, index) => {
    host.append(el("span", { class: "chip" }, [
      el("i", { class: "swatch", style: `background:${PALETTE[index % PALETTE.length]}` }),
      el("span", { class: "tax", text: TAX_LABEL[item.tax] }),
      item.name,
      el("button", {
        type: "button",
        text: "Quitar",
        ariaLabel: `Quitar ${item.name}`,
        onClick: () => {
          state.selection.splice(index, 1);
          render();
        },
      }),
    ]));
  });
  document.getElementById("selection-limit").textContent = state.selection.length >= 8
    ? "Ocho etiquetas es el máximo para que los gráficos se puedan leer."
    : "";
}

function render() {
  showView(state.view);
  if (state.meta) syncControls();
  renderChips();
  if (state.view === "explore") renderResults(++exploreTicket);
  if (state.view === "moves") renderMoves(++movesTicket);
  if (state.meta) writeHash();
}

function block(title, caption, chart, table) {
  return el("figure", { class: "chart" }, [
    el("h3", { text: title }),
    caption ? el("p", { class: "caption", text: caption }) : null,
    chart,
    table ? el("details", { class: "figures" }, [el("summary", { text: "Ver los números" }), table]) : null,
    sourceCaption(),
  ]);
}

function sourceCaption() {
  const url = state.meta?.source?.url;
  const label = "Steam Dataset 2026 cleaned";
  return el("figcaption", {}, [
    "Fuente: ",
    url ? el("a", { href: url, text: label }) : label,
    ", snapshot a enero de 2026.",
  ]);
}

function simpleTable(headers, rows) {
  return el("div", { class: "table-wrap" }, [
    el("table", {}, [
      el("thead", {}, [el("tr", {}, headers.map((item) => el("th", { class: item.num ? "num" : "", text: item.text })))]),
      el("tbody", {}, rows.map((row) => el("tr", {}, row.map((cell) => (
        cell instanceof Node ? el("td", {}, [cell]) : el("td", { class: typeof cell === "object" && cell?.num ? "num" : "", text: typeof cell === "object" ? cell.text : String(cell) })
      ))))),
    ]),
  ]);
}

function numCell(text) {
  return { num: true, text };
}

async function computeSelection(selection, match) {
  const taxs = taxonomiesOf(selection);
  const ids = await idsFor(state.cat, selection, match, state.yearFrom, state.yearTo);
  const seriesData = await summarizeSeries(state.cat, ids, taxs, state.yearFrom, state.yearTo);
  const corte = cutWindow(seriesData, state.yearFrom, state.yearTo, state.meta.recommendedYear, state.yearWindow);
  return { selection, match, taxs, seriesData, corte, reading: readTrend(corte), name: selectionTitle(selection, match) };
}

function readingText(reading, name) {
  const prefix = name ? `${name}: ` : "";
  const yearWindow = `${yearSpan(reading.previousStart, reading.previousEnd)} y ${yearSpan(reading.recentStart, reading.anchor)}`;
  if (reading.key === "incomplete") {
    return `${prefix}Para comparar ventanas de ${state.yearWindow} años ancladas en ${reading.anchor} hacen falta lanzamientos desde ${reading.previousStart}. Ampliá el período o achicá la ventana.`;
  }
  const prev = reading.prev;
  const recentSlice = reading.recentSlice;
  if (reading.key === "emerging") {
    return `${prefix}Entre ${yearWindow} el recorte pasa de ${num(prev.releases)} a ${num(recentSlice.releases)} lanzamientos. Conviene leerlo como una aparición, no como una tendencia estable.`;
  }
  if (reading.key === "thin") {
    return `${prefix}Hay pocos lanzamientos para comparar (${num(prev.releases)} y después ${num(recentSlice.releases)}). La participación puede saltar por casualidad.`;
  }
  if (reading.key === "no-baseline") {
    return `${prefix}No hay lanzamientos en la ventana previa. Sin esa base no se puede decir si el espacio crece o sólo aparece.`;
  }
  const movement = `La participación pasa de ${pct(prev.share)} a ${pct(recentSlice.share)} (${pp(reading.dPart)}). Los lanzamientos pasan de ${num(prev.releases)} a ${num(recentSlice.releases)} (${signedPct(reading.dVol)}).`;
  if (reading.key === "rising") return `${prefix}${movement} Gana lugar en el catálogo: no se explica sólo porque Steam publica más juegos.`;
  if (reading.key === "falling") return `${prefix}${movement} El espacio pierde peso relativo.`;
  if (reading.key === "more-titles") return `${prefix}${movement} Hay más títulos, pero el peso relativo queda quieto: el crecimiento acompaña la expansión general del catálogo.`;
  if (reading.key === "fewer-titles") return `${prefix}${movement} Hay menos títulos y la participación se mantiene.`;
  return `${prefix}${movement} En este corte el espacio está quieto.`;
}

function coverageNotes(results) {
  const notes = [];
  const taxs = new Set(results.flatMap((result) => result.taxs));
  if (taxs.has("Tags") && state.yearTo > state.meta.recommendedYear) {
    notes.push(`El gráfico llega hasta ${state.yearTo}, pero las ventanas se anclan en ${state.meta.recommendedYear}. En 2025 la cobertura de tags es ${pct(coverageFor("Tags", 2025))}: un faltante de metadatos puede parecer una caída del mercado.`);
  }
  for (const result of results) {
    const previous = result.reading.prev?.coverage;
    const recent = result.reading.recentSlice?.coverage;
    if (previous == null || recent == null) continue;
    if (Math.abs(recent - previous) >= 8) {
      notes.push(`La cobertura del denominador pasa de ${pct(previous)} a ${pct(recent)} entre ventanas. Parte del movimiento puede ser metadatos, no sólo catálogo.`);
      break;
    }
  }
  if (taxs.size > 1 && state.mode === "labels") {
    notes.push("Cada curva se divide por los juegos que tienen informada su propia taxonomía. Un género y un tag no comparten denominador.");
  }
  return notes;
}

function seriesColor(results, accessor) {
  return {
    years: results[0].seriesData.years,
    series: results.map((result, index) => ({
      name: result.name,
      color: PALETTE[index % PALETTE.length],
      values: accessor(result),
    })),
  };
}

async function renderResults(ticket) {
  const host = document.getElementById("results");
  host.replaceChildren();
  if (!state.selection.length) {
    host.append(el("div", { class: "empty" }, [
      el("h2", { text: "Elegí un nicho" }),
      el("p", { text: "Buscá un tag, un género o una categoría, o usá un atajo. Los atajos no recomiendan qué desarrollar: sólo muestran cómo se lee el catálogo." }),
    ]));
    return;
  }
  if (!state.cat) {
    host.append(el("p", { class: "note", text: "Cargando el catálogo compacto en el navegador…" }));
    return;
  }
  host.append(el("p", { class: "note", text: "Consultando el catálogo…" }));
  let results;
  try {
    results = state.mode === "cohort"
      ? [await computeSelection(state.selection, state.match)]
      : await Promise.all(state.selection.map((item) => computeSelection([item], "all")));
  } catch (error) {
    if (ticket !== exploreTicket) return;
    host.replaceChildren(el("p", { class: "note", text: `No se pudo consultar: ${error.message}` }));
    return;
  }
  if (ticket !== exploreTicket) return;
  host.replaceChildren();
  if (results.every((result) => result.seriesData.totals.games === 0)) {
    host.append(el("p", { class: "note", text: "Ningún título del período cumple este recorte. Probá «alguna» en vez de «todas», o ampliá los años." }));
    return;
  }

  const primaryReading = results[0].reading;
  host.append(el("div", { class: "result-head" }, [
    el("div", {}, [
      el("p", { class: "kicker", text: state.mode === "cohort" ? "Recorte combinado" : "Etiquetas por separado" }),
      el("h2", { text: state.mode === "cohort" ? results[0].name : "Comparación" }),
    ]),
    el("button", { type: "button", class: "secondary", text: "Copiar enlace", onClick: (evento) => copyLink(evento.currentTarget) }),
  ]));
  host.append(el("p", { class: "period", text: periodText(primaryReading) }));

  if (results.length === 1) {
    host.append(el("div", { class: "reading" }, [pill(results[0].reading.key), el("p", { class: "quote", text: readingText(results[0].reading) })]));
  } else {
    const keys = results.map((result) => result.reading.key);
    const sameReading = keys.every((key) => key === keys[0]);
    host.append(el("div", { class: "reading" }, [
      sameReading ? pill(keys[0]) : el("span", { class: "status thin", text: "Lecturas distintas" }),
      el("p", { class: "quote", text: sameReading
        ? `Las ${results.length} etiquetas comparten la misma lectura de ventana.`
        : "No se mueven todas igual. El cambio en puntos, abajo, muestra quién gana lugar y quién no." }),
    ]));
    host.append(comparisonTable(results));
  }
  for (const note of coverageNotes(results)) host.append(el("p", { class: "note", text: note }));
  if (results.length === 1) host.append(kpis(results[0]));

  const conCambio = results.filter((result) => result.reading.dPart != null);
  if (conCambio.length) {
    host.append(block(
      "Cambio de participación entre ventanas",
      `Puntos porcentuales${state.mode === "cohort" ? ` sobre ${denominatorPhrase(taxonomiesOf(state.selection))}` : ""}. Cero quiere decir que el peso relativo no cambió. El cartel usa ±${decimal(READING_CUTS.points, 1)} pp y ±${READING_CUTS.volumen}% de volumen: es una ayuda de lectura, no un test.`,
      chartBars({
        rows: conCambio.map((result, index) => ({
          name: result.name,
          value: result.reading.dPart,
          color: PALETTE[results.indexOf(result) % PALETTE.length],
        })),
        format: (value) => pp(value),
        aria: "Cambio de participación entre la ventana previa y la reciente",
        signed: true,
      }),
      null,
    ));
  }

  const share = seriesColor(results, (result) => result.seriesData.share);
  host.append(block(
    "Participación año a año",
    "Porcentaje de los lanzamientos del año que entran en el denominador. El eje arranca en cero para no inflar un movimiento chico.",
    chartLines({ ...share, formatY: (value) => pct(value), aria: "Participación anual", tooltip: tooltip() }),
    yearTable(results, (result) => result.seriesData.share, (value) => pct(value)),
  ));

  if (results.length === 1) {
    host.append(block(
      "Lanzamientos por año",
      "Barras: el recorte. Línea: todos los lanzamientos de Steam ese año, en el eje derecho.",
      chartBarsLine({
        years: results[0].seriesData.years,
        bars: results[0].seriesData.releases,
        line: results[0].seriesData.market,
        formatBars: num,
        formatLine: num,
        aria: "Lanzamientos del recorte y del catálogo",
        tooltip: tooltip(),
      }),
      yearTable(results, (result) => result.seriesData.releases, num),
    ));
  } else {
    host.append(block(
      "Lanzamientos por año",
      "Cada etiqueta tiene su propia escala. Sirve para ver la forma —si hay más o menos títulos— y no para comparar alturas entre etiquetas.",
      chartMultiples({
        ...seriesColor(results, (result) => result.seriesData.releases),
        formatY: num,
        aria: "Lanzamientos anuales de cada etiqueta",
      }),
      yearTable(results, (result) => result.seriesData.releases, num),
    ));
  }

  await renderOverlap(host);
  if (ticket !== exploreTicket) return;
  if (results.length === 1) await renderDepth(host, results[0]);
  else host.append(el("p", { class: "note", text: "El desempeño relativo, la antigüedad de las reviews y los casos se calculan sobre un solo recorte. Dejá una etiqueta o pasá a «Un recorte combinado»." }));
}

function periodText(reading) {
  const base = `Período ${yearSpan(state.yearFrom, state.yearTo)}.`;
  if (reading.key === "incomplete") return `${base} Las ventanas de ${state.yearWindow} años ancladas en ${reading.anchor} necesitan datos desde ${reading.previousStart}.`;
  return `${base} Ventanas ${yearSpan(reading.previousStart, reading.previousEnd)} y ${yearSpan(reading.recentStart, reading.anchor)}.`;
}

function kpis(result) {
  const period = accumulate(result.seriesData, state.yearFrom, state.yearTo);
  const totals = result.seriesData.totals;
  return el("div", { class: "kpis" }, [
    kpi(num(totals.games), "Títulos en el período"),
    kpi(pct(period?.share), `Participación entre ${denominatorPhrase(result.taxs)}`),
    kpi(pct(period?.marketShare, 2), "Participación sobre todos los lanzamientos"),
    kpi(num(totals.medianReviews), "Mediana de reviews acumuladas"),
    kpi(rate(totals.positiveRate), "Tasa positiva agregada"),
    kpi(num(totals.medianOwners), "Mediana del punto medio de owners"),
    kpi(usd(totals.medianPrice), "Precio mediano de lista"),
  ]);
}

function kpi(value, label) {
  return el("div", { class: "kpi" }, [el("b", { text: value }), el("span", { text: label })]);
}

function comparisonTable(results) {
  return simpleTable(
    ["Etiqueta", "Títulos", "Participación", "Ventana previa", "Ventana reciente", "Cambio", "Lectura"].map((text, index) => ({ text, num: index > 0 && index < 6 })),
    results.map((result) => {
      const period = accumulate(result.seriesData, state.yearFrom, state.yearTo);
      return [
        result.name,
        numCell(num(result.seriesData.totals.games)),
        numCell(pct(period?.share)),
        numCell(pct(result.reading.prev?.share)),
        numCell(pct(result.reading.recentSlice?.share)),
        numCell(pp(result.reading.dPart)),
        STATUS_LABEL[result.reading.key] || "—",
      ];
    }),
  );
}

function yearTable(results, accessor, format) {
  const years = results[0].seriesData.years;
  return simpleTable(
    [{ text: "Año" }, ...results.map((result) => ({ text: result.name, num: true }))],
    years.map((year, index) => [String(year), ...results.map((result) => numCell(format(accessor(result)[index])))]),
  );
}

async function renderOverlap(host) {
  if (state.selection.length >= 2) {
    const matriz = await selectionMatrix(state.cat, state.selection, state.yearFrom, state.yearTo);
    if (state.selection.length === 2) {
      host.append(el("p", { class: "quote short", text: overlapText(state.selection.map((item) => item.name), matriz) }));
    }
    host.append(block(
      "Similitud entre las etiquetas elegidas",
      "Sirve para ver si dos etiquetas nombran el mismo conjunto de juegos o sólo se tocan. El número es la intersección dividida por la unión: 1 si aparecen siempre juntas, cerca de 0 si casi no comparten títulos. Una intersección grande puede dar un valor bajo, porque cada etiqueta también cubre juegos que la otra no nombra. La diagonal es 1. Se calcula en el período elegido.",
      chartHeatmap({
        names: state.selection.map((item) => item.name),
        matriz: matriz.jaccard,
        aria: "Matriz de similitud de Jaccard",
      }),
      null,
    ));
  }
  const unaSola = state.mode === "labels" && state.selection.length === 1;
  const cohort = state.mode === "cohort";
  if (!unaSola && !cohort) return;
  const tax = cohort ? "Tags" : state.selection[0].tax;
  const ids = cohort
    ? await idsFor(state.cat, state.selection, state.match, state.yearFrom, state.yearTo)
    : await idsFor(state.cat, state.selection, "all", state.yearFrom, state.yearTo);
  const excludeBits = new Set(state.selection.filter((item) => item.tax === tax).map((item) => item.bit));
  const nearby = await companions(
    state.cat,
    ids,
    tax,
    excludeBits,
    await countsInPeriod(state.cat, tax, state.yearFrom, state.yearTo),
  );
  host.append(block(
    cohort ? "Tags que más se repiten en el recorte" : `${TAX_PLURAL[tax]} que aparecen junto con la etiqueta`,
    "Es coocurrencia, no una causa. Un juego puede llevar muchas etiquetas a la vez.",
    chartBars({
      rows: nearby.map((row) => ({ name: row.name, value: row.games, color: "#7aa2ff" })),
      format: (value) => num(value),
      aria: "Etiquetas que coocurren",
    }),
    simpleTable(
      ["Etiqueta", "En el recorte", "% del recorte", "Jaccard"].map((text, index) => ({ text, num: index > 0 })),
      nearby.map((row) => [row.name, numCell(num(row.games)), numCell(pct(row.share)), numCell(decimal(row.jaccard, 2))]),
    ),
  ));
}

function overlapText(names, matriz) {
  const compartidos = matriz.countsGrid[0][1];
  const jaccard = matriz.jaccard[0][1];
  if (!compartidos) return `${names[0]} y ${names[1]} no comparten títulos en el período.`;
  let closing = "Se tocan, pero ninguna de las dos describe sola al mismo conjunto.";
  if (jaccard >= 0.5) closing = "El solapamiento es alto: son descripciones cercanas, aunque no idénticas.";
  else if (jaccard < 0.15) closing = "La intersección puede ser numerosa y, aun así, chica respecto de la unión. Ninguna reemplaza a la otra.";
  return `${names[0]} y ${names[1]} comparten ${num(compartidos)} títulos. Jaccard ${decimal(jaccard, 2)}. ${closing}`;
}

async function renderDepth(host, result) {
  host.append(block(
    "Reviews acumuladas según el año de salida",
    "Mediana y percentil 75 en escala logarítmica. Una caída hacia los años recientes mezcla menos tiempo en el mercado con cambios de catálogo: no es, por sí sola, una caída de calidad.",
    chartLines({
      years: result.seriesData.years,
      series: [
        { name: "Mediana", color: "#7aa2ff", values: result.seriesData.medianReviews },
        { name: "Percentil 75", color: "#c4b5fd", values: result.seriesData.p75Reviews },
      ],
      formatY: num,
      aria: "Reviews acumuladas por año de lanzamiento",
      tooltip: tooltip(),
      log: true,
    }),
    yearTable([
      { name: "Mediana", seriesData: { years: result.seriesData.years, medianReviews: result.seriesData.medianReviews } },
      { name: "Percentil 75", seriesData: { years: result.seriesData.years, medianReviews: result.seriesData.p75Reviews } },
    ], (item) => item.seriesData.medianReviews, num),
  ));
  host.append(el("details", { class: "figures" }, [
    el("summary", { text: "Otras señales acumuladas del snapshot" }),
    el("p", { text: `Mediana del pico de usuarios concurrentes: ${num(result.seriesData.totals.medianCcu)}. Mediana de tiempo de juego informado: ${num(result.seriesData.totals.medianPlay)} minutos. Muchos ceros en estas series quieren decir ausencia de señal, no un juego de duración nula.` }),
  ]));

  const model = await performance(state.cat, result.seriesData.ids, { minReviews: state.minReviews, origin: state.yearFrom });
  const parts = model.segments.map((segment) => ({ ...segment, value: segment.games, color: SEGMENT_COLOR[segment.name] }));
  host.append(el("section", { class: "performance" }, [
    el("h3", { text: "Desempeño relativo dentro del recorte" }),
    el("p", { class: "caption", text: "Cada juego se compara con los de su bloque de dos años, contados desde el año Desde. Alcance = 0,75 × percentil de reviews + 0,25 × percentil del punto medio de owners. La satisfacción usa una tasa suavizada con 30 reviews de previa y sólo se juzga si hay suficientes reviews. El porcentaje de breakouts existe por el corte en el percentil 90: no es una tasa de éxito." }),
    chartStacked({ parts, aria: "Distribución de segmentos de desempeño" }),
    el("ul", { class: "legend" }, parts.filter((part) => part.games).map((part) => el("li", {}, [
      el("i", { style: `background:${part.color}` }),
      `${part.name}: ${num(part.games)} (${pct(part.pct)})`,
    ]))),
    el("h4", { text: "Sensibilidad al mínimo de reviews" }),
    simpleTable(
      ["Mínimo", "Evaluables", "Breakouts", "Joyas ocultas", "Éxito con recepción débil", "Bajo desempeño"].map((text, index) => ({ text, num: index > 0 })),
      model.sensitivity.map((row) => [
        row.minimum === state.minReviews ? `${row.minimum} (en uso)` : String(row.minimum),
        numCell(num(row.evaluated)),
        numCell(num(row.breakouts)),
        numCell(num(row.gems)),
        numCell(num(row.weak)),
        numCell(num(row.low)),
      ]),
    ),
  ]));
  host.append(block(
    "Cuánta evidencia de recepción hay",
    "El mínimo no borra juegos del análisis de alcance. Sólo evita juzgar la recepción cuando casi no hay reviews.",
    chartColumns({
      labels: model.evidencia.map((row) => row.label),
      values: model.evidencia.map((row) => row.games),
      format: num,
      aria: "Histograma de reviews",
    }),
    null,
  ));
  if (model.points) {
    const canvasEl = el("canvas", { class: "scatter", ariaLabel: "Alcance y satisfacción relativos" });
    const figure = block(
      "Alcance y satisfacción",
      "Cada punto es un juego con reviews suficientes. Abajo a la derecha: poca llegada y mucha satisfacción relativa. Arriba: más alcance dentro de su bloque de edad.",
      canvasEl,
      null,
    );
    host.append(figure);
    requestAnimationFrame(() => drawScatter(canvasEl, model.points));
  } else {
    host.append(el("p", { class: "note", text: "Hay demasiados títulos con reviews suficientes para marcar cada punto. Quedan la distribución y las listas." }));
  }
  renderLists(host, model);
  await renderLift(host, model);
}

function renderLists(host, model) {
  const groups = [
    ["breakouts", "Breakouts bien recibidos", "Alcance alto y recepción que no queda por debajo de la mediana de su bloque. Sirven para estudiar adquisición, no como fórmula."],
    ["gems", "Joyas ocultas", "Satisfacción relativa alta y alcance por debajo de la mediana. «Oculta» es relativo a este modelo: no dice si el proyecto fue rentable."],
    ["typical", "Casos cerca del centro", "Útiles para una expectativa de base, menos sesgada por los éxitos visibles."],
    ["weak", "Mucho alcance, recepción débil", "Llegaron relativamente lejos y la satisfacción quedó en el cuarto inferior."],
    ["low", "Bajo desempeño relativo", "Alcance y satisfacción en el cuarto inferior. Es una posición en este recorte, no un juicio editorial."],
  ];
  for (const [key, title, caption] of groups) {
    const rows = model.lists[key];
    if (!rows.length) continue;
    host.append(el("section", { class: "cases" }, [
      el("h3", { text: title }),
      el("p", { class: "caption", text: caption }),
      caseTable(rows),
    ]));
  }
}

function caseTable(rows) {
  return simpleTable(
    ["Título", "Año", "Reviews", "Tasa positiva", "Owners estimados", "Precio", "Alcance", "Satisfacción"].map((text, index) => ({ text, num: index > 0 })),
    rows.map((row) => [
      steamLink(row),
      numCell(String(row.year)),
      numCell(num(row.reviews)),
      numCell(rate(row.rate)),
      row.ownerMids.label,
      numCell(usd(row.priceCents)),
      numCell(decimal(row.alcance * 100, 0)),
      numCell(row.satisfaction == null ? "—" : decimal(row.satisfaction * 100, 0)),
    ]),
  );
}

function steamLink(row) {
  return el("a", {
    href: `https://store.steampowered.com/app/${row.appid}`,
    target: "_blank",
    rel: "noopener noreferrer",
    text: row.name,
  });
}

async function renderLift(host, model) {
  const excludeBits = new Set(state.selection.filter((item) => item.tax === "Tags").map((item) => item.bit));
  const breakouts = model.segmentIds["Breakout bien recibido"] || [];
  const lows = model.segmentIds["Bajo desempeño"] || [];
  let breakoutFloor = 8;
  let lifts = await liftTags(state.cat, breakouts, model.eligibleIds, excludeBits, breakoutFloor);
  let aviso = "Se piden al menos 8 juegos del segmento. Un lift de 2 quiere decir que el tag aparece el doble de seguido que entre los juegos evaluables del recorte. No es una causa, y con pocos casos es frágil.";
  if (!lifts.length && breakouts.length >= 5) {
    breakoutFloor = 5;
    lifts = await liftTags(state.cat, breakouts, model.eligibleIds, excludeBits, breakoutFloor);
    aviso = "El segmento es chico: el mínimo bajó a 5 juegos. Leé estos lifts con más desconfianza.";
  }
  if (lifts.length) {
    host.append(block(
      "Tags de más en los breakouts",
      aviso,
      chartBars({
        rows: lifts.slice(0, 12).map((row) => ({ name: row.name, value: row.lift, color: "#7aa2ff" })),
        format: (value) => `${decimal(value, 2)}×`,
        aria: "Lift de tags en breakouts",
      }),
      liftTable(lifts.slice(0, 12)),
    ));
  }
  const liftsBajos = (await liftTags(state.cat, lows, model.eligibleIds, excludeBits, 5)).slice(0, 8);
  if (liftsBajos.length) {
    host.append(el("details", { class: "figures" }, [
      el("summary", { text: "Tags de más en el bajo desempeño relativo" }),
      el("p", { class: "caption", text: "La misma cuenta, sobre el segmento de alcance y satisfacción bajos. Tampoco es una receta al revés." }),
      liftTable(liftsBajos),
    ]));
  }
}

function liftTable(rows) {
  return simpleTable(
    ["Tag", "En el segmento", "% segmento", "% referencia", "Lift", "Diferencia"].map((text, index) => ({ text, num: index > 0 })),
    rows.map((row) => [
      row.name,
      numCell(num(row.group)),
      numCell(pct(row.groupPct)),
      numCell(pct(row.referenciaPct)),
      numCell(`${decimal(row.lift, 2)}×`),
      numCell(pp(row.pp)),
    ]),
  );
}

function rankingKey() {
  return `${state.movTax}|${state.movesAnchor}|${state.movesWindow}`;
}

async function renderMoves(ticket) {
  const host = document.getElementById("moves-live");
  if (!state.cat) {
    host.replaceChildren(el("p", { class: "note", text: "Cargando el catálogo en el navegador…" }));
    return;
  }
  const key = rankingKey();
  if (!cacheRanking.has(key)) {
    host.replaceChildren(el("p", { class: "note", text: "Consultando movimientos…" }));
  }
  let outcome;
  try {
    outcome = await rankingCache();
  } catch (error) {
    if (ticket !== movesTicket) return;
    host.replaceChildren(el("p", { class: "note", text: `No se pudo consultar: ${error.message}` }));
    return;
  }
  if (ticket !== movesTicket || key !== rankingKey()) return;
  paintMoves(outcome);
}

function paintMoves(outcome) {
  const host = document.getElementById("moves-live");
  const minimums = state.movesSmall ? { recent: 1, previous: 0 } : FLOORS[state.movTax];
  const rows = outcome.rows.filter((row) => row.recentReleases >= minimums.recent && row.prevReleases >= minimums.previous && row.dPart != null);
  const text = foldText(state.movesQuery.trim());
  const visibles = text ? rows.filter((row) => foldText(row.name).includes(text)) : rows;
  const sortedRows = visibles.slice().sort((a, b) => b.dPart - a.dPart);
  const gainers = sortedRows.filter((row) => row.dPart > 0).slice(0, 12);
  const losers = sortedRows.filter((row) => row.dPart < 0).sort((a, b) => a.dPart - b.dPart).slice(0, 12);
  host.replaceChildren();
  host.append(el("p", { class: "caption", text: `Ventanas ${yearSpan(outcome.previousStart, outcome.previousEnd)} y ${yearSpan(outcome.recentStart, outcome.anchor)}. Cobertura de ${TAX_PLURAL[state.movTax].toLowerCase()}: ${pct(outcome.prevCoverage)} y después ${pct(outcome.recentCoverage)}. ${state.movesSmall ? "Se incluyen etiquetas con pocos lanzamientos: el orden es más ruidoso." : `Quedan afuera las que no llegan a ${minimums.recent} lanzamientos recientes y ${minimums.previous} previos.`}` }));
  if (Math.abs((outcome.recentCoverage ?? 0) - (outcome.prevCoverage ?? 0)) >= 8) {
    host.append(el("p", { class: "note", text: "La cobertura cambia bastante entre ventanas. Una etiqueta puede «caer» porque faltan metadatos." }));
  }
  if (!sortedRows.length) {
    host.append(el("p", { class: "note", text: text ? "Ninguna etiqueta coincide con el filtro." : "Ninguna etiqueta llega al mínimo de lanzamientos en estas ventanas." }));
    return;
  }
  if (gainers.length) {
    host.append(block("Ganan participación", "Las doce subas más grandes, en puntos.", chartBars({
      rows: gainers.map((row) => ({ name: row.name, value: row.dPart, color: "#3ddc97" })),
      format: (value) => pp(value),
      aria: "Etiquetas que ganan participación",
      signed: true,
    }), null));
  }
  if (losers.length) {
    host.append(block("Pierden participación", "Las doce bajas más grandes.", chartBars({
      rows: losers.map((row) => ({ name: row.name, value: row.dPart, color: "#fb7185" })),
      format: (value) => pp(value),
      aria: "Etiquetas que pierden participación",
      signed: true,
    }), null));
  }
  host.append(el("p", { class: "caption", text: "Abrir una etiqueta muestra, en Explorar, los años de estas dos ventanas." }));
  host.append(el("details", { class: "figures", open: Boolean(text) }, [
    el("summary", { text: `Ver la tabla completa (${num(sortedRows.length)} etiquetas)` }),
    simpleTable(
    ["Etiqueta", "Lanz. previos", "Lanz. recientes", "Cambio de volumen", "Participación previa", "Participación reciente", "Cambio"].map((header, index) => ({ text: header, num: index > 0 })),
    sortedRows.map((row) => [
      el("button", { type: "button", class: "row-link", text: row.name, onClick: () => openLabel(row) }),
      numCell(num(row.prevReleases)),
      numCell(num(row.recentReleases)),
      numCell(signedPct(row.dVol)),
      numCell(pct(row.partPrev)),
      numCell(pct(row.partRec)),
      numCell(pp(row.dPart)),
    ]),
    ),
  ]));
}

function rankingCache() {
  const key = rankingKey();
  if (!cacheRanking.has(key)) {
    const consulta = ranking(state.cat, state.movTax, state.movesAnchor, state.movesWindow);
    consulta.catch(() => cacheRanking.delete(key));
    cacheRanking.set(key, consulta);
  }
  return cacheRanking.get(key);
}

async function openLabel(row) {
  const outcome = await rankingCache();
  state.view = "explore";
  state.mode = "labels";
  state.match = "all";
  state.yearWindow = state.movesWindow;
  state.yearFrom = Math.max(state.meta.yearMin, outcome.previousStart);
  state.yearTo = Math.min(state.meta.yearMax, outcome.anchor);
  state.selection = [{ tax: state.movTax, bit: row.bit, name: row.name }];
  render();
  document.getElementById("explore").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOverview() {
  const meta = state.meta;
  const host = document.getElementById("overview-live");
  const index2010 = meta.years.indexOf(2010);
  const years = meta.years.slice(index2010);
  host.replaceChildren(
    el("div", { class: "kpis" }, [
      kpi(num(meta.source.titles), "Títulos analizados"),
      kpi(pct(meta.taxonomies.Tags.coverage), "Con tags informados"),
      kpi(String(meta.taxonomies.Tags.uniqueLabels), "Tags distintos"),
      kpi(`${meta.yearMin}–${meta.yearMax}`, "Años de lanzamiento"),
    ]),
    el("div", { class: "cols-3" }, [
      taxonomyCard("Tags", "Mecánica, tema, tono, estética. Es la capa útil para un nicho y la más incompleta."),
      taxonomyCard("Genres", "Familias amplias. Indie, Early Access y Free To Play vienen en esta lista: hablan de producción o de ficha, no sólo de género."),
      taxonomyCard("Categories", "Funciones de Steam: un jugador, logros, control, cooperativo. Un salto puede ser un cambio de ficha, no de demanda."),
    ]),
    block(
      "Más lanzamientos, menos tags informados",
      "Barras: títulos publicados. Línea: porcentaje con tags, en el eje derecho. Desde 2010.",
      chartBarsLine({
        years,
        bars: meta.market.slice(index2010),
        line: meta.coverage.Tags.slice(index2010),
        formatBars: num,
        formatLine: (value) => pct(value, 0),
        aria: "Lanzamientos anuales y cobertura de tags",
        tooltip: tooltip(),
      }),
      null,
    ),
    el("p", { class: "note", text: `En 2024 los tags cubren ${pct(coverageFor("Tags", 2024))}; en 2025, ${pct(coverageFor("Tags", 2025))}. En 2026 este archivo no trae tags. La comparación recomendada termina en ${meta.recommendedYear}.` }),
    el("div", { class: "cols-2" }, [
      block("Tags más presentes", "Los porcentajes no suman 100%: un juego lleva varias etiquetas.", topBars("Tags"), null),
      block("Géneros más presentes", "Cobertura casi completa. Siguen sin ser excluyentes.", topBars("Genres"), null),
    ]),
    block("Categorías más presentes", "Single-player lidera porque describe el modo de uso, no un género.", topBars("Categories"), null),
    block(
      "Cuántos tags lleva cada juego",
      `${num(meta.density.Tags.find((row) => row.n === 0)?.games)} juegos no tienen tags. Entre los demás, el promedio es ${decimal(meta.taxonomies.Tags.average, 2)}. El pico en 20 es un tope de la fuente, no una elección editorial: miles de fichas llegan al máximo guardado.`,
      chartColumns({
        labels: meta.density.Tags.map((row) => String(row.n)),
        values: meta.density.Tags.map((row) => row.games),
        format: num,
        aria: "Cantidad de tags por juego",
      }),
      null,
    ),
    el("div", { class: "cols-2" }, [
      el("section", {}, [el("h3", { text: "Combinaciones exactas de géneros" }), combinationTable("Genres")]),
      el("section", {}, [el("h3", { text: "Combinaciones exactas de categorías" }), combinationTable("Categories")]),
    ]),
  );
  const note = document.getElementById("source-note");
  note.replaceChildren(
    el("a", { href: meta.source.url, text: meta.source.name }),
    ` · ${meta.source.credit}. ${num(meta.source.titles)} títulos. ${shortDate(meta.source.firstDate)} a ${shortDate(meta.source.lastDate)}. SHA-256 ${meta.source.sha256.slice(0, 12)}… No está afiliado a Valve ni a los autores del dataset.`,
  );
}

function taxonomyCard(tax, text) {
  const data = state.meta.taxonomies[tax];
  return el("article", { class: "card" }, [
    el("h3", { text: TAX_PLURAL[tax] }),
    el("p", { class: "stat", text: pct(data.coverage, data.coverage > 99 ? 1 : 1) }),
    el("p", { text: text }),
    el("p", { class: "caption", text: `${num(data.uniqueLabels)} etiquetas · ${num(data.games)} juegos · promedio ${decimal(data.average, 2)}` }),
  ]);
}

function topBars(tax) {
  const rows = state.meta.labels[tax]
    .map((name, bit) => ({ name, value: state.meta.labelCounts[tax][bit], color: "#7aa2ff" }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);
  return chartBars({ rows, format: num, aria: `Más frecuentes: ${TAX_PLURAL[tax]}` });
}

function combinationTable(tax) {
  return simpleTable(
    [{ text: "Combinación" }, { text: "Títulos", num: true }],
    state.meta.combinations[tax].map((row) => [row.name, numCell(num(row.games))]),
  );
}

function fillPresets() {
  const host = document.getElementById("presets");
  host.replaceChildren();
  for (const preset of PRESETS) {
    const complete = preset.selected.every(([tax, name]) => state.bits.get(tax)?.has(name));
    if (!complete) continue;
    host.append(el("button", { type: "button", class: "preset", onClick: () => applyPreset(preset) }, [
      el("strong", { text: preset.title }),
      el("span", { text: preset.text }),
    ]));
  }
}

function applyPreset(preset) {
  state.selection = resolveSelection(preset.selected.map(([tax, name]) => ({ tax, name })));
  state.mode = preset.mode;
  state.match = preset.match;
  state.view = "explore";
  render();
}

function searchLabels(text) {
  const consulta = foldText(text.trim());
  if (!state.meta || !consulta) return [];
  const output_dir = [];
  for (const tax of ["Tags", "Genres", "Categories"]) {
    state.meta.labels[tax].forEach((name, bit) => {
      if (foldText(name).includes(consulta)) {
        output_dir.push({ tax, bit, name: name, games: state.meta.labelCounts[tax][bit] });
      }
    });
  }
  output_dir.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name, "es"));
  return output_dir.slice(0, 12);
}

function renderSuggestions() {
  const list = document.getElementById("suggestions");
  const box = document.getElementById("q");
  list.replaceChildren();
  if (!state.suggestions.length) {
    list.hidden = true;
    box.setAttribute("aria-expanded", "false");
    return;
  }
  list.hidden = false;
  box.setAttribute("aria-expanded", "true");
  state.suggestions.forEach((item, index) => {
    list.append(el("li", {}, [
      el("button", {
        type: "button",
        ariaSelected: index === state.suggestionIndex ? "true" : "false",
        onMouseDown: (evento) => evento.preventDefault(),
        onClick: () => addSelection(item),
      }, [
        el("span", {}, [el("span", { class: "tax", text: TAX_LABEL[item.tax] }), ` ${item.name}`]),
        el("span", { class: "count", text: num(item.games) }),
      ]),
    ]));
  });
}

function addSelection(item) {
  if (state.selection.some((actual) => actual.tax === item.tax && actual.bit === item.bit)) return;
  if (state.selection.length >= 8) {
    document.getElementById("selection-limit").textContent = "Ocho etiquetas es el máximo para que los gráficos se puedan leer.";
    return;
  }
  state.selection.push({ tax: item.tax, bit: item.bit, name: item.name });
  state.view = "explore";
  document.getElementById("q").value = "";
  state.suggestions = [];
  state.suggestionIndex = -1;
  renderSuggestions();
  render();
}

async function copyLink(buttonEl) {
  const original = buttonEl.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    buttonEl.textContent = "Enlace copiado";
  } catch {
    buttonEl.textContent = "Copiá la URL de la barra";
  }
  setTimeout(() => {
    buttonEl.textContent = original;
  }, 1800);
}

function on(id, evento, fn) {
  document.getElementById(id).addEventListener(evento, fn);
}

function bindUi() {
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.mode = radio.value;
      render();
    });
  }
  for (const radio of document.querySelectorAll('input[name="match"]')) {
    radio.addEventListener("change", () => {
      if (!radio.checked) return;
      state.match = radio.value;
      render();
    });
  }
  on("yearFrom", "change", () => {
    state.yearFrom = clampYear(document.getElementById("yearFrom").value, state.yearFrom);
    if (state.yearFrom > state.yearTo) state.yearTo = state.yearFrom;
    render();
  });
  on("yearTo", "change", () => {
    state.yearTo = clampYear(document.getElementById("yearTo").value, state.yearTo);
    if (state.yearTo < state.yearFrom) state.yearFrom = state.yearTo;
    render();
  });
  on("yearWindow", "change", () => {
    state.yearWindow = Number(document.getElementById("yearWindow").value);
    render();
  });
  on("min-reviews", "change", () => {
    state.minReviews = Number(document.getElementById("min-reviews").value);
    render();
  });
  on("clear-selection", "click", () => {
    state.selection = [];
    render();
  });
  on("q", "input", () => {
    state.suggestions = searchLabels(document.getElementById("q").value);
    state.suggestionIndex = state.suggestions.length ? 0 : -1;
    renderSuggestions();
  });
  on("q", "keydown", (evento) => {
    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      state.suggestionIndex = Math.min(state.suggestions.length - 1, state.suggestionIndex + 1);
      renderSuggestions();
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      state.suggestionIndex = Math.max(0, state.suggestionIndex - 1);
      renderSuggestions();
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      const elegida = state.suggestions[state.suggestionIndex] || state.suggestions[0];
      if (elegida) addSelection(elegida);
    } else if (evento.key === "Escape") {
      state.suggestions = [];
      renderSuggestions();
    }
  });
  document.addEventListener("click", (evento) => {
    if (!evento.target.closest(".search")) {
      state.suggestions = [];
      renderSuggestions();
    }
  });
  on("moves-tax", "change", () => {
    state.movTax = document.getElementById("moves-tax").value;
    render();
  });
  on("moves-window", "change", () => {
    state.movesWindow = Number(document.getElementById("moves-window").value);
    render();
  });
  on("moves-anchor", "change", () => {
    state.movesAnchor = clampYear(document.getElementById("moves-anchor").value, state.movesAnchor);
    render();
  });
  on("moves-small", "change", () => {
    state.movesSmall = document.getElementById("moves-small").checked;
    render();
  });
  on("moves-query", "input", () => {
    state.movesQuery = document.getElementById("moves-query").value;
    if (state.view !== "moves") return;
    const key = rankingKey();
    const cached = cacheRanking.get(key);
    if (!cached) return;
    cached.then((outcome) => {
      if (key !== rankingKey()) return;
      paintMoves(outcome);
    }).catch(() => {});
  });
  window.addEventListener("hashchange", () => {
    readHash();
    render();
  });
}

async function fetchBuffer(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo leer ${url}`);
  const total = Number(response.headers.get("content-length") || 0);
  if (!response.body) return response.arrayBuffer();
  const reader = response.body.getReader();
  const parts = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    received += value.byteLength;
    onProgress(received, total);
  }
  const output_dir = new Uint8Array(received);
  let offset = 0;
  for (const part of parts) {
    output_dir.set(part, offset);
    offset += part.byteLength;
  }
  return output_dir.buffer;
}

function renderStatus(text) {
  const svgEl = document.getElementById("loading");
  svgEl.hidden = !text;
  svgEl.textContent = text || "";
}

async function start() {
  bindUi();
  if (location.protocol === "file:") {
    renderStatus("Abrí esta carpeta con un servidor local. En la terminal: python -m http.server 8080 y entrá a http://localhost:8080");
    return;
  }
  try {
    state.meta = await fetch("data/meta.json").then((response) => {
      if (!response.ok) throw new Error("meta");
      return response.json();
    });
  } catch {
    renderStatus("No se encontró data/meta.json. Generá los datos con build.py y serví la carpeta por HTTP.");
    return;
  }
  if (state.meta.format !== 2) {
    renderStatus("Los datos son de una versión que esta página no sabe leer. Volvé a generarlos con build.py.");
    return;
  }
  for (const tax of ["Genres", "Categories", "Tags"]) {
    state.bits.set(tax, new Map(state.meta.labels[tax].map((name, bit) => [name, bit])));
  }
  state.yearFrom = 2010;
  state.yearTo = state.meta.recommendedYear;
  state.movesAnchor = state.meta.recommendedYear;
  document.getElementById("yearFrom").min = String(state.meta.yearMin);
  document.getElementById("yearFrom").max = String(state.meta.yearMax);
  document.getElementById("yearTo").min = String(state.meta.yearMin);
  document.getElementById("yearTo").max = String(state.meta.yearMax);
  document.getElementById("moves-anchor").min = String(state.meta.yearMin);
  document.getElementById("moves-anchor").max = String(state.meta.recommendedYear);
  readHash();
  renderOverview();
  fillPresets();
  render();
  renderStatus("Cargando DuckDB en el navegador…");
  try {
    const motor = await openInBrowser();
    const buffer = await fetchBuffer("data/games.json", (loaded, total) => {
      renderStatus(total ? `Cargando el catálogo… ${num(loaded)} de ${num(total)} bytes` : "Cargando el catálogo…");
    });
    renderStatus("Preparando las consultas…");
    await motor.loadBuffer(buffer);
    await prepareTables(motor.query, state.meta);
    state.cat = createCatalog(state.meta, motor);
  } catch (error) {
    renderStatus(`No se pudo preparar DuckDB (${error.message}). Hace falta conexión para bajar el motor la primera vez, y el archivo data/games.json.`);
    return;
  }
  renderStatus("");
  render();
}

start();
