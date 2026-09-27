# Tendencias de mercado

Sitio estático para **analizar y detectar nichos** en el catálogo de Steam:
qué lugar ocupa un recorte y si gana participación, queda quieto o se achica.

Está pensado para equipos de desarrollo de la Argentina. La interfaz está en
español. No estima ventas ni recomienda qué juego hacer. Mide oferta publicada
y cómo se describe, con un snapshot de enero de 2026.

Las consultas corren en el navegador con [DuckDB-Wasm](https://duckdb.org/docs/current/clients/wasm/overview.html)
(versión fijada `1.33.1-dev57.0`, el build `+esm` de jsDelivr). No hay servidor: el JSON de
`data/games.json` se carga en una base local y el filtrado, las ventanas y los
rankings son SQL. El modelo de desempeño sigue en JavaScript sobre el recorte
que devuelve DuckDB. GitHub Pages no aísla el origen, así que se usa el build
sin hilos. La primera visita descarga el motor; después queda en caché.

El sitio no está armado alrededor de un juego concreto. Cualquier combinación
de géneros, categorías y tags se lee con el mismo método.

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

## Qué no entra

No hay servidor. El navegador descarga un catálogo compacto (sin descripciones,
capturas, developers ni publishers) y calcula ahí. Con eso no se puede filtrar
por estudio o idioma, ni cambiar el peso 75/25 del alcance ni las 30 reviews de
previa. El plano de puntos se omite si hay más de 2.500 títulos con recepción
evaluable. El detalle está en la sección Método del sitio.

Reviews, owners, usuarios concurrentes y tiempo de juego son acumulados del
snapshot, no series de demanda. `Estimated owners` es un rango.

## Publicar en GitHub Pages

Esta carpeta es la raíz del sitio. El repositorio público tiene que contener
`index.html` en la raíz, no esta carpeta anidada dentro de otro proyecto.

1. Creá un repositorio y subí esta carpeta. Los datos van en `data/`:
   `meta.json` (chico, el panorama) y `games.json` (el catálogo).
   Sin esos dos archivos el sitio no tiene números.
2. En el repositorio: Settings → Pages → Branch `main` → carpeta `/ (root)`.
3. La URL va a ser `https://<usuario>.github.io/<repo>/`.

No hace falta un build en GitHub. Los datos ya están generados.

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

## Método, en corto

- La participación de una etiqueta es su cantidad de lanzamientos dividida por
  los juegos del mismo año que tienen esa taxonomía informada.
- Una ventana suma los años y después divide. No promedia los porcentajes.
- El desempeño compara cada juego con su bloque de dos años. No es una tasa de
  éxito del género: el grupo breakout existe porque el corte está en el
  percentil 90.

## Licencia de los datos

Los datos de origen no son de este repositorio. Al redistribuir el catálogo
compacto, mantené la atribución del pie de página y revisá las condiciones de
Kaggle y de la ficha original antes de publicar.
