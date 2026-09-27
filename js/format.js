export const TAX_LABEL = {
  Genres: "Género",
  Categories: "Categoría",
  Tags: "Tag",
};

export const TAX_PLURAL = {
  Genres: "Géneros",
  Categories: "Categorías",
  Tags: "Tags",
};

const INTEGER_FORMAT = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
const DATE_FORMAT = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" });

export function num(value) {
  if (value == null || Number.isNaN(value)) return "—";
  return INTEGER_FORMAT.format(value);
}

export function decimal(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function pct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${decimal(value, digits)}%`;
}

export function signedPct(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${decimal(value, digits)}%`;
}

export function pp(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${decimal(value, digits)} pp`;
}

export function rate(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  return pct(value * 100, digits);
}

export function usd(cents) {
  if (cents == null || Number.isNaN(cents)) return "—";
  if (cents === 0) return "Gratis";
  return `USD ${decimal(cents / 100, 2)}`;
}

export function shortDate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return DATE_FORMAT.format(new Date(year, month - 1, day));
}

export function yearSpan(yearFrom, yearTo) {
  return `${yearFrom}\u2013${yearTo}`;
}

export function foldText(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function denominatorPhrase(taxonomies) {
  if (taxonomies.length === 1 && taxonomies[0] === "Tags") return "juegos con tags informados";
  if (taxonomies.length === 1 && taxonomies[0] === "Genres") return "juegos con género informado";
  if (taxonomies.length === 1 && taxonomies[0] === "Categories") return "juegos con categoría informada";
  return "juegos con todas las taxonomías elegidas informadas";
}
