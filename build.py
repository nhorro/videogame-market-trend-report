#!/usr/bin/env python3
"""Build the JSON catalog the static site reads.

Writes data/meta.json (small overview) and data/games.json (one row per title).
A label's index is its position in meta.labels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import pandas as pd


ROOT = Path(__file__).resolve().parent
DEFAULT_CSV = ROOT.parent / "data" / "steam_cleaned_2026.csv"

TAXONOMIES = ("Genres", "Categories", "Tags")
JSON_KEYS = {"Genres": "genres", "Categories": "categories", "Tags": "tags"}
OWNER_RANGE = re.compile(r"^\s*(\d+)\s*-\s*(\d+)\s*$")
KNOWN_SNAPSHOT = "b54fa551d186b6b969ce6eeac30925abc645f4e6397b22a24209f5fb03a2e6b6"


def split_labels(value: object) -> list[str]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return []
    seen: list[str] = []
    ya: set[str] = set()
    for part in str(value).split(","):
        label = part.strip()
        if label and label not in ya:
            ya.add(label)
            seen.append(label)
    return seen


def format_thousands(number: int) -> str:
    return f"{number:,}".replace(",", ".")


def range_label(lower: int, upper: int) -> str:
    if lower == 0 and upper == 0:
        return "0 – 0"
    if lower == upper:
        return format_thousands(lower)
    return f"{format_thousands(lower)} – {format_thousands(upper)}"


def clean_name(name: object, appid: int) -> str:
    if name is None or (isinstance(name, float) and pd.isna(name)):
        text = ""
    else:
        text = str(name)
    text = " ".join(text.replace("\x00", " ").split())
    return text or f"App {appid}"


def sorted_index(lists: list[list[str]]) -> tuple[list[str], dict[str, int]]:
    contador: Counter[str] = Counter()
    for labels in lists:
        contador.update(labels)
    names = sorted(contador, key=lambda text: text.casefold())
    return names, {label: position for position, label in enumerate(names)}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as origin:
        for block in iter(lambda: origin.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def yearly_coverage(yearSpan: list[int], masks: list[bool]) -> list[int]:
    countRow = Counter(year for year, isPresent in zip(yearSpan, masks) if isPresent)
    return countRow


def assert_known_snapshot(
    digest: str,
    df: pd.DataFrame,
    yearSpan: list[int],
    lists: dict[str, list[list[str]]],
    tag_coverage: list[float],
    years: list[int],
) -> None:
    if digest != KNOWN_SNAPSHOT:
        print("Snapshot distinto del usado en el armado original: no se comparan cifras fijas.")
        return

    tags = lists["Tags"]
    presentFlags = [bool(labels) for labels in tags]
    point = story = both = bothInWindow = 0
    windows = {(2019, 2021): 0, (2022, 2024): 0}
    story_windows = {(2019, 2021): 0, (2022, 2024): 0}
    point_windows = {(2019, 2021): 0, (2022, 2024): 0}
    eligible = {(2019, 2021): 0, (2022, 2024): 0}
    for year, labels, hasTags in zip(yearSpan, tags, presentFlags):
        nameSet = set(labels)
        es_point = "Point & Click" in nameSet
        es_story = "Story Rich" in nameSet
        point += es_point
        story += es_story
        if es_point and es_story:
            both += 1
            if 2010 <= year <= 2024:
                bothInWindow += 1
        for yearWindow in windows:
            if yearWindow[0] <= year <= yearWindow[1]:
                if hasTags:
                    eligible[yearWindow] += 1
                if es_point and es_story:
                    windows[yearWindow] += 1
                if es_story:
                    story_windows[yearWindow] += 1
                if es_point:
                    point_windows[yearWindow] += 1

    def coverage(year: int) -> float:
        return tag_coverage[years.index(year)]

    assert len(df) == 114_172
    assert str(pd.to_datetime(df["Release date"], errors="coerce").min().date()) == "1997-06-30"
    assert str(pd.to_datetime(df["Release date"], errors="coerce").max().date()) == "2026-01-05"
    assert len({label for group in lists["Genres"] for label in group}) == 33
    assert len({label for group in lists["Categories"] for label in group}) == 58
    assert len({label for group in lists["Tags"] for label in group}) == 451
    assert point == 5_440
    assert story == 13_294
    assert both == 2_050
    assert bothInWindow == 1_888
    assert windows[(2019, 2021)] == 556
    assert windows[(2022, 2024)] == 791
    assert point_windows[(2019, 2021)] == 1_386
    assert point_windows[(2022, 2024)] == 2_264
    assert story_windows[(2019, 2021)] == 3_585
    assert story_windows[(2022, 2024)] == 6_026
    assert abs(556 / eligible[(2019, 2021)] * 100 - 2.393868939981056) < 1e-9
    assert abs(791 / eligible[(2022, 2024)] * 100 - 2.545126934586055) < 1e-9
    assert abs(coverage(2024) - 69.68) < 0.02
    assert abs(coverage(2025) - 27.44) < 0.02
    print("Cifras de control del snapshot conocido: ok")


def build_catalog(csv_path: Path, output_dir: Path) -> None:
    if not csv_path.exists():
        raise SystemExit(
            "No está el CSV. Descargá Steam Dataset 2026 cleaned y pasalo con --csv.\n"
            f"Ruta buscada: {csv_path}"
        )

    print(f"Leyendo {csv_path}")
    df = pd.read_csv(
        csv_path,
        usecols=[
            "AppID",
            "Name",
            "Release date",
            "Estimated owners",
            "Peak CCU",
            "Price",
            "Positive",
            "Negative",
            "Median playtime forever",
            "Categories",
            "Genres",
            "Tags",
        ],
        low_memory=False,
    )
    dates = pd.to_datetime(df["Release date"], errors="coerce")
    if dates.isna().any():
        raise SystemExit("Hay fechas de lanzamiento que no se pudieron leer")
    if df["AppID"].nunique() != len(df):
        raise SystemExit("Hay AppID duplicados")
    yearSpan = dates.dt.year.astype(int).tolist()
    lists = {column: df[column].map(split_labels).tolist() for column in TAXONOMIES}
    appids = df["AppID"].astype("int64").tolist()
    source_names = df["Name"].tolist()
    ownerMids = df["Estimated owners"].astype(str).tolist()
    positives = df["Positive"].astype("int64").tolist()
    negativas = df["Negative"].astype("int64").tolist()
    concurrentes = df["Peak CCU"].astype("int64").tolist()
    playtime = df["Median playtime forever"].tolist()
    prices = df["Price"].tolist()
    source_title_count = len(yearSpan)
    digest = sha256(csv_path)
    raw_years = list(range(min(yearSpan), max(yearSpan) + 1))
    raw_present = [bool(labels) for labels in lists["Tags"]]
    raw_by_year = yearly_coverage(yearSpan, raw_present)
    raw_market = Counter(yearSpan)
    raw_coverage = [
        (raw_by_year.get(year, 0) / raw_market[year] * 100 if raw_market[year] else 0.0)
        for year in raw_years
    ]
    assert_known_snapshot(digest, df, yearSpan, lists, raw_coverage, raw_years)
    print(f"Universo analizado: {len(yearSpan):,} títulos.".replace(",", "."))

    ranges: dict[tuple[int, int], None] = {}
    for text in df["Estimated owners"].astype(str):
        found = OWNER_RANGE.match(text)
        if not found:
            raise SystemExit(f"Rango de owners desconocido: {text!r}")
        ranges.setdefault((int(found.group(1)), int(found.group(2))), None)
    owners = []
    for position, (lower, upper) in enumerate(sorted(ranges)):
        totalSum = lower + upper
        owners.append(
            {
                "id": position,
                "lower": lower,
                "upper": upper,
                "mid": totalSum // 2 if totalSum % 2 == 0 else totalSum / 2,
                "label": range_label(lower, upper),
            }
        )
    owner_id = {(item["lower"], item["upper"]): item["id"] for item in owners}

    ids: dict[str, dict[str, int]] = {}
    names: dict[str, list[str]] = {}
    for column in TAXONOMIES:
        names[column], ids[column] = sorted_index(lists[column])

    counts = {
        column: [0 for _ in names[column]]
        for column in TAXONOMIES
    }
    for column in TAXONOMIES:
        for labels in lists[column]:
            for label in labels:
                counts[column][ids[column][label]] += 1

    total = len(yearSpan)
    order = sorted(range(total), key=lambda row: appids[row])
    games = {key: [] for key in ("appid", "year", "owner", "positive", "negative", "ccu", "play", "price_cents", "name", "genres", "categories", "tags")}
    for processed, row in enumerate(order, start=1):
        appid = appids[row]
        found = OWNER_RANGE.match(ownerMids[row])
        assert found is not None
        games["appid"].append(appid)
        games["year"].append(yearSpan[row])
        games["owner"].append(owner_id[(int(found.group(1)), int(found.group(2)))])
        games["positive"].append(int(positives[row]))
        games["negative"].append(int(negativas[row]))
        games["ccu"].append(int(concurrentes[row]))
        games["play"].append(int(round(float(playtime[row]))))
        games["price_cents"].append(int(round(float(prices[row]) * 100)))
        games["name"].append(clean_name(source_names[row], appid))
        for column, key in JSON_KEYS.items():
            games[key].append([ids[column][label] for label in lists[column][row]])
        if processed % 20000 == 0:
            print(f"  {processed:,} títulos".replace(",", "."))

    year_min = min(yearSpan)
    year_max = max(yearSpan)
    years = list(range(year_min, year_max + 1))
    market_counter = Counter(yearSpan)
    market = [int(market_counter.get(year, 0)) for year in years]
    with_taxonomy: dict[str, list[int]] = {}
    coverage: dict[str, list[float]] = {}
    resumen = {}
    density = {}
    for column in TAXONOMIES:
        presentFlags = [bool(labels) for labels in lists[column]]
        by_year = yearly_coverage(yearSpan, presentFlags)
        con = [int(by_year.get(year, 0)) for year in years]
        with_taxonomy[column] = con
        coverage[column] = [
            (count / base * 100 if base else 0.0) for count, base in zip(con, market)
        ]
        lengths = [len(labels) for labels in lists[column]]
        informed = sum(1 for lengthCount in lengths if lengthCount)
        resumen[column] = {
            "uniqueLabels": len(names[column]),
            "games": informed,
            "coverage": informed / total * 100,
            "average": (sum(lengths) / informed) if informed else 0,
        }
        distribucion = Counter(lengths)
        density[column] = [
            {"n": int(count), "games": int(distribucion[count])}
            for count in sorted(distribucion)
        ]

    combinations = {}
    for column in ("Genres", "Categories"):
        contador = Counter(
            " + ".join(sorted(labels)) for labels in lists[column] if labels
        )
        combinations[column] = [
            {"name": name, "games": int(count)}
            for name, count in contador.most_common(8)
        ]

    meta = {
        "format": 2,
        "generated": date.today().isoformat(),
        "source": {
            "name": "Steam Dataset 2026 cleaned",
            "credit": "Stefano Triscali, sobre el Steam Games Dataset de Martin Bustos / Fronkon Games",
            "updated": "enero 2026",
            "url": "https://www.kaggle.com/datasets/stefanotriscali/steam-database-2026-fixed",
            "urlOriginal": "https://huggingface.co/datasets/FronkonGames/steam-games-dataset",
            "sha256": digest,
            "bytes": csv_path.stat().st_size,
            "titles": total,
            "sourceTitles": source_title_count,
            "firstDate": str(dates.min().date()),
            "lastDate": str(dates.max().date()),
        },
        "recommendedYear": 2024,
        "yearMin": year_min,
        "yearMax": year_max,
        "years": years,
        "market": market,
        "coverage": coverage,
        "withTaxonomy": with_taxonomy,
        "taxonomies": resumen,
        "density": density,
        "combinations": combinations,
        "labels": names,
        "labelCounts": counts,
        "owners": owners,
        "parameters": {
            "binYears": 2,
            "priorStrength": 30,
            "reviewWeight": 0.75,
            "minReviews": 20,
            "reachHigh": 0.90,
            "reachLow": 0.25,
            "satisfactionHigh": 0.75,
            "satisfactionLow": 0.25,
            "yearWindow": 3,
        },
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    meta_path = output_dir / "meta.json"
    games_path = output_dir / "games.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("Escribiendo games.json…")
    games_path.write_text(json.dumps(games, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(
        f"Listo: {total:,} títulos, meta.json {meta_path.stat().st_size / 1e3:.0f} KB, "
        f"games.json {games_path.stat().st_size / 1e6:.1f} MB".replace(",", ".")
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera data/ para el sitio estático")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=ROOT / "data")
    args = parser.parse_args()
    try:
        build_catalog(args.csv, args.out)
    except BrokenPipeError:
        sys.exit(0)


if __name__ == "__main__":
    main()
