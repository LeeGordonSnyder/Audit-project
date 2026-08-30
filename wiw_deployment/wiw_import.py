"""
Loads a When I Work schedule export (CSV or .xlsx, exported from the
Schedule view's Export option) into a normalized list of Shift objects.

WiW's export column names vary by plan and export settings, so headers are
matched against the alias lists in config.WIW_COLUMN_ALIASES rather than
assumed exact. If your export can't be parsed, the error message says which
logical field couldn't be resolved -- add your header text as an alias in
config.py and re-run; no code changes needed for that class of fix.
"""
from __future__ import annotations

import csv
import re
from datetime import datetime, date as date_cls
from pathlib import Path

from . import config
from .breaks import Shift


class WiwImportError(ValueError):
    pass


def _normalize_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", h.strip().lower()).strip()


def _resolve_columns(headers: list[str]) -> dict[str, int]:
    normalized = [_normalize_header(h) for h in headers]
    resolved: dict[str, int] = {}
    for field_name, aliases in config.WIW_COLUMN_ALIASES.items():
        alias_set = {_normalize_header(a) for a in aliases}
        for idx, h in enumerate(normalized):
            if h in alias_set:
                resolved[field_name] = idx
                break
    return resolved


_TIME_FORMATS = [
    "%I:%M %p", "%I:%M%p", "%I %p", "%I%p",
    "%H:%M", "%H:%M:%S",
]


def _parse_time_to_minutes(text: str) -> int:
    text = text.strip()
    for fmt in _TIME_FORMATS:
        try:
            t = datetime.strptime(text.upper().replace(".", ""), fmt)
            return t.hour * 60 + t.minute
        except ValueError:
            continue
    raise WiwImportError(f"Could not parse time value: {text!r}")


_SHIFT_RANGE_RE = re.compile(r"(.+?)\s*[-–—]\s*(.+)")


def _parse_shift_range(text: str) -> tuple[int, int]:
    m = _SHIFT_RANGE_RE.match(text.strip())
    if not m:
        raise WiwImportError(f"Could not parse shift range: {text!r}")
    return _parse_time_to_minutes(m.group(1)), _parse_time_to_minutes(m.group(2))


def _normalize_role(raw_position: str) -> str:
    key = raw_position.strip().lower()
    if key in config.WIW_POSITION_ALIASES:
        return config.WIW_POSITION_ALIASES[key]
    # Fall back to an exact/uppercased match against known role codes
    # (handles exports where the position IS already "FL", "PG", etc.)
    upper = raw_position.strip().upper()
    if upper in config.ROLE_STYLES:
        return upper
    raise WiwImportError(
        f"Unrecognized WiW position {raw_position!r}; add it to "
        f"config.WIW_POSITION_ALIASES mapped to one of {sorted(config.ROLE_STYLES)}"
    )


def _read_rows(path: Path) -> tuple[list[str], list[list[str]]]:
    if path.suffix.lower() in (".xlsx", ".xlsm"):
        import openpyxl

        wb = openpyxl.load_workbook(path, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers = [str(c) if c is not None else "" for c in next(rows_iter)]
        rows = [[("" if c is None else str(c)) for c in row] for row in rows_iter]
        return headers, rows

    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        rows = list(reader)
    if not rows:
        return [], []
    return rows[0], rows[1:]


def load_wiw_export(path: str | Path, target_date: date_cls | None = None) -> list[Shift]:
    """Parse a WiW schedule export file into a list of Shift objects.

    If target_date is given and the export spans multiple dates (has a date
    column), only that date's rows are kept -- otherwise all rows are used.
    """
    path = Path(path)
    headers, rows = _read_rows(path)
    if not headers:
        raise WiwImportError(f"No data found in {path}")

    cols = _resolve_columns(headers)

    has_name = "name" in cols or ("first_name" in cols and "last_name" in cols)
    has_times = ("start_time" in cols and "end_time" in cols) or "shift" in cols
    missing = []
    if not has_name:
        missing.append("name (or first_name + last_name)")
    if "position" not in cols:
        missing.append("position")
    if not has_times:
        missing.append("start_time + end_time (or a combined shift column)")
    if missing:
        raise WiwImportError(
            "Could not find required column(s): " + ", ".join(missing) +
            f". Columns found in file: {headers}. "
            "Add the real header text as an alias in config.WIW_COLUMN_ALIASES."
        )

    shifts: list[Shift] = []
    for row in rows:
        if not any(cell.strip() for cell in row):
            continue  # skip blank rows

        if target_date is not None and "date" in cols:
            raw_date = row[cols["date"]].strip()
            if raw_date and not _matches_date(raw_date, target_date):
                continue

        if "name" in cols:
            name = row[cols["name"]].strip()
        else:
            name = f"{row[cols['first_name']].strip()} {row[cols['last_name']].strip()}".strip()
        if not name:
            continue

        position = row[cols["position"]].strip()
        if not position:
            continue  # unassigned / open shift rows are skipped

        if "start_time" in cols and "end_time" in cols:
            start_min = _parse_time_to_minutes(row[cols["start_time"]])
            end_min = _parse_time_to_minutes(row[cols["end_time"]])
        else:
            start_min, end_min = _parse_shift_range(row[cols["shift"]])

        shifts.append(Shift(name=name, role=_normalize_role(position), start_min=start_min, end_min=end_min))

    return shifts


def _matches_date(raw_date: str, target_date: date_cls) -> bool:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%B %d, %Y", "%b %d, %Y", "%a, %b %d"):
        try:
            parsed = datetime.strptime(raw_date, fmt)
            if fmt == "%a, %b %d":
                parsed = parsed.replace(year=target_date.year)
            return parsed.date() == target_date
        except ValueError:
            continue
    return raw_date == target_date.isoformat()
