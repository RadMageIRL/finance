"""Independent reference oracle for the money supply pages (M1 and M2, H.6).

Writes tests/oracle/fixtures/econ-money.json from the money supply rules M1 to
M16 (implemented in src/lib/data/money.ts). This script is written from those
rules alone, not from the TypeScript code, so that a mistake shared by both is
unlikely. It uses only the Python standard library and exact arithmetic: a
value is the decimal string the CSV holds, a dollar change is taken on
integers at a common scale, a percent change is an exact fraction rounded half
away from zero, and no float is used anywhere.

Run from the repository root:

    python -I tests/oracle/econ_money.py

It is also run by tests/oracle/generate.py through runpy, so it locates its
output next to itself and reads nothing at run time: every input row is
embedded below, including the rows copied from the verified test fixture root
local/econ-fixture/live (test data, never a publication).

Cases written:
  months_before  calendar months back (M2)
  diff           dollar changes (M8)
  percent        percent changes (M9)
  display        levels, dollar changes, percents, missing values and
                 release wording (M4, M10, M13)
  et_date        America/New_York dates of UTC detection times (M16)
  series         synthetic and fixture series: the current month (M5), the
                 revision window (M12), changes with the reasons they are not
                 computed (M6 to M11), the recent table (M14) and the
                 comparison table (M15)

Before writing, every dollar and percent change is checked against an
independent restatement with the decimal module, and the hand-worked
expectations listed in self_check() must hold.
"""

import json
import re
from datetime import date
from decimal import ROUND_HALF_UP, Decimal, localcontext
from fractions import Fraction
from pathlib import Path

OUTPUT = Path(__file__).resolve().parent / "fixtures" / "econ-money.json"
OUTPUT_LABEL = "tests/oracle/fixtures/econ-money.json"

MONTH_NAMES = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

PERIOD_RE = re.compile(r"(\d{4})-(\d{2})")
DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
UTC_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z")
VALUE_RE = re.compile(r"(-?)(\d+)(?:\.(\d+))?")


# ---------------------------------------------------------------------------
# M2: months


def parse_period(period):
    m = PERIOD_RE.fullmatch(period) if isinstance(period, str) else None
    if not m or not 1 <= int(m.group(2)) <= 12:
        raise ValueError(f"not a month: {period!r}")
    return int(m.group(1)), int(m.group(2))


def month_number(period):
    """Months since January of year 0, so that months compare and subtract."""
    year, month = parse_period(period)
    return year * 12 + month - 1


def period_of(number):
    year, month0 = divmod(number, 12)
    return f"{year:04d}-{month0 + 1:02d}"


def months_before(period, months):
    """The calendar month `months` months before `period` (M2)."""
    return period_of(month_number(period) - months)


def month_words(period):
    """"October 2026" (M2)."""
    year, month = parse_period(period)
    return f"{MONTH_NAMES[month - 1]} {year}"


# ---------------------------------------------------------------------------
# Dates (M13, M16)


def parse_date(text):
    m = DATE_RE.fullmatch(text) if isinstance(text, str) else None
    if not m:
        raise ValueError(f"not a date: {text!r}")
    return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))


def date_words(text):
    """"November 24, 2026": the day without a leading zero (M13)."""
    d = parse_date(text)
    return f"{MONTH_NAMES[d.month - 1]} {d.day}, {d.year}"


# ---------------------------------------------------------------------------
# M1, M8, M9: exact values and changes


def parse_value(text):
    """A decimal string as (units, places), the value being units / 10**places."""
    m = VALUE_RE.fullmatch(text) if isinstance(text, str) else None
    if not m:
        raise ValueError(f"not a decimal value: {text!r}")
    fraction = m.group(3) or ""
    units = int(m.group(2) + fraction)
    return (-units if m.group(1) else units), len(fraction)


def exact(text):
    units, places = parse_value(text)
    return Fraction(units, 10 ** places)


def decimal_string(units, places):
    """units / 10**places written with exactly `places` decimals; zero has no sign."""
    digits = str(abs(units)).rjust(places + 1, "0")
    body = digits[:-places] + "." + digits[-places:] if places else digits
    return "-" + body if units < 0 else body


def dollar_change(later, earlier):
    """L minus E exactly, with the longer fractional part of the two (M8)."""
    later_units, later_places = parse_value(later)
    earlier_units, earlier_places = parse_value(earlier)
    places = max(later_places, earlier_places)
    units = (later_units * 10 ** (places - later_places)
             - earlier_units * 10 ** (places - earlier_places))
    return decimal_string(units, places)


def round_half_away(x, places):
    """The Fraction x rounded to `places` decimals, an exact tie away from zero,
    as integer units of 10**-places."""
    scaled = abs(x) * 10 ** places
    whole, rest = divmod(scaled.numerator, scaled.denominator)
    if 2 * rest >= scaled.denominator:
        whole += 1
    return -whole if x < 0 else whole


def percent_change(later, earlier):
    """100 (L - E) / E rounded to two decimals half away from zero, or None
    when E is not above zero (M9)."""
    e = exact(earlier)
    if e <= 0:
        return None
    return decimal_string(round_half_away(100 * (exact(later) - e) / e, 2), 2)


# ---------------------------------------------------------------------------
# M10: display


def grouped(unsigned):
    """Digits of the whole part grouped by thousands with commas."""
    whole, dot, fraction = unsigned.partition(".")
    groups = []
    while len(whole) > 3:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    groups.insert(0, whole)
    return ",".join(groups) + dot + fraction


def signed_parts(text):
    """('+', '-' or '' for zero, the unsigned magnitude) of a decimal string."""
    q = exact(text)
    magnitude = text[1:] if text.startswith("-") else text
    return ("+" if q > 0 else "-" if q < 0 else ""), magnitude


def level_display(value):
    """("$20,073.6 billion", "20,073.6")."""
    if exact(value) < 0 or value.startswith("-"):
        raise ValueError(f"the rules give no wording for a negative level: {value!r}")
    cell = grouped(value)
    return f"${cell} billion", cell


def dollars_display(dollars):
    """("+$106.3 billion", "+106.3"); zero has no sign."""
    sign, magnitude = signed_parts(dollars)
    cell = grouped(magnitude)
    return f"{sign}${cell} billion", f"{sign}{cell}"


def percent_display(percent):
    """("+0.53 percent", "+0.53"); zero has no sign; the digits are grouped
    like a level ("+1,234.50 percent")."""
    sign, magnitude = signed_parts(percent)
    cell = grouped(magnitude)
    return f"{sign}{cell} percent", f"{sign}{cell}"


# ---------------------------------------------------------------------------
# M3, M4: missing rows


MISSING_TEXT = {"NA": "Not available", "ND": "No data", "NC": "Not calculable"}


def has_code(code):
    return code not in (None, "")


def is_missing(row):
    """A row is missing when it carries a missing code or has an empty value (M3)."""
    return has_code(row["missing_code"]) or row["value"] in (None, "")


def missing_display(code):
    """"<text> (<code>)", or "Missing" alone without a code (M4).

    Any code other than NA, ND and NC has the text "Missing", so an unknown
    code XX is shown as "Missing (XX)"; an empty code counts as none."""
    if has_code(code):
        return f"{MISSING_TEXT.get(code, 'Missing')} ({code})"
    return "Missing"


# ---------------------------------------------------------------------------
# M13: release wording


def release_wording(released, basis):
    if basis == "not-recorded" or released in (None, ""):
        return "Release date not recorded"
    words = date_words(released)
    if basis == "calendar":
        return f"H.6 release of {words}"
    if basis == "rule":
        return f"Publication day by the New York Fed's schedule: {words}"
    if basis == "first-seen":
        return f"First seen by RadMage Finance on {words} (Eastern Time date)"
    return words


# ---------------------------------------------------------------------------
# M16: the America/New_York date of a UTC time, from the rules themselves


def nth_sunday(year, month, n):
    """The proleptic ordinal of the n-th Sunday of a month (Monday is weekday 0)."""
    first = date(year, month, 1)
    return first.toordinal() + (6 - first.weekday()) % 7 + 7 * (n - 1)


def et_date(utc):
    m = UTC_RE.fullmatch(utc) if isinstance(utc, str) else None
    if not m:
        raise ValueError(f"not a UTC time: {utc!r}")
    year, month, day, hour, minute, second = (int(g) for g in m.groups())
    if hour > 23 or minute > 59 or second > 59:
        raise ValueError(f"not a UTC time: {utc!r}")
    t = date(year, month, day).toordinal() * 86400 + hour * 3600 + minute * 60 + second
    # 2:00 a.m. Eastern standard time (UTC minus 5) is 7:00 UTC; 2:00 a.m.
    # Eastern daylight time (UTC minus 4) is 6:00 UTC.
    dst_start = nth_sunday(year, 3, 2) * 86400 + 7 * 3600
    dst_end = nth_sunday(year, 11, 1) * 86400 + 6 * 3600
    offset = 4 if dst_start <= t < dst_end else 5
    return date.fromordinal((t - offset * 3600) // 86400).isoformat()


# ---------------------------------------------------------------------------
# M5 to M15: series

MEASURES = {"m1-sa": "M1", "m1-nsa": "M1", "m2-sa": "M2", "m2-nsa": "M2"}
BREAKS = {"M1": ["2020-05"], "M2": []}

CELL = {
    "later-absent": "Not computed (no observation)",
    "earlier-absent": "Not computed (no observation)",
    "later-missing": "Not computed (missing month)",
    "earlier-missing": "Not computed (missing month)",
    "break": "Not computed (definition change)",
    "earlier-not-positive": "Not computed (earlier value not above zero)",
}
NOT_POSITIVE_TEXT = "The earlier value is not above zero, so no percent change is computed."
VERB = {"grew": "grew", "shrank": "shrank", "unchanged": "was unchanged"}
TAG = {"grew": "Grew", "shrank": "Shrank", "unchanged": "Unchanged"}
COMPARISONS = (("1 year earlier", 12), ("5 years earlier", 60), ("10 years earlier", 120))


def make_series(name, source, series_id, rows, extra_changes=()):
    measure = MEASURES[series_id]
    row_dicts = []
    for period, value, code, released, basis in rows:
        parse_period(period)
        if value is not None:
            parse_value(value)
        if released is not None:
            parse_date(released)
        row_dicts.append({"period": period, "value": value, "missing_code": code,
                          "released": released, "released_basis": basis})
    numbers = [month_number(r["period"]) for r in row_dicts]
    if numbers != sorted(set(numbers)):
        raise ValueError(f"{name}: rows are not in period order without repeats")
    return {
        "name": name,
        "source": source,
        "series_id": series_id,
        "measure": measure,
        "breaks": list(BREAKS[measure]),
        "rows": row_dicts,
        "by_period": {r["period"]: r for r in row_dicts},
        "extra_changes": list(extra_changes),
    }


def change(series, to, months):
    """A change from E = to minus months to L = to (M6 to M11)."""
    later_month, earlier_month = to, months_before(to, months)
    by_period = series["by_period"]

    def not_computed(reason, text):
        return {"ok": False, "from": earlier_month, "to": later_month,
                "reason": reason, "reason_text": text, "cell": CELL[reason]}

    later = by_period.get(later_month)
    if later is None:
        return not_computed("later-absent",
                            f"There is no observation for {month_words(later_month)}.")
    if is_missing(later):
        return not_computed("later-missing",
                            f"{month_words(later_month)} has no published value: "
                            f"{missing_display(later['missing_code'])}.")
    earlier = by_period.get(earlier_month)
    if earlier is None:
        text = f"There is no observation for {month_words(earlier_month)}."
        first = series["rows"][0]["period"]
        if month_number(earlier_month) < month_number(first):
            text += f" The data start in {month_words(first)}."
        return not_computed("earlier-absent", text)
    if is_missing(earlier):
        return not_computed("earlier-missing",
                            f"{month_words(earlier_month)} has no published value: "
                            f"{missing_display(earlier['missing_code'])}.")
    for b in series["breaks"]:
        if month_number(earlier_month) < month_number(b) <= month_number(later_month):
            return not_computed("break",
                                f"The H.6 definition of {series['measure']} changed in "
                                f"{month_words(b)}, so {month_words(earlier_month)} and "
                                f"{month_words(later_month)} are not comparable.")

    dollars = dollar_change(later["value"], earlier["value"])
    dollars_text, dollars_cell = dollars_display(dollars)
    percent = percent_change(later["value"], earlier["value"])
    if percent is None:
        percent_text, percent_cell = None, CELL["earlier-not-positive"]
        percent_reason, percent_reason_text = "earlier-not-positive", NOT_POSITIVE_TEXT
    else:
        percent_text, percent_cell = percent_display(percent)
        percent_reason, percent_reason_text = None, None
    delta = exact(later["value"]) - exact(earlier["value"])
    direction = "grew" if delta > 0 else "shrank" if delta < 0 else "unchanged"
    return {
        "ok": True,
        "from": earlier_month,
        "to": later_month,
        "dollars": dollars,
        "dollars_text": dollars_text,
        "dollars_cell": dollars_cell,
        "percent": percent,
        "percent_text": percent_text,
        "percent_cell": percent_cell,
        "percent_reason": percent_reason,
        "percent_reason_text": percent_reason_text,
        "direction": direction,
        "tag": TAG[direction],
        "sentence": (f"The {series['measure']} money stock {VERB[direction]} from "
                     f"{month_words(earlier_month)} to {month_words(later_month)}."),
    }


def change_cells(result):
    """The dollar and percent cells of a change in a table (M14, M15)."""
    if result["ok"]:
        return result["dollars_cell"], result["percent_cell"]
    return result["cell"], result["cell"]


def value_cell(row):
    if row is None:
        return "No observation"
    if is_missing(row):
        return missing_display(row["missing_code"])
    return level_display(row["value"])[1]


def current_of(series):
    """The last row (M5)."""
    if not series["rows"]:
        return None
    row = series["rows"][-1]
    if is_missing(row):
        text = missing_display(row["missing_code"])
    else:
        text = level_display(row["value"])[0]
    return {"period": row["period"], "value": row["value"],
            "missing_code": row["missing_code"], "text": text}


def revision_window(series):
    """The periods of the last two rows (M12)."""
    return [r["period"] for r in series["rows"][-2:]]


def recent_table(series):
    """The last 24 rows, newest first (M14)."""
    window = revision_window(series)
    table = []
    for row in reversed(series["rows"][-24:]):
        period = row["period"]
        month = month_words(period)
        if period in window:
            month += " (subject to revision)"
        if period in series["breaks"]:
            month += " (first month of a new definition)"
        change_cell, percent_cell = change_cells(change(series, period, 1))
        table.append({
            "period": period,
            "month": month,
            "value": value_cell(row),
            "change": change_cell,
            "percent": percent_cell,
            "released": release_wording(row["released"], row["released_basis"]),
        })
    return table


def comparison_table(series):
    """The current month against 12, 60 and 120 months earlier (M15)."""
    if not series["rows"]:
        return []
    current = series["rows"][-1]["period"]
    table = []
    for label, months in COMPARISONS:
        earlier = months_before(current, months)
        change_cell, percent_cell = change_cells(change(series, current, months))
        table.append({
            "label": label,
            "months": months,
            "period": earlier,
            "month": month_words(earlier),
            "value": value_cell(series["by_period"].get(earlier)),
            "change": change_cell,
            "percent": percent_cell,
        })
    return table


def series_case(series):
    pairs = []
    for row in series["rows"]:
        pairs.append((row["period"], 1))
        pairs.append((row["period"], 12))
    pairs.extend(series["extra_changes"])
    if len(set(pairs)) != len(pairs):
        raise ValueError(f"{series['name']}: repeated change case")
    return {
        "name": series["name"],
        "source": series["source"],
        "series_id": series["series_id"],
        "measure": series["measure"],
        "breaks": series["breaks"],
        "rows": series["rows"],
        "current": current_of(series),
        "revision_window": revision_window(series),
        "changes": [{"to": to, "months": months, "result": change(series, to, months)}
                    for to, months in pairs],
        "recent": recent_table(series),
        "comparisons": comparison_table(series),
    }


# ---------------------------------------------------------------------------
# Embedded fixture rows

# Rows copied exactly from the verified test fixture root local/econ-fixture/live
# (test data, never a publication): 1959-01 to 1960-12 and 2015-01 to the last row
# of each current segment. Fields: period, value_usd_billions, missing_code,
# released, released_basis; an empty field is None.
FIXTURE_FILES = {
    "m1-sa": "series/m1-sa/all/37a42728e2f9ca41.csv",
    "m2-sa": "series/m2-sa/all/326496999de8adcb.csv",
    "m1-nsa": "series/m1-nsa/all/6c311d0f61108885.csv",
    "m2-nsa": "series/m2-nsa/all/c5ac45c719812b8e.csv",
}

FIXTURE_ROWS = {
    "m1-sa": (
        ("1959-01", "138.9", None, None, "not-recorded"),
        ("1959-02", "139.4", None, None, "not-recorded"),
        ("1959-03", "139.7", None, None, "not-recorded"),
        ("1959-04", "139.7", None, None, "not-recorded"),
        ("1959-05", "140.7", None, None, "not-recorded"),
        ("1959-06", "141.2", None, None, "not-recorded"),
        ("1959-07", "141.7", None, None, "not-recorded"),
        ("1959-08", "141.9", None, None, "not-recorded"),
        ("1959-09", "141.0", None, None, "not-recorded"),
        ("1959-10", "140.5", None, None, "not-recorded"),
        ("1959-11", "140.4", None, None, "not-recorded"),
        ("1959-12", "139.9", None, None, "not-recorded"),
        ("1960-01", "140.0", None, None, "not-recorded"),
        ("1960-02", "139.9", None, None, "not-recorded"),
        ("1960-03", "139.8", None, None, "not-recorded"),
        ("1960-04", "139.6", None, None, "not-recorded"),
        ("1960-05", "139.6", None, None, "not-recorded"),
        ("1960-06", "139.6", None, None, "not-recorded"),
        ("1960-07", "140.2", None, None, "not-recorded"),
        ("1960-08", "141.3", None, None, "not-recorded"),
        ("1960-09", "141.2", None, None, "not-recorded"),
        ("1960-10", "140.9", None, None, "not-recorded"),
        ("1960-11", "140.9", None, None, "not-recorded"),
        ("1960-12", "140.7", None, None, "not-recorded"),
        ("2015-01", "2973.0", None, None, "not-recorded"),
        ("2015-02", "3043.2", None, None, "not-recorded"),
        ("2015-03", "3018.9", None, None, "not-recorded"),
        ("2015-04", "3020.6", None, None, "not-recorded"),
        ("2015-05", "2996.7", None, None, "not-recorded"),
        ("2015-06", "3033.4", None, None, "not-recorded"),
        ("2015-07", "3053.8", None, None, "not-recorded"),
        ("2015-08", "3033.2", None, None, "not-recorded"),
        ("2015-09", "3057.6", None, None, "not-recorded"),
        ("2015-10", "3037.6", None, None, "not-recorded"),
        ("2015-11", "3094.7", None, None, "not-recorded"),
        ("2015-12", "3126.1", None, None, "not-recorded"),
        ("2016-01", "3125.1", None, None, "not-recorded"),
        ("2016-02", "3167.9", None, None, "not-recorded"),
        ("2016-03", "3193.6", None, None, "not-recorded"),
        ("2016-04", "3237.8", None, None, "not-recorded"),
        ("2016-05", "3259.6", None, None, "not-recorded"),
        ("2016-06", "3269.6", None, None, "not-recorded"),
        ("2016-07", "3263.5", None, None, "not-recorded"),
        ("2016-08", "3326.2", None, None, "not-recorded"),
        ("2016-09", "3331.2", None, None, "not-recorded"),
        ("2016-10", "3340.5", None, None, "not-recorded"),
        ("2016-11", "3361.5", None, None, "not-recorded"),
        ("2016-12", "3370.6", None, None, "not-recorded"),
        ("2017-01", "3423.9", None, None, "not-recorded"),
        ("2017-02", "3436.5", None, None, "not-recorded"),
        ("2017-03", "3496.4", None, None, "not-recorded"),
        ("2017-04", "3493.7", None, None, "not-recorded"),
        ("2017-05", "3545.6", None, None, "not-recorded"),
        ("2017-06", "3552.6", None, None, "not-recorded"),
        ("2017-07", "3570.0", None, None, "not-recorded"),
        ("2017-08", "3601.8", None, None, "not-recorded"),
        ("2017-09", "3578.9", None, None, "not-recorded"),
        ("2017-10", "3617.1", None, None, "not-recorded"),
        ("2017-11", "3639.7", None, None, "not-recorded"),
        ("2017-12", "3637.1", None, None, "not-recorded"),
        ("2018-01", "3691.7", None, None, "not-recorded"),
        ("2018-02", "3649.1", None, None, "not-recorded"),
        ("2018-03", "3713.7", None, None, "not-recorded"),
        ("2018-04", "3705.9", None, None, "not-recorded"),
        ("2018-05", "3689.5", None, None, "not-recorded"),
        ("2018-06", "3681.1", None, None, "not-recorded"),
        ("2018-07", "3701.7", None, None, "not-recorded"),
        ("2018-08", "3709.7", None, None, "not-recorded"),
        ("2018-09", "3710.4", None, None, "not-recorded"),
        ("2018-10", "3736.8", None, None, "not-recorded"),
        ("2018-11", "3713.7", None, None, "not-recorded"),
        ("2018-12", "3780.7", None, None, "not-recorded"),
        ("2019-01", "3787.8", None, None, "not-recorded"),
        ("2019-02", "3785.5", None, None, "not-recorded"),
        ("2019-03", "3782.3", None, None, "not-recorded"),
        ("2019-04", "3827.7", None, None, "not-recorded"),
        ("2019-05", "3824.4", None, None, "not-recorded"),
        ("2019-06", "3853.8", None, None, "not-recorded"),
        ("2019-07", "3884.2", None, None, "not-recorded"),
        ("2019-08", "3877.5", None, None, "not-recorded"),
        ("2019-09", "3916.9", None, None, "not-recorded"),
        ("2019-10", "3947.4", None, None, "not-recorded"),
        ("2019-11", "3962.6", None, None, "not-recorded"),
        ("2019-12", "4020.3", None, None, "not-recorded"),
        ("2020-01", "4026.4", None, None, "not-recorded"),
        ("2020-02", "4024.9", None, None, "not-recorded"),
        ("2020-03", "4322.9", None, None, "not-recorded"),
        ("2020-04", "4856.4", None, None, "not-recorded"),
        ("2020-05", "16312.5", None, None, "not-recorded"),
        ("2020-06", "16598.6", None, None, "not-recorded"),
        ("2020-07", "16801.3", None, None, "not-recorded"),
        ("2020-08", "16927.6", None, None, "not-recorded"),
        ("2020-09", "17166.2", None, None, "not-recorded"),
        ("2020-10", "17368.1", None, None, "not-recorded"),
        ("2020-11", "17638.8", None, None, "not-recorded"),
        ("2020-12", "17809.3", None, None, "not-recorded"),
        ("2021-01", "18106.3", None, None, "not-recorded"),
        ("2021-02", "18390.5", None, "2021-03-23", "calendar"),
        ("2021-03", "18657.4", None, "2021-04-27", "calendar"),
        ("2021-04", "18983.6", None, "2021-05-25", "calendar"),
        ("2021-05", "19288.1", None, "2021-06-22", "calendar"),
        ("2021-06", "19322.8", None, "2021-07-27", "calendar"),
        ("2021-07", "19503.1", None, "2021-08-24", "calendar"),
        ("2021-08", "19764.2", None, "2021-09-28", "calendar"),
        ("2021-09", "19942.8", None, "2021-10-26", "calendar"),
        ("2021-10", "20053.6", None, "2021-11-23", "calendar"),
        ("2021-11", "20245.2", None, "2021-12-28", "calendar"),
        ("2021-12", "20412.7", None, "2022-01-25", "calendar"),
        ("2022-01", "20561.2", None, "2022-02-22", "calendar"),
        ("2022-02", "20661.3", None, "2022-03-22", "calendar"),
        ("2022-03", "20735.0", None, "2022-04-26", "calendar"),
        ("2022-04", "20731.7", None, "2022-05-24", "calendar"),
        ("2022-05", "20684.9", None, "2022-06-28", "calendar"),
        ("2022-06", "20587.6", None, "2022-07-26", "calendar"),
        ("2022-07", "20529.4", None, "2022-08-23", "calendar"),
        ("2022-08", "20450.8", None, "2022-09-27", "calendar"),
        ("2022-09", "20281.3", None, "2022-10-25", "calendar"),
        ("2022-10", "20111.0", None, "2022-11-22", "calendar"),
        ("2022-11", "19953.0", None, "2022-12-27", "calendar"),
        ("2022-12", "19721.0", None, "2023-01-24", "calendar"),
        ("2023-01", "19588.8", None, "2023-02-28", "calendar"),
        ("2023-02", "19440.4", None, "2023-03-28", "calendar"),
        ("2023-03", "18988.6", None, "2023-04-25", "calendar"),
        ("2023-04", "18631.2", None, "2023-05-23", "calendar"),
        ("2023-05", "18565.0", None, "2023-06-27", "calendar"),
        ("2023-06", "18437.1", None, "2023-07-25", "calendar"),
        ("2023-07", "18350.1", None, "2023-08-22", "calendar"),
        ("2023-08", "18245.0", None, "2023-09-26", "calendar"),
        ("2023-09", "18139.8", None, "2023-10-24", "calendar"),
        ("2023-10", "18050.2", None, "2023-11-28", "calendar"),
        ("2023-11", "17985.7", None, "2023-12-26", "calendar"),
        ("2023-12", "17959.0", None, "2024-01-23", "calendar"),
        ("2024-01", "17979.7", None, "2024-02-27", "calendar"),
        ("2024-02", "18011.2", None, "2024-03-26", "calendar"),
        ("2024-03", "18028.3", None, "2024-04-23", "calendar"),
        ("2024-04", "17979.1", None, "2024-05-28", "calendar"),
        ("2024-05", "18010.1", None, "2024-06-25", "calendar"),
        ("2024-06", "18023.9", None, "2024-07-23", "calendar"),
        ("2024-07", "18020.5", None, "2024-08-27", "calendar"),
        ("2024-08", "18083.8", None, "2024-09-24", "calendar"),
        ("2024-09", "18146.3", None, "2024-10-22", "calendar"),
        ("2024-10", "18208.7", None, "2024-11-26", "calendar"),
        ("2024-11", "18336.2", None, "2024-12-26", "calendar"),
        ("2024-12", "18373.7", None, "2025-01-28", "calendar"),
        ("2025-01", "18442.4", None, "2025-02-25", "calendar"),
        ("2025-02", "18491.2", None, "2025-03-25", "calendar"),
        ("2025-03", "18535.0", None, "2025-04-22", "calendar"),
        ("2025-04", "18600.6", None, "2025-05-27", "calendar"),
        ("2025-05", "18641.7", None, "2025-06-24", "calendar"),
        ("2025-06", "18726.2", None, "2025-07-22", "calendar"),
        ("2025-07", "18782.7", None, "2025-08-26", "calendar"),
        ("2025-08", "18820.1", None, "2025-09-23", "calendar"),
        ("2025-09", "18883.8", None, "2025-10-28", "calendar"),
        ("2025-10", "18964.7", None, "2025-11-25", "calendar"),
        ("2025-11", "18998.1", None, "2025-12-23", "calendar"),
        ("2025-12", "19072.5", None, "2026-01-27", "calendar"),
        ("2026-01", "19165.1", None, "2026-02-24", "calendar"),
        ("2026-02", "19346.0", None, "2026-03-24", "calendar"),
        ("2026-03", "19381.2", None, "2026-04-28", "calendar"),
        ("2026-04", "19469.0", None, "2026-05-26", "calendar"),
        ("2026-05", "19689.2", None, "2026-06-23", "calendar"),
        ("2026-06", "19771.1", None, "2026-07-28", "calendar"),
        ("2026-07", "19863.6", None, "2026-08-25", "calendar"),
        ("2026-08", "19967.3", None, "2026-09-22", "calendar"),
        ("2026-09", "21264.9", None, "2026-10-27", "calendar"),
        ("2026-10", "20073.6", None, "2026-11-24", "calendar"),
    ),
    "m2-sa": (
        ("1959-01", "286.6", None, None, "not-recorded"),
        ("1959-02", "287.7", None, None, "not-recorded"),
        ("1959-03", "289.2", None, None, "not-recorded"),
        ("1959-04", "290.1", None, None, "not-recorded"),
        ("1959-05", "292.2", None, None, "not-recorded"),
        ("1959-06", "294.1", None, None, "not-recorded"),
        ("1959-07", "295.2", None, None, "not-recorded"),
        ("1959-08", "296.4", None, None, "not-recorded"),
        ("1959-09", "296.7", None, None, "not-recorded"),
        ("1959-10", "296.5", None, None, "not-recorded"),
        ("1959-11", "297.1", None, None, "not-recorded"),
        ("1959-12", "297.8", None, None, "not-recorded"),
        ("1960-01", "298.2", None, None, "not-recorded"),
        ("1960-02", "298.4", None, None, "not-recorded"),
        ("1960-03", "299.3", None, None, "not-recorded"),
        ("1960-04", "300.1", None, None, "not-recorded"),
        ("1960-05", "300.9", None, None, "not-recorded"),
        ("1960-06", "302.3", None, None, "not-recorded"),
        ("1960-07", "304.1", None, None, "not-recorded"),
        ("1960-08", "306.9", None, None, "not-recorded"),
        ("1960-09", "308.4", None, None, "not-recorded"),
        ("1960-10", "309.5", None, None, "not-recorded"),
        ("1960-11", "310.9", None, None, "not-recorded"),
        ("1960-12", "312.4", None, None, "not-recorded"),
        ("2015-01", "11806.2", None, None, "not-recorded"),
        ("2015-02", "11920.7", None, None, "not-recorded"),
        ("2015-03", "11919.1", None, None, "not-recorded"),
        ("2015-04", "11953.4", None, None, "not-recorded"),
        ("2015-05", "11981.9", None, None, "not-recorded"),
        ("2015-06", "12020.9", None, None, "not-recorded"),
        ("2015-07", "12063.5", None, None, "not-recorded"),
        ("2015-08", "12110.1", None, None, "not-recorded"),
        ("2015-09", "12172.7", None, None, "not-recorded"),
        ("2015-10", "12228.4", None, None, "not-recorded"),
        ("2015-11", "12322.7", None, None, "not-recorded"),
        ("2015-12", "12393.6", None, None, "not-recorded"),
        ("2016-01", "12522.2", None, None, "not-recorded"),
        ("2016-02", "12604.4", None, None, "not-recorded"),
        ("2016-03", "12662.2", None, None, "not-recorded"),
        ("2016-04", "12741.9", None, None, "not-recorded"),
        ("2016-05", "12800.7", None, None, "not-recorded"),
        ("2016-06", "12849.3", None, None, "not-recorded"),
        ("2016-07", "12907.3", None, None, "not-recorded"),
        ("2016-08", "12986.7", None, None, "not-recorded"),
        ("2016-09", "13052.7", None, None, "not-recorded"),
        ("2016-10", "13124.5", None, None, "not-recorded"),
        ("2016-11", "13214.2", None, None, "not-recorded"),
        ("2016-12", "13240.6", None, None, "not-recorded"),
        ("2017-01", "13318.9", None, None, "not-recorded"),
        ("2017-02", "13395.2", None, None, "not-recorded"),
        ("2017-03", "13464.6", None, None, "not-recorded"),
        ("2017-04", "13520.3", None, None, "not-recorded"),
        ("2017-05", "13567.4", None, None, "not-recorded"),
        ("2017-06", "13577.0", None, None, "not-recorded"),
        ("2017-07", "13638.5", None, None, "not-recorded"),
        ("2017-08", "13695.0", None, None, "not-recorded"),
        ("2017-09", "13743.0", None, None, "not-recorded"),
        ("2017-10", "13801.5", None, None, "not-recorded"),
        ("2017-11", "13849.1", None, None, "not-recorded"),
        ("2017-12", "13887.3", None, None, "not-recorded"),
        ("2018-01", "13902.4", None, None, "not-recorded"),
        ("2018-02", "13949.8", None, None, "not-recorded"),
        ("2018-03", "14014.5", None, None, "not-recorded"),
        ("2018-04", "14034.8", None, None, "not-recorded"),
        ("2018-05", "14091.0", None, None, "not-recorded"),
        ("2018-06", "14133.2", None, None, "not-recorded"),
        ("2018-07", "14170.0", None, None, "not-recorded"),
        ("2018-08", "14221.3", None, None, "not-recorded"),
        ("2018-09", "14243.9", None, None, "not-recorded"),
        ("2018-10", "14257.6", None, None, "not-recorded"),
        ("2018-11", "14288.4", None, None, "not-recorded"),
        ("2018-12", "14392.0", None, None, "not-recorded"),
        ("2019-01", "14460.2", None, None, "not-recorded"),
        ("2019-02", "14506.6", None, None, "not-recorded"),
        ("2019-03", "14559.5", None, None, "not-recorded"),
        ("2019-04", "14594.0", None, None, "not-recorded"),
        ("2019-05", "14703.2", None, None, "not-recorded"),
        ("2019-06", "14798.8", None, None, "not-recorded"),
        ("2019-07", "14882.7", None, None, "not-recorded"),
        ("2019-08", "14974.4", None, None, "not-recorded"),
        ("2019-09", "15047.2", None, None, "not-recorded"),
        ("2019-10", "15185.6", None, None, "not-recorded"),
        ("2019-11", "15301.3", None, None, "not-recorded"),
        ("2019-12", "15351.5", None, None, "not-recorded"),
        ("2020-01", "15425.0", None, None, "not-recorded"),
        ("2020-02", "15492.8", None, None, "not-recorded"),
        ("2020-03", "16034.4", None, None, "not-recorded"),
        ("2020-04", "17064.0", None, None, "not-recorded"),
        ("2020-05", "17931.9", None, None, "not-recorded"),
        ("2020-06", "18180.0", None, None, "not-recorded"),
        ("2020-07", "18331.4", None, None, "not-recorded"),
        ("2020-08", "18413.3", None, None, "not-recorded"),
        ("2020-09", "18605.0", None, None, "not-recorded"),
        ("2020-10", "18759.9", None, None, "not-recorded"),
        ("2020-11", "19002.4", None, None, "not-recorded"),
        ("2020-12", "19119.4", None, None, "not-recorded"),
        ("2021-01", "19375.3", None, None, "not-recorded"),
        ("2021-02", "19641.4", None, "2021-03-23", "calendar"),
        ("2021-03", "19874.5", None, "2021-04-27", "calendar"),
        ("2021-04", "20174.2", None, "2021-05-25", "calendar"),
        ("2021-05", "20457.7", None, "2021-06-22", "calendar"),
        ("2021-06", "20472.0", None, "2021-07-27", "calendar"),
        ("2021-07", "20636.8", None, "2021-08-24", "calendar"),
        ("2021-08", "20893.4", None, "2021-09-28", "calendar"),
        ("2021-09", "21062.0", None, "2021-10-26", "calendar"),
        ("2021-10", "21149.8", None, "2021-11-23", "calendar"),
        ("2021-11", "21328.2", None, "2021-12-28", "calendar"),
        ("2021-12", "21488.2", None, "2022-01-25", "calendar"),
        ("2022-01", "21623.5", None, "2022-02-22", "calendar"),
        ("2022-02", "21706.0", None, "2022-03-22", "calendar"),
        ("2022-03", "21770.7", None, "2022-04-26", "calendar"),
        ("2022-04", "21750.8", None, "2022-05-24", "calendar"),
        ("2022-05", "21700.2", None, "2022-06-28", "calendar"),
        ("2022-06", "21630.9", None, "2022-07-26", "calendar"),
        ("2022-07", "21631.8", None, "2022-08-23", "calendar"),
        ("2022-08", "21621.9", None, "2022-09-27", "calendar"),
        ("2022-09", "21520.8", None, "2022-10-25", "calendar"),
        ("2022-10", "21443.7", None, "2022-11-22", "calendar"),
        ("2022-11", "21388.5", None, "2022-12-27", "calendar"),
        ("2022-12", "21272.8", None, "2023-01-24", "calendar"),
        ("2023-01", "21261.6", None, "2023-02-28", "calendar"),
        ("2023-02", "21241.6", None, "2023-03-28", "calendar"),
        ("2023-03", "20932.6", None, "2023-04-25", "calendar"),
        ("2023-04", "20737.8", None, "2023-05-23", "calendar"),
        ("2023-05", "20808.0", None, "2023-06-27", "calendar"),
        ("2023-06", "20777.3", None, "2023-07-25", "calendar"),
        ("2023-07", "20770.3", None, "2023-08-22", "calendar"),
        ("2023-08", "20759.2", None, "2023-09-26", "calendar"),
        ("2023-09", "20729.8", None, "2023-10-24", "calendar"),
        ("2023-10", "20712.3", None, "2023-11-28", "calendar"),
        ("2023-11", "20724.0", None, "2023-12-26", "calendar"),
        ("2023-12", "20753.6", None, "2024-01-23", "calendar"),
        ("2024-01", "20808.5", None, "2024-02-27", "calendar"),
        ("2024-02", "20896.0", None, "2024-03-26", "calendar"),
        ("2024-03", "20940.9", None, "2024-04-23", "calendar"),
        ("2024-04", "20929.9", None, "2024-05-28", "calendar"),
        ("2024-05", "20995.3", None, "2024-06-25", "calendar"),
        ("2024-06", "21045.0", None, "2024-07-23", "calendar"),
        ("2024-07", "21072.7", None, "2024-08-27", "calendar"),
        ("2024-08", "21165.8", None, "2024-09-24", "calendar"),
        ("2024-09", "21249.9", None, "2024-10-22", "calendar"),
        ("2024-10", "21311.1", None, "2024-11-26", "calendar"),
        ("2024-11", "21429.3", None, "2024-12-26", "calendar"),
        ("2024-12", "21462.0", None, "2025-01-28", "calendar"),
        ("2025-01", "21513.6", None, "2025-02-25", "calendar"),
        ("2025-02", "21581.1", None, "2025-03-25", "calendar"),
        ("2025-03", "21657.4", None, "2025-04-22", "calendar"),
        ("2025-04", "21743.3", None, "2025-05-27", "calendar"),
        ("2025-05", "21808.8", None, "2025-06-24", "calendar"),
        ("2025-06", "21916.1", None, "2025-07-22", "calendar"),
        ("2025-07", "21998.1", None, "2025-08-26", "calendar"),
        ("2025-08", "22065.9", None, "2025-09-23", "calendar"),
        ("2025-09", "22149.2", None, "2025-10-28", "calendar"),
        ("2025-10", "22223.1", None, "2025-11-25", "calendar"),
        ("2025-11", "22253.2", None, "2025-12-23", "calendar"),
        ("2025-12", "22328.8", None, "2026-01-27", "calendar"),
        ("2026-01", "22386.6", None, "2026-02-24", "calendar"),
        ("2026-02", "22572.3", None, "2026-03-24", "calendar"),
        ("2026-03", "22613.9", None, "2026-04-28", "calendar"),
        ("2026-04", "22728.0", None, "2026-05-26", "calendar"),
        ("2026-05", "22980.9", None, "2026-06-23", "calendar"),
        ("2026-06", "23077.7", None, "2026-07-28", "calendar"),
        ("2026-07", "23177.4", None, "2026-08-25", "calendar"),
        ("2026-08", "23300.9", None, "2026-09-22", "calendar"),
        ("2026-09", "23413.9", None, "2026-10-27", "calendar"),
    ),
    "m1-nsa": (
        ("1959-01", "142.2", None, None, "not-recorded"),
        ("1959-02", "139.3", None, None, "not-recorded"),
        ("1959-03", "138.4", None, None, "not-recorded"),
        ("1959-04", "139.7", None, None, "not-recorded"),
        ("1959-05", "138.7", None, None, "not-recorded"),
        ("1959-06", "139.4", None, None, "not-recorded"),
        ("1959-07", "140.3", None, None, "not-recorded"),
        ("1959-08", "140.0", None, None, "not-recorded"),
        ("1959-09", "140.3", None, None, "not-recorded"),
        ("1959-10", "140.7", None, None, "not-recorded"),
        ("1959-11", "141.8", None, None, "not-recorded"),
        ("1959-12", "143.6", None, None, "not-recorded"),
        ("1960-01", "143.3", None, None, "not-recorded"),
        ("1960-02", "139.8", None, None, "not-recorded"),
        ("1960-03", "138.5", None, None, "not-recorded"),
        ("1960-04", "139.7", None, None, "not-recorded"),
        ("1960-05", "137.6", None, None, "not-recorded"),
        ("1960-06", "137.9", None, None, "not-recorded"),
        ("1960-07", "138.9", None, None, "not-recorded"),
        ("1960-08", "139.4", None, None, "not-recorded"),
        ("1960-09", "140.5", None, None, "not-recorded"),
        ("1960-10", "141.2", None, None, "not-recorded"),
        ("1960-11", "142.3", None, None, "not-recorded"),
        ("1960-12", "144.5", None, None, "not-recorded"),
        ("2015-01", "2958.3", None, None, "not-recorded"),
        ("2015-02", "2997.2", None, None, "not-recorded"),
        ("2015-03", "3041.6", None, None, "not-recorded"),
        ("2015-04", "3053.5", None, None, "not-recorded"),
        ("2015-05", "2994.2", None, None, "not-recorded"),
        ("2015-06", "3039.3", None, None, "not-recorded"),
        ("2015-07", "3057.3", None, None, "not-recorded"),
        ("2015-08", "3041.5", None, None, "not-recorded"),
        ("2015-09", "3035.7", None, None, "not-recorded"),
        ("2015-10", "3031.6", None, None, "not-recorded"),
        ("2015-11", "3076.2", None, None, "not-recorded"),
        ("2015-12", "3161.3", None, None, "not-recorded"),
        ("2016-01", "3114.5", None, None, "not-recorded"),
        ("2016-02", "3117.3", None, None, "not-recorded"),
        ("2016-03", "3200.8", None, None, "not-recorded"),
        ("2016-04", "3255.8", None, None, "not-recorded"),
        ("2016-05", "3256.4", None, None, "not-recorded"),
        ("2016-06", "3268.8", None, None, "not-recorded"),
        ("2016-07", "3266.9", None, None, "not-recorded"),
        ("2016-08", "3341.4", None, None, "not-recorded"),
        ("2016-09", "3319.1", None, None, "not-recorded"),
        ("2016-10", "3350.6", None, None, "not-recorded"),
        ("2016-11", "3351.8", None, None, "not-recorded"),
        ("2016-12", "3407.6", None, None, "not-recorded"),
        ("2017-01", "3412.4", None, None, "not-recorded"),
        ("2017-02", "3382.1", None, None, "not-recorded"),
        ("2017-03", "3501.6", None, None, "not-recorded"),
        ("2017-04", "3513.7", None, None, "not-recorded"),
        ("2017-05", "3542.0", None, None, "not-recorded"),
        ("2017-06", "3552.9", None, None, "not-recorded"),
        ("2017-07", "3573.7", None, None, "not-recorded"),
        ("2017-08", "3614.3", None, None, "not-recorded"),
        ("2017-09", "3568.2", None, None, "not-recorded"),
        ("2017-10", "3627.9", None, None, "not-recorded"),
        ("2017-11", "3629.8", None, None, "not-recorded"),
        ("2017-12", "3679.5", None, None, "not-recorded"),
        ("2018-01", "3679.1", None, None, "not-recorded"),
        ("2018-02", "3593.6", None, None, "not-recorded"),
        ("2018-03", "3716.2", None, None, "not-recorded"),
        ("2018-04", "3726.1", None, None, "not-recorded"),
        ("2018-05", "3683.7", None, None, "not-recorded"),
        ("2018-06", "3684.6", None, None, "not-recorded"),
        ("2018-07", "3708.0", None, None, "not-recorded"),
        ("2018-08", "3716.8", None, None, "not-recorded"),
        ("2018-09", "3700.3", None, None, "not-recorded"),
        ("2018-10", "3746.6", None, None, "not-recorded"),
        ("2018-11", "3705.1", None, None, "not-recorded"),
        ("2018-12", "3826.4", None, None, "not-recorded"),
        ("2019-01", "3774.2", None, None, "not-recorded"),
        ("2019-02", "3730.3", None, None, "not-recorded"),
        ("2019-03", "3781.9", None, None, "not-recorded"),
        ("2019-04", "3848.9", None, None, "not-recorded"),
        ("2019-05", "3817.6", None, None, "not-recorded"),
        ("2019-06", "3858.9", None, None, "not-recorded"),
        ("2019-07", "3892.3", None, None, "not-recorded"),
        ("2019-08", "3880.7", None, None, "not-recorded"),
        ("2019-09", "3909.2", None, None, "not-recorded"),
        ("2019-10", "3955.3", None, None, "not-recorded"),
        ("2019-11", "3954.7", None, None, "not-recorded"),
        ("2019-12", "4069.9", None, None, "not-recorded"),
        ("2020-01", "4010.3", None, None, "not-recorded"),
        ("2020-02", "3971.1", None, None, "not-recorded"),
        ("2020-03", "4318.2", None, None, "not-recorded"),
        ("2020-04", "4881.2", None, None, "not-recorded"),
        ("2020-05", "16199.8", None, None, "not-recorded"),
        ("2020-06", "16572.9", None, None, "not-recorded"),
        ("2020-07", "16774.4", None, None, "not-recorded"),
        ("2020-08", "16897.4", None, None, "not-recorded"),
        ("2020-09", "17164.1", None, None, "not-recorded"),
        ("2020-10", "17346.3", None, None, "not-recorded"),
        ("2020-11", "17663.5", None, None, "not-recorded"),
        ("2020-12", "17968.0", None, None, "not-recorded"),
        ("2021-01", "18101.5", None, None, "not-recorded"),
        ("2021-02", "18273.3", None, "2021-03-23", "calendar"),
        ("2021-03", "18725.8", None, "2021-04-27", "calendar"),
        ("2021-04", "19080.4", None, "2021-05-25", "calendar"),
        ("2021-05", "19162.7", None, "2021-06-22", "calendar"),
        ("2021-06", "19299.2", None, "2021-07-27", "calendar"),
        ("2021-07", "19478.6", None, "2021-08-24", "calendar"),
        ("2021-08", "19729.0", None, "2021-09-28", "calendar"),
        ("2021-09", "19938.6", None, "2021-10-26", "calendar"),
        ("2021-10", "20025.8", None, "2021-11-23", "calendar"),
        ("2021-11", "20268.9", None, "2021-12-28", "calendar"),
        ("2021-12", "20591.0", None, "2022-01-25", "calendar"),
        ("2022-01", "20552.8", None, "2022-02-22", "calendar"),
        ("2022-02", "20534.3", None, "2022-03-22", "calendar"),
        ("2022-03", "20818.3", None, "2022-04-26", "calendar"),
        ("2022-04", "20838.4", None, "2022-05-24", "calendar"),
        ("2022-05", "20562.4", None, "2022-06-28", "calendar"),
        ("2022-06", "20562.8", None, "2022-07-26", "calendar"),
        ("2022-07", "20501.1", None, "2022-08-23", "calendar"),
        ("2022-08", "20415.2", None, "2022-09-27", "calendar"),
        ("2022-09", "20269.3", None, "2022-10-25", "calendar"),
        ("2022-10", "20071.3", None, "2022-11-22", "calendar"),
        ("2022-11", "19973.9", None, "2022-12-27", "calendar"),
        ("2022-12", "19877.9", None, "2023-01-24", "calendar"),
        ("2023-01", "19584.4", None, "2023-02-28", "calendar"),
        ("2023-02", "19325.5", None, "2023-03-28", "calendar"),
        ("2023-03", "19073.5", None, "2023-04-25", "calendar"),
        ("2023-04", "18729.1", None, "2023-05-23", "calendar"),
        ("2023-05", "18474.6", None, "2023-06-27", "calendar"),
        ("2023-06", "18416.0", None, "2023-07-25", "calendar"),
        ("2023-07", "18320.5", None, "2023-08-22", "calendar"),
        ("2023-08", "18214.0", None, "2023-09-26", "calendar"),
        ("2023-09", "18122.7", None, "2023-10-24", "calendar"),
        ("2023-10", "18006.2", None, "2023-11-28", "calendar"),
        ("2023-11", "17998.0", None, "2023-12-26", "calendar"),
        ("2023-12", "18092.3", None, "2024-01-23", "calendar"),
        ("2024-01", "17980.7", None, "2024-02-27", "calendar"),
        ("2024-02", "17909.7", None, "2024-03-26", "calendar"),
        ("2024-03", "18116.7", None, "2024-04-23", "calendar"),
        ("2024-04", "18074.5", None, "2024-05-28", "calendar"),
        ("2024-05", "17932.1", None, "2024-06-25", "calendar"),
        ("2024-06", "18006.4", None, "2024-07-23", "calendar"),
        ("2024-07", "17990.9", None, "2024-08-27", "calendar"),
        ("2024-08", "18053.9", None, "2024-09-24", "calendar"),
        ("2024-09", "18116.2", None, "2024-10-22", "calendar"),
        ("2024-10", "18160.3", None, "2024-11-26", "calendar"),
        ("2024-11", "18342.2", None, "2024-12-26", "calendar"),
        ("2024-12", "18509.8", None, "2025-01-28", "calendar"),
        ("2025-01", "18447.4", None, "2025-02-25", "calendar"),
        ("2025-02", "18387.2", None, "2025-03-25", "calendar"),
        ("2025-03", "18627.8", None, "2025-04-22", "calendar"),
        ("2025-04", "18705.7", None, "2025-05-27", "calendar"),
        ("2025-05", "18569.1", None, "2025-06-24", "calendar"),
        ("2025-06", "18709.3", None, "2025-07-22", "calendar"),
        ("2025-07", "18746.1", None, "2025-08-26", "calendar"),
        ("2025-08", "18786.0", None, "2025-09-23", "calendar"),
        ("2025-09", "18845.3", None, "2025-10-28", "calendar"),
        ("2025-10", "18913.8", None, "2025-11-25", "calendar"),
        ("2025-11", "18997.0", None, "2025-12-23", "calendar"),
        ("2025-12", "19225.4", None, "2026-01-27", "calendar"),
        ("2026-01", "19170.2", None, "2026-02-24", "calendar"),
        ("2026-02", "19226.9", None, "2026-03-24", "calendar"),
        ("2026-03", "19476.0", None, "2026-04-28", "calendar"),
        ("2026-04", "19584.7", None, "2026-05-26", "calendar"),
        ("2026-05", "19618.4", None, "2026-06-23", "calendar"),
        ("2026-06", "19761.0", None, "2026-07-28", "calendar"),
        ("2026-07", "19827.8", None, "2026-08-25", "calendar"),
        ("2026-08", "19932.1", None, "2026-09-22", "calendar"),
        ("2026-09", "20009.7", None, "2026-10-27", "calendar"),
    ),
    "m2-nsa": (
        ("1959-01", "289.8", None, None, "not-recorded"),
        ("1959-02", "287.7", None, None, "not-recorded"),
        ("1959-03", "287.9", None, None, "not-recorded"),
        ("1959-04", "290.2", None, None, "not-recorded"),
        ("1959-05", "290.2", None, None, "not-recorded"),
        ("1959-06", "292.5", None, None, "not-recorded"),
        ("1959-07", "294.4", None, None, "not-recorded"),
        ("1959-08", "294.8", None, None, "not-recorded"),
        ("1959-09", "296.1", None, None, "not-recorded"),
        ("1959-10", "296.9", None, None, "not-recorded"),
        ("1959-11", "297.8", None, None, "not-recorded"),
        ("1959-12", "300.6", None, None, "not-recorded"),
        ("1960-01", "301.5", None, None, "not-recorded"),
        ("1960-02", "298.5", None, None, "not-recorded"),
        ("1960-03", "298.2", None, None, "not-recorded"),
        ("1960-04", "300.3", None, None, "not-recorded"),
        ("1960-05", "298.9", None, None, "not-recorded"),
        ("1960-06", "300.9", None, None, "not-recorded"),
        ("1960-07", "303.5", None, None, "not-recorded"),
        ("1960-08", "305.2", None, None, "not-recorded"),
        ("1960-09", "307.8", None, None, "not-recorded"),
        ("1960-10", "309.9", None, None, "not-recorded"),
        ("1960-11", "311.7", None, None, "not-recorded"),
        ("1960-12", "315.3", None, None, "not-recorded"),
        ("2015-01", "11785.2", None, None, "not-recorded"),
        ("2015-02", "11873.5", None, None, "not-recorded"),
        ("2015-03", "11983.0", None, None, "not-recorded"),
        ("2015-04", "12031.3", None, None, "not-recorded"),
        ("2015-05", "11934.7", None, None, "not-recorded"),
        ("2015-06", "11990.6", None, None, "not-recorded"),
        ("2015-07", "12041.9", None, None, "not-recorded"),
        ("2015-08", "12099.4", None, None, "not-recorded"),
        ("2015-09", "12166.6", None, None, "not-recorded"),
        ("2015-10", "12201.0", None, None, "not-recorded"),
        ("2015-11", "12328.4", None, None, "not-recorded"),
        ("2015-12", "12458.0", None, None, "not-recorded"),
        ("2016-01", "12509.6", None, None, "not-recorded"),
        ("2016-02", "12548.6", None, None, "not-recorded"),
        ("2016-03", "12716.6", None, None, "not-recorded"),
        ("2016-04", "12810.5", None, None, "not-recorded"),
        ("2016-05", "12742.2", None, None, "not-recorded"),
        ("2016-06", "12822.6", None, None, "not-recorded"),
        ("2016-07", "12884.2", None, None, "not-recorded"),
        ("2016-08", "12981.3", None, None, "not-recorded"),
        ("2016-09", "13047.1", None, None, "not-recorded"),
        ("2016-10", "13105.6", None, None, "not-recorded"),
        ("2016-11", "13217.4", None, None, "not-recorded"),
        ("2016-12", "13326.0", None, None, "not-recorded"),
        ("2017-01", "13308.0", None, None, "not-recorded"),
        ("2017-02", "13332.5", None, None, "not-recorded"),
        ("2017-03", "13519.1", None, None, "not-recorded"),
        ("2017-04", "13592.8", None, None, "not-recorded"),
        ("2017-05", "13502.6", None, None, "not-recorded"),
        ("2017-06", "13551.6", None, None, "not-recorded"),
        ("2017-07", "13614.9", None, None, "not-recorded"),
        ("2017-08", "13685.0", None, None, "not-recorded"),
        ("2017-09", "13737.5", None, None, "not-recorded"),
        ("2017-10", "13783.5", None, None, "not-recorded"),
        ("2017-11", "13853.2", None, None, "not-recorded"),
        ("2017-12", "13978.9", None, None, "not-recorded"),
        ("2018-01", "13897.5", None, None, "not-recorded"),
        ("2018-02", "13884.3", None, None, "not-recorded"),
        ("2018-03", "14067.1", None, None, "not-recorded"),
        ("2018-04", "14105.8", None, None, "not-recorded"),
        ("2018-05", "14017.4", None, None, "not-recorded"),
        ("2018-06", "14112.7", None, None, "not-recorded"),
        ("2018-07", "14148.2", None, None, "not-recorded"),
        ("2018-08", "14203.2", None, None, "not-recorded"),
        ("2018-09", "14237.2", None, None, "not-recorded"),
        ("2018-10", "14238.8", None, None, "not-recorded"),
        ("2018-11", "14293.5", None, None, "not-recorded"),
        ("2018-12", "14489.0", None, None, "not-recorded"),
        ("2019-01", "14465.2", None, None, "not-recorded"),
        ("2019-02", "14443.2", None, None, "not-recorded"),
        ("2019-03", "14614.3", None, None, "not-recorded"),
        ("2019-04", "14665.0", None, None, "not-recorded"),
        ("2019-05", "14618.1", None, None, "not-recorded"),
        ("2019-06", "14779.3", None, None, "not-recorded"),
        ("2019-07", "14860.7", None, None, "not-recorded"),
        ("2019-08", "14944.2", None, None, "not-recorded"),
        ("2019-09", "15036.9", None, None, "not-recorded"),
        ("2019-10", "15162.1", None, None, "not-recorded"),
        ("2019-11", "15308.1", None, None, "not-recorded"),
        ("2019-12", "15459.4", None, None, "not-recorded"),
        ("2020-01", "15444.7", None, None, "not-recorded"),
        ("2020-02", "15433.7", None, None, "not-recorded"),
        ("2020-03", "16102.6", None, None, "not-recorded"),
        ("2020-04", "17146.5", None, None, "not-recorded"),
        ("2020-05", "17812.8", None, None, "not-recorded"),
        ("2020-06", "18150.0", None, None, "not-recorded"),
        ("2020-07", "18298.3", None, None, "not-recorded"),
        ("2020-08", "18363.9", None, None, "not-recorded"),
        ("2020-09", "18585.2", None, None, "not-recorded"),
        ("2020-10", "18728.0", None, None, "not-recorded"),
        ("2020-11", "19015.4", None, None, "not-recorded"),
        ("2020-12", "19279.3", None, None, "not-recorded"),
        ("2021-01", "19400.3", None, None, "not-recorded"),
        ("2021-02", "19545.3", None, "2021-03-23", "calendar"),
        ("2021-03", "19961.4", None, "2021-04-27", "calendar"),
        ("2021-04", "20279.1", None, "2021-05-25", "calendar"),
        ("2021-05", "20325.8", None, "2021-06-22", "calendar"),
        ("2021-06", "20442.0", None, "2021-07-27", "calendar"),
        ("2021-07", "20603.6", None, "2021-08-24", "calendar"),
        ("2021-08", "20837.7", None, "2021-09-28", "calendar"),
        ("2021-09", "21038.1", None, "2021-10-26", "calendar"),
        ("2021-10", "21111.9", None, "2021-11-23", "calendar"),
        ("2021-11", "21343.4", None, "2021-12-28", "calendar"),
        ("2021-12", "21666.9", None, "2022-01-25", "calendar"),
        ("2022-01", "21645.1", None, "2022-02-22", "calendar"),
        ("2022-02", "21600.4", None, "2022-03-22", "calendar"),
        ("2022-03", "21875.3", None, "2022-04-26", "calendar"),
        ("2022-04", "21867.2", None, "2022-05-24", "calendar"),
        ("2022-05", "21571.8", None, "2022-06-28", "calendar"),
        ("2022-06", "21598.2", None, "2022-07-26", "calendar"),
        ("2022-07", "21592.2", None, "2022-08-23", "calendar"),
        ("2022-08", "21564.8", None, "2022-09-27", "calendar"),
        ("2022-09", "21486.7", None, "2022-10-25", "calendar"),
        ("2022-10", "21391.6", None, "2022-11-22", "calendar"),
        ("2022-11", "21400.7", None, "2022-12-27", "calendar"),
        ("2022-12", "21428.0", None, "2023-01-24", "calendar"),
        ("2023-01", "21289.9", None, "2023-02-28", "calendar"),
        ("2023-02", "21149.2", None, "2023-03-28", "calendar"),
        ("2023-03", "21043.8", None, "2023-04-25", "calendar"),
        ("2023-04", "20849.0", None, "2023-05-23", "calendar"),
        ("2023-05", "20712.9", None, "2023-06-27", "calendar"),
        ("2023-06", "20749.5", None, "2023-07-25", "calendar"),
        ("2023-07", "20729.4", None, "2023-08-22", "calendar"),
        ("2023-08", "20704.2", None, "2023-09-26", "calendar"),
        ("2023-09", "20686.2", None, "2023-10-24", "calendar"),
        ("2023-10", "20650.4", None, "2023-11-28", "calendar"),
        ("2023-11", "20724.7", None, "2023-12-26", "calendar"),
        ("2023-12", "20880.8", None, "2024-01-23", "calendar"),
        ("2024-01", "20846.7", None, "2024-02-27", "calendar"),
        ("2024-02", "20819.0", None, "2024-03-26", "calendar"),
        ("2024-03", "21063.8", None, "2024-04-23", "calendar"),
        ("2024-04", "21043.8", None, "2024-05-28", "calendar"),
        ("2024-05", "20911.2", None, "2024-06-25", "calendar"),
        ("2024-06", "21015.8", None, "2024-07-23", "calendar"),
        ("2024-07", "21026.1", None, "2024-08-27", "calendar"),
        ("2024-08", "21112.2", None, "2024-09-24", "calendar"),
        ("2024-09", "21193.3", None, "2024-10-22", "calendar"),
        ("2024-10", "21242.9", None, "2024-11-26", "calendar"),
        ("2024-11", "21425.0", None, "2024-12-26", "calendar"),
        ("2024-12", "21592.7", None, "2025-01-28", "calendar"),
        ("2025-01", "21558.7", None, "2025-02-25", "calendar"),
        ("2025-02", "21505.7", None, "2025-03-25", "calendar"),
        ("2025-03", "21792.3", None, "2025-04-22", "calendar"),
        ("2025-04", "21869.1", None, "2025-05-27", "calendar"),
        ("2025-05", "21726.4", None, "2025-06-24", "calendar"),
        ("2025-06", "21881.3", None, "2025-07-22", "calendar"),
        ("2025-07", "21938.2", None, "2025-08-26", "calendar"),
        ("2025-08", "22006.4", None, "2025-09-23", "calendar"),
        ("2025-09", "22084.6", None, "2025-10-28", "calendar"),
        ("2025-10", "22152.3", None, "2025-11-25", "calendar"),
        ("2025-11", "22242.5", None, "2025-12-23", "calendar"),
        ("2025-12", "22476.6", None, "2026-01-27", "calendar"),
        ("2026-01", "22432.8", None, "2026-02-24", "calendar"),
        ("2026-02", "22484.3", None, "2026-03-24", "calendar"),
        ("2026-03", "22753.2", None, "2026-04-28", "calendar"),
        ("2026-04", "22864.0", None, "2026-05-26", "calendar"),
        ("2026-05", "22897.3", None, "2026-06-23", "calendar"),
        ("2026-06", "23047.1", None, "2026-07-28", "calendar"),
        ("2026-07", "23117.0", None, "2026-08-25", "calendar"),
        ("2026-08", "23242.5", None, "2026-09-22", "calendar"),
        ("2026-09", "23339.6", None, "2026-10-27", "calendar"),
    ),
}

# Every detected_at value of the fixture revision CSVs, first-seen order, no repeats:
#   revisions/m1-sa/2026/1491e2d3a1aa7f8a.csv
#   revisions/m2-sa/2026/d58b27bb3f3aea50.csv
#   revisions/m1-nsa/2026/01ac925df69f85d6.csv
#   revisions/m2-nsa/2026/19fdd2111cfba250.csv
FIXTURE_DETECTED_AT = (
    "2026-11-24T19:17:00Z",
    "2026-11-24T20:00:00Z",
    "2026-11-25T15:17:00Z",
)

# ---------------------------------------------------------------------------
# Cases


def nr(period, value, code=None):
    """A row whose release date is not recorded."""
    return (period, value, code, None, "not-recorded")


SYNTHETIC = [
    make_series(
        "m1-break-2020", "synthetic", "m1-sa",
        [
            nr("2010-04", "1706.5"), nr("2010-05", "1712.3"), nr("2011-06", "1957.8"),
            nr("2015-04", "3012.4"), nr("2015-05", "3023.9"), nr("2016-06", "3262.1"),
            nr("2019-01", "3738.9"), nr("2019-02", "3757.1"), nr("2019-03", "3767.9"),
            nr("2019-04", "3781.6"), nr("2019-05", "3793.0"), nr("2019-06", "3818.3"),
            nr("2019-07", "3833.6"), nr("2019-08", None, "ND"), nr("2019-09", "3876.2"),
            nr("2019-10", "3906.0"), nr("2019-11", "3936.4"), nr("2019-12", "3977.4"),
            nr("2020-01", "3986.4"), nr("2020-02", "4005.4"), nr("2020-03", "4256.1"),
            nr("2020-04", "4856.4"), nr("2020-05", "16232.0"), nr("2020-06", "16408.9"),
            nr("2020-07", "16571.7"), nr("2020-08", "16766.2"), nr("2020-09", "16940.8"),
            nr("2020-10", "17143.9"), nr("2020-11", "17322.6"), nr("2020-12", "17771.3"),
            nr("2021-01", "18054.0"), nr("2021-02", "18325.5"), nr("2021-03", "18530.4"),
            nr("2021-04", "18795.4"),
            ("2021-05", "19093.9", None, "2021-06-22", "calendar"),
            ("2021-06", "19275.0", None, "2021-07-27", "calendar"),
        ],
        [
            ("2021-07", 1), ("2021-07", 12), ("2018-12", 1), ("2018-12", 12),
            ("2020-04", 60), ("2020-04", 120), ("2020-05", 60), ("2020-05", 120),
            ("2020-06", 60), ("2021-05", 60), ("2021-06", 60), ("2021-06", 120),
        ],
    ),
    make_series(
        "m1-break-current", "synthetic", "m1-nsa",
        [
            nr("2019-01", "3741.6"), nr("2019-02", "3689.3"), nr("2019-03", "3733.9"),
            nr("2019-04", "3810.0"), nr("2019-05", "3772.4"), nr("2019-06", "3829.1"),
            nr("2019-07", "3838.5"), nr("2019-08", "3843.2"), nr("2019-09", "3858.7"),
            nr("2019-10", "3889.0"), nr("2019-11", "3931.6"), nr("2019-12", "4028.8"),
            nr("2020-01", "3992.4"), nr("2020-02", "3964.7"), nr("2020-03", "4243.5"),
            nr("2020-04", "4859.8"),
            ("2020-05", "16139.6", None, "2020-06-23", "calendar"),
            ("2020-06", "16322.0", None, "2020-07-28", "rule"),
        ],
        [("2020-07", 1), ("2020-07", 12), ("2018-12", 1), ("2018-12", 12)],
    ),
    make_series(
        "m2-missing-codes", "synthetic", "m2-nsa",
        [
            nr("2024-01", "20766.6"), nr("2024-02", "20755.3"), nr("2024-03", None, "NA"),
            nr("2024-04", "20888.7"), nr("2024-05", "20918.4"), nr("2024-06", "21016.2"),
            nr("2024-07", "21070.9"), nr("2024-08", None, "XX"), nr("2024-09", "21221.6"),
            nr("2024-10", None), nr("2024-11", "21385.6"), nr("2024-12", "21600.2"),
            nr("2025-01", "21500.0", "ND"), nr("2025-02", "21524.0"), nr("2025-03", "21610.9"),
            nr("2025-04", "21803.1"), nr("2025-05", "21777.0"), nr("2025-06", "21899.4"),
            ("2025-07", "21945.3", None, "2025-08-26", "calendar"),
            ("2025-08", None, "NC", "2025-09-23", "calendar"),
        ],
        [("2025-09", 1), ("2025-09", 12), ("2023-12", 1), ("2023-12", 12)],
    ),
    make_series(
        "m2-rounding", "synthetic", "m2-sa",
        [
            nr("2022-01", "800.0"), nr("2022-02", "801.0"), nr("2022-03", "800.0"),
            nr("2022-04", "799.0"), nr("2022-05", "799.0"), nr("2022-06", "4000.0"),
            nr("2022-07", "3999.9"), nr("2022-08", "4000.0"), nr("2022-09", "0.0"),
            nr("2022-10", "1500.0"), nr("2022-11", "0.0"), nr("2022-12", "0.0"),
            nr("2023-01", "8000.0"), nr("2023-02", "8010.0"), nr("2023-03", "8000.0"),
            nr("2023-04", "8009.9"), nr("2023-05", "8000.0"), nr("2023-06", "8010.1"),
            nr("2023-07", "8000.0"), nr("2023-08", "7990.0"), nr("2023-09", "2000.0"),
            nr("2023-10", "2000.1"),
            ("2023-11", "2000.0", None, "2023-12-19", "calendar"),
            ("2023-12", "1999.9", None, "2024-01-23", "calendar"),
        ],
        [("2024-01", 1), ("2024-01", 12), ("2021-12", 1), ("2021-12", 12)],
    ),
    make_series(
        "m1-gap-midyear", "synthetic", "m1-nsa",
        [
            nr("2023-07", "18234.5"), nr("2023-08", "18170.2"), nr("2023-09", "18102.9"),
            nr("2023-10", "18044.1"), nr("2023-11", "17989.6"), nr("2023-12", "18186.3"),
            nr("2024-01", "18066.0"),
            nr("2024-03", "18011.4"), nr("2024-04", None, "ND"), nr("2024-05", "17998.7"),
            nr("2024-06", "18047.3"), nr("2024-07", "18065.9"), nr("2024-08", "18120.4"),
            nr("2024-09", "18166.1"), nr("2024-10", "18205.8"), nr("2024-11", "18311.0"),
            ("2024-12", "18563.2", None, None, "calendar"),
            nr("2025-01", "18402.7"),
            ("2025-02", "18350.9", None, "2025-03-25", "rule"),
            ("2025-04", "18571.4", None, "2025-05-28", "first-seen"),
        ],
        [
            ("2024-02", 1), ("2024-02", 12), ("2025-03", 1), ("2025-03", 12),
            ("2025-05", 1), ("2025-05", 12),
        ],
    ),
    make_series(
        "m2-short", "synthetic", "m2-nsa",
        [
            ("2026-06", "23050.0", None, "2026-07-28", "calendar"),
            ("2026-07", "23125.5", None, "2026-08-25", "rule"),
            ("2026-08", "23200.0", None, "2026-09-03", "first-seen"),
            ("2026-09", "23200.0", None, None, "calendar"),
            ("2026-10", "23180.4", None, "2026-11-24", "not-recorded"),
        ],
        [("2026-11", 1), ("2026-11", 12), ("2026-05", 1), ("2026-05", 12)],
    ),
    make_series(
        "m1-one-row", "synthetic", "m1-sa",
        [("2026-10", "20073.6", None, "2026-11-24", "calendar")],
        [("2026-11", 1), ("2026-11", 12), ("2026-09", 1), ("2026-09", 12)],
    ),
    make_series(
        "m2-empty", "synthetic", "m2-sa",
        [],
        [("2026-10", 1), ("2026-10", 12), ("2026-09", 1), ("2026-09", 12)],
    ),
    make_series(
        "m2-large-percent", "synthetic", "m2-nsa",
        [
            nr("2025-09", "2.0"), nr("2025-10", "25.0"), nr("2025-11", "24.5"),
            ("2026-09", "3.0", None, "2026-10-27", "calendar"),
            ("2026-10", "30000.0", None, "2026-11-24", "calendar"),
        ],
        [("2026-11", 1), ("2026-11", 12), ("2026-01", 1), ("2026-01", 12)],
    ),
]


def fixture_series():
    out = []
    for series_id, rows in FIXTURE_ROWS.items():
        first_block = [r for r in rows if r[0] <= "1960-12"]
        recent_block = [r for r in rows if r[0] >= "2015-01"]
        if (len(first_block) != 24 or first_block[0][0] != "1959-01"
                or first_block[-1][0] != "1960-12" or recent_block[0][0] != "2015-01"
                or len(first_block) + len(recent_block) != len(rows)):
            raise ValueError(f"fixture {series_id}: unexpected embedded rows")
        source = (f"fixture {FIXTURE_FILES[series_id]} rows 1959-01 to 1960-12 and "
                  f"2015-01 to {rows[-1][0]}")
        out.append(make_series(f"fixture-{series_id}", source, series_id, rows))
    return out


# (period, months, hand-worked result)
MONTHS_BEFORE = [
    ("2026-01", 1, "2025-12"), ("2026-01", 12, "2025-01"), ("2026-01", 13, "2024-12"),
    ("2026-01", 120, "2016-01"), ("2026-10", 1, "2026-09"), ("2026-10", 12, "2025-10"),
    ("2026-10", 60, "2021-10"), ("2026-10", 120, "2016-10"), ("2026-12", 1, "2026-11"),
    ("2026-12", 11, "2026-01"), ("2026-12", 12, "2025-12"), ("2026-12", 120, "2016-12"),
    ("2027-01", 1, "2026-12"), ("2026-11", 11, "2025-12"), ("1959-01", 1, "1958-12"),
    ("1959-01", 12, "1958-01"), ("1960-12", 23, "1959-01"), ("2020-05", 1, "2020-04"),
    ("2021-04", 12, "2020-04"), ("2021-05", 12, "2020-05"), ("2020-05", 60, "2015-05"),
    ("2020-05", 120, "2010-05"), ("2000-03", 3, "1999-12"), ("2000-02", 24, "1998-02"),
]

# (later, earlier, hand-worked dollar change)
DIFF = [
    ("20073.6", "21264.9", "-1191.3"), ("21264.9", "19967.3", "1297.6"),
    ("20073.6", "18964.7", "1108.9"), ("16232.0", "4856.4", "11375.6"),
    ("100", "99.95", "0.05"), ("99.95", "100", "-0.05"), ("7", "6.5", "0.5"),
    ("6.5", "7", "-0.5"), ("1234567.8", "0.1", "1234567.7"),
    ("0.1", "1234567.8", "-1234567.7"), ("801.0", "800.0", "1.0"),
    ("799.0", "800.0", "-1.0"), ("5.0", "5.0", "0.0"), ("0.0", "0.0", "0.0"),
    ("7", "7", "0"), ("100.00", "100.0", "0.00"), ("3999.9", "4000.0", "-0.1"),
    ("1000.0", "999.9", "0.1"), ("999.9", "1000.0", "-0.1"), ("0.1", "0.0", "0.1"),
    ("12", "0.005", "11.995"), ("0.5", "0.25", "0.25"),
]

# (later, earlier, hand-worked percent change or None)
PERCENT = [
    ("801.0", "800.0", "0.13"), ("799.0", "800.0", "-0.13"),
    ("8010.0", "8000.0", "0.13"), ("7990.0", "8000.0", "-0.13"),
    ("80099.9", "80000.0", "0.12"), ("80100.1", "80000.0", "0.13"),
    ("79900.1", "80000.0", "-0.12"), ("79899.9", "80000.0", "-0.13"),
    ("2000.1", "2000.0", "0.01"), ("1999.9", "2000.0", "-0.01"),
    ("2000.0", "2000.1", "0.00"), ("3999.9", "4000.0", "0.00"),
    ("4000.1", "4000.0", "0.00"), ("800.0", "800.0", "0.00"),
    ("5.0", "0.0", None), ("0.0", "0.0", None),
    ("20073.6", "21264.9", "-5.60"), ("21264.9", "19967.3", "6.50"),
    ("20073.6", "18964.7", "5.85"), ("16232.0", "4856.4", "234.24"),
    ("100", "99.95", "0.05"), ("7", "6.5", "7.69"), ("6.5", "7", "-7.14"),
    ("1234567.8", "0.1", "1234567700.00"), ("0.1", "1234567.8", "-100.00"),
    ("0.1", "4000.0", "-100.00"), ("0.0", "5.0", "-100.00"),
    ("1.0", "3.0", "-66.67"), ("2.0", "3.0", "-33.33"), ("4.0", "3.0", "33.33"),
    ("5.0", "3.0", "66.67"), ("1.0", "8.0", "-87.50"), ("1.1", "8.0", "-86.25"),
    ("12", "0.005", "239900.00"),
]

# (value, hand-worked text, hand-worked cell)
LEVELS = [
    ("20073.6", "$20,073.6 billion", "20,073.6"), ("138.9", "$138.9 billion", "138.9"),
    ("999.9", "$999.9 billion", "999.9"), ("1000.0", "$1,000.0 billion", "1,000.0"),
    ("4856.4", "$4,856.4 billion", "4,856.4"), ("16232.0", "$16,232.0 billion", "16,232.0"),
    ("99999.9", "$99,999.9 billion", "99,999.9"),
    ("100000.0", "$100,000.0 billion", "100,000.0"),
    ("1234567.8", "$1,234,567.8 billion", "1,234,567.8"),
    ("123456789.0", "$123,456,789.0 billion", "123,456,789.0"),
    ("0.1", "$0.1 billion", "0.1"), ("0.0", "$0.0 billion", "0.0"),
    ("100", "$100 billion", "100"),
]

# (dollar change, hand-worked text, hand-worked cell)
DOLLARS = [
    ("-1191.3", "-$1,191.3 billion", "-1,191.3"), ("106.3", "+$106.3 billion", "+106.3"),
    ("1108.9", "+$1,108.9 billion", "+1,108.9"), ("11375.6", "+$11,375.6 billion", "+11,375.6"),
    ("0.0", "$0.0 billion", "0.0"), ("0.00", "$0.00 billion", "0.00"),
    ("0", "$0 billion", "0"), ("-0.1", "-$0.1 billion", "-0.1"),
    ("0.05", "+$0.05 billion", "+0.05"), ("999.9", "+$999.9 billion", "+999.9"),
    ("1000.0", "+$1,000.0 billion", "+1,000.0"),
    ("-1234567.7", "-$1,234,567.7 billion", "-1,234,567.7"),
]

# (percent change, hand-worked text, hand-worked cell)
PERCENTS = [
    ("-5.60", "-5.60 percent", "-5.60"), ("0.53", "+0.53 percent", "+0.53"),
    ("0.00", "0.00 percent", "0.00"), ("5.85", "+5.85 percent", "+5.85"),
    ("0.13", "+0.13 percent", "+0.13"), ("-0.13", "-0.13 percent", "-0.13"),
    ("0.01", "+0.01 percent", "+0.01"), ("-0.01", "-0.01 percent", "-0.01"),
    ("100.00", "+100.00 percent", "+100.00"), ("-100.00", "-100.00 percent", "-100.00"),
    ("234.24", "+234.24 percent", "+234.24"), ("999.99", "+999.99 percent", "+999.99"),
    ("1000.00", "+1,000.00 percent", "+1,000.00"),
    ("-1000.00", "-1,000.00 percent", "-1,000.00"),
    ("1234.50", "+1,234.50 percent", "+1,234.50"),
    ("-98765.43", "-98,765.43 percent", "-98,765.43"),
    ("999999.99", "+999,999.99 percent", "+999,999.99"),
    ("1000000.00", "+1,000,000.00 percent", "+1,000,000.00"),
    ("-1234567.89", "-1,234,567.89 percent", "-1,234,567.89"),
    ("1234567700.00", "+1,234,567,700.00 percent", "+1,234,567,700.00"),
]

# (value, missing code, hand-worked text)
MISSING = [
    (None, "NA", "Not available (NA)"), (None, "ND", "No data (ND)"),
    (None, "NC", "Not calculable (NC)"), (None, "XX", "Missing (XX)"),
    (None, None, "Missing"), (None, "", "Missing"),
    ("20073.6", "NA", "Not available (NA)"), ("21500.0", "ND", "No data (ND)"),
    ("5.0", "XX", "Missing (XX)"),
]

# (released, released_basis, hand-worked text)
RELEASED = [
    ("2026-11-24", "calendar", "H.6 release of November 24, 2026"),
    ("2026-12-01", "calendar", "H.6 release of December 1, 2026"),
    ("2024-02-29", "calendar", "H.6 release of February 29, 2024"),
    (None, "calendar", "Release date not recorded"),
    (None, "not-recorded", "Release date not recorded"),
    ("2026-11-24", "not-recorded", "Release date not recorded"),
    ("2026-12-01", "rule", "Publication day by the New York Fed's schedule: December 1, 2026"),
    (None, "rule", "Release date not recorded"),
    ("2026-11-25", "first-seen",
     "First seen by RadMage Finance on November 25, 2026 (Eastern Time date)"),
    (None, "first-seen", "Release date not recorded"),
    ("2026-01-05", "estimated", "January 5, 2026"),
    (None, "estimated", "Release date not recorded"),
]

# (UTC time, hand-worked America/New_York date). Daylight time in 2025 runs
# from March 9 to November 2, in 2026 from March 8 to November 1, in 2027 from
# March 14 to November 7.
ET_EDGES = [
    ("2026-11-24T04:59:59Z", "2026-11-23"), ("2026-11-24T05:00:00Z", "2026-11-24"),
    ("2026-07-01T03:59:59Z", "2026-06-30"), ("2026-07-01T04:00:00Z", "2026-07-01"),
    ("2026-03-07T04:30:00Z", "2026-03-06"), ("2026-03-08T04:59:59Z", "2026-03-07"),
    ("2026-03-08T05:00:00Z", "2026-03-08"), ("2026-03-08T06:59:59Z", "2026-03-08"),
    ("2026-03-08T07:00:00Z", "2026-03-08"), ("2026-03-09T03:59:59Z", "2026-03-08"),
    ("2026-03-09T04:00:00Z", "2026-03-09"), ("2026-10-31T04:30:00Z", "2026-10-31"),
    ("2026-11-01T03:59:59Z", "2026-10-31"), ("2026-11-01T04:00:00Z", "2026-11-01"),
    ("2026-11-01T05:59:59Z", "2026-11-01"), ("2026-11-01T06:00:00Z", "2026-11-01"),
    ("2026-11-02T04:59:59Z", "2026-11-01"), ("2026-11-02T05:00:00Z", "2026-11-02"),
    ("2026-01-01T04:59:59Z", "2025-12-31"), ("2026-01-01T05:00:00Z", "2026-01-01"),
    ("2026-12-31T23:59:59Z", "2026-12-31"),
    ("2025-03-09T04:30:00Z", "2025-03-08"), ("2025-06-15T03:30:00Z", "2025-06-14"),
    ("2025-11-02T04:30:00Z", "2025-11-02"),
    ("2027-01-01T04:59:59Z", "2026-12-31"), ("2027-03-14T04:30:00Z", "2027-03-13"),
    ("2027-03-15T04:30:00Z", "2027-03-15"), ("2027-11-07T04:30:00Z", "2027-11-07"),
    ("2027-11-08T04:30:00Z", "2027-11-07"), ("2028-03-01T04:59:59Z", "2028-02-29"),
]

# The fixture detection times, with hand-worked dates (Eastern standard time).
FIXTURE_ET = {
    "2026-11-24T19:17:00Z": "2026-11-24",
    "2026-11-24T20:00:00Z": "2026-11-24",
    "2026-11-25T15:17:00Z": "2026-11-25",
}


# ---------------------------------------------------------------------------
# Independent restatements and hand-worked checks


def decimal_dollar_change(later, earlier):
    with localcontext() as ctx:
        ctx.prec = 100
        d = Decimal(later) - Decimal(earlier)
    text = format(d, "f")
    return text[1:] if text.startswith("-") and d == 0 else text


def decimal_percent_change(later, earlier):
    with localcontext() as ctx:
        ctx.prec = 100
        e = Decimal(earlier)
        if e <= 0:
            return None
        q = ((Decimal(later) - e) * 100 / e).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return "0.00" if q == 0 else format(q, "f")


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def check_change(series, to, months, **expected):
    result = change(series, to, months)
    for key, value in expected.items():
        check(result.get(key) == value,
              f"{series['name']} {to} minus {months}: {key} is {result.get(key)!r}, "
              f"expected {value!r}")


def self_check(all_series):
    for period, months, expected in MONTHS_BEFORE:
        check(months_before(period, months) == expected, f"months_before {period} {months}")
    for later, earlier, expected in DIFF:
        check(dollar_change(later, earlier) == expected, f"diff {later} {earlier}")
        check(decimal_dollar_change(later, earlier) == expected, f"decimal diff {later} {earlier}")
    for later, earlier, expected in PERCENT:
        check(percent_change(later, earlier) == expected, f"percent {later} {earlier}")
        check(decimal_percent_change(later, earlier) == expected,
              f"decimal percent {later} {earlier}")
    for value, text, cell in LEVELS:
        check(level_display(value) == (text, cell), f"level {value}")
    for dollars, text, cell in DOLLARS:
        check(dollars_display(dollars) == (text, cell), f"dollars {dollars}")
    for percent, text, cell in PERCENTS:
        check(percent_display(percent) == (text, cell), f"percent display {percent}")
    for value, code, text in MISSING:
        check(is_missing({"value": value, "missing_code": code}), f"missing {value} {code}")
        check(missing_display(code) == text, f"missing display {value} {code}")
    for released, basis, text in RELEASED:
        check(release_wording(released, basis) == text, f"released {released} {basis}")
    for utc, expected in ET_EDGES + sorted(FIXTURE_ET.items()):
        check(et_date(utc) == expected, f"et_date {utc}")
    check(set(FIXTURE_DETECTED_AT) == set(FIXTURE_ET), "fixture detection times")

    # Every computed change of every series against the decimal restatement.
    for series in all_series:
        for row in series["rows"]:
            for months in (1, 12, 60, 120):
                result = change(series, row["period"], months)
                if result["ok"]:
                    later = series["by_period"][result["to"]]["value"]
                    earlier = series["by_period"][result["from"]]["value"]
                    check(result["dollars"] == decimal_dollar_change(later, earlier),
                          f"{series['name']} {row['period']} dollars")
                    check(result["percent"] == decimal_percent_change(later, earlier),
                          f"{series['name']} {row['period']} percent")

    by_name = {s["name"]: s for s in all_series}
    brk = by_name["m1-break-2020"]
    check_change(brk, "2020-05", 1, ok=False, reason="break",
                 reason_text="The H.6 definition of M1 changed in May 2020, so April 2020 "
                             "and May 2020 are not comparable.")
    check_change(brk, "2020-06", 1, ok=True, dollars="176.9", percent="1.09")
    check_change(brk, "2020-04", 1, ok=True, dollars="600.3", percent="14.10")
    check_change(brk, "2021-04", 12, ok=False, reason="break")
    check_change(brk, "2021-05", 12, ok=True, dollars="2861.9", percent="17.63")
    check_change(brk, "2020-08", 12, ok=False, reason="earlier-missing",
                 reason_text="August 2019 has no published value: No data (ND).")
    check_change(brk, "2019-08", 1, ok=False, reason="later-missing", cell="Not computed (missing month)")
    check_change(brk, "2020-04", 60, ok=True, dollars="1844.0", percent="61.21")
    check_change(brk, "2020-04", 120, ok=True, dollars="3149.9", percent="184.58")
    check_change(brk, "2020-05", 60, ok=False, reason="break")
    check_change(brk, "2021-06", 120, ok=False, reason="break")
    check_change(brk, "2021-05", 60, ok=False, reason="earlier-absent",
                 reason_text="There is no observation for May 2016.")
    check_change(brk, "2010-04", 1, ok=False, reason="earlier-absent",
                 reason_text="There is no observation for March 2010. The data start in April 2010.")
    check_change(brk, "2018-12", 12, ok=False, reason="later-absent",
                 reason_text="There is no observation for December 2018.")
    check(recent_table(brk)[13]["month"] == "May 2020 (first month of a new definition)",
          "break month label")
    check(recent_table(brk)[-1]["period"] == "2019-07", "recent holds 24 rows")

    cur = by_name["m1-break-current"]
    check(recent_table(cur)[1]["month"]
          == "May 2020 (subject to revision) (first month of a new definition)",
          "both labels in order")
    check(comparison_table(cur)[0]["change"] == "Not computed (definition change)",
          "comparison across the break")

    mis = by_name["m2-missing-codes"]
    check(current_of(mis) == {"period": "2025-08", "value": None, "missing_code": "NC",
                              "text": "Not calculable (NC)"}, "missing current month")
    check_change(mis, "2025-08", 1, ok=False, reason="later-missing",
                 reason_text="August 2025 has no published value: Not calculable (NC).")
    check_change(mis, "2024-04", 1, ok=False, reason="earlier-missing",
                 reason_text="March 2024 has no published value: Not available (NA).")
    check_change(mis, "2025-03", 12, ok=False, reason="earlier-missing")
    check_change(mis, "2024-11", 1, ok=False, reason="earlier-missing",
                 reason_text="October 2024 has no published value: Missing.")
    check_change(mis, "2025-02", 1, ok=False, reason="earlier-missing",
                 reason_text="January 2025 has no published value: No data (ND).")
    check_change(mis, "2025-02", 12, ok=True, dollars="768.7", percent="3.70")
    check_change(mis, "2024-09", 1, ok=False, reason="earlier-missing",
                 reason_text="August 2024 has no published value: Missing (XX).")
    check([c["value"] for c in comparison_table(mis)]
          == ["Missing (XX)", "No observation", "No observation"], "missing comparisons")

    big = by_name["m2-large-percent"]
    check_change(big, "2025-10", 1, ok=True, dollars="23.0", percent="1150.00",
                 percent_text="+1,150.00 percent", percent_cell="+1,150.00")
    check_change(big, "2025-11", 1, ok=True, dollars="-0.5", percent="-2.00")
    check_change(big, "2026-09", 1, ok=False, reason="earlier-absent",
                 reason_text="There is no observation for August 2026.")
    check_change(big, "2026-09", 12, ok=True, dollars="1.0", percent="50.00")
    check_change(big, "2026-10", 1, ok=True, dollars="29997.0",
                 dollars_text="+$29,997.0 billion", percent="999900.00",
                 percent_text="+999,900.00 percent", percent_cell="+999,900.00")
    check_change(big, "2026-10", 12, ok=True, dollars="29975.0", percent="119900.00",
                 percent_cell="+119,900.00")
    check(comparison_table(big)[0]["change"] == "+29,975.0"
          and comparison_table(big)[0]["percent"] == "+119,900.00", "grouped percent cell")
    check(recent_table(big)[0]["percent"] == "+999,900.00", "grouped percent in the recent table")

    rnd = by_name["m2-rounding"]
    check_change(rnd, "2022-02", 1, percent="0.13", percent_text="+0.13 percent", direction="grew")
    check_change(rnd, "2022-04", 1, percent="-0.13", direction="shrank")
    check_change(rnd, "2022-05", 1, dollars="0.0", dollars_text="$0.0 billion",
                 percent="0.00", direction="unchanged", tag="Unchanged",
                 sentence="The M2 money stock was unchanged from April 2022 to May 2022.")
    check_change(rnd, "2022-07", 1, dollars="-0.1", percent="0.00", percent_cell="0.00",
                 direction="shrank")
    check_change(rnd, "2022-10", 1, ok=True, dollars="1500.0", dollars_cell="+1,500.0",
                 percent=None, percent_text=None, percent_reason="earlier-not-positive",
                 percent_cell="Not computed (earlier value not above zero)")
    check_change(rnd, "2022-12", 1, dollars="0.0", percent=None, direction="unchanged")
    check_change(rnd, "2023-08", 1, percent="-0.13")
    check_change(rnd, "2023-10", 1, percent="0.01")
    check_change(rnd, "2023-11", 1, percent="0.00", direction="shrank")
    check_change(rnd, "2023-12", 1, percent="-0.01")
    check_change(rnd, "2023-07", 12, percent="100.01")
    check(comparison_table(rnd)[0]["change"] == "+1,999.9"
          and comparison_table(rnd)[0]["percent"] == "Not computed (earlier value not above zero)",
          "comparison with an earlier zero")

    gap = by_name["m1-gap-midyear"]
    check_change(gap, "2023-07", 1, reason="earlier-absent",
                 reason_text="There is no observation for June 2023. The data start in July 2023.")
    check_change(gap, "2024-03", 1, reason="earlier-absent",
                 reason_text="There is no observation for February 2024.")
    check_change(gap, "2024-02", 1, reason="later-absent")
    check(revision_window(gap) == ["2025-02", "2025-04"], "revision window over a gap")
    check(comparison_table(gap)[1]["change"] == "Not computed (no observation)",
          "an absent month comes before a break")

    one = by_name["m1-one-row"]
    check_change(one, "2026-10", 1, reason="earlier-absent",
                 reason_text="There is no observation for September 2026. "
                             "The data start in October 2026.")
    check(recent_table(one)[0]["month"] == "October 2026 (subject to revision)", "one row")

    fx = by_name["fixture-m1-sa"]
    check_change(fx, "2026-10", 1, ok=True, dollars="-1191.3", percent="-5.60",
                 dollars_text="-$1,191.3 billion", direction="shrank",
                 sentence="The M1 money stock shrank from September 2026 to October 2026.")
    check_change(fx, "2015-01", 1, reason="earlier-absent",
                 reason_text="There is no observation for December 2014.")
    check_change(fx, "1959-01", 1, reason="earlier-absent",
                 reason_text="There is no observation for December 1958. "
                             "The data start in January 1959.")


# ---------------------------------------------------------------------------
# Output


def build():
    all_series = SYNTHETIC + fixture_series()
    self_check(all_series)
    et_inputs = list(FIXTURE_DETECTED_AT) + [utc for utc, _ in ET_EDGES]
    if len(set(et_inputs)) != len(et_inputs):
        raise ValueError("repeated et_date case")
    return {
        "generator": "tests/oracle/econ_money.py",
        "rules": "src/lib/data/money.ts M1 to M16",
        "months_before": [{"period": p, "months": n, "result": months_before(p, n)}
                          for p, n, _ in MONTHS_BEFORE],
        "diff": [{"later": l, "earlier": e, "dollars": dollar_change(l, e)}
                 for l, e, _ in DIFF],
        "percent": [{"later": l, "earlier": e, "percent": percent_change(l, e)}
                    for l, e, _ in PERCENT],
        "display": {
            "level": [dict(zip(("value", "text", "cell"), (v,) + level_display(v)))
                      for v, _, _ in LEVELS],
            "dollars": [dict(zip(("dollars", "text", "cell"), (d,) + dollars_display(d)))
                        for d, _, _ in DOLLARS],
            "percent": [dict(zip(("percent", "text", "cell"), (p,) + percent_display(p)))
                        for p, _, _ in PERCENTS],
            "missing": [{"value": v, "missing_code": c, "text": missing_display(c)}
                        for v, c, _ in MISSING],
            "released": [{"released": r, "released_basis": b, "text": release_wording(r, b)}
                         for r, b, _ in RELEASED],
        },
        "et_date": [{"utc": utc, "date": et_date(utc)} for utc in et_inputs],
        "series": [series_case(s) for s in all_series],
    }


def count_cases(content):
    n = len(content["months_before"]) + len(content["diff"]) + len(content["percent"])
    n += sum(len(cases) for cases in content["display"].values())
    n += len(content["et_date"])
    for s in content["series"]:
        n += len(s["changes"]) + len(s["recent"]) + len(s["comparisons"])
    return n


def main():
    content = build()
    text = json.dumps(content, indent=2, ensure_ascii=False) + "\n"
    if chr(0x2013) in text or chr(0x2014) in text:
        raise ValueError("a dash character the house rules forbid")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"econ money oracle: {count_cases(content)} cases written to {OUTPUT_LABEL}")


if __name__ == "__main__":
    main()
