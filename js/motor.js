// DuckDB runs in the browser (Wasm) or in Node (the same Wasm, for the check).
// GitHub Pages does not send cross-origin isolation headers, so the threaded build is unused.

const VERSION = "1.33.1-dev57.0";
const CDN = `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${VERSION}`;

function normalizeRow(row) {
  const record = row.toJSON();
  for (const key of Object.keys(record)) {
    if (typeof record[key] === "bigint") record[key] = Number(record[key]);
  }
  return record;
}

function wrapQuery(conn) {
  return async (sql) => {
    const table = await Promise.resolve(conn.query(sql));
    return table.toArray().map(normalizeRow);
  };
}

export async function prepareTables(query, meta) {
  const ownerMids = meta.owners.map((item) => `(${item.id | 0}, ${Number(item.mid)})`).join(", ");
  await query(`CREATE TABLE ownerMids AS SELECT * FROM (VALUES ${ownerMids}) t(id, mid)`);
  await query(`
    CREATE TABLE games AS
    SELECT
      row_number() OVER () - 1 AS id,
      CAST(r.year AS INTEGER) AS year,
      CAST(r.owner AS INTEGER) AS owner,
      CAST(r.positive AS INTEGER) AS positive,
      CAST(r.negative AS INTEGER) AS negative,
      CAST(r.ccu AS INTEGER) AS ccu,
      CAST(r.play AS INTEGER) AS play,
      CAST(r.price_cents AS INTEGER) AS price_cents,
      CAST(r.appid AS INTEGER) AS appid,
      r.name AS name,
      CAST(r.genres AS INTEGER[]) AS genres,
      CAST(r.categories AS INTEGER[]) AS categories,
      CAST(r.tags AS INTEGER[]) AS tags,
      d.mid AS owners_mid
    FROM raw r
    LEFT JOIN ownerMids d ON d.id = CAST(r.owner AS INTEGER)
  `);
  await query("DROP TABLE raw");
  const [{ n }] = await query("SELECT count(*) AS n FROM games");
  if (n !== meta.source.titles) {
    throw new Error(`DuckDB cargó ${n} títulos y meta.json espera ${meta.source.titles}`);
  }
}

export async function openInNode() {
  const duckdb = await import("@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs");
  const { createRequire } = await import("node:module");
  const path = await import("node:path");
  const require = createRequire(import.meta.url);
  const dist = path.dirname(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm"));
  const db = await duckdb.createDuckDB(
    {
      mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: null },
      eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: null },
    },
    new duckdb.ConsoleLogger(),
    duckdb.NODE_RUNTIME,
  );
  await db.instantiate();
  const conn = db.connect();
  return {
    query: wrapQuery(conn),
    loadFile: async (filePath) => {
      conn.insertJSONFromPath(filePath, { name: "raw" });
    },
  };
}

export async function openInBrowser() {
  // The raw dist module imports "apache-arrow" bare. Chrome does not apply a
  // page import map to a cross-origin module. This version's +esm build already
  // points at apache-arrow, and getJsDelivrBundles() still returns the pinned wasm.
  const duckdb = await import(`${CDN}/+esm`);
  const published = duckdb.getJsDelivrBundles();
  const bundles = { mvp: published.mvp, eh: published.eh };
  const bundle = await duckdb.selectBundle(bundles);
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(workerUrl);
  const conn = await db.connect();
  return {
    query: wrapQuery(conn),
    loadBuffer: async (buffer) => {
      await db.registerFileBuffer("games.json", new Uint8Array(buffer));
      await conn.insertJSONFromPath("games.json", { name: "raw" });
    },
  };
}
