# Tendencias de mercado

[Ir a aplicación](https://nhorro.github.io/videogame-market-trend-report).

Sitio estático para **analizar y detectar nichos** en el catálogo de Steam:
qué lugar ocupa un recorte y si gana participación, queda quieto o se achica.

Mide oferta publicada y cómo se describe, con un snapshot de enero de 2026.

Las consultas corren en el navegador con [DuckDB-Wasm](https://duckdb.org/docs/current/clients/wasm/overview.html)
(versión fijada `1.33.1-dev57.0`, el build `+esm` de jsDelivr). No hay servidor: el JSON de
`data/games.json` se carga en una base local y el filtrado, las ventanas y los
rankings son SQL. El modelo de desempeño sigue en JavaScript sobre el recorte
que devuelve DuckDB. GitHub Pages no aísla el origen, así que se usa el build
sin hilos. La primera visita descarga el motor; después queda en caché.

## Qué se puede hacer

- Elegir hasta ocho etiquetas y compararlas, o definir un recorte que pida
  **todas** o **alguna**.
- Ver participación anual, lanzamientos y el cambio entre dos ventanas
  (por defecto, 2019–2021 contra 2022–2024).
- Leer un cartel orientativo: gana lugar, está quieto, se achica, o hay más
  títulos sin más peso relativo.
- Ver coocurrencia y similitud de Jaccard.
- Ver desempeño relativo dentro del recorte, controlado por antigüedad:
  breakouts, joyas ocultas, casos típicos y lift de tags.
- Compartir el recorte: el estado queda en la URL.
- Rankear qué etiquetas ganaron o perdieron participación.

## Limitaciones

Como está pensado para correr sin servidor, el navegador descarga un catálogo compacto (sin descripciones,
capturas, developers ni publishers) y calcula ahí. Con eso no se puede filtrar
por estudio o idioma, ni cambiar el peso 75/25 del alcance ni las 30 reviews de
previa. Si el recorte tiene más de 8.000 títulos con recepción evaluable, el
plano de puntos muestra una muestra; la distribución y las listas siguen
siendo del total. El detalle está en la sección Método del sitio.

Reviews, owners, usuarios concurrentes y tiempo de juego son acumulados del
snapshot, no series de demanda. `Estimated owners` es un rango.

## Publicación en Github Pages

Esta carpeta es la raíz del sitio: `index.html` tiene que quedar en la raíz,
no adentro de otra carpeta.

No hace falta un build en GitHub. Los datos ya están en `data/meta.json` y
`data/games.json`. Sin esos dos archivos el panorama no tiene números.
`.nojekyll` también va en la raíz: si falta, Pages procesa el repo con Jekyll
y puede ignorar archivos.

1. Subí `main` con `index.html`, `css/`, `js/`, `data/` y `.nojekyll`.
   No subas `node_modules/` ni `.venv/`: están en `.gitignore`.
2. En el repositorio: Settings → Pages → Build and deployment → Deploy from a branch.
3. Branch: `main`. Folder: `/ (root)`. Save.
4. En uno o dos minutos la página queda en
   <https://nhorro.github.io/videogame-market-trend-report/>.

La primera visita de cada persona descarga DuckDB-Wasm desde jsDelivr. Hace
falta conexión esa vez. El catálogo sale del repositorio y las consultas
corren en el navegador. Si el hash de un recorte se comparte, la URL sigue
siendo la de Pages más `#/explore?...`.

## Probarlo antes de subirlo

Desde esta carpeta:

```bash
./preview.sh
```

Corre `test/control.mjs` y, si pasa, sirve el sitio en
<http://127.0.0.1:8080>. La primera vez instala DuckDB-Wasm para ese control;
el sitio publicado no lo usa. `Ctrl+C` corta el servidor.

No abras `index.html` como archivo: los módulos no cargan así. En el panorama
tienen que figurar 114.172 títulos. En Explorar, el preset Point & click
narrativo muestra el cartel «Más títulos, misma participación».

## Regenerar los datos

El CSV no se versiona. Es **Steam Dataset 2026 cleaned**, de Stefano Triscali,
sobre el Steam Games Dataset de Martin Bustos / Fronkon Games:

- <https://www.kaggle.com/datasets/stefanotriscali/steam-database-2026-fixed>
- <https://huggingface.co/datasets/FronkonGames/steam-games-dataset>

```bash
uv sync
uv run python build.py --csv /ruta/a/steam_cleaned_2026.csv
./preview.sh
```

`build.py` escribe `data/meta.json` y `data/games.json`. Para iterar la página
alcanza con volver a subir HTML, CSS y JS: el JSON sólo se reemplaza cuando
cambia el CSV. Si el archivo es el snapshot de referencia, el script compara
cantidades conocidas antes de terminar. `test/control.mjs` vuelve a comprobar
el recorte `Point & Click` + `Story Rich` y el modelo de desempeño.

Hace falta Node 18 o más nuevo para el test y un navegador actual para el sitio.
El ancla recomendada sigue siendo 2024: en 2025 la cobertura de tags cae fuerte
y una ausencia de metadatos parece una caída del mercado.

## Método

- La participación de una etiqueta es su cantidad de lanzamientos dividida por
  los juegos del mismo año que tienen esa taxonomía informada.
- Una ventana suma los años y después divide. No promedia los porcentajes.
- El desempeño compara cada juego con su bloque de dos años. No es una tasa de
  éxito del género: el grupo breakout existe porque el corte está en el
  percentil 90.
