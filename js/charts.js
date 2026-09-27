import { decimal } from "./format.js";

const NS = "http://www.w3.org/2000/svg";
const INK = "#e7e9f2";
const MUTED = "#9aa3bd";
const GRID = "#2a3148";
const TEAL = "#7aa2ff";
const VIOLET = "#c4b5fd";

export const PALETTE = ["#7aa2ff", "#c4b5fd", "#5eead4", "#f0ab6a", "#f9a8d4", "#86efac", "#93c5fd", "#fde68a"];

export const SEGMENT_COLOR = {
  "Breakout bien recibido": "#7aa2ff",
  "Éxito con recepción débil": "#f0ab6a",
  "Joya oculta": "#c4b5fd",
  "Bajo desempeño": "#fb7185",
  "Típico": "#9aa3bd",
  Intermedio: "#5eead4",
  "Evidencia insuficiente": "#5c657f",
};

function svgEl(name, attributes) {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function svgBase(boxWidth, boxHeight, aria) {
  const element = svgEl("svg", { viewBox: `0 0 ${boxWidth} ${boxHeight}`, role: "img" });
  if (aria) element.setAttribute("aria-label", aria);
  element.setAttribute("font-family", "Atkinson Hyperlegible, Segoe UI, sans-serif");
  return element;
}

function niceCeil(value) {
  if (!(value > 0)) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exp;
  const bonito = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10;
  return bonito * exp;
}

function niceFloor(value) {
  if (!(value < 0)) return 0;
  return -niceCeil(Math.abs(value));
}

function shorten(text, maximum) {
  if (text.length <= maximum) return text;
  return `${text.slice(0, maximum - 1)}…`;
}

export function fillTooltip(tooltip, title, lines) {
  tooltip.replaceChildren();
  const header = document.createElement("strong");
  header.textContent = title;
  tooltip.append(header);
  for (const line of lines) {
    const row = document.createElement("span");
    row.textContent = line;
    tooltip.append(row);
  }
  tooltip.hidden = false;
}

function placeTooltip(tooltip, evento) {
  const margin = 14;
  const boxWidth = tooltip.offsetWidth;
  const boxHeight = tooltip.offsetHeight;
  let x = evento.clientX + margin;
  let y = evento.clientY + margin;
  if (x + boxWidth > window.innerWidth - 8) x = evento.clientX - boxWidth - margin;
  if (y + boxHeight > window.innerHeight - 8) y = evento.clientY - boxHeight - margin;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTooltip(tooltip) {
  if (tooltip) tooltip.hidden = true;
}

function xPositions(count, leftEdge, boxWidth) {
  if (count <= 1) return [leftEdge + boxWidth / 2];
  return Array.from({ length: count }, (_, index) => leftEdge + (boxWidth * index) / (count - 1));
}

function yearLabels(years, xs, baseY, parent) {
  const step = years.length > 12 ? 2 : 1;
  years.forEach((year, index) => {
    if (index % step !== 0 && index !== years.length - 1) return;
    const text = svgEl("text", {
      x: xs[index],
      y: baseY,
      "text-anchor": "middle",
      fill: MUTED,
      "font-size": 11,
    });
    text.textContent = String(year);
    parent.append(text);
  });
}

export function chartLines({ years, series, formatY, aria, tooltip, log = false }) {
  const boxWidth = 720;
  const boxHeight = 320;
  const leftEdge = 54;
  const rightEdge = 16;
  const above = 16;
  const below = 36;
  const plotBoxWidth = boxWidth - leftEdge - rightEdge;
  const plotBoxHeight = boxHeight - above - below;
  const element = svgBase(boxWidth, boxHeight, aria);
  const values = series.flatMap((seriesData) => seriesData.values.filter((value) => value != null && (!log || value > 0)));
  if (!years.length || !values.length) {
    element.append(svgEl("text", { x: 24, y: 40, fill: MUTED, "font-size": 14 }));
    element.lastChild.textContent = "Sin datos en este período.";
    return element;
  }
  let yMin;
  let yMax;
  if (log) {
    yMin = Math.min(...values);
    yMax = Math.max(...values);
    if (yMin === yMax) {
      yMin /= 2;
      yMax *= 2;
    }
  } else {
    yMin = 0;
    yMax = niceCeil(Math.max(...values) * 1.12);
  }
  const yDe = (value) => {
    if (log) {
      const t = (Math.log10(value) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin) || 1);
      return above + plotBoxHeight - t * plotBoxHeight;
    }
    return above + plotBoxHeight - ((value - yMin) / (yMax - yMin || 1)) * plotBoxHeight;
  };
  const ticks = log ? logTicks(yMin, yMax) : [0, yMax / 2, yMax];
  for (const brand of ticks) {
    const y = yDe(brand);
    element.append(svgEl("line", { x1: leftEdge, x2: boxWidth - rightEdge, y1: y, y2: y, stroke: GRID }));
    element.append(svgEl("text", { x: leftEdge - 8, y: y + 4, "text-anchor": "end", fill: MUTED, "font-size": 11 }));
    element.lastChild.textContent = formatY(brand);
  }
  const xs = xPositions(years.length, leftEdge, plotBoxWidth);
  yearLabels(years, xs, boxHeight - 12, element);
  series.forEach((seriesData) => {
    let span = [];
    const close = () => {
      if (span.length < 2) {
        span = [];
        return;
      }
      element.append(svgEl("polyline", {
        points: span.map((point) => `${point.x},${point.y}`).join(" "),
        fill: "none",
        stroke: seriesData.color,
        "stroke-width": 2.4,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      }));
      span = [];
    };
    seriesData.values.forEach((value, index) => {
      if (value == null || (log && value <= 0)) {
        close();
        return;
      }
      span.push({ x: xs[index], y: yDe(value) });
    });
    close();
  });
  if (tooltip) {
    const guide = svgEl("line", { y1: above, y2: above + plotBoxHeight, stroke: INK, "stroke-dasharray": "3 3", visibility: "hidden" });
    element.append(guide);
    element.addEventListener("pointermove", (evento) => {
      const box = element.getBoundingClientRect();
      const x = ((evento.clientX - box.left) / box.width) * boxWidth;
      let best = 0;
      let distance = Infinity;
      xs.forEach((position, index) => {
        const delta = Math.abs(position - x);
        if (delta < distance) {
          distance = delta;
          best = index;
        }
      });
      guide.setAttribute("x1", xs[best]);
      guide.setAttribute("x2", xs[best]);
      guide.setAttribute("visibility", "visible");
      fillTooltip(
        tooltip,
        String(years[best]),
        series.map((seriesData) => `${seriesData.name}: ${formatY(seriesData.values[best])}`),
      );
      placeTooltip(tooltip, evento);
    });
    element.addEventListener("pointerleave", () => {
      guide.setAttribute("visibility", "hidden");
      hideTooltip(tooltip);
    });
  }
  return element;
}

function logTicks(minimum, maximum) {
  const ticks = [];
  let power = 10 ** Math.floor(Math.log10(minimum));
  const selectionLimit = 10 ** Math.ceil(Math.log10(maximum));
  while (power <= selectionLimit * 1.01 && ticks.length < 6) {
    if (power >= minimum / 1.2 && power <= maximum * 1.2) ticks.push(power);
    power *= 10;
  }
  return ticks.length ? ticks : [minimum, maximum];
}

export function chartBarsLine({ years, bars, line, formatBars, formatLine, aria, tooltip }) {
  const boxWidth = 720;
  const boxHeight = 320;
  const leftEdge = 52;
  const rightEdge = 58;
  const above = 16;
  const below = 36;
  const plotBoxWidth = boxWidth - leftEdge - rightEdge;
  const plotBoxHeight = boxHeight - above - below;
  const element = svgBase(boxWidth, boxHeight, aria);
  const maxBars = Math.max(...bars, 0);
  const maxLine = Math.max(...line, 0);
  const yMaxB = niceCeil(maxBars * 1.12);
  const yMaxL = maxLine <= 100 ? 100 : niceCeil(maxLine * 1.12);
  const yB = (value) => above + plotBoxHeight - (value / (yMaxB || 1)) * plotBoxHeight;
  const yL = (value) => above + plotBoxHeight - (value / (yMaxL || 1)) * plotBoxHeight;
  for (const brand of [0, yMaxB / 2, yMaxB]) {
    const y = yB(brand);
    element.append(svgEl("line", { x1: leftEdge, x2: boxWidth - rightEdge, y1: y, y2: y, stroke: GRID }));
    element.append(svgEl("text", { x: leftEdge - 8, y: y + 4, "text-anchor": "end", fill: TEAL, "font-size": 11 }));
    element.lastChild.textContent = formatBars(brand);
  }
  for (const brand of [yMaxL / 2, yMaxL]) {
    element.append(svgEl("text", { x: boxWidth - rightEdge + 8, y: yL(brand) + 4, fill: VIOLET, "font-size": 11 }));
    element.lastChild.textContent = formatLine(brand);
  }
  const step = plotBoxWidth / years.length;
  const centers = years.map((_, index) => leftEdge + index * step + step / 2);
  bars.forEach((value, index) => {
    const barHeight = plotBoxHeight - (yB(value) - above);
    element.append(svgEl("rect", {
      x: leftEdge + index * step + step * 0.18,
      y: yB(value),
      width: step * 0.64,
      height: Math.max(0, barHeight),
      fill: TEAL,
    }));
  });
  const points = centers.map((x, index) => `${x},${yL(line[index])}`).join(" ");
  element.append(svgEl("polyline", { points: points, fill: "none", stroke: VIOLET, "stroke-width": 2.2 }));
  yearLabels(years, centers, boxHeight - 12, element);
  if (tooltip) {
    element.addEventListener("pointermove", (evento) => {
      const box = element.getBoundingClientRect();
      const x = ((evento.clientX - box.left) / box.width) * boxWidth;
      let index = Math.floor((x - leftEdge) / step);
      index = Math.max(0, Math.min(years.length - 1, index));
      fillTooltip(tooltip, String(years[index]), [
        `Recorte: ${formatBars(bars[index])}`,
        `Mercado: ${formatLine(line[index])}`,
      ]);
      placeTooltip(tooltip, evento);
    });
    element.addEventListener("pointerleave", () => hideTooltip(tooltip));
  }
  return element;
}

export function chartMultiples({ years, series, formatY, aria }) {
  const boxWidth = 720;
  const rowHeight = 72;
  const leftEdge = 132;
  const rightEdge = 12;
  const element = svgBase(boxWidth, Math.max(rowHeight, series.length * rowHeight), aria);
  const plotBoxWidth = boxWidth - leftEdge - rightEdge;
  series.forEach((seriesData, row) => {
    const values = seriesData.values.map((value) => value ?? 0);
    const maximum = niceCeil(Math.max(...values, 0) * 1.15);
    const above = row * rowHeight + 16;
    const plotHeight = 40;
    const base = above + plotHeight;
    element.append(svgEl("text", { x: 0, y: above + 16, fill: INK, "font-size": 13 }));
    element.lastChild.textContent = shorten(seriesData.name, 18);
    element.append(svgEl("line", { x1: leftEdge, x2: boxWidth - rightEdge, y1: base, y2: base, stroke: GRID }));
    const xs = xPositions(years.length, leftEdge, plotBoxWidth);
    let span = [];
    seriesData.values.forEach((value, index) => {
      if (value == null) return;
      span.push(`${xs[index]},${base - (value / (maximum || 1)) * plotHeight}`);
    });
    if (span.length > 1) {
      element.append(svgEl("polyline", {
        points: span.join(" "),
        fill: "none",
        stroke: seriesData.color,
        "stroke-width": 2,
      }));
    }
    element.append(svgEl("text", { x: boxWidth - rightEdge, y: above + 12, "text-anchor": "end", fill: MUTED, "font-size": 11 }));
    element.lastChild.textContent = formatY(maximum);
  });
  return element;
}

export function chartBars({ rows, format, aria, signed = false }) {
  const boxWidth = 720;
  const chars = rows.reduce((maximum, row) => Math.max(maximum, Math.min(row.name.length, 36)), 12);
  const leftEdge = Math.min(260, Math.max(148, Math.round(chars * 7.2)));
  const rightEdge = 78;
  const rowHeight = 28;
  const above = 12;
  const element = svgBase(boxWidth, above + rows.length * rowHeight + 8, aria);
  if (!rows.length) {
    element.append(svgEl("text", { x: 0, y: 24, fill: MUTED, "font-size": 14 }));
    element.lastChild.textContent = "Sin datos para este gráfico.";
    return element;
  }
  const values = rows.map((row) => row.value);
  let minimum = signed ? niceFloor(Math.min(...values, 0) * 1.15) : 0;
  let maximum = niceCeil(Math.max(...values, 0) * 1.15);
  if (minimum === 0 && maximum === 0) maximum = 1;
  const plotBoxWidth = boxWidth - leftEdge - rightEdge;
  const scaleValue = (value) => leftEdge + ((value - minimum) / (maximum - minimum || 1)) * plotBoxWidth;
  const cero = scaleValue(0);
  element.append(svgEl("line", { x1: cero, x2: cero, y1: 4, y2: above + rows.length * rowHeight, stroke: GRID }));
  rows.forEach((row, index) => {
    const y = above + index * rowHeight;
    const x = scaleValue(Math.min(0, row.value));
    const xFin = scaleValue(Math.max(0, row.value));
    element.append(svgEl("text", { x: leftEdge - 10, y: y + 16, "text-anchor": "end", fill: INK, "font-size": 13 }));
    element.lastChild.textContent = shorten(row.name, 36);
    element.append(svgEl("rect", {
      x,
      y: y + 6,
      width: Math.max(1, xFin - x),
      height: 14,
      fill: row.color || TEAL,
    }));
    element.append(svgEl("text", {
      x: row.value >= 0 ? xFin + 6 : x - 6,
      y: y + 17,
      "text-anchor": row.value >= 0 ? "start" : "end",
      fill: MUTED,
      "font-size": 12,
    }));
    element.lastChild.textContent = format(row.value);
  });
  return element;
}

export function chartColumns({ labels, values, aria, format }) {
  const boxWidth = 720;
  const boxHeight = 260;
  const leftEdge = 44;
  const rightEdge = 12;
  const above = 16;
  const below = 48;
  const element = svgBase(boxWidth, boxHeight, aria);
  const maximum = niceCeil(Math.max(...values, 0) * 1.12);
  const plotBoxWidth = boxWidth - leftEdge - rightEdge;
  const plotBoxHeight = boxHeight - above - below;
  const step = plotBoxWidth / Math.max(labels.length, 1);
  element.append(svgEl("line", { x1: leftEdge, x2: boxWidth - rightEdge, y1: above + plotBoxHeight, y2: above + plotBoxHeight, stroke: GRID }));
  values.forEach((value, index) => {
    const barHeight = (value / (maximum || 1)) * plotBoxHeight;
    element.append(svgEl("rect", {
      x: leftEdge + index * step + step * 0.18,
      y: above + plotBoxHeight - barHeight,
      width: step * 0.64,
      height: barHeight,
      fill: TEAL,
    }));
    const text = svgEl("text", {
      x: leftEdge + index * step + step / 2,
      y: above + plotBoxHeight + 16,
      "text-anchor": "end",
      fill: MUTED,
      "font-size": 11,
      transform: `rotate(-40 ${leftEdge + index * step + step / 2} ${above + plotBoxHeight + 16})`,
    });
    text.textContent = labels[index];
    element.append(text);
  });
  element.append(svgEl("text", { x: leftEdge - 6, y: above + 8, "text-anchor": "end", fill: MUTED, "font-size": 11 }));
  element.lastChild.textContent = format(maximum);
  return element;
}

export function chartStacked({ parts, aria }) {
  const boxWidth = 720;
  const boxHeight = 36;
  const element = svgBase(boxWidth, boxHeight, aria);
  const total = parts.reduce((totalSum, part) => totalSum + part.value, 0) || 1;
  let x = 0;
  for (const part of parts) {
    const w = (part.value / total) * boxWidth;
    if (w <= 0) continue;
    element.append(svgEl("rect", { x, y: 0, width: w, height: boxHeight, fill: part.color }));
    x += w;
  }
  return element;
}

export function chartHeatmap({ names, matriz, aria }) {
  const count = names.length;
  const margin = 128;
  const cell = Math.max(36, Math.min(64, (720 - margin) / count));
  const boxWidth = margin + cell * count + 8;
  const boxHeight = margin + cell * count + 8;
  const element = svgBase(boxWidth, boxHeight, aria);
  names.forEach((name, index) => {
    const x = margin + index * cell + cell / 2;
    const y = margin - 8;
    const text = svgEl("text", {
      x,
      y,
      "text-anchor": "end",
      fill: INK,
      "font-size": 11,
      transform: `rotate(-40 ${x} ${y})`,
    });
    text.textContent = shorten(name, 22);
    element.append(text);
    element.append(svgEl("text", {
      x: margin - 8,
      y: margin + index * cell + cell / 2 + 4,
      "text-anchor": "end",
      fill: INK,
      "font-size": 11,
    }));
    element.lastChild.textContent = shorten(name, 18);
  });
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const value = matriz[row][column];
      const t = Math.max(0, Math.min(1, value / 0.35));
      element.append(svgEl("rect", {
        x: margin + column * cell,
        y: margin + row * cell,
        width: cell - 2,
        height: cell - 2,
        fill: mix("#1a2033", "#6d8cff", t),
      }));
      element.append(svgEl("text", {
        x: margin + column * cell + (cell - 2) / 2,
        y: margin + row * cell + (cell - 2) / 2 + 4,
        "text-anchor": "middle",
        fill: t > 0.62 ? "#0e1018" : INK,
        "font-size": cell < 48 ? 10 : 12,
      }));
      element.lastChild.textContent = decimal(value, 2);
    }
  }
  return element;
}

function mix(yearFrom, yearTo, t) {
  const a = yearFrom.match(/\w\w/g).map((pair) => parseInt(pair, 16));
  const b = yearTo.match(/\w\w/g).map((pair) => parseInt(pair, 16));
  const canal = a.map((value, index) => Math.round(value + (b[index] - value) * t));
  return `rgb(${canal.join(",")})`;
}

export function drawScatter(canvas, points) {
  const cssWidth = canvas.clientWidth || 720;
  const cssHeight = 420;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  canvas.style.width = "100%";
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const leftEdge = 48;
  const below = 36;
  const above = 12;
  const rightEdge = 12;
  const plotBoxWidth = cssWidth - leftEdge - rightEdge;
  const plotBoxHeight = cssHeight - above - below;
  const xDe = (value) => leftEdge + value * plotBoxWidth;
  const yDe = (value) => above + plotBoxHeight - value * plotBoxHeight;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = MUTED;
  ctx.font = "12px Atkinson Hyperlegible, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  for (const brand of [0, 0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.moveTo(xDe(brand), above);
    ctx.lineTo(xDe(brand), above + plotBoxHeight);
    ctx.stroke();
    ctx.fillText(decimal(brand * 100, 0), xDe(brand), cssHeight - 14);
    ctx.beginPath();
    ctx.moveTo(leftEdge, yDe(brand));
    ctx.lineTo(leftEdge + plotBoxWidth, yDe(brand));
    ctx.stroke();
  }
  ctx.textAlign = "right";
  ctx.fillText("100", leftEdge - 6, yDe(1) + 4);
  ctx.fillText("0", leftEdge - 6, yDe(0) + 4);
  for (const point of points) {
    ctx.fillStyle = SEGMENT_COLOR[point.segment] || TEAL;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(xDe(point.alcance), yDe(point.satisfaction), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
