"""
All the "shape of the spreadsheet" and "shape of the business rules" knobs live
here. If your real deployment workbook's layout differs even slightly from what
was inferred from the example screenshot (different columns, different starting
row, different role codes), fix it here rather than in the algorithm code.
"""
from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Sheet layout (1-indexed rows/columns, matching openpyxl / Excel addressing)
# ---------------------------------------------------------------------------

# Row holding the hourly column headers ("8am", "9am", ... "10pm").
HOUR_HEADER_ROW = 3

# First row a staff member can occupy, and how many rows are reserved for
# staff even if fewer people are scheduled that day (keeps the Hourly Tracker
# section below anchored at a fixed row like in the source workbook).
STAFF_START_ROW = 4
STAFF_ROW_CAPACITY = 20

# Columns (1-indexed: A=1, B=2, ...)
COL_NAME = 1          # A: staff name
COL_SHIFT = 2         # B: "9am - 2:30pm" style shift text
COL_BREAK_30 = 3      # C: the 30-minute break, if any
COL_BREAK_15_A = 4    # D: first 15-minute break, if any
COL_BREAK_15_B = 5    # E: second 15-minute break, if any (only 8.5h+ shifts)
GRID_START_COL = 6    # F: first hourly column
GRID_START_HOUR = 8   # F column represents 8am
GRID_END_HOUR = 22    # last hourly column represents 10pm (last col = T)

GRID_NUM_COLS = GRID_END_HOUR - GRID_START_HOUR + 1


# ---------------------------------------------------------------------------
# Role codes (the "Shift Functions" legend) -> fill color + display label.
# Colors are approximate reads of the legend swatches in the example sheet;
# tweak the hex values to match your brand palette exactly.
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RoleStyle:
    code: str
    label: str
    fill_hex: str          # ARGB-less hex, e.g. "FFC000"
    font_hex: str = "000000"


ROLE_STYLES = {
    "FL":    RoleStyle("FL", "Floor Leader", "F4A93B"),
    "PROD":  RoleStyle("PROD", "BOH / Product", "1F6FC1", "FFFFFF"),
    "PD":    RoleStyle("PD", "Training / Development", "7B4FA0", "FFFFFF"),
    "MEET":  RoleStyle("MEET", "Leadership Meeting", "8C8C8C", "FFFFFF"),
    "HUD":   RoleStyle("HUD", "Huddle", "00C8D6"),
    "OPEN":  RoleStyle("OPEN", "Open / Close", "FFF200"),
    "PG":    RoleStyle("PG", "Product Guide", "2FAE4E", "FFFFFF"),
    "B":     RoleStyle("B", "Break", "D9D9D9"),
}

# ---------------------------------------------------------------------------
# When I Work export column recognition.
#
# WiW's export column names vary by plan/export settings. Rather than assume
# one exact layout, the importer matches header text against these alias
# lists (case-insensitive, punctuation-insensitive). If your export uses a
# header not listed here, add it -- no code changes needed.
# ---------------------------------------------------------------------------

WIW_COLUMN_ALIASES = {
    "first_name": ["first name", "firstname"],
    "last_name": ["last name", "lastname"],
    "name": ["name", "employee", "employee name", "user", "user name"],
    "position": ["position", "role", "job", "job title"],
    "date": ["date", "shift date", "start date"],
    "start_time": ["start time", "start", "shift start", "clock in"],
    "end_time": ["end time", "end", "shift end", "clock out"],
    "shift": ["shift", "shift time", "time"],
}

# Maps a "position" string as it might appear in a When I Work export onto one
# of the ROLE_STYLES codes above. Matching is case-insensitive and tolerant of
# extra whitespace. Add aliases here rather than touching the importer if your
# WiW position names differ (e.g. "Key Holder" -> "FL").
WIW_POSITION_ALIASES = {
    "floor leader": "FL",
    "floor lead": "FL",
    "key holder": "FL",
    "product guide": "PG",
    "sales associate": "PG",
    "boh": "PROD",
    "product": "PROD",
    "back of house": "PROD",
    "training": "PD",
    "development": "PD",
}


# ---------------------------------------------------------------------------
# Break policy
#
# Tiers are evaluated by total scheduled shift length, in hours. Boundaries
# below reflect: "over 5 hours -> one 15; 5-8(.5) hours -> a 15 and a 30;
# 8.5+ hours -> two 15s and a 30". Exact boundary handling (is a shift of
# *exactly* 6.0 hours tier 1 or tier 2?) is a judgment call marked below --
# adjust to match your actual labor policy if it differs.
# ---------------------------------------------------------------------------

NO_BREAK_MAX_HOURS = 5.0        # <= this: no break at all
ONE_FIFTEEN_MAX_HOURS = 6.0     # (NO_BREAK_MAX_HOURS, this): one 15 only
FIFTEEN_AND_THIRTY_MAX_HOURS = 8.5   # [ONE_FIFTEEN_MAX_HOURS, this): 15 + 30
# >= FIFTEEN_AND_THIRTY_MAX_HOURS: two 15s + a 30

# Minutes of buffer at the very start/end of a shift where a break should
# never be placed (people need to actually open/close/settle in).
SHIFT_EDGE_BUFFER_MINUTES = 30

# Scheduling grid resolution used internally by the break placer.
TIME_STEP_MINUTES = 5

# Floor coverage rules while breaks are being placed.
MIN_STAFF_ON_FLOOR = 2          # never let on-floor headcount drop below this
MIN_FLOOR_LEADS_ON_FLOOR = 1    # at least one FL must always remain on the floor
