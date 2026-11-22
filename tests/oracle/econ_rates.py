"""Independent reference oracle for the Interest Rate Tracker calculations.

Writes tests/oracle/fixtures/econ-rates.json from the written rules R1 to R13
of the Interest Rate Tracker (named in the fixture as "src/lib/data/rates.ts R1
to R13"). It is written from the rules text alone, not from the TypeScript
module, so that a mistake shared by both is unlikely. It uses only the Python
standard library, and every number is a decimal string computed exactly: a
change in basis points is found in integers scaled by a power of ten, and each
one is checked against a restatement in the decimal module at a precision far
beyond its inputs. Nothing goes through floating point.

Run from the repository root (tests/oracle/generate.py also runs it):

    python -I tests/oracle/econ_rates.py

The fixture holds four sections:

  bp             changes in basis points (R2) with their signed and words
                 forms: positive, negative and zero changes, inputs with
                 different numbers of decimals, trailing zeros, large changes,
                 negative inputs and the singular "1 basis point";
  months_back    dates moved back by whole months (R3), with month-end
                 clamping and leap years;
  target_change  changes from one target to another (R9): rate to rate, range
                 to range with equal and with unequal bound changes, rate to
                 range, range to rate and an unchanged target;
  cases          small datasets, each with the latest EFFR (R4), its
                 comparisons (R5 to R7), the target in effect on given dates
                 (R8), the change point rows (R10), the comparison table (R11),
                 the recent table (R12) and the chart windows (R13).

Every case but one is synthetic. The case "nyfed-fixture" is built from rows
copied from the verified appendix B fixture CSVs. Those rows are test data
from the appendix B fixture root, never a publication. Its observations are a
subset of the fixture's EFFR records (whole months, chosen so that every
comparison date and every window start falls in a copied month), so it is
marked incomplete and its windows leave out the EFFR line.

Self-checks, each of which raises on failure:
  - every change in basis points equals its decimal restatement, is in R2's
    canonical form, and is the negation of the change the other way;
  - hand-worked results for every bp, months back and target change entry,
    and for chosen results of every case;
  - every months back result keeps the day or clamps it to the month's end,
    exactly m months earlier;
  - a change from a rate to a rate always has equal bound changes;
  - the change point rows add up to the change from the first target to the
    last, and the changes between valued observations add up the same way;
  - every comparison, target lookup and recent row is restated from the rules
    with a separate scan, and the recent table has min(30, n) rows;
  - every window lies within [S, E], its segments alternate kinds, every
    segment ends where the next begins and the last one at E;
  - the fixture case's latest EFFR, current target and change point count are
    those of the copied CSVs;
  - the output and this script are ASCII, and the JSON is deterministic.
"""

import calendar
import datetime
import decimal
import json
import re
from pathlib import Path

GENERATOR = "tests/oracle/econ_rates.py"
RULES = "src/lib/data/rates.ts R1 to R13"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE_NAME = "econ-rates.json"

DECIMAL_PATTERN = re.compile(r"(-?)([0-9]+)(?:\.([0-9]+))?")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
CANONICAL_PATTERN = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?")

RECENT_ROWS = 30
WINDOW_DAYS = 7
COMPARISONS = (("previous", None), ("month", 1), ("year", 12), ("five-years", 60))
WINDOWS = (("1y", 12), ("5y", 60), ("10y", 120), ("all", None))

TALLY = {"bp restated": 0, "rate pairs": 0, "case checks": 0}


def require(condition, message):
    """Raise when a self-check fails (never exit: generate.py runs every oracle in one process)."""
    if not condition:
        raise AssertionError(f"econ rates oracle: {message}")


# R1 and R2: decimal strings and changes in basis points

def parse_decimal(text):
    """R1: a decimal string as (units, scale), worth exactly units / 10**scale."""
    match = DECIMAL_PATTERN.fullmatch(text) if isinstance(text, str) else None
    require(match is not None, f"R1: {text!r} is not a decimal string")
    sign, whole, fraction = match.group(1), match.group(2), match.group(3) or ""
    units = int(whole + fraction)
    return (-units if sign else units), len(fraction)


def canonical(units, scale):
    """R2's canonical form of units / 10**scale: no exponent, no plus sign, no leading zeros,
    no trailing zeros after the point (nor the point with them), and zero as "0"."""
    if units == 0:
        return "0"
    sign = "-" if units < 0 else ""
    magnitude = abs(units)
    while scale > 0 and magnitude % 10 == 0:
        magnitude //= 10
        scale -= 1
    digits = str(magnitude)
    if scale == 0:
        return sign + digits
    digits = digits.rjust(scale + 1, "0")
    return f"{sign}{digits[:-scale]}.{digits[-scale:]}"


def bp_restated(earlier, later):
    """R2 restated in the decimal module, trapping any rounding."""
    with decimal.localcontext() as context:
        context.prec = 400
        context.traps[decimal.Inexact] = True
        context.traps[decimal.Rounded] = True
        change = (decimal.Decimal(later) - decimal.Decimal(earlier)) * 100
        if change.is_zero():
            return "0"
        return format(change.normalize(), "f")


def bp(earlier, later):
    """R2: the change from an earlier value to a later one, (later - earlier) x 100, exactly."""
    a_units, a_scale = parse_decimal(earlier)
    b_units, b_scale = parse_decimal(later)
    scale = max(a_scale, b_scale)
    change = b_units * 10 ** (scale - b_scale) - a_units * 10 ** (scale - a_scale)
    if scale >= 2:
        scale -= 2
    else:
        change *= 10 ** (2 - scale)
        scale = 0
    result = canonical(change, scale)
    restated = bp_restated(earlier, later)
    require(result == restated, f"R2: {earlier} to {later} gives {result}, restated {restated}")
    require(CANONICAL_PATTERN.fullmatch(result) is not None and result != "-0",
            f"R2: {result!r} is not canonical")
    TALLY["bp restated"] += 1
    return result


def signed(change):
    """R2's signed form: "+" before a positive change, a negative one keeps its "-", zero is "0"."""
    if change == "0" or change.startswith("-"):
        return change
    return "+" + change


def words(change):
    """R2's words form, with "basis point" (singular) when the amount is exactly "1"."""
    if change == "0":
        return "unchanged"
    direction = "down" if change.startswith("-") else "up"
    amount = change[1:] if change.startswith("-") else change
    unit = "basis point" if amount == "1" else "basis points"
    return f"{direction} {amount} {unit}"


def negate(change):
    """The negation of a canonical change ("0" stays "0")."""
    if change == "0":
        return change
    return change[1:] if change.startswith("-") else "-" + change


# R3: months back

def parse_date(text):
    """A YYYY-MM-DD date string as a date (anything else is refused)."""
    require(isinstance(text, str) and DATE_PATTERN.fullmatch(text) is not None, f"not a date: {text!r}")
    day = datetime.date.fromisoformat(text)
    require(day.isoformat() == text, f"not a date: {text!r}")
    return day


def months_back(date_text, months):
    """R3: move the year and month back by m months, keeping the day of the month or taking
    the last day of the resulting month when that month is shorter."""
    require(isinstance(months, int) and not isinstance(months, bool) and months >= 0,
            f"R3: months must be a whole number >= 0, not {months!r}")
    day = parse_date(date_text)
    year, month_index = divmod(day.year * 12 + day.month - 1 - months, 12)
    last_day = calendar.monthrange(year, month_index + 1)[1]
    return datetime.date(year, month_index + 1, min(day.day, last_day)).isoformat()


def days_between(earlier, later):
    """Calendar days from one date string to another."""
    return (parse_date(later) - parse_date(earlier)).days


# Inputs

def rate(effective, value):
    """A 'rate' change point."""
    return {"effective": effective, "kind": "rate", "value": value, "lower": None, "upper": None}


def band(effective, lower, upper):
    """A 'range' change point."""
    return {"effective": effective, "kind": "range", "value": None, "lower": lower, "upper": upper}


def check_inputs(observations, change_points):
    """The inputs as the rules state them: ascending unique periods with R1 values or null,
    ascending unique effective dates, a rate with a value only and a range with bounds only."""
    previous = None
    for period, value in observations:
        parse_date(period)
        require(previous is None or period > previous, f"observations out of order at {period}")
        if value is not None:
            parse_decimal(value)
        previous = period
    previous = None
    for point in change_points:
        require(list(point) == ["effective", "kind", "value", "lower", "upper"], f"change point keys {point}")
        parse_date(point["effective"])
        require(previous is None or point["effective"] > previous,
                f"change points out of order at {point['effective']}")
        if point["kind"] == "rate":
            parse_decimal(point["value"])
            require(point["lower"] is None and point["upper"] is None, f"rate with bounds {point}")
        else:
            require(point["kind"] == "range", f"unknown kind {point}")
            require(point["value"] is None, f"range with a value {point}")
            parse_decimal(point["lower"])
            parse_decimal(point["upper"])
        previous = point["effective"]


# R4 to R7: the latest EFFR and its comparisons

def latest_effr(observations):
    """R4: the last observation whose value is not null."""
    for period, value in reversed(observations):
        if value is not None:
            return period, value
    return None


def previous_observation(observations, period):
    """R5: the last observation before the period whose value is not null."""
    found = None
    for candidate, value in observations:
        if candidate >= period:
            break
        if value is not None:
            found = (candidate, value)
    return found


def observation_for(observations, date):
    """R6: the last valued observation on or before T, used only when it is at most 7 days
    before T; otherwise None with the reason."""
    found = None
    for period, value in observations:
        if period > date:
            break
        if value is not None:
            found = (period, value)
    if found is None:
        return None, "before-data"
    if days_between(found[0], date) > WINDOW_DAYS:
        return None, "outside-window"
    return found, None


def comparisons(observations, latest):
    """R7: 'previous', 'month', 'year' and 'five-years', each against the latest EFFR."""
    if latest is None:
        return []
    reference, value = latest
    rows = []
    for ident, months in COMPARISONS:
        if months is None:
            date = None
            found = previous_observation(observations, reference)
            reason = None if found is not None else "no-earlier"
        else:
            date = months_back(reference, months)
            found, reason = observation_for(observations, date)
        rows.append({
            "id": ident,
            "date": date,
            "period": found[0] if found is not None else None,
            "value": found[1] if found is not None else None,
            "bp": bp(found[1], value) if found is not None else None,
            "reason": reason,
        })
    return rows


# R8 to R11: targets, their changes, the change point rows and the comparison table

def target_in_effect(change_points, date):
    """R8: the change point with the latest effective date on or before the date, or None."""
    found = None
    for point in change_points:
        if point["effective"] > date:
            break
        found = point
    return found


def bounds(point):
    """R8: a rate's bounds are both its value; a range's are its lower and upper."""
    if point["kind"] == "rate":
        return point["value"], point["value"]
    return point["lower"], point["upper"]


def target_change(earlier, later):
    """R9: the lower-bound and upper-bound changes, with the signed and words forms."""
    old_lower, old_upper = bounds(earlier)
    new_lower, new_upper = bounds(later)
    lower = bp(old_lower, new_lower)
    upper = bp(old_upper, new_upper)
    if lower == upper:
        signed_text, words_text = signed(lower), words(lower)
    else:
        signed_text = f"lower {signed(lower)}, upper {signed(upper)}"
        words_text = f"lower bound {words(lower)}, upper bound {words(upper)}"
    return {"lower": lower, "upper": upper, "signed": signed_text, "words": words_text}


def bound_changes(earlier, later):
    """R9's two bound changes alone, as the cases carry them."""
    change = target_change(earlier, later)
    return {"lower": change["lower"], "upper": change["upper"]}


def target_summary(point):
    """A target in effect: its effective date and its bounds."""
    if point is None:
        return None
    lower, upper = bounds(point)
    return {"effective": point["effective"], "lower": lower, "upper": upper}


def change_point_rows(change_points):
    """R10: every change point, oldest first, with its change from the one before it."""
    rows = []
    before = None
    for point in change_points:
        lower, upper = bounds(point)
        rows.append({
            "effective": point["effective"],
            "lower": lower,
            "upper": upper,
            "change": None if before is None else bound_changes(before, point),
        })
        before = point
    return rows


def comparison_table(change_points, latest, comparison_rows):
    """R11: the latest row, then one row per comparison, each with the target in effect on its
    period and (except the latest row) the change from that target to the target on D."""
    if latest is None:
        return []
    reference, value = latest
    reference_target = target_in_effect(change_points, reference)
    rows = [{
        "id": "latest",
        "period": reference,
        "effr": value,
        "target": target_summary(reference_target),
        "target_change": None,
    }]
    for comparison in comparison_rows:
        if comparison["period"] is None:
            rows.append({"id": comparison["id"], "period": None, "effr": None, "target": None,
                         "target_change": None})
            continue
        target = target_in_effect(change_points, comparison["period"])
        change = None
        if target is not None and reference_target is not None:
            change = bound_changes(target, reference_target)
        rows.append({
            "id": comparison["id"],
            "period": comparison["period"],
            "effr": comparison["value"],
            "target": target_summary(target),
            "target_change": change,
        })
    return rows


# R12: the recent table

def recent_rows(observations):
    """R12: the last 30 observations, newest first, each with its previous observation (R5,
    given by its period) and the change from it."""
    rows = []
    for period, value in reversed(observations[-RECENT_ROWS:]):
        previous = previous_observation(observations, period)
        change = None
        if value is not None and previous is not None:
            change = bp(previous[1], value)
        rows.append({
            "period": period,
            "value": value,
            "previous": previous[0] if previous is not None else None,
            "bp": change,
        })
    return rows


# R13: the chart windows

def level_point(x, point):
    """A target point: (x, value) for a rate, (x, lower, upper) for a range."""
    if point["kind"] == "rate":
        return [x, point["value"]]
    return [x, point["lower"], point["upper"]]


def target_segments(points, end):
    """R13: consecutive points of one kind form a segment; a segment followed by another ends
    with a closing point at the next segment's first x, and the last ends with one at E unless
    its last point is already at E. Each closing point holds its segment's last level."""
    groups = []
    for x, point in points:
        if groups and groups[-1][0] == point["kind"]:
            groups[-1][1].append((x, point))
        else:
            groups.append((point["kind"], [(x, point)]))
    segments = []
    for index, (kind, members) in enumerate(groups):
        drawn = [level_point(x, point) for x, point in members]
        last_x, last_point = members[-1]
        if index + 1 < len(groups):
            drawn.append(level_point(groups[index + 1][1][0][0], last_point))
        elif last_x != end:
            drawn.append(level_point(end, last_point))
        segments.append({"kind": kind, "points": drawn})
    return segments


def chart_windows(observations, change_points, latest, complete):
    """R13: windows '1y', '5y', '10y' and 'all' (none without observations and change points)."""
    ends = []
    if latest is not None:
        ends.append(latest[0])
    if change_points:
        ends.append(change_points[-1]["effective"])
    if not ends:
        return {key: None for key, _ in WINDOWS}
    end = max(ends)
    windows = {}
    for key, months in WINDOWS:
        if months is None:
            starts = []
            if observations:
                starts.append(observations[0][0])
            if change_points:
                starts.append(change_points[0]["effective"])
            start = min(starts)
        else:
            start = months_back(end, months)
        line = [[period, value] for period, value in observations if start <= period <= end]
        x0 = None
        segments = []
        if change_points:
            x0 = max(start, change_points[0]["effective"])
            points = [(x0, target_in_effect(change_points, x0))]
            points += [(point["effective"], point) for point in change_points
                       if x0 < point["effective"] <= end]
            segments = target_segments(points, end)
        window = {
            "start": start,
            "end": end,
            "x0": x0,
            "effr_first": line[0][0] if line else None,
            "effr_last": line[-1][0] if line else None,
        }
        if complete:
            window["effr"] = line
        window["segments"] = segments
        windows[key] = window
    return windows


# The sections of the fixture

# (earlier, later, the change in basis points worked by hand)
BP_EXAMPLES = [
    ("3.64", "3.88", "24"),
    ("3.88", "3.64", "-24"),
    ("3.88", "3.875", "-0.5"),
    ("3.875", "3.88", "0.5"),
    ("1.00", "1.000", "0"),
    ("1.000", "1.00", "0"),
    ("3.88", "3.88", "0"),
    ("0.10", "0.20", "10"),
    ("0.20", "0.10", "-10"),
    ("0.00", "5.25", "525"),
    ("5.25", "0.00", "-525"),
    ("6.50", "1.00", "-550"),
    ("20.00", "0.07", "-1993"),
    ("100", "0", "-10000"),
    ("0", "1000000000000000000000", "100000000000000000000000"),
    ("0.08", "0.09", "1"),
    ("0.09", "0.08", "-1"),
    ("1.01", "1.0", "-1"),
    ("0.995", "1.005", "1"),
    ("0.5", "0.51", "1"),
    ("3.875", "3.885", "1"),
    ("4.33", "4.335", "0.5"),
    ("0", "0.001", "0.1"),
    ("0.001", "0", "-0.1"),
    ("0.0001", "0.0002", "0.01"),
    ("2.000", "2.0001", "0.01"),
    ("10.12345", "10.12346", "0.001"),
    ("0.123456789", "0.123456790", "0.0000001"),
    ("0.000000000000000001", "0", "-0.0000000000000001"),
    ("1", "2", "100"),
    ("2.5", "2", "-50"),
    ("1.5", "1.25", "-25"),
    ("0.07", "0.10", "3"),
    ("0.41", "0.31", "-10"),
    ("7.03", "6.52", "-51"),
    ("3.63", "3.88", "25"),
    ("0.08", "3.88", "380"),
    ("-0.05", "0.10", "15"),
    ("0.10", "-0.05", "-15"),
    ("-0.25", "-0.5", "-25"),
    ("-0.5", "-0.25", "25"),
    ("-2.125", "-2.12", "0.5"),
    ("-1", "-1.00", "0"),
    ("0.00", "-0.00", "0"),
    ("-0.00", "0.00", "0"),
]

# (earlier, later, signed, words) worked by hand
BP_FORMS = [
    ("3.64", "3.88", "+24", "up 24 basis points"),
    ("3.88", "3.875", "-0.5", "down 0.5 basis points"),
    ("3.875", "3.88", "+0.5", "up 0.5 basis points"),
    ("1.00", "1.000", "0", "unchanged"),
    ("0.00", "-0.00", "0", "unchanged"),
    ("0.08", "0.09", "+1", "up 1 basis point"),
    ("0.09", "0.08", "-1", "down 1 basis point"),
    ("0.0001", "0.0002", "+0.01", "up 0.01 basis points"),
    ("0.00", "5.25", "+525", "up 525 basis points"),
    ("20.00", "0.07", "-1993", "down 1993 basis points"),
]

# (date, months, result worked by hand)
MONTHS_BACK_EXAMPLES = [
    ("2026-03-31", 1, "2026-02-28"),
    ("2026-03-31", 13, "2025-02-28"),
    ("2024-03-31", 1, "2024-02-29"),
    ("2024-03-31", 13, "2023-02-28"),
    ("2024-02-29", 12, "2023-02-28"),
    ("2024-02-29", 48, "2020-02-29"),
    ("2024-02-29", 0, "2024-02-29"),
    ("2026-11-18", 0, "2026-11-18"),
    ("2026-11-18", 1, "2026-10-18"),
    ("2026-11-18", 12, "2025-11-18"),
    ("2026-11-18", 60, "2021-11-18"),
    ("2026-11-18", 120, "2016-11-18"),
    ("2026-05-31", 1, "2026-04-30"),
    ("2026-07-31", 1, "2026-06-30"),
    ("2026-10-31", 1, "2026-09-30"),
    ("2026-12-31", 2, "2026-10-31"),
    ("2026-12-31", 10, "2026-02-28"),
    ("2026-01-15", 1, "2025-12-15"),
    ("2025-01-31", 1, "2024-12-31"),
    ("2024-12-31", 10, "2024-02-29"),
    ("2024-08-31", 6, "2024-02-29"),
    ("2024-03-30", 1, "2024-02-29"),
    ("2023-03-29", 1, "2023-02-28"),
    ("2024-03-31", 12, "2023-03-31"),
    ("2024-03-31", 60, "2019-03-31"),
    ("2024-03-31", 120, "2014-03-31"),
    ("2028-02-29", 60, "2023-02-28"),
    ("2028-02-29", 120, "2018-02-28"),
    ("2004-02-29", 48, "2000-02-29"),
    ("2001-02-28", 12, "2000-02-28"),
    ("2101-03-31", 13, "2100-02-28"),
    ("2017-03-16", 60, "2012-03-16"),
    ("2017-03-16", 120, "2007-03-16"),
    ("2010-08-31", 120, "2000-08-31"),
]

# (earlier, later, lower, upper, signed, words) worked by hand
TARGET_CHANGE_EXAMPLES = [
    (rate("2008-10-29", "1.00"), band("2008-12-16", "0.00", "0.25"), "-100", "-75",
     "lower -100, upper -75",
     "lower bound down 100 basis points, upper bound down 75 basis points"),
    (rate("2008-10-08", "1.50"), rate("2008-10-29", "1.00"), "-50", "-50",
     "-50", "down 50 basis points"),
    (rate("2004-06-30", "1.25"), rate("2004-08-10", "1.50"), "25", "25",
     "+25", "up 25 basis points"),
    (rate("2001-01-03", "6.00"), rate("2001-01-04", "6.01"), "1", "1",
     "+1", "up 1 basis point"),
    (rate("2001-05-15", "4.000"), rate("2001-06-27", "3.875"), "-12.5", "-12.5",
     "-12.5", "down 12.5 basis points"),
    (rate("2006-06-29", "5.25"), rate("2007-09-18", "5.25"), "0", "0",
     "0", "unchanged"),
    (band("2015-12-17", "0.25", "0.50"), band("2016-12-15", "0.50", "0.75"), "25", "25",
     "+25", "up 25 basis points"),
    (band("2023-07-27", "5.25", "5.50"), band("2024-09-19", "4.75", "5.00"), "-50", "-50",
     "-50", "down 50 basis points"),
    (band("2026-09-17", "3.75", "4.00"), band("2026-10-29", "3.75", "4.00"), "0", "0",
     "0", "unchanged"),
    (band("2020-03-16", "0.00", "0.25"), band("2022-03-17", "0.25", "0.75"), "25", "50",
     "lower +25, upper +50",
     "lower bound up 25 basis points, upper bound up 50 basis points"),
    (band("2025-10-30", "3.75", "4.00"), band("2025-12-11", "3.75", "4.25"), "0", "25",
     "lower 0, upper +25",
     "lower bound unchanged, upper bound up 25 basis points"),
    (band("2018-12-20", "2.25", "2.50"), band("2019-08-01", "2.00", "2.50"), "-25", "0",
     "lower -25, upper 0",
     "lower bound down 25 basis points, upper bound unchanged"),
    (band("2020-03-16", "0.00", "0.25"), band("2020-03-17", "0.01", "0.24"), "1", "-1",
     "lower +1, upper -1",
     "lower bound up 1 basis point, upper bound down 1 basis point"),
    (rate("2002-11-06", "1.25"), band("2008-12-16", "1.00", "1.50"), "-25", "25",
     "lower -25, upper +25",
     "lower bound down 25 basis points, upper bound up 25 basis points"),
    (rate("2008-01-01", "1.00"), band("2008-02-01", "1.00", "1.000"), "0", "0",
     "0", "unchanged"),
    (band("2008-12-16", "0.00", "0.25"), rate("2009-01-28", "0.50"), "50", "25",
     "lower +50, upper +25",
     "lower bound up 50 basis points, upper bound up 25 basis points"),
    (band("2016-12-15", "0.25", "0.50"), rate("2017-03-16", "0.25"), "0", "-25",
     "lower 0, upper -25",
     "lower bound unchanged, upper bound down 25 basis points"),
]


# The synthetic cases

RECENT_CASE_OBSERVATIONS = [
    ("2026-02-02", "3.64"), ("2026-02-03", "3.64"), ("2026-02-04", None), ("2026-02-05", "3.63"),
    ("2026-02-06", "3.64"), ("2026-02-09", "3.64"), ("2026-02-10", "3.65"), ("2026-02-11", "3.64"),
    ("2026-02-12", "3.64"), ("2026-02-13", "3.63"), ("2026-02-16", None), ("2026-02-17", "3.64"),
    ("2026-02-18", "3.64"), ("2026-02-19", "3.645"), ("2026-02-20", "3.64"), ("2026-02-23", "3.64"),
    ("2026-02-24", "3.64"), ("2026-02-25", "3.63"), ("2026-02-26", "3.63"), ("2026-02-27", "3.64"),
    ("2026-03-02", "3.64"), ("2026-03-03", "3.64"), ("2026-03-04", "3.64"), ("2026-03-05", None),
    ("2026-03-06", None), ("2026-03-09", "3.62"), ("2026-03-10", "3.63"), ("2026-03-11", "3.63"),
    ("2026-03-12", "3.63"), ("2026-03-13", "3.63"), ("2026-03-16", "3.63"), ("2026-03-17", "3.64"),
    ("2026-03-18", "3.64"),
]

SYNTHETIC_CASES = [
    {
        "id": "latest-value-null",
        "about": "R4 and R5 with null values: the last observation is null, so the latest EFFR is the "
                 "valued one before it and its previous observation skips a null; the recent table has "
                 "fewer than 30 rows with nulls, and the windows end on the latest EFFR (leaving the "
                 "trailing null out of the EFFR line) with change points that all begin after S.",
        "observations": [("2026-01-05", "3.64"), ("2026-01-06", "3.65"), ("2026-01-07", None),
                         ("2026-01-08", "3.63"), ("2026-01-09", None)],
        "change_points": [band("2025-12-11", "3.50", "3.75")],
        "target_dates": ["2025-12-10", "2025-12-11", "2026-01-09"],
    },
    {
        "id": "comparison-windows",
        "about": "R6: the month comparison date is a Sunday (the Friday before is used), the year "
                 "comparison date is exactly 7 days after its observation (used) and the five-year one "
                 "8 days after (outside-window); the 1y window starts in the middle of a target segment "
                 "and the longer windows start before the first change point.",
        "observations": [("2021-11-10", "0.08"), ("2021-11-12", None), ("2025-11-11", "3.87"),
                         ("2025-11-14", None), ("2026-10-15", "3.88"), ("2026-10-16", "3.875"),
                         ("2026-10-19", "3.88"), ("2026-11-17", "3.87"), ("2026-11-18", "3.88")],
        "change_points": [band("2025-10-30", "4.00", "4.25"), band("2025-12-11", "3.50", "3.75"),
                          band("2026-09-17", "3.75", "4.00")],
        "target_dates": ["2025-10-29", "2025-10-30", "2025-11-18", "2026-11-18"],
    },
    {
        "id": "one-valued-observation",
        "about": "R7 with a single valued observation after a null one: 'previous' has the reason "
                 "'no-earlier' and the other comparisons 'before-data', and without change points every "
                 "window has no X0, no segments and no target.",
        "observations": [("2026-05-01", None), ("2026-05-04", "4.33")],
        "change_points": [],
        "target_dates": ["2026-05-04"],
    },
    {
        "id": "month-end-reference",
        "about": "R3 inside R7 with D = 2024-03-31: the month comparison date is clamped to 2024-02-29, "
                 "the five-year date 2019-03-31 is a Sunday (the Friday before is used), and the previous "
                 "observation skips a null record.",
        "observations": [("2019-03-29", "2.43"), ("2023-03-31", "4.83"), ("2024-02-28", "5.32"),
                         ("2024-02-29", "5.31"), ("2024-03-28", "5.33"), ("2024-03-29", None),
                         ("2024-03-31", "5.33")],
        "change_points": [band("2018-12-20", "2.25", "2.50"), band("2022-11-03", "3.75", "4.00"),
                          band("2023-07-27", "5.25", "5.50")],
        "target_dates": ["2018-12-19", "2024-02-29", "2024-03-31"],
    },
    {
        "id": "target-only",
        "about": "No observations: no latest EFFR, no comparisons and empty tables, R8 queries before the "
                 "first change point, on effective dates and on the day before them, and windows built "
                 "from the change points alone, with the rate to range switch inside them and the last "
                 "change point at E.",
        "observations": [],
        "change_points": [rate("2008-10-08", "1.50"), rate("2008-10-29", "1.00"),
                          band("2008-12-16", "0.00", "0.25")],
        "target_dates": ["2008-10-07", "2008-10-08", "2008-10-28", "2008-10-29", "2008-12-15",
                         "2008-12-16", "2026-11-18"],
    },
    {
        "id": "empty",
        "about": "Neither observations nor change points: no latest EFFR, no target in effect and no "
                 "window at all.",
        "observations": [],
        "change_points": [],
        "target_dates": ["2026-11-18"],
    },
    {
        "id": "change-point-rows",
        "about": "R10 and R11 across kinds: rate to rate, the rate to range transition, a range change "
                 "with unequal bound changes and a range to rate change, with comparison rows whose "
                 "targets are of the other kind; the long windows hold three segments of alternating "
                 "kinds and the last change point is at E.",
        "observations": [("2012-03-16", "0.13"), ("2016-03-16", "0.37"), ("2017-02-16", "0.66"),
                         ("2017-03-15", "0.66"), ("2017-03-16", "0.91")],
        "change_points": [rate("2008-01-30", "3.00"), rate("2008-10-29", "1.00"),
                          band("2008-12-16", "0.00", "0.25"), band("2015-12-17", "0.25", "0.50"),
                          band("2016-12-15", "0.50", "1.00"), rate("2017-03-16", "0.75")],
        "target_dates": ["2008-01-29", "2008-01-30", "2008-12-15", "2008-12-16", "2016-12-14",
                         "2016-12-15", "2017-03-16", "2030-01-01"],
    },
    {
        "id": "comparison-without-target",
        "about": "R11: the month comparison is not shown (outside-window, from a Saturday back to a "
                 "Friday 8 days before) and the year comparison's period is before the first change "
                 "point, so its target and target change are null; the 1y window starts on an "
                 "observation, which it includes.",
        "observations": [("2025-06-02", "4.33"), ("2026-04-24", "3.63"), ("2026-06-01", "3.63"),
                         ("2026-06-02", "3.62")],
        "change_points": [band("2025-09-18", "4.00", "4.25"), band("2025-12-11", "3.50", "3.75")],
        "target_dates": ["2025-06-02", "2025-09-17", "2025-09-18", "2026-06-02"],
    },
    {
        "id": "target-after-latest",
        "about": "R13: the last change point is effective after the latest EFFR period, so E is that "
                 "change point's date and the last segment ends on it with no closing point, while the "
                 "latest EFFR row still has the target in effect before it.",
        "observations": [("2026-09-14", "3.63"), ("2026-09-15", "3.64"), ("2026-09-16", "3.63")],
        "change_points": [band("2025-12-11", "3.50", "3.75"), band("2026-09-17", "3.75", "4.00")],
        "target_dates": ["2026-09-16", "2026-09-17", "2026-09-18"],
    },
    {
        "id": "window-without-change-point",
        "about": "R13: the 1y window contains no change point, so its target is the X0 point and the "
                 "closing point at E; the month and year comparisons are outside the 7-day window and "
                 "the previous change is 1 basis point.",
        "observations": [("2006-06-28", "5.00"), ("2006-06-29", "5.25"), ("2007-07-31", "5.26"),
                         ("2007-08-01", "5.27")],
        "change_points": [rate("2006-05-10", "5.00"), rate("2006-06-29", "5.25")],
        "target_dates": ["2006-05-09", "2006-05-10", "2006-06-28", "2006-06-29", "2007-08-01"],
    },
    {
        "id": "recent-thirty-of-thirty-three",
        "about": "R12 with 33 observations: the recent table keeps the last 30, newest first, and the "
                 "oldest row shown takes its previous observation from outside the table, skipping a "
                 "null.",
        "observations": RECENT_CASE_OBSERVATIONS,
        "change_points": [],
        "target_dates": ["2026-03-18"],
    },
]


# The fixture case: rows copied from the verified appendix B fixture CSVs under
# local/econ-fixture/live/series/ (columns period and value_percent for the EFFR;
# effective, kind, value_percent, lower_percent and upper_percent for the target;
# an empty cell is null). These rows are test data from the appendix B fixture
# root, never a publication.

NYFED_EFFR_ROWS = (
    ("effr/2000/d31bb18f2443dcef.csv, 2000-07-03 to 2000-07-31", """
2000-07-03,7.03
2000-07-05,6.52
2000-07-06,6.51
2000-07-07,6.42
2000-07-10,6.51
2000-07-11,6.39
2000-07-12,6.38
2000-07-13,6.50
2000-07-14,6.51
2000-07-17,6.58
2000-07-18,6.47
2000-07-19,6.45
2000-07-20,6.52
2000-07-21,6.51
2000-07-24,6.52
2000-07-25,6.46
2000-07-26,6.49
2000-07-27,6.52
2000-07-28,6.44
2000-07-31,6.64
"""),
    ("effr/2016/df4cd88880fb87e6.csv, 2016-11-01 to 2016-11-30", """
2016-11-01,0.41
2016-11-02,0.41
2016-11-03,0.41
2016-11-04,0.41
2016-11-07,0.41
2016-11-08,0.41
2016-11-09,0.41
2016-11-10,0.41
2016-11-14,0.41
2016-11-15,0.41
2016-11-16,0.41
2016-11-17,0.41
2016-11-18,0.41
2016-11-21,0.41
2016-11-22,0.41
2016-11-23,0.41
2016-11-25,0.41
2016-11-28,0.41
2016-11-29,0.41
2016-11-30,0.31
"""),
    ("effr/2021/77c3f04be0d827a6.csv, 2021-11-01 to 2021-11-30", """
2021-11-01,0.08
2021-11-02,0.08
2021-11-03,0.08
2021-11-04,0.08
2021-11-05,0.08
2021-11-08,0.08
2021-11-09,0.08
2021-11-10,0.08
2021-11-12,0.08
2021-11-15,0.08
2021-11-16,0.08
2021-11-17,0.08
2021-11-18,0.08
2021-11-19,0.08
2021-11-22,0.08
2021-11-23,0.08
2021-11-24,0.08
2021-11-26,0.08
2021-11-29,0.08
2021-11-30,0.07
"""),
    ("effr/2025/faf2c52d73e44d85.csv, 2025-11-01 to 2025-11-30", """
2025-11-03,3.87
2025-11-04,3.87
2025-11-05,3.87
2025-11-06,3.87
2025-11-07,3.87
2025-11-10,3.87
2025-11-12,3.87
2025-11-13,3.88
2025-11-14,3.88
2025-11-17,3.88
2025-11-18,3.88
2025-11-19,3.88
2025-11-20,3.88
2025-11-21,3.88
2025-11-24,3.88
2025-11-25,3.88
2025-11-26,3.88
2025-11-28,3.89
"""),
    ("effr/2026/5d3b783e4d67d43d.csv, 2026-09-01 to the end of the file", """
2026-09-01,3.63
2026-09-02,3.63
2026-09-03,3.63
2026-09-04,3.63
2026-09-08,3.63
2026-09-09,3.63
2026-09-10,3.63
2026-09-11,3.63
2026-09-14,3.63
2026-09-15,3.63
2026-09-16,3.63
2026-09-17,3.88
2026-09-18,3.88
2026-09-21,3.88
2026-09-22,3.88
2026-09-23,3.88
2026-09-24,3.88
2026-09-25,3.88
2026-09-28,3.88
2026-09-29,3.88
2026-09-30,3.88
2026-10-01,3.88
2026-10-02,3.88
2026-10-05,3.88
2026-10-06,3.88
2026-10-07,3.88
2026-10-08,3.88
2026-10-09,3.88
2026-10-13,3.88
2026-10-14,3.88
2026-10-15,3.88
2026-10-16,3.88
2026-10-19,3.88
2026-10-20,3.88
2026-10-21,3.88
2026-10-22,3.88
2026-10-23,3.88
2026-10-26,3.88
2026-10-27,3.88
2026-10-28,3.88
2026-10-29,3.88
2026-10-30,3.88
2026-11-02,3.88
2026-11-03,3.88
2026-11-04,3.88
2026-11-05,3.88
2026-11-06,3.88
2026-11-09,3.88
2026-11-10,3.88
2026-11-12,3.87
2026-11-13,3.88
2026-11-16,3.87
2026-11-17,3.88
2026-11-18,3.88
"""),
)

# fomc-target/all/d1d19f052d2927ef.csv, every row
NYFED_TARGET_ROWS = """
2000-07-03,rate,6.50,,
2001-01-03,rate,6.00,,
2001-01-31,rate,5.50,,
2001-03-20,rate,5.00,,
2001-04-18,rate,4.50,,
2001-05-15,rate,4.00,,
2001-06-27,rate,3.75,,
2001-08-21,rate,3.50,,
2001-09-17,rate,3.00,,
2001-10-02,rate,2.50,,
2001-11-06,rate,2.00,,
2001-12-11,rate,1.75,,
2002-11-06,rate,1.25,,
2003-06-25,rate,1.00,,
2004-06-30,rate,1.25,,
2004-08-10,rate,1.50,,
2004-09-21,rate,1.75,,
2004-11-10,rate,2.00,,
2004-12-14,rate,2.25,,
2005-02-02,rate,2.50,,
2005-03-22,rate,2.75,,
2005-05-03,rate,3.00,,
2005-06-30,rate,3.25,,
2005-08-09,rate,3.50,,
2005-09-20,rate,3.75,,
2005-11-01,rate,4.00,,
2005-12-13,rate,4.25,,
2006-01-31,rate,4.50,,
2006-03-28,rate,4.75,,
2006-05-10,rate,5.00,,
2006-06-29,rate,5.25,,
2007-09-18,rate,4.75,,
2007-10-31,rate,4.50,,
2007-12-11,rate,4.25,,
2008-01-22,rate,3.50,,
2008-01-30,rate,3.00,,
2008-03-18,rate,2.25,,
2008-04-30,rate,2.00,,
2008-10-08,rate,1.50,,
2008-10-29,rate,1.00,,
2008-12-16,range,,0.00,0.25
2015-12-17,range,,0.25,0.50
2016-12-15,range,,0.50,0.75
2017-03-16,range,,0.75,1.00
2017-06-15,range,,1.00,1.25
2017-12-14,range,,1.25,1.50
2018-03-22,range,,1.50,1.75
2018-06-14,range,,1.75,2.00
2018-09-27,range,,2.00,2.25
2018-12-20,range,,2.25,2.50
2019-08-01,range,,2.00,2.25
2019-09-19,range,,1.75,2.00
2019-10-31,range,,1.50,1.75
2020-03-04,range,,1.00,1.25
2020-03-16,range,,0.00,0.25
2022-03-17,range,,0.25,0.50
2022-05-05,range,,0.75,1.00
2022-06-16,range,,1.50,1.75
2022-07-28,range,,2.25,2.50
2022-09-22,range,,3.00,3.25
2022-11-03,range,,3.75,4.00
2022-12-15,range,,4.25,4.50
2023-02-02,range,,4.50,4.75
2023-03-23,range,,4.75,5.00
2023-05-04,range,,5.00,5.25
2023-07-27,range,,5.25,5.50
2024-09-19,range,,4.75,5.00
2024-11-08,range,,4.50,4.75
2024-12-19,range,,4.25,4.50
2025-09-18,range,,4.00,4.25
2025-10-30,range,,3.75,4.00
2025-12-11,range,,3.50,3.75
2026-09-17,range,,3.75,4.00
"""


def copied_rows(block, width):
    """The rows of a copied CSV block, an empty cell as None."""
    rows = []
    for line in block.strip().splitlines():
        cells = line.split(",")
        require(len(cells) == width, f"copied row {line!r} has {len(cells)} cells")
        rows.append([cell if cell != "" else None for cell in cells])
    return rows


def nyfed_case():
    """The fixture case from the copied rows (incomplete: its observations are a subset)."""
    observations = []
    for _source, block in NYFED_EFFR_ROWS:
        observations += [(period, value) for period, value in copied_rows(block, 2)]
    change_points = []
    for effective, kind, value, lower, upper in copied_rows(NYFED_TARGET_ROWS, 5):
        if kind == "rate":
            require(lower is None and upper is None, f"copied rate row {effective} has bounds")
            change_points.append(rate(effective, value))
        else:
            require(kind == "range" and value is None, f"copied range row {effective} has a value")
            change_points.append(band(effective, lower, upper))
    return {
        "id": "nyfed-fixture",
        "about": "Rows copied from the verified appendix B fixture CSVs (test data, never a "
                 "publication): the EFFR for July 2000, November 2016, November 2021, November 2025 "
                 "and 2026-09-01 to 2026-11-18, with all 73 target change points; the observations "
                 "are a subset, so the windows omit the EFFR line.",
        "complete": False,
        "observations": observations,
        "change_points": change_points,
        "target_dates": ["1999-12-31", "2000-07-03", "2008-12-15", "2008-12-16", "2015-12-16",
                         "2015-12-17", "2026-09-16", "2026-09-17", "2026-11-18"],
    }


def build_case(spec, complete):
    """A case with its expected results from R4 to R13."""
    observations = [tuple(row) for row in spec["observations"]]
    change_points = [dict(point) for point in spec["change_points"]]
    check_inputs(observations, change_points)
    for date in spec["target_dates"]:
        parse_date(date)
    latest = latest_effr(observations)
    comparison_rows = comparisons(observations, latest)
    expected = {
        "latest": {"period": latest[0], "value": latest[1]} if latest is not None else None,
        "comparisons": comparison_rows,
        "target_at": [
            {"date": date, "effective": (target_in_effect(change_points, date) or {}).get("effective")}
            for date in spec["target_dates"]
        ],
        "change_points": change_point_rows(change_points),
        "comparison_table": comparison_table(change_points, latest, comparison_rows),
        "recent": recent_rows(observations),
        "windows": chart_windows(observations, change_points, latest, complete),
    }
    return {
        "id": spec["id"],
        "about": spec["about"],
        "complete": complete,
        "observations": [[period, value] for period, value in observations],
        "change_points": change_points,
        "target_dates": list(spec["target_dates"]),
        "expected": expected,
    }


# Hand-worked results of every case: (case id, path into "expected", value)

HAND_CHECKS = [
    ("latest-value-null", ("latest",), {"period": "2026-01-08", "value": "3.63"}),
    ("latest-value-null", ("comparisons", 0), {"id": "previous", "date": None, "period": "2026-01-06",
                                               "value": "3.65", "bp": "-2", "reason": None}),
    ("latest-value-null", ("comparisons", 1), {"id": "month", "date": "2025-12-08", "period": None,
                                               "value": None, "bp": None, "reason": "before-data"}),
    ("latest-value-null", ("recent",), [
        {"period": "2026-01-09", "value": None, "previous": "2026-01-08", "bp": None},
        {"period": "2026-01-08", "value": "3.63", "previous": "2026-01-06", "bp": "-2"},
        {"period": "2026-01-07", "value": None, "previous": "2026-01-06", "bp": None},
        {"period": "2026-01-06", "value": "3.65", "previous": "2026-01-05", "bp": "1"},
        {"period": "2026-01-05", "value": "3.64", "previous": None, "bp": None},
    ]),
    ("latest-value-null", ("windows", "1y"), {
        "start": "2025-01-08", "end": "2026-01-08", "x0": "2025-12-11",
        "effr_first": "2026-01-05", "effr_last": "2026-01-08",
        "effr": [["2026-01-05", "3.64"], ["2026-01-06", "3.65"], ["2026-01-07", None],
                 ["2026-01-08", "3.63"]],
        "segments": [{"kind": "range", "points": [["2025-12-11", "3.50", "3.75"],
                                                  ["2026-01-08", "3.50", "3.75"]]}],
    }),
    ("latest-value-null", ("windows", "all", "start"), "2025-12-11"),
    ("latest-value-null", ("target_at",), [{"date": "2025-12-10", "effective": None},
                                           {"date": "2025-12-11", "effective": "2025-12-11"},
                                           {"date": "2026-01-09", "effective": "2025-12-11"}]),

    ("comparison-windows", ("comparisons",), [
        {"id": "previous", "date": None, "period": "2026-11-17", "value": "3.87", "bp": "1",
         "reason": None},
        {"id": "month", "date": "2026-10-18", "period": "2026-10-16", "value": "3.875", "bp": "0.5",
         "reason": None},
        {"id": "year", "date": "2025-11-18", "period": "2025-11-11", "value": "3.87", "bp": "1",
         "reason": None},
        {"id": "five-years", "date": "2021-11-18", "period": None, "value": None, "bp": None,
         "reason": "outside-window"},
    ]),
    ("comparison-windows", ("comparison_table", 3), {
        "id": "year", "period": "2025-11-11", "effr": "3.87",
        "target": {"effective": "2025-10-30", "lower": "4.00", "upper": "4.25"},
        "target_change": {"lower": "-25", "upper": "-25"}}),
    ("comparison-windows", ("comparison_table", 4), {"id": "five-years", "period": None, "effr": None,
                                                     "target": None, "target_change": None}),
    ("comparison-windows", ("windows", "1y", "x0"), "2025-11-18"),
    ("comparison-windows", ("windows", "1y", "segments"), [{"kind": "range", "points": [
        ["2025-11-18", "4.00", "4.25"], ["2025-12-11", "3.50", "3.75"], ["2026-09-17", "3.75", "4.00"],
        ["2026-11-18", "3.75", "4.00"]]}]),
    ("comparison-windows", ("windows", "1y", "effr_first"), "2026-10-15"),
    ("comparison-windows", ("windows", "5y", "x0"), "2025-10-30"),
    ("comparison-windows", ("windows", "5y", "effr_first"), "2025-11-11"),
    ("comparison-windows", ("windows", "10y", "effr_first"), "2021-11-10"),
    ("comparison-windows", ("windows", "all", "start"), "2021-11-10"),

    ("one-valued-observation", ("comparisons", 0, "reason"), "no-earlier"),
    ("one-valued-observation", ("comparisons", 1), {"id": "month", "date": "2026-04-04", "period": None,
                                                    "value": None, "bp": None, "reason": "before-data"}),
    ("one-valued-observation", ("comparison_table", 0), {"id": "latest", "period": "2026-05-04",
                                                         "effr": "4.33", "target": None,
                                                         "target_change": None}),
    ("one-valued-observation", ("recent",), [
        {"period": "2026-05-04", "value": "4.33", "previous": None, "bp": None},
        {"period": "2026-05-01", "value": None, "previous": None, "bp": None},
    ]),
    ("one-valued-observation", ("windows", "all"), {
        "start": "2026-05-01", "end": "2026-05-04", "x0": None,
        "effr_first": "2026-05-01", "effr_last": "2026-05-04",
        "effr": [["2026-05-01", None], ["2026-05-04", "4.33"]], "segments": []}),

    ("month-end-reference", ("comparisons",), [
        {"id": "previous", "date": None, "period": "2024-03-28", "value": "5.33", "bp": "0",
         "reason": None},
        {"id": "month", "date": "2024-02-29", "period": "2024-02-29", "value": "5.31", "bp": "2",
         "reason": None},
        {"id": "year", "date": "2023-03-31", "period": "2023-03-31", "value": "4.83", "bp": "50",
         "reason": None},
        {"id": "five-years", "date": "2019-03-31", "period": "2019-03-29", "value": "2.43", "bp": "290",
         "reason": None},
    ]),
    ("month-end-reference", ("comparison_table", 3, "target_change"), {"lower": "150", "upper": "150"}),
    ("month-end-reference", ("comparison_table", 4, "target_change"), {"lower": "300", "upper": "300"}),
    ("month-end-reference", ("windows", "5y", "effr_first"), "2023-03-31"),
    ("month-end-reference", ("windows", "5y", "x0"), "2019-03-31"),
    ("month-end-reference", ("windows", "1y", "segments"), [{"kind": "range", "points": [
        ["2023-03-31", "3.75", "4.00"], ["2023-07-27", "5.25", "5.50"], ["2024-03-31", "5.25", "5.50"]]}]),
    ("month-end-reference", ("windows", "all", "start"), "2018-12-20"),

    ("target-only", ("latest",), None),
    ("target-only", ("comparisons",), []),
    ("target-only", ("comparison_table",), []),
    ("target-only", ("recent",), []),
    ("target-only", ("target_at",), [
        {"date": "2008-10-07", "effective": None}, {"date": "2008-10-08", "effective": "2008-10-08"},
        {"date": "2008-10-28", "effective": "2008-10-08"}, {"date": "2008-10-29", "effective": "2008-10-29"},
        {"date": "2008-12-15", "effective": "2008-10-29"}, {"date": "2008-12-16", "effective": "2008-12-16"},
        {"date": "2026-11-18", "effective": "2008-12-16"},
    ]),
    ("target-only", ("change_points",), [
        {"effective": "2008-10-08", "lower": "1.50", "upper": "1.50", "change": None},
        {"effective": "2008-10-29", "lower": "1.00", "upper": "1.00",
         "change": {"lower": "-50", "upper": "-50"}},
        {"effective": "2008-12-16", "lower": "0.00", "upper": "0.25",
         "change": {"lower": "-100", "upper": "-75"}},
    ]),
    ("target-only", ("windows", "1y"), {
        "start": "2007-12-16", "end": "2008-12-16", "x0": "2008-10-08", "effr_first": None,
        "effr_last": None, "effr": [],
        "segments": [{"kind": "rate", "points": [["2008-10-08", "1.50"], ["2008-10-29", "1.00"],
                                                 ["2008-12-16", "1.00"]]},
                     {"kind": "range", "points": [["2008-12-16", "0.00", "0.25"]]}],
    }),
    ("target-only", ("windows", "all", "start"), "2008-10-08"),

    ("empty", ("latest",), None),
    ("empty", ("target_at",), [{"date": "2026-11-18", "effective": None}]),
    ("empty", ("windows",), {"1y": None, "5y": None, "10y": None, "all": None}),

    ("change-point-rows", ("change_points",), [
        {"effective": "2008-01-30", "lower": "3.00", "upper": "3.00", "change": None},
        {"effective": "2008-10-29", "lower": "1.00", "upper": "1.00",
         "change": {"lower": "-200", "upper": "-200"}},
        {"effective": "2008-12-16", "lower": "0.00", "upper": "0.25",
         "change": {"lower": "-100", "upper": "-75"}},
        {"effective": "2015-12-17", "lower": "0.25", "upper": "0.50",
         "change": {"lower": "25", "upper": "25"}},
        {"effective": "2016-12-15", "lower": "0.50", "upper": "1.00",
         "change": {"lower": "25", "upper": "50"}},
        {"effective": "2017-03-16", "lower": "0.75", "upper": "0.75",
         "change": {"lower": "25", "upper": "-25"}},
    ]),
    ("change-point-rows", ("comparison_table",), [
        {"id": "latest", "period": "2017-03-16", "effr": "0.91",
         "target": {"effective": "2017-03-16", "lower": "0.75", "upper": "0.75"}, "target_change": None},
        {"id": "previous", "period": "2017-03-15", "effr": "0.66",
         "target": {"effective": "2016-12-15", "lower": "0.50", "upper": "1.00"},
         "target_change": {"lower": "25", "upper": "-25"}},
        {"id": "month", "period": "2017-02-16", "effr": "0.66",
         "target": {"effective": "2016-12-15", "lower": "0.50", "upper": "1.00"},
         "target_change": {"lower": "25", "upper": "-25"}},
        {"id": "year", "period": "2016-03-16", "effr": "0.37",
         "target": {"effective": "2015-12-17", "lower": "0.25", "upper": "0.50"},
         "target_change": {"lower": "50", "upper": "25"}},
        {"id": "five-years", "period": "2012-03-16", "effr": "0.13",
         "target": {"effective": "2008-12-16", "lower": "0.00", "upper": "0.25"},
         "target_change": {"lower": "75", "upper": "50"}},
    ]),
    ("change-point-rows", ("comparisons", 3, "bp"), "78"),
    ("change-point-rows", ("windows", "1y", "segments"), [
        {"kind": "range", "points": [["2016-03-16", "0.25", "0.50"], ["2016-12-15", "0.50", "1.00"],
                                     ["2017-03-16", "0.50", "1.00"]]},
        {"kind": "rate", "points": [["2017-03-16", "0.75"]]},
    ]),
    ("change-point-rows", ("windows", "10y", "segments"), [
        {"kind": "rate", "points": [["2008-01-30", "3.00"], ["2008-10-29", "1.00"],
                                    ["2008-12-16", "1.00"]]},
        {"kind": "range", "points": [["2008-12-16", "0.00", "0.25"], ["2015-12-17", "0.25", "0.50"],
                                     ["2016-12-15", "0.50", "1.00"], ["2017-03-16", "0.50", "1.00"]]},
        {"kind": "rate", "points": [["2017-03-16", "0.75"]]},
    ]),
    ("change-point-rows", ("windows", "all", "start"), "2008-01-30"),

    ("comparison-without-target", ("comparisons", 1), {"id": "month", "date": "2026-05-02", "period": None,
                                                       "value": None, "bp": None,
                                                       "reason": "outside-window"}),
    ("comparison-without-target", ("comparison_table",), [
        {"id": "latest", "period": "2026-06-02", "effr": "3.62",
         "target": {"effective": "2025-12-11", "lower": "3.50", "upper": "3.75"}, "target_change": None},
        {"id": "previous", "period": "2026-06-01", "effr": "3.63",
         "target": {"effective": "2025-12-11", "lower": "3.50", "upper": "3.75"},
         "target_change": {"lower": "0", "upper": "0"}},
        {"id": "month", "period": None, "effr": None, "target": None, "target_change": None},
        {"id": "year", "period": "2025-06-02", "effr": "4.33", "target": None, "target_change": None},
        {"id": "five-years", "period": None, "effr": None, "target": None, "target_change": None},
    ]),
    ("comparison-without-target", ("comparisons", 2, "bp"), "-71"),
    ("comparison-without-target", ("windows", "1y", "effr_first"), "2025-06-02"),
    ("comparison-without-target", ("windows", "1y", "segments"), [{"kind": "range", "points": [
        ["2025-09-18", "4.00", "4.25"], ["2025-12-11", "3.50", "3.75"], ["2026-06-02", "3.50", "3.75"]]}]),

    ("target-after-latest", ("windows", "1y"), {
        "start": "2025-09-17", "end": "2026-09-17", "x0": "2025-12-11",
        "effr_first": "2026-09-14", "effr_last": "2026-09-16",
        "effr": [["2026-09-14", "3.63"], ["2026-09-15", "3.64"], ["2026-09-16", "3.63"]],
        "segments": [{"kind": "range", "points": [["2025-12-11", "3.50", "3.75"],
                                                  ["2026-09-17", "3.75", "4.00"]]}],
    }),
    ("target-after-latest", ("comparison_table", 0, "target", "effective"), "2025-12-11"),
    ("target-after-latest", ("comparisons", 0, "bp"), "-1"),

    ("window-without-change-point", ("comparisons",), [
        {"id": "previous", "date": None, "period": "2007-07-31", "value": "5.26", "bp": "1",
         "reason": None},
        {"id": "month", "date": "2007-07-01", "period": None, "value": None, "bp": None,
         "reason": "outside-window"},
        {"id": "year", "date": "2006-08-01", "period": None, "value": None, "bp": None,
         "reason": "outside-window"},
        {"id": "five-years", "date": "2002-08-01", "period": None, "value": None, "bp": None,
         "reason": "before-data"},
    ]),
    ("window-without-change-point", ("windows", "1y"), {
        "start": "2006-08-01", "end": "2007-08-01", "x0": "2006-08-01",
        "effr_first": "2007-07-31", "effr_last": "2007-08-01",
        "effr": [["2007-07-31", "5.26"], ["2007-08-01", "5.27"]],
        "segments": [{"kind": "rate", "points": [["2006-08-01", "5.25"], ["2007-08-01", "5.25"]]}],
    }),
    ("window-without-change-point", ("windows", "5y", "segments"), [{"kind": "rate", "points": [
        ["2006-05-10", "5.00"], ["2006-06-29", "5.25"], ["2007-08-01", "5.25"]]}]),
    ("window-without-change-point", ("windows", "all", "start"), "2006-05-10"),

    ("recent-thirty-of-thirty-three", ("recent", 0), {"period": "2026-03-18", "value": "3.64",
                                                      "previous": "2026-03-17", "bp": "0"}),
    ("recent-thirty-of-thirty-three", ("recent", 7), {"period": "2026-03-09", "value": "3.62",
                                                      "previous": "2026-03-04", "bp": "-2"}),
    ("recent-thirty-of-thirty-three", ("recent", 8), {"period": "2026-03-06", "value": None,
                                                      "previous": "2026-03-04", "bp": None}),
    ("recent-thirty-of-thirty-three", ("recent", 16), {"period": "2026-02-24", "value": "3.64",
                                                       "previous": "2026-02-23", "bp": "0"}),
    ("recent-thirty-of-thirty-three", ("recent", 19), {"period": "2026-02-19", "value": "3.645",
                                                       "previous": "2026-02-18", "bp": "0.5"}),
    ("recent-thirty-of-thirty-three", ("recent", 29), {"period": "2026-02-05", "value": "3.63",
                                                       "previous": "2026-02-03", "bp": "-1"}),
    ("recent-thirty-of-thirty-three", ("comparisons", 1), {"id": "month", "date": "2026-02-18",
                                                           "period": "2026-02-18", "value": "3.64",
                                                           "bp": "0", "reason": None}),

    ("nyfed-fixture", ("latest",), {"period": "2026-11-18", "value": "3.88"}),
    ("nyfed-fixture", ("comparisons",), [
        {"id": "previous", "date": None, "period": "2026-11-17", "value": "3.88", "bp": "0",
         "reason": None},
        {"id": "month", "date": "2026-10-18", "period": "2026-10-16", "value": "3.88", "bp": "0",
         "reason": None},
        {"id": "year", "date": "2025-11-18", "period": "2025-11-18", "value": "3.88", "bp": "0",
         "reason": None},
        {"id": "five-years", "date": "2021-11-18", "period": "2021-11-18", "value": "0.08", "bp": "380",
         "reason": None},
    ]),
    ("nyfed-fixture", ("comparison_table", 0, "target"),
     {"effective": "2026-09-17", "lower": "3.75", "upper": "4.00"}),
    ("nyfed-fixture", ("comparison_table", 3, "target"),
     {"effective": "2025-10-30", "lower": "3.75", "upper": "4.00"}),
    ("nyfed-fixture", ("comparison_table", 4, "target"),
     {"effective": "2020-03-16", "lower": "0.00", "upper": "0.25"}),
    ("nyfed-fixture", ("comparison_table", 4, "target_change"), {"lower": "375", "upper": "375"}),
    ("nyfed-fixture", ("target_at",), [
        {"date": "1999-12-31", "effective": None}, {"date": "2000-07-03", "effective": "2000-07-03"},
        {"date": "2008-12-15", "effective": "2008-10-29"}, {"date": "2008-12-16", "effective": "2008-12-16"},
        {"date": "2015-12-16", "effective": "2008-12-16"}, {"date": "2015-12-17", "effective": "2015-12-17"},
        {"date": "2026-09-16", "effective": "2025-12-11"}, {"date": "2026-09-17", "effective": "2026-09-17"},
        {"date": "2026-11-18", "effective": "2026-09-17"},
    ]),
    ("nyfed-fixture", ("change_points", 0), {"effective": "2000-07-03", "lower": "6.50", "upper": "6.50",
                                             "change": None}),
    ("nyfed-fixture", ("change_points", 40), {"effective": "2008-12-16", "lower": "0.00", "upper": "0.25",
                                              "change": {"lower": "-100", "upper": "-75"}}),
    ("nyfed-fixture", ("change_points", 72), {"effective": "2026-09-17", "lower": "3.75", "upper": "4.00",
                                              "change": {"lower": "25", "upper": "25"}}),
    ("nyfed-fixture", ("windows", "1y", "start"), "2025-11-18"),
    ("nyfed-fixture", ("windows", "1y", "effr_first"), "2025-11-18"),
    ("nyfed-fixture", ("windows", "5y", "effr_first"), "2021-11-18"),
    ("nyfed-fixture", ("windows", "10y", "effr_first"), "2016-11-18"),
    ("nyfed-fixture", ("windows", "all", "start"), "2000-07-03"),
    ("nyfed-fixture", ("windows", "all", "x0"), "2000-07-03"),
    ("nyfed-fixture", ("windows", "1y", "segments"), [{"kind": "range", "points": [
        ["2025-11-18", "3.75", "4.00"], ["2025-12-11", "3.50", "3.75"], ["2026-09-17", "3.75", "4.00"],
        ["2026-11-18", "3.75", "4.00"]]}]),
]


def dig(node, path):
    """The value at a path of keys and indexes."""
    for step in path:
        node = node[step]
    return node


def check_hand(cases):
    """Every case's chosen results equal those worked by hand."""
    by_id = {case["id"]: case for case in cases}
    for case_id, path, value in HAND_CHECKS:
        found = dig(by_id[case_id]["expected"], path)
        require(found == value, f"{case_id} {path}: {found!r}, worked by hand {value!r}")
    TALLY["hand checks"] = len(HAND_CHECKS)


def check_case(case):
    """Restate the results of one case from the rules with separate scans."""
    observations = [tuple(row) for row in case["observations"]]
    change_points = case["change_points"]
    expected = case["expected"]
    valued = [(period, value) for period, value in observations if value is not None]
    values = dict(observations)

    # R4 and R7
    latest = expected["latest"]
    if not valued:
        require(latest is None and expected["comparisons"] == [] and expected["comparison_table"] == [],
                f"{case['id']}: results without a latest EFFR")
    else:
        require(latest == {"period": valued[-1][0], "value": valued[-1][1]}, f"{case['id']}: R4")
        reference = latest["period"]
        require([row["id"] for row in expected["comparisons"]] == [ident for ident, _ in COMPARISONS],
                f"{case['id']}: R7 order")
        for row, (ident, months) in zip(expected["comparisons"], COMPARISONS):
            if months is None:
                earlier = [item for item in valued if item[0] < reference]
                require(row["date"] is None, f"{case['id']}: 'previous' has no date")
                if earlier:
                    require((row["period"], row["value"], row["reason"]) == (*earlier[-1], None),
                            f"{case['id']}: R5")
                else:
                    require(row["period"] is None and row["reason"] == "no-earlier", f"{case['id']}: R5")
            else:
                require(row["date"] == months_back(reference, months), f"{case['id']}: R7 date")
                candidates = [item for item in valued if item[0] <= row["date"]]
                if not candidates:
                    require(row["period"] is None and row["reason"] == "before-data",
                            f"{case['id']}: R6 before-data")
                elif days_between(candidates[-1][0], row["date"]) > WINDOW_DAYS:
                    require(row["period"] is None and row["reason"] == "outside-window",
                            f"{case['id']}: R6 outside-window")
                else:
                    require((row["period"], row["value"], row["reason"]) == (*candidates[-1], None),
                            f"{case['id']}: R6")
            if row["period"] is None:
                require(row["value"] is None and row["bp"] is None and row["reason"] is not None,
                        f"{case['id']}: a comparison not shown")
            else:
                require(row["bp"] == bp(row["value"], latest["value"]), f"{case['id']}: R7 change")
        table = expected["comparison_table"]
        require([row["id"] for row in table] == ["latest"] + [ident for ident, _ in COMPARISONS],
                f"{case['id']}: R11 rows")
        require(table[0]["period"] == reference and table[0]["target_change"] is None,
                f"{case['id']}: R11 latest row")
        for row, comparison in zip(table[1:], expected["comparisons"]):
            require(row["period"] == comparison["period"] and row["effr"] == comparison["value"],
                    f"{case['id']}: R11 row {row['id']}")
            if row["target"] is None or table[0]["target"] is None:
                require(row["target_change"] is None, f"{case['id']}: R11 change without a target")

    # R8
    for row in expected["target_at"]:
        on_or_before = [point for point in change_points if point["effective"] <= row["date"]]
        wanted = on_or_before[-1]["effective"] if on_or_before else None
        require(row["effective"] == wanted, f"{case['id']}: R8 on {row['date']}")

    # R10: the changes add up to the change from the first target to the last
    rows = expected["change_points"]
    require(len(rows) == len(change_points) and (not rows or rows[0]["change"] is None),
            f"{case['id']}: R10 rows")
    if len(rows) > 1:
        with decimal.localcontext() as context:
            context.prec = 400
            for side in ("lower", "upper"):
                total = sum((decimal.Decimal(row["change"][side]) for row in rows[1:]), decimal.Decimal(0))
                require(total == decimal.Decimal(bp(rows[0][side], rows[-1][side])),
                        f"{case['id']}: R10 {side} changes do not add up")

    # R2 additivity over the valued observations
    if len(valued) > 1:
        with decimal.localcontext() as context:
            context.prec = 400
            total = sum((decimal.Decimal(bp(a[1], b[1])) for a, b in zip(valued, valued[1:])),
                        decimal.Decimal(0))
            require(total == decimal.Decimal(bp(valued[0][1], valued[-1][1])),
                    f"{case['id']}: observation changes do not add up")

    # R12
    recent = expected["recent"]
    require(len(recent) == min(RECENT_ROWS, len(observations)), f"{case['id']}: R12 row count")
    require([row["period"] for row in recent] == [period for period, _ in observations][::-1][:RECENT_ROWS],
            f"{case['id']}: R12 order")
    for row in recent:
        earlier = [item for item in valued if item[0] < row["period"]]
        require(row["value"] == values[row["period"]], f"{case['id']}: R12 value")
        require(row["previous"] == (earlier[-1][0] if earlier else None), f"{case['id']}: R12 previous")
        if row["value"] is None or not earlier:
            require(row["bp"] is None, f"{case['id']}: R12 change without a value")
        else:
            require(row["bp"] == bp(earlier[-1][1], row["value"]), f"{case['id']}: R12 change")

    # R13
    windows = expected["windows"]
    require(list(windows) == [key for key, _ in WINDOWS], f"{case['id']}: R13 keys")
    for key, window in windows.items():
        if window is None:
            require(not valued and not change_points, f"{case['id']}: R13 {key} missing")
            continue
        start, end, x0 = window["start"], window["end"], window["x0"]
        require(start <= end, f"{case['id']}: R13 {key} S after E")
        require(("effr" in window) == case["complete"], f"{case['id']}: R13 {key} EFFR line")
        inside = [period for period, _ in observations if start <= period <= end]
        require(window["effr_first"] == (inside[0] if inside else None)
                and window["effr_last"] == (inside[-1] if inside else None), f"{case['id']}: R13 {key} ends")
        if case["complete"]:
            require(window["effr"] == [[period, values[period]] for period in inside],
                    f"{case['id']}: R13 {key} EFFR line")
        else:
            # The copied months must hold the window's first EFFR record, so that the
            # subset gives the same first period as the whole fixture.
            require(window["effr_first"] is not None and window["effr_first"][:7] == start[:7],
                    f"{case['id']}: R13 {key} start outside the copied months")
        segments = window["segments"]
        if not change_points:
            require(x0 is None and segments == [], f"{case['id']}: R13 {key} target without change points")
            continue
        require(start <= x0 <= end and x0 == max(start, change_points[0]["effective"]),
                f"{case['id']}: R13 {key} X0")
        require(segments and segments[0]["points"][0][0] == x0, f"{case['id']}: R13 {key} first point")
        require(segments[-1]["points"][-1][0] == end, f"{case['id']}: R13 {key} last point")
        inner = [point for point in change_points if x0 < point["effective"] <= end]
        closings = 0
        for index, segment in enumerate(segments):
            points = segment["points"]
            width = 2 if segment["kind"] == "rate" else 3
            require(all(len(point) == width for point in points), f"{case['id']}: R13 {key} point shape")
            xs = [point[0] for point in points]
            require(all(start <= x <= end for x in xs), f"{case['id']}: R13 {key} point outside [S, E]")
            require(all(a < b for a, b in zip(xs, xs[1:])), f"{case['id']}: R13 {key} x order")
            if index + 1 < len(segments):
                following = segments[index + 1]
                require(following["kind"] != segment["kind"], f"{case['id']}: R13 {key} kinds do not alternate")
                require(points[-1][0] == following["points"][0][0], f"{case['id']}: R13 {key} closing x")
            # Every segment but the last ends with a closing point; the last one does unless its
            # last point is a change point at E (or the X0 point is itself at E).
            if index + 1 < len(segments):
                closing = True
            else:
                closing = len(points) > 1 and points[-1][0] not in {point["effective"] for point in inner}
            if closing:
                require(len(points) > 1 and points[-1][1:] == points[-2][1:],
                        f"{case['id']}: R13 {key} closing level")
                closings += 1
        total_points = sum(len(segment["points"]) for segment in segments)
        require(total_points == 1 + len(inner) + closings, f"{case['id']}: R13 {key} point count")
    TALLY["case checks"] += 1


def check_rate_pairs(change_point_lists):
    """R9: a change from a rate to a rate always has equal bound changes."""
    for change_points in change_point_lists:
        rates = [point for point in change_points if point["kind"] == "rate"]
        for index, older in enumerate(rates):
            for newer in rates[index + 1:]:
                change = target_change(older, newer)
                require(change["lower"] == change["upper"] and change["signed"] == signed(change["lower"])
                        and change["words"] == words(change["lower"]),
                        f"R9: rate {older['value']} to rate {newer['value']} has unequal bounds")
                TALLY["rate pairs"] += 1


def check_computed(content):
    """Every computed change in the output is in R2's canonical form, never "-0" (input values,
    such as "-0.00", are kept as given and not checked here)."""
    found = []
    for entry in content["bp"]:
        found += [entry["bp"], entry["signed"][1:] if entry["signed"].startswith("+") else entry["signed"]]
    for entry in content["target_change"]:
        found += [entry["lower"], entry["upper"]]
    for case in content["cases"]:
        expected = case["expected"]
        found += [row["bp"] for row in expected["comparisons"] if row["bp"] is not None]
        found += [row["bp"] for row in expected["recent"] if row["bp"] is not None]
        for row in expected["change_points"]:
            if row["change"] is not None:
                found += [row["change"]["lower"], row["change"]["upper"]]
        for row in expected["comparison_table"]:
            if row["target_change"] is not None:
                found += [row["target_change"]["lower"], row["target_change"]["upper"]]
    for change in found:
        require(CANONICAL_PATTERN.fullmatch(change) is not None and change != "-0",
                f"computed change {change!r} is not canonical")
    TALLY["computed changes"] = len(found)


def build_bp_section():
    """R2's examples, each checked against its hand-worked change and the negation the other way."""
    entries = []
    for earlier, later, worked in BP_EXAMPLES:
        change = bp(earlier, later)
        require(change == worked, f"R2: {earlier} to {later} gives {change}, worked by hand {worked}")
        require(bp(later, earlier) == negate(change), f"R2: {earlier} to {later} is not antisymmetric")
        entries.append({"earlier": earlier, "later": later, "bp": change, "signed": signed(change),
                        "words": words(change)})
    forms = {(entry["earlier"], entry["later"]): entry for entry in entries}
    for earlier, later, signed_text, words_text in BP_FORMS:
        entry = forms[(earlier, later)]
        require((entry["signed"], entry["words"]) == (signed_text, words_text),
                f"R2: forms of {earlier} to {later}: {entry['signed']!r}, {entry['words']!r}")
    for entry in entries:
        require(entry["signed"].lstrip("+") == entry["bp"], f"R2: signed form of {entry}")
    return entries


def build_months_section():
    """R3's examples, each against its hand-worked result and the clamping property."""
    entries = []
    for date, months, worked in MONTHS_BACK_EXAMPLES:
        result = months_back(date, months)
        require(result == worked, f"R3: {date} minus {months} gives {result}, worked by hand {worked}")
        before, after = parse_date(date), parse_date(result)
        require((before.year * 12 + before.month) - (after.year * 12 + after.month) == months,
                f"R3: {date} minus {months} is not {months} months back")
        require(after.day == min(before.day, calendar.monthrange(after.year, after.month)[1]),
                f"R3: {date} minus {months} has the wrong day")
        entries.append({"date": date, "months": months, "result": result})
    return entries


def build_target_change_section():
    """R9's examples, each against its hand-worked bound changes and forms."""
    entries = []
    for earlier, later, lower, upper, signed_text, words_text in TARGET_CHANGE_EXAMPLES:
        check_inputs([], [earlier, later])
        change = target_change(earlier, later)
        require((change["lower"], change["upper"], change["signed"], change["words"])
                == (lower, upper, signed_text, words_text),
                f"R9: {earlier['effective']} to {later['effective']} gives {change}")
        entries.append({"earlier": earlier, "later": later, **change})
    return entries


def main():
    """Build, check and write tests/oracle/fixtures/econ-rates.json."""
    bp_entries = build_bp_section()
    months_entries = build_months_section()
    change_entries = build_target_change_section()
    cases = [build_case(spec, True) for spec in SYNTHETIC_CASES]
    cases.append(build_case(nyfed_case(), False))
    require(len({case["id"] for case in cases}) == len(cases), "case ids are not unique")

    check_hand(cases)
    for case in cases:
        check_case(case)
    check_rate_pairs([case["change_points"] for case in cases]
                     + [[entry["earlier"], entry["later"]] for entry in change_entries])

    fixture = next(case for case in cases if case["id"] == "nyfed-fixture")
    require(len(fixture["change_points"]) == 73, "the fixture target does not have 73 change points")
    require(fixture["expected"]["latest"] == {"period": "2026-11-18", "value": "3.88"},
            "the fixture's latest EFFR is not 3.88 on 2026-11-18")
    require(fixture["expected"]["comparison_table"][0]["target"]
            == {"effective": "2026-09-17", "lower": "3.75", "upper": "4.00"},
            "the fixture's current target is not 3.75 to 4.00 from 2026-09-17")
    require(len(fixture["observations"]) == 132, "the fixture case does not have 132 copied EFFR rows")
    require(all("effr" not in window for window in fixture["expected"]["windows"].values()),
            "the fixture case's windows carry an EFFR line")

    content = {
        "generator": GENERATOR,
        "rules": RULES,
        "bp": bp_entries,
        "months_back": months_entries,
        "target_change": change_entries,
        "cases": cases,
    }
    check_computed(content)
    text = json.dumps(content, indent=2, ensure_ascii=False) + "\n"
    require(text.isascii(), "the output is not ASCII")
    require(json.loads(text) == content, "the output does not read back")
    require(json.dumps(json.loads(text), indent=2, ensure_ascii=False) + "\n" == text,
            "the output is not deterministic")
    require(Path(__file__).read_bytes().isascii(), "this script is not ASCII")

    FIXTURE_DIR.mkdir(exist_ok=True)
    with open(FIXTURE_DIR / FIXTURE_NAME, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)

    observations = sum(len(case["observations"]) for case in cases)
    change_points = sum(len(case["change_points"]) for case in cases)
    print(f"econ rates oracle: {len(bp_entries)} bp, {len(months_entries)} months back, "
          f"{len(change_entries)} target changes, {len(cases)} cases "
          f"({sum(case['complete'] for case in cases)} complete; {observations} observations, "
          f"{change_points} change points); {TALLY['bp restated']} changes matched the decimal "
          f"restatement, {TALLY['rate pairs']} rate to rate pairs, {TALLY['hand checks']} hand checks; "
          f"wrote {FIXTURE_NAME} ({len(text.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
