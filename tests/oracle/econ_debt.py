"""Independent reference oracle for the National Debt Tracker rules D1 to D14.

Writes tests/oracle/fixtures/econ-debt.json from the written rules alone, not from the
TypeScript implementation, so that a mistake shared by both is unlikely: the records of a
series (D1), its latest record (D2), the daily, monthly and yearly changes with their base
dates, gaps, anomaly dates, validity checks and values (D3 to D8), the exact and rounded
displays (D9, D10), the parts against the total (D11), the missing values of a series (D12),
the recent records (D13) and the chart points (D14). It uses only the Python standard
library: amounts are exact integer cents, the month arithmetic of D4 is written out on the
Gregorian calendar, and day counts come from a day number of our own.

Run from the repository root (tests/oracle/generate.py also runs it):

    python -I tests/oracle/econ_debt.py

Every case is embedded below, so the fixture reproduces from committed files alone: synthetic
edge cases for every rule, and rows copied exactly from the fixture data in
local/econ-fixture/live/ (test data, never a publication) with the registry's anomalies,
documented gaps and gap limit for the three debt series. Every result is checked a second way
(with datetime, bisect, decimal and fractions, or by a brute-force restatement of the rule),
and the synthetic cases also carry expectations worked out by hand from the rules. Any failed
check raises before the fixture is written.
"""

import bisect
import calendar
import json
import math
import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Context, Decimal, Inexact
from fractions import Fraction
from pathlib import Path

GENERATOR = "tests/oracle/econ_debt.py"
RULES = "D1 to D14 of the National Debt Tracker rules"
FIXTURE_FILE = Path(__file__).resolve().parent / "fixtures" / "econ-debt.json"

SERIES = ("debt-total", "debt-held-public", "debt-intragov")
KINDS = (("daily", None), ("monthly", 1), ("yearly", 12))
REASONS = ("no-latest", "no-comparison", "not-published", "gap", "anomaly-latest", "anomaly-comparison")

# Exact decimal arithmetic for the self-checks: any rounding at all raises.
EXACT = Context(prec=80, traps=[Inexact])

CHECKS = [0]


def check(condition, message):
    """A self-check: raises, so the script exits non-zero, when a second statement of a rule disagrees."""
    CHECKS[0] += 1
    if not condition:
        raise AssertionError(message)


# Dates (D1, D4, D5)

DATE_PATTERN = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
MONTH_DAYS = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def is_leap(year):
    """Gregorian: every fourth year is a leap year, except the centuries not divisible by 400."""
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def days_in_month(year, month):
    return 29 if month == 2 and is_leap(year) else MONTH_DAYS[month - 1]


def parse_date(text):
    match = DATE_PATTERN.fullmatch(text) if isinstance(text, str) else None
    if not match:
        raise ValueError(f"not a YYYY-MM-DD date: {text!r}")
    year, month, day = (int(group) for group in match.groups())
    if not (1 <= month <= 12 and 1 <= day <= days_in_month(year, month)):
        raise ValueError(f"not a calendar date: {text!r}")
    return year, month, day


def format_date(year, month, day):
    return f"{year:04d}-{month:02d}-{day:02d}"


def day_number(text):
    """The number of days from 0000-03-01 (proleptic Gregorian) to the date. The year is counted
    from March, so that a leap day is the last day of its year: 365 days a year, plus one every
    fourth year, less one every century, plus one every fourth century, then the days of the
    months since March (153 days in every five months from March) and of the month."""
    year, month, day = parse_date(text)
    if month <= 2:
        year -= 1
        month += 12
    return 365 * year + year // 4 - year // 100 + year // 400 + (153 * (month - 3) + 2) // 5 + day - 1


def days_between(start, end):
    """D5: the whole number of calendar days from one date to another."""
    return day_number(end) - day_number(start)


def base_date(latest, months):
    """D4: the same day of the month one month (monthly) or twelve months (yearly) before, or the
    last day of that earlier month when the day does not exist in it."""
    year, month, day = parse_date(latest)
    index = year * 12 + (month - 1) - months
    base_year, base_month = index // 12, index % 12 + 1
    return format_date(base_year, base_month, min(day, days_in_month(base_year, base_month)))


def base_date_by_calendar(latest, months):
    """D4 a second way, with datetime: step back from the first of the month one month at a time,
    then walk forward through that month to the last day not after the latest record's day."""
    day = date.fromisoformat(latest)
    first = day.replace(day=1)
    for _ in range(months):
        first = (first - timedelta(days=1)).replace(day=1)
    candidate = first
    while True:
        following = candidate + timedelta(days=1)
        if following.month != first.month or following.day > day.day:
            return candidate.isoformat()
        candidate = following


# Amounts (D1, D8, D9, D10)

AMOUNT_PATTERN = re.compile(r"(-?)([0-9]+)\.([0-9]{2})")
RECORD_VALUE_PATTERN = re.compile(r"[0-9]+\.[0-9]{2}")


def cents(text):
    """D1: a decimal string with exactly two decimals, as exact integer cents; anything else is an error."""
    match = AMOUNT_PATTERN.fullmatch(text) if isinstance(text, str) else None
    if not match:
        raise ValueError(f"not a decimal with exactly two decimals: {text!r}")
    sign, whole, fraction = match.groups()
    value = int(whole) * 100 + int(fraction)
    return -value if sign else value


def decimal_text(amount):
    """D8: integer cents as a decimal string with two decimals ("2000000000.00", "-0.03", "0.00")."""
    sign = "-" if amount < 0 else ""
    size = abs(amount)
    return f"{sign}{size // 100}.{size % 100:02d}"


def group(digits):
    """D9: digits grouped by commas in threes from the right."""
    head = len(digits) % 3 or 3
    return ",".join([digits[:head]] + [digits[i:i + 3] for i in range(head, len(digits), 3)])


def with_sign(amount, body, signed):
    """D9: "-" before a negative amount; a signed amount also has "+" above zero; zero has no sign."""
    if amount < 0:
        return "-" + body
    if signed and amount > 0:
        return "+" + body
    return body


def exact_display(text, signed=False):
    """D9: "$" and the digits grouped by commas in threes, with the two decimals."""
    amount = cents(text)
    size = abs(amount)
    return with_sign(amount, f"${group(str(size // 100))}.{size % 100:02d}", signed)


SCALES = ((12, "trillion"), (9, "billion"), (6, "million"))


def rounded_display(text, signed=False):
    """D10: the scale chosen from the absolute value before rounding, the moved value rounded half
    up (away from zero) to two decimals, grouped as D9, then the word; None below one million."""
    amount = cents(text)
    size = abs(amount)
    for places, word in SCALES:
        unit = 10 ** places
        if size >= 100 * unit:
            # In cents, the moved value in hundredths is size / unit: a whole part and a remainder.
            hundredths, remainder = divmod(size, unit)
            if 2 * remainder >= unit:
                hundredths += 1
            return with_sign(amount, f"${group(str(hundredths // 100))}.{hundredths % 100:02d} {word}", signed)
    return None


def check_exact_display(text):
    value = Decimal(text)
    for signed in (False, True):
        shown = exact_display(text, signed)
        body = "$" + format(EXACT.abs(value), ",.2f")
        if value < 0:
            expected = "-" + body
        elif value > 0 and signed:
            expected = "+" + body
        else:
            expected = body
        check(shown == expected, f"D9 {text} signed={signed}: {shown} against {expected}")
        back = Decimal(shown.replace("$", "").replace(",", "").replace("+", ""))
        check(back == value, f"D9 {text}: {shown} does not read back")


def check_rounded_display(text):
    """D10 a second way: the scale and the half up rounding in fractions and in decimal."""
    value = Fraction(cents(text), 100)
    size = abs(value)
    scale = next(((places, word) for places, word in SCALES if size >= Fraction(10) ** places), None)
    for signed in (False, True):
        shown = rounded_display(text, signed)
        if scale is None:
            check(shown is None, f"D10 {text}: {shown} below one million")
            continue
        places, word = scale
        moved = size / Fraction(10) ** places
        hundredths = math.floor(moved * 100 + Fraction(1, 2))
        by_decimal = EXACT.multiply(EXACT.abs(Decimal(text)), Decimal(1).scaleb(-places)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP, context=Context(prec=80))
        check(Fraction(by_decimal) * 100 == hundredths, f"D10 {text}: fractions and decimal disagree")
        body = "$" + format(by_decimal, ",.2f") + " " + word
        if value < 0:
            expected = "-" + body
        elif signed:
            expected = "+" + body
        else:
            expected = body
        check(shown == expected, f"D10 {text} signed={signed}: {shown} against {expected}")


# Records (D1, D2)

def validate_records(records, where):
    """D1: ascending dates, one record per date, each value a decimal with two decimals or None."""
    for index, (day, value) in enumerate(records):
        parse_date(day)
        if value is not None:
            cents(value)
        if index:
            check(day_number(records[index - 1][0]) < day_number(day), f"{where}: records out of order at {day}")


def latest_index(records):
    """D2: the position of the last record that has a published value, or None."""
    for index in range(len(records) - 1, -1, -1):
        if records[index][1] is not None:
            return index
    return None


# Changes (D3 to D8)

def change_result(records, months, anomalies, max_gap):
    """D3 to D8 for one kind of change: months is None (daily), 1 (monthly) or 12 (yearly)."""
    anomaly_dates = {day for day, _ in anomalies}
    position = latest_index(records)
    if position is None:
        return result(None, None, None, None, "no-latest", None)
    latest, latest_value = records[position]
    if months is None:
        base = None
        comparison_position = position - 1 if position > 0 else None
    else:
        base = base_date(latest, months)
        comparison_position = None
        for index, (day, _) in enumerate(records):
            if day_number(day) > day_number(base):
                break
            comparison_position = index
    if comparison_position is None:
        return result(latest, base, None, None, "no-comparison", None)
    comparison, comparison_value = records[comparison_position]
    gap = days_between(comparison, latest if months is None else base)
    if comparison_value is None:
        reason = "not-published"
    elif gap > max_gap:
        reason = "gap"
    elif latest in anomaly_dates:
        reason = "anomaly-latest"
    elif comparison in anomaly_dates:
        reason = "anomaly-comparison"
    else:
        reason = None
    change = None if reason else decimal_text(cents(latest_value) - cents(comparison_value))
    return result(latest, base, comparison, gap, reason, change)


def result(latest, base, comparison, gap, reason, change):
    return {"valid": reason is None, "latest": latest, "base": base, "comparison": comparison,
            "gap_days": gap, "reason": reason, "change": change}


def check_change(records, months, anomalies, max_gap, got, where):
    """D3 to D8 a second way: bisect over the dates, datetime for the base date and the gap, every
    failing check listed in the D7 order and the first one taken, and decimal for the change."""
    check(got["valid"] == (got["reason"] is None) and (got["change"] is None) == (got["reason"] is not None),
          f"{where}: valid, reason and change disagree")
    dates = [day for day, _ in records]
    value_of = dict(records)
    published = [day for day, value in records if value is not None]
    latest = max(published, key=day_number) if published else None
    check(got["latest"] == latest, f"{where}: latest {got['latest']} against {latest}")
    if latest is None:
        check(got == result(None, None, None, None, "no-latest", None), f"{where}: no latest record")
        return
    position = dates.index(latest)
    if months is None:
        base = None
        comparison = dates[position - 1] if position else None
    else:
        base = base_date_by_calendar(latest, months)
        found = bisect.bisect_right(dates, base)
        comparison = dates[found - 1] if found else None
    gap = None
    if comparison is not None:
        gap = (date.fromisoformat(latest if months is None else base) - date.fromisoformat(comparison)).days
    anomaly_dates = [day for day, _ in anomalies]
    failing = [name for name, failed in (
        ("no-comparison", comparison is None),
        ("not-published", comparison is not None and value_of[comparison] is None),
        ("gap", gap is not None and gap > max_gap),
        ("anomaly-latest", latest in anomaly_dates),
        ("anomaly-comparison", comparison in anomaly_dates),
    ) if failed]
    reason = failing[0] if failing else None
    for key, expected in (("base", base), ("comparison", comparison), ("gap_days", gap), ("reason", reason)):
        check(got[key] == expected, f"{where}: {key} {got[key]} against {expected}")
    if reason is None:
        latest_value, comparison_value = Decimal(value_of[latest]), Decimal(value_of[comparison])
        change = EXACT.subtract(latest_value, comparison_value)
        check(Decimal(got["change"]) == change and got["change"] == format(change, "f"),
              f"{where}: change {got['change']} against {change}")
        check(EXACT.add(Decimal(got["change"]), comparison_value) == latest_value,
              f"{where}: change re-added to the comparison value is not the latest value")
        check(AMOUNT_PATTERN.fullmatch(got["change"]) is not None and got["change"] != "-0.00",
              f"{where}: change {got['change']} is not a decimal with two decimals")


# Parts against the total (D11)

def parts_differences(total, held, intragov, anomalies):
    """D11: every record date on which all three series have a published value and the parts do
    not add up to the total, oldest first, with the registry text of an anomaly date."""
    text_of = dict(anomalies)
    held_value = dict(held)
    intragov_value = dict(intragov)
    rows = []
    for day, total_value in total:
        held_on, intragov_on = held_value.get(day), intragov_value.get(day)
        if total_value is None or held_on is None or intragov_on is None:
            continue
        difference = cents(held_on) + cents(intragov_on) - cents(total_value)
        if difference:
            rows.append({"period": day, "total": total_value, "held": held_on, "intragov": intragov_on,
                         "difference": decimal_text(difference), "note": text_of.get(day)})
    return rows


def check_parts(total, held, intragov, anomalies, got, where):
    """D11 a second way: the dates common to the three published sets, in decimal, with every
    listed difference re-added and every date left out shown to add up exactly."""
    published = [{day: value for day, value in series if value is not None} for series in (total, held, intragov)]
    common = sorted(set(published[0]) & set(published[1]) & set(published[2]), key=day_number)
    listed = {row["period"]: row for row in got}
    check([row["period"] for row in got] == [day for day in common if day in listed], f"{where}: order or dates")
    check(set(listed) <= set(common), f"{where}: a listed date lacks a published value in a series")
    text_of = dict(anomalies)
    for day in common:
        total_value, held_value, intragov_value = (Decimal(values[day]) for values in published)
        parts = EXACT.add(held_value, intragov_value)
        if day in listed:
            row = listed[day]
            check((row["total"], row["held"], row["intragov"]) == tuple(values[day] for values in published),
                  f"{where}: {day} values")
            difference = Decimal(row["difference"])
            check(difference != 0 and EXACT.add(total_value, difference) == parts, f"{where}: {day} re-added")
            check(row["note"] == text_of.get(day), f"{where}: {day} note")
        else:
            check(parts == total_value, f"{where}: {day} left out but the parts differ from the total")


# Missing values (D12)

def missing_values(records):
    """D12 in one pass forward and one backward."""
    first_published = next((day for day, value in records if value is not None), None)
    not_published = 0
    last_not_published = None
    for day, value in records:
        if value is None:
            not_published += 1
            last_not_published = day
    daily_from = None
    for day, value in reversed(records):
        if value is None:
            break
        daily_from = day
    return {"first_published": first_published, "not_published": not_published,
            "last_not_published": last_not_published, "daily_from": daily_from}


def check_missing(records, got, where):
    """D12 by brute force: every candidate date D tried against every record dated D or later."""
    published = [day for day, value in records if value is not None]
    unpublished = [day for day, value in records if value is None]
    candidates = [day for day, _ in records
                  if all(value is not None for other, value in records if day_number(other) >= day_number(day))]
    expected = {
        "first_published": min(published, key=day_number) if published else None,
        "not_published": len(records) - len(published),
        "last_not_published": max(unpublished, key=day_number) if unpublished else None,
        "daily_from": min(candidates, key=day_number) if candidates else None,
    }
    check(got == expected, f"{where}: {got} against {expected}")
    if records and records[-1][1] is None:
        check(got["daily_from"] is None, f"{where}: the last record has no value")
    if records and not unpublished:
        check(got["daily_from"] == records[0][0], f"{where}: every record has a value")


# Recent records (D13)

def part_state(values, day):
    if day not in values:
        return {"state": "no-record", "value": None}
    if values[day] is None:
        return {"state": "not-published", "value": None}
    return {"state": "published", "value": values[day]}


def recent_records(total, held, intragov, n):
    """D13: the last n records of the total, newest first, each part published, not published or
    without a record on that date."""
    held_values, intragov_values = dict(held), dict(intragov)
    rows = []
    for day, total_value in reversed(total[max(len(total) - n, 0):]):
        rows.append({"period": day, "total": total_value, "held": part_state(held_values, day),
                     "intragov": part_state(intragov_values, day)})
    return rows


def check_recent(total, held, intragov, n, got, where):
    """D13 a second way: the dates sorted newest first and cut at n, the parts found by bisect."""
    newest_first = sorted((day for day, _ in total), key=day_number, reverse=True)[:n]
    check([row["period"] for row in got] == newest_first, f"{where}: dates")
    check(len(got) == min(n, len(total)), f"{where}: length")
    total_values = dict(total)
    for row in got:
        check(row["total"] == total_values[row["period"]], f"{where}: {row['period']} total")
        for name, series in (("held", held), ("intragov", intragov)):
            dates = [day for day, _ in series]
            found = bisect.bisect_left(dates, row["period"])
            if found < len(dates) and dates[found] == row["period"]:
                value = series[found][1]
                expected = {"state": "not-published" if value is None else "published", "value": value}
            else:
                expected = {"state": "no-record", "value": None}
            check(row[name] == expected, f"{where}: {row['period']} {name}")


# Chart points (D14)

def chart_points(records, known_gaps, window):
    """D14: the records from the first one with a published value (and not before the window
    start), each a point, plus a gap point on every documented gap date strictly between the first
    and the last point on which the series has no record, in date order."""
    first = next((index for index, (_, value) in enumerate(records) if value is not None), None)
    window_start = None
    if window == "twelve-months":
        position = latest_index(records)
        if position is None:
            raise ValueError("a twelve-month chart needs a latest record")
        window_start = base_date(records[position][0], 12)
    elif window is not None:
        raise ValueError(f"unknown window {window!r}")
    if first is None:
        return window_start, []
    kept = [(day, value) for day, value in records[first:]
            if window_start is None or day_number(day) >= day_number(window_start)]
    if not kept:
        return window_start, []
    start, end = day_number(kept[0][0]), day_number(kept[-1][0])
    record_dates = {day for day, _ in records}
    gaps = [(day, None) for day in known_gaps if start < day_number(day) < end and day not in record_dates]
    points = sorted(kept + gaps, key=lambda point: day_number(point[0]))
    return window_start, [[day, value] for day, value in points]


def check_chart(records, known_gaps, window, window_start, got, where):
    """D14 a second way: walk every calendar day from the first point to the last with datetime."""
    published = [day for day, value in records if value is not None]
    if window == "twelve-months":
        check(window_start == base_date_by_calendar(max(published, key=day_number), 12), f"{where}: window start")
    else:
        check(window_start is None, f"{where}: no window")
    values = dict(records)
    if not published:
        check(got == [], f"{where}: nothing published")
        return
    begin = date.fromisoformat(min(published, key=day_number))
    if window_start is not None:
        begin = max(begin, date.fromisoformat(window_start))
    kept_days = [day for day, _ in records if date.fromisoformat(day) >= begin]
    if not kept_days:
        check(got == [], f"{where}: nothing kept")
        return
    first, last = date.fromisoformat(kept_days[0]), date.fromisoformat(kept_days[-1])
    gap_days = set(known_gaps)
    expected = []
    day = first
    while day <= last:
        text = day.isoformat()
        if text in values:
            expected.append([text, values[text]])
        elif text in gap_days and first < day < last:
            expected.append([text, None])
        day += timedelta(days=1)
    check(got == expected, f"{where}: points")
    check(len({point[0] for point in got}) == len(got), f"{where}: one point per date")


# Registry (copied from local/econ-fixture/live/registry/econ-73fcccacdb080e6d.json, the v0.8
# registry). Only debt-total lists known_inconsistencies; the three debt series list the same
# known_gaps, each with GAP_TEXT, and the same continuity.max_gap of 6 days.

REGISTRY_INCONSISTENCIES = {
    "debt-total": (
        ("2011-02-01", "The published parts exceed the published total by $0.03."),
        ("2025-08-04", "The published parts exceed the published total by $10,000,000,000.00."),
    ),
    "debt-held-public": (),
    "debt-intragov": (),
}
GAP_TEXT = "A Federal Reserve business day with no Debt to the Penny record in the source (checked 2026-11-16)."
REGISTRY_KNOWN_GAPS = (
    "1995-11-20", "1997-01-31", "1997-12-19", "1997-12-24", "1998-01-02", "1998-03-06", "1998-05-19",
    "1999-03-18", "1999-08-09", "1999-11-30", "2000-02-22", "2000-11-09", "2001-01-08", "2001-09-11",
    "2001-09-24", "2001-12-21", "2005-04-01", "2019-04-03",
)
REGISTRY_MAX_GAP = 6

# manifest.json: the last period of each series in the fixture data.
FIXTURE_LAST_PERIOD = {"debt-total": "2026-11-23", "debt-held-public": "2026-11-23", "debt-intragov": "2026-11-13"}


def registry_anomalies():
    """D6: the known_inconsistencies of any of the three debt series, for all three, oldest first."""
    found = {}
    for series in SERIES:
        for day, text in REGISTRY_INCONSISTENCIES[series]:
            check(found.get(day, text) == text, f"D6: {day} has two registry texts")
            found[day] = text
    return [[day, found[day]] for day in sorted(found, key=day_number)]


# Rows copied exactly from the fixture data in local/econ-fixture/live/ (test data, never a
# publication): the current segment file of each year named by manifest.json, columns period
# and value_usd (an empty value_usd is a record without a value, missing code not-published).
# Each block holds every row of the series from its first date to its last date, so any slice
# inside a block is the series itself over that range.

FIXTURE_BLOCKS = {
    "debt-total": [
        # series/debt-total/2010/3b461b3c12b142b8.csv, series/debt-total/2011/38b9f5de8efd0b74.csv
        ("2010-01-04", "2011-03-01", """\
2010-01-04,12290238158257.13
2010-01-05,12303300925702.18
2010-01-06,12302080159963.01
2010-01-07,12280845281517.59
2010-01-08,12280604597845.51
2010-01-11,12285484345787.32
2010-01-12,12291168534193.72
2010-01-13,12282274011672.19
2010-01-14,12258545028915.24
2010-01-15,12319326469724.43
2010-01-19,12322107592352.96
2010-01-20,12327380804696.82
2010-01-21,12300163248044.69
2010-01-22,12302465487917.34
2010-01-25,12303736486568.45
2010-01-26,12308886504801.94
2010-01-27,12301772321038.04
2010-01-28,12274431428037.28
2010-01-29,12278635997966.88
2010-02-01,12349463585067.42
2010-02-02,12360943989345.48
2010-02-03,12354041054846.90
2010-02-04,12346427470024.01
2010-02-05,12345510656150.03
2010-02-08,12347902954531.73
2010-02-09,12349467132738.49
2010-02-10,12340570199406.32
2010-02-11,12349324464284.28
2010-02-12,12351624191901.06
2010-02-16,12384358013736.32
2010-02-17,12386495535882.23
2010-02-18,12401448666808.30
2010-02-19,12402054835588.68
2010-02-22,12403027179655.21
2010-02-23,12409374679862.09
2010-02-24,12401781166870.02
2010-02-25,12433661592275.45
2010-02-26,12440068020714.47
2010-03-01,12507536462861.04
2010-03-02,12519423725485.39
2010-03-03,12508944297560.56
2010-03-04,12545490013032.29
2010-03-05,12544703929352.55
2010-03-08,12546372001879.73
2010-03-09,12552703515296.83
2010-03-10,12544389439808.45
2010-03-11,12575479490348.47
2010-03-12,12575678862901.61
2010-03-15,12636662956140.07
2010-03-16,12643701402529.55
2010-03-17,12639779478641.89
2010-03-18,12661296056307.25
2010-03-19,12661039727506.65
2010-03-22,12663372436835.10
2010-03-23,12670895780689.20
2010-03-24,12662466657519.82
2010-03-25,12687570153023.93
2010-03-26,12685893723805.70
2010-03-29,12686249797715.01
2010-03-30,12684570896780.80
2010-03-31,12773123096139.43
2010-04-01,12764878911618.18
2010-04-02,12762747199516.75
2010-04-05,12786559060352.58
2010-04-06,12792967119405.50
2010-04-07,12791874548454.16
2010-04-08,12826031306447.93
2010-04-09,12825687391205.70
2010-04-12,12826379456286.85
2010-04-13,12831193383690.69
2010-04-14,12823492436215.11
2010-04-15,12874618766079.29
2010-04-16,12877714305798.84
2010-04-19,12863049415216.38
2010-04-20,12871255665556.84
2010-04-21,12865514120486.88
2010-04-22,12872601270864.44
2010-04-23,12877195922374.91
2010-04-26,12880364008405.96
2010-04-27,12886315749582.96
2010-04-28,12876734073745.72
2010-04-29,12853100126888.44
2010-04-30,12948738915856.86
2010-05-03,12927020546327.13
2010-05-04,12940953934792.90
2010-05-05,12943495066136.13
2010-05-06,12932913325200.66
2010-05-07,12928941224629.55
2010-05-10,12926785477772.98
2010-05-11,12931157737293.42
2010-05-12,12923161977864.28
2010-05-13,12927411267929.24
2010-05-14,12926689780236.68
2010-05-17,12974895930216.56
2010-05-18,12984666665110.57
2010-05-19,12975292327567.97
2010-05-20,12987822672429.02
2010-05-21,12987796841336.51
2010-05-24,12989095409531.09
2010-05-25,12995779490444.52
2010-05-26,12987274122710.70
2010-05-27,12987916782708.55
2010-05-28,12992539130957.22
2010-06-01,13050826460886.97
2010-06-02,13058289851171.50
2010-06-03,13056249966400.12
2010-06-04,13050588009652.62
2010-06-07,13052204878286.76
2010-06-08,13056957049453.42
2010-06-09,13046148615770.79
2010-06-10,13041405343973.44
2010-06-11,13041208520697.17
2010-06-14,13043148269336.48
2010-06-15,13078420280010.67
2010-06-16,13073000699429.76
2010-06-17,13038877263966.78
2010-06-18,13038455716111.87
2010-06-21,13040053515762.18
2010-06-22,13046652647591.81
2010-06-23,13041849923645.94
2010-06-24,13038079983718.36
2010-06-25,13038305786811.25
2010-06-28,13038916836943.40
2010-06-29,13037542715703.81
2010-06-30,13203473753968.10
2010-07-01,13178317356215.73
2010-07-02,13175330731664.70
2010-07-06,13177644774581.63
2010-07-07,13181991714131.18
2010-07-08,13192234850314.21
2010-07-09,13193854880648.02
2010-07-12,13194523014378.23
2010-07-13,13199290856204.31
2010-07-14,13189505566215.83
2010-07-15,13240228521494.88
2010-07-16,13239903754450.73
2010-07-19,13242893842328.75
2010-07-20,13245998461216.30
2010-07-21,13237494446894.52
2010-07-22,13249153625870.38
2010-07-23,13248524997009.91
2010-07-26,13252030092034.06
2010-07-27,13258280104675.66
2010-07-28,13247793649102.86
2010-07-29,13246508860572.07
2010-07-30,13237726976890.03
2010-08-02,13296826659389.53
2010-08-03,13301637817150.95
2010-08-04,13302301677300.10
2010-08-05,13310887351665.80
2010-08-06,13310114269532.31
2010-08-09,13311250227462.87
2010-08-10,13319830936991.03
2010-08-11,13307871897992.93
2010-08-12,13317048837517.12
2010-08-13,13315417951875.00
2010-08-16,13356994188341.44
2010-08-17,13364739861340.53
2010-08-18,13353801011553.95
2010-08-19,13363227573941.68
2010-08-20,13361739911386.51
2010-08-23,13363278285831.30
2010-08-24,13371301700295.28
2010-08-25,13361354442247.95
2010-08-26,13376189739693.61
2010-08-27,13375222710985.08
2010-08-30,13369841967694.39
2010-08-31,13449652537035.05
2010-09-01,13426803373412.02
2010-09-02,13442057367029.28
2010-09-03,13435343171187.87
2010-09-07,13438770879030.74
2010-09-08,13435355520330.43
2010-09-09,13444496046138.49
2010-09-10,13441762397157.23
2010-09-13,13443442988893.40
2010-09-14,13440225498627.42
2010-09-15,13498026949136.56
2010-09-16,13464896653374.11
2010-09-17,13467745270382.77
2010-09-20,13469342458134.17
2010-09-21,13476661616652.10
2010-09-22,13471094170316.20
2010-09-23,13463477025087.58
2010-09-24,13466818283723.48
2010-09-27,13468173874830.08
2010-09-28,13472761083757.88
2010-09-29,13466272411365.62
2010-09-30,13561623030891.79
2010-10-01,13610847585810.09
2010-10-04,13617255556356.04
2010-10-05,13624352674172.79
2010-10-06,13624678196435.07
2010-10-07,13615674949267.91
2010-10-08,13614052490714.72
2010-10-12,13612664732574.96
2010-10-13,13612299748993.36
2010-10-14,13606947094101.90
2010-10-15,13665926643255.96
2010-10-18,13668894473093.42
2010-10-19,13676109536322.09
2010-10-20,13667947376827.80
2010-10-21,13667983325978.31
2010-10-22,13667624992210.96
2010-10-25,13669359903495.66
2010-10-26,13673749566734.14
2010-10-27,13663891267223.32
2010-10-28,13658812457389.51
2010-10-29,13668825497341.36
2010-11-01,13713087906377.36
2010-11-02,13723974060859.22
2010-11-03,13718711829904.32
2010-11-04,13723439668440.18
2010-11-05,13723330060510.52
2010-11-08,13725166759183.46
2010-11-09,13727147399038.59
2010-11-10,13719547683746.49
2010-11-12,13721979465685.32
2010-11-15,13789013561493.72
2010-11-16,13795134710938.49
2010-11-17,13789278919702.62
2010-11-18,13788455142118.05
2010-11-19,13789699194529.33
2010-11-22,13794645743594.58
2010-11-23,13797004450927.68
2010-11-24,13788289275079.99
2010-11-26,13794243004364.88
2010-11-29,13790302153225.82
2010-11-30,13860773759018.43
2010-12-01,13834918581977.03
2010-12-02,13840966239053.15
2010-12-03,13833511738992.20
2010-12-06,13834824737060.60
2010-12-07,13838490314497.64
2010-12-08,13847884133109.61
2010-12-09,13846494847569.86
2010-12-10,13846685751077.18
2010-12-13,13848017156749.09
2010-12-14,13852589330911.83
2010-12-15,13879785054580.12
2010-12-16,13878837351150.62
2010-12-17,13883400070159.87
2010-12-20,13868461288845.81
2010-12-21,13867477082973.71
2010-12-22,13858529371601.09
2010-12-23,13865176563186.31
2010-12-24,13866145290604.69
2010-12-27,13874000269245.64
2010-12-28,13877230355933.00
2010-12-29,13870949681979.42
2010-12-30,13871130353817.40
2010-12-31,14025215218708.52
2011-01-03,13997932781828.89
2011-01-04,14014049043294.41
2011-01-05,14011526727895.85
2011-01-06,14011793170981.72
2011-01-07,14009422364546.03
2011-01-10,14014345009018.63
2011-01-11,14019559567587.86
2011-01-12,14010389488111.56
2011-01-13,14007216975377.59
2011-01-14,14007943536871.15
2011-01-18,14052380830542.80
2011-01-19,14053512150448.45
2011-01-20,14056313474932.58
2011-01-21,14060136959466.51
2011-01-24,14062239904820.69
2011-01-25,14067472135118.65
2011-01-26,14060011229556.38
2011-01-27,14059409159678.42
2011-01-28,14056512363629.35
2011-01-31,14131051056010.84
2011-02-01,14109842878903.50
2011-02-02,14116512433408.69
2011-02-03,14100427020880.94
2011-02-04,14099823671305.06
2011-02-07,14104021737251.53
2011-02-08,14110420810062.28
2011-02-09,14098789113781.32
2011-02-10,14083345766082.15
2011-02-11,14082712722334.93
2011-02-14,14081561324681.83
2011-02-15,14138085120211.66
2011-02-16,14129889690377.50
2011-02-17,14123589307190.53
2011-02-18,14124831879791.32
2011-02-22,14128556647662.68
2011-02-23,14125462676307.51
2011-02-24,14119807822019.49
2011-02-25,14137541098872.71
2011-02-28,14194764339462.64
2011-03-01,14172957589856.62
"""),
        # series/debt-total/2018/2bdc3e19a664f295.csv, series/debt-total/2019/613ec39ea9078320.csv
        ("2018-03-01", "2019-04-12", """\
2018-03-01,20874435529527.56
2018-03-02,20867726890754.58
2018-03-05,20872756577561.62
2018-03-06,20878815095126.54
2018-03-07,20879868237922.03
2018-03-08,20957314831621.48
2018-03-09,20957037099272.42
2018-03-12,20962217016816.16
2018-03-13,20972809767485.34
2018-03-14,20958230936189.63
2018-03-15,21031067004766.25
2018-03-16,21034109394094.77
2018-03-19,21044423366830.66
2018-03-20,21050409012718.72
2018-03-21,21032685133173.23
2018-03-22,21065155853968.88
2018-03-23,21068911163715.00
2018-03-26,21078004295231.99
2018-03-27,21085008958072.43
2018-03-28,21071123981792.35
2018-03-29,21113576555836.45
2018-03-30,21089642954195.85
2018-04-02,21119428167134.32
2018-04-03,21117036563374.48
2018-04-04,21118181678650.67
2018-04-05,21120516214632.52
2018-04-06,21120328488282.31
2018-04-09,21126975459212.66
2018-04-10,21134791585045.75
2018-04-11,21121833941447.86
2018-04-12,21062482347576.05
2018-04-13,21063430153271.02
2018-04-16,21070966420897.65
2018-04-17,21078301250985.42
2018-04-18,21079825622461.71
2018-04-19,21035490499062.02
2018-04-20,21038689089288.52
2018-04-23,21043317739890.61
2018-04-24,21062394007499.15
2018-04-25,21059600102296.72
2018-04-26,21055498294426.90
2018-04-27,21053362097750.15
2018-04-30,21068200197433.39
2018-05-01,21030629980055.97
2018-05-02,21045329035471.85
2018-05-03,21033707724786.27
2018-05-04,21037962909322.34
2018-05-07,21044166639576.73
2018-05-08,21054765494439.73
2018-05-09,21041008612752.39
2018-05-10,21050822593901.63
2018-05-11,21050639712224.13
2018-05-14,21054333351581.17
2018-05-15,21085763264509.00
2018-05-16,21073973527665.04
2018-05-17,21080911541301.81
2018-05-18,21080657571615.85
2018-05-21,21085944732707.85
2018-05-22,21094646382036.53
2018-05-23,21082960914217.14
2018-05-24,21086523104703.44
2018-05-25,21100147496907.13
2018-05-29,21103081230154.62
2018-05-30,21105716687008.42
2018-05-31,21145215185726.27
2018-06-01,21083101841090.82
2018-06-04,21090788185039.90
2018-06-05,21101359553390.92
2018-06-06,21102352873994.41
2018-06-07,21100104747917.42
2018-06-08,21089120186022.95
2018-06-11,21092939472262.30
2018-06-12,21099489928692.23
2018-06-13,21086796728063.70
2018-06-14,21080800469062.53
2018-06-15,21123860003777.00
2018-06-18,21131552165121.66
2018-06-19,21145776248815.35
2018-06-20,21134210723405.84
2018-06-21,21130804062854.82
2018-06-22,21130600883846.19
2018-06-25,21140053677467.79
2018-06-26,21149679487479.03
2018-06-27,21132466998348.70
2018-06-28,21128999819421.29
2018-06-29,21195069635322.81
2018-07-02,21206269833983.27
2018-07-03,21200946191836.57
2018-07-05,21202772898489.06
2018-07-06,21205959245607.94
2018-07-09,21208118414223.52
2018-07-10,21216401150637.29
2018-07-11,21207800900961.24
2018-07-12,21211173172828.90
2018-07-13,21210749709985.38
2018-07-16,21243372844071.82
2018-07-17,21255414486483.41
2018-07-18,21240863782088.95
2018-07-19,21259998398094.92
2018-07-20,21260651850117.75
2018-07-23,21263807944392.77
2018-07-24,21271247800540.01
2018-07-25,21265465085278.12
2018-07-26,21298625513846.47
2018-07-27,21298529758160.39
2018-07-30,21299336900639.99
2018-07-31,21313061060202.36
2018-08-01,21264843695121.88
2018-08-02,21313281480972.70
2018-08-03,21299885021440.17
2018-08-06,21305396357131.22
2018-08-07,21309935887061.00
2018-08-08,21298611652099.77
2018-08-09,21342180438050.36
2018-08-10,21340305860713.26
2018-08-13,21345092516711.61
2018-08-14,21351570155673.96
2018-08-15,21372335862718.26
2018-08-16,21407198924328.46
2018-08-17,21411381995917.67
2018-08-20,21413596733315.34
2018-08-21,21419489702413.26
2018-08-22,21406769129269.27
2018-08-23,21427964691382.19
2018-08-24,21427915886083.86
2018-08-27,21434509795753.30
2018-08-28,21441778054853.24
2018-08-29,21439418968321.48
2018-08-30,21442467655114.31
2018-08-31,21458849674105.03
2018-09-04,21455349744287.30
2018-09-05,21471068566864.17
2018-09-06,21454589882352.10
2018-09-07,21456483108262.84
2018-09-10,21459790397306.67
2018-09-11,21466240223764.98
2018-09-12,21450777638517.61
2018-09-13,21432542252109.45
2018-09-14,21432243515559.68
2018-09-17,21490885696294.14
2018-09-18,21499171612329.23
2018-09-19,21494298981877.34
2018-09-20,21467468522886.37
2018-09-21,21466736176134.46
2018-09-24,21475519434473.53
2018-09-25,21482774907893.49
2018-09-26,21471059693409.20
2018-09-27,21431887134696.46
2018-09-28,21516058183180.23
2018-10-01,21606948383546.28
2018-10-02,21618812057150.71
2018-10-03,21605363414469.16
2018-10-04,21599377345082.36
2018-10-05,21599293061786.97
2018-10-09,21602285916278.38
2018-10-10,21594438319301.65
2018-10-11,21590013434727.39
2018-10-12,21597941304882.14
2018-10-15,21654150409486.39
2018-10-16,21661717322449.45
2018-10-17,21653793061650.80
2018-10-18,21672453590238.12
2018-10-19,21671476474549.22
2018-10-22,21674683713625.99
2018-10-23,21682446587870.73
2018-10-24,21671062290012.80
2018-10-25,21695750095091.45
2018-10-26,21694906926249.19
2018-10-29,21697502722082.55
2018-10-30,21699981385978.17
2018-10-31,21702369768174.47
2018-11-01,21683971652591.44
2018-11-02,21676608763810.66
2018-11-05,21682375718173.25
2018-11-06,21691245489008.61
2018-11-07,21690440697756.73
2018-11-08,21733425227728.46
2018-11-09,21732569650931.19
2018-11-13,21734201829935.66
2018-11-14,21725713263679.99
2018-11-15,21763815767800.21
2018-11-16,21766361664768.69
2018-11-19,21772154155056.20
2018-11-20,21782702247862.12
2018-11-21,21769263916844.09
2018-11-23,21802839722859.62
2018-11-26,21811396160621.93
2018-11-27,21816375589157.53
2018-11-28,21801924124576.84
2018-11-29,21818103811690.47
2018-11-30,21850093880675.80
2018-12-03,21824097352309.98
2018-12-04,21836687236972.05
2018-12-05,21839046215674.56
2018-12-06,21851519415475.75
2018-12-07,21850844847464.58
2018-12-10,21854296172540.94
2018-12-11,21849744563858.24
2018-12-12,21836655970708.04
2018-12-13,21823094510705.58
2018-12-14,21820936961476.66
2018-12-17,21876674953142.67
2018-12-18,21885501490485.79
2018-12-19,21873194423164.45
2018-12-20,21863635176724.12
2018-12-21,21868943731576.67
2018-12-24,21862540831594.79
2018-12-26,21861315992472.00
2018-12-27,21845329154412.01
2018-12-28,21867322638334.45
2018-12-31,21974095705790.55
2019-01-02,21943897507129.68
2019-01-03,21929258046653.58
2019-01-04,21931966199373.94
2019-01-07,21935478484527.11
2019-01-08,21941436879693.69
2019-01-09,21930194582386.14
2019-01-10,21917603881288.34
2019-01-11,21917159310974.58
2019-01-14,21919993773556.77
2019-01-15,21969969573018.07
2019-01-16,21960411284948.15
2019-01-17,21954771806120.41
2019-01-18,21954898759285.36
2019-01-22,21953160110078.25
2019-01-23,21947795866492.78
2019-01-24,21941258881102.69
2019-01-25,21950249913408.50
2019-01-28,21955074791078.53
2019-01-29,21973331001422.70
2019-01-30,21968157827920.13
2019-01-31,21982423036475.23
2019-02-01,21921630334906.20
2019-02-04,21933491166604.77
2019-02-05,21957295730198.83
2019-02-06,21957560953101.45
2019-02-07,21955061924930.72
2019-02-08,21957707162297.58
2019-02-11,22012840891685.32
2019-02-12,22035768149459.89
2019-02-13,22020113259723.01
2019-02-14,22015608446497.27
2019-02-15,22025547947478.37
2019-02-19,22040666955080.47
2019-02-20,22039763197239.24
2019-02-21,22039289882625.87
2019-02-22,22063557299600.16
2019-02-25,22067095964458.39
2019-02-26,22089959800922.00
2019-02-27,22074317868857.95
2019-02-28,22115526445599.07
2019-03-01,22028945980301.65
2019-03-04,22028447125652.23
2019-03-05,22028524548385.66
2019-03-06,22028357199655.04
2019-03-07,22029051549002.87
2019-03-08,22028881490539.35
2019-03-11,22028371305809.44
2019-03-12,22028444133429.20
2019-03-13,22028273031640.25
2019-03-14,22028877815332.49
2019-03-15,22028706063174.96
2019-03-18,22028190803484.94
2019-03-19,22028262639972.93
2019-03-20,22028089812176.34
2019-03-21,22028692383333.10
2019-03-22,22028518927886.87
2019-03-25,22027998543525.24
2019-03-26,22028072102351.20
2019-03-27,22027897795377.42
2019-03-28,22029112480741.88
2019-03-29,22027880157027.99
2019-04-01,22027704987724.49
2019-04-02,22027579108932.54
2019-04-04,22028147661589.79
2019-04-05,22027973012982.34
2019-04-08,22027449134390.73
2019-04-09,22027496999035.60
2019-04-10,22027323060789.03
2019-04-11,22027837127788.04
2019-04-12,22027664941778.85
"""),
        # series/debt-total/2019/613ec39ea9078320.csv, series/debt-total/2020/98f69aadba3afded.csv
        ("2019-12-30", "2020-01-02", """\
2019-12-30,23108827795092.86
2019-12-31,23201380134807.73
2020-01-02,23171999133830.77
"""),
        # series/debt-total/2024/9b700d8ba857701b.csv, series/debt-total/2025/6824d6bb7a8e92ac.csv
        ("2024-07-01", "2025-09-04", """\
2024-07-01,34841059628786.80
2024-07-02,34866040431327.31
2024-07-03,34847568990054.13
2024-07-05,34852201287595.04
2024-07-08,34857390059828.10
2024-07-09,34884371510047.60
2024-07-10,34861321658685.01
2024-07-11,34888939546525.91
2024-07-12,34889213426967.08
2024-07-15,34911647554064.35
2024-07-16,34940154193610.64
2024-07-17,34923277120226.95
2024-07-18,34945963278406.29
2024-07-19,34944251830592.92
2024-07-22,34950138997139.35
2024-07-23,34988121329285.52
2024-07-24,34969578299467.18
2024-07-25,34997540505103.33
2024-07-26,35001278179208.67
2024-07-29,35004415930299.00
2024-07-30,35043209977687.27
2024-07-31,35104770649301.03
2024-08-01,35059402347141.52
2024-08-02,35051428694554.99
2024-08-05,35059256376453.14
2024-08-06,35085786495843.24
2024-08-07,35094756345920.31
2024-08-08,35123327978028.47
2024-08-09,35122527132406.43
2024-08-12,35126850161739.27
2024-08-13,35160349582384.67
2024-08-14,35137624661984.40
2024-08-15,35169163778240.35
2024-08-16,35167228191213.46
2024-08-19,35178034113238.07
2024-08-20,35215900370093.07
2024-08-21,35193999279273.78
2024-08-22,35210350799546.12
2024-08-23,35213967100485.15
2024-08-26,35225184901185.83
2024-08-27,35289492003154.99
2024-08-28,35269696270863.86
2024-08-29,35279776145434.29
2024-08-30,35256056842790.06
2024-09-03,35319686640609.98
2024-09-04,35343824738015.02
2024-09-05,35345572154736.15
2024-09-06,35343086505566.21
2024-09-09,35346632271646.61
2024-09-10,35331161690593.41
2024-09-11,35309184612870.00
2024-09-12,35273879754917.38
2024-09-13,35268781589361.92
2024-09-16,35346469569597.74
2024-09-17,35350842310771.10
2024-09-18,35331269621113.08
2024-09-19,35327646622839.45
2024-09-20,35319710736132.06
2024-09-23,35324636379347.22
2024-09-24,35324325476368.35
2024-09-25,35303965164452.88
2024-09-26,35296367284952.26
2024-09-27,35321337344400.43
2024-09-30,35464673929171.69
2024-10-01,35668947367182.09
2024-10-02,35677760608035.45
2024-10-03,35677796842519.70
2024-10-04,35680514816032.92
2024-10-07,35682617798771.80
2024-10-08,35717705665132.67
2024-10-09,35693841261552.04
2024-10-10,35680634083932.18
2024-10-11,35707319682513.26
2024-10-15,35751271808625.45
2024-10-16,35743513547464.87
2024-10-17,35769084471524.38
2024-10-18,35769732147503.35
2024-10-21,35772750214886.62
2024-10-22,35802822173836.96
2024-10-23,35777371535343.63
2024-10-24,35809157751119.80
2024-10-25,35815392559823.53
2024-10-28,35817406407906.45
2024-10-29,35848521510437.02
2024-10-30,35847012590067.17
2024-10-31,35951601173936.02
2024-11-01,35866603223541.48
2024-11-04,35884401015854.36
2024-11-05,35911107598198.18
2024-11-06,35912058541218.85
2024-11-07,35943554220297.64
2024-11-08,35945396362475.20
2024-11-12,35963765584299.24
2024-11-13,35950262427779.69
2024-11-14,35965533024604.05
2024-11-15,35959176987940.11
2024-11-18,35963976342723.91
2024-11-19,35992291043718.85
2024-11-20,35973905978114.70
2024-11-21,36034994586981.97
2024-11-22,36047523137936.35
2024-11-25,36052650894794.76
2024-11-26,36113570535802.53
2024-11-27,36090597225804.43
2024-11-29,36087362960612.00
2024-12-02,36171181955284.36
2024-12-03,36169413863866.88
2024-12-04,36170511547438.85
2024-12-05,36167364938108.44
2024-12-06,36166037570457.33
2024-12-09,36172195279062.94
2024-12-10,36163442396226.61
2024-12-11,36132520515276.53
2024-12-12,36133463898632.02
2024-12-13,36134075633938.69
2024-12-16,36192895704983.65
2024-12-17,36189345826140.62
2024-12-18,36167604149955.61
2024-12-19,36167124467492.90
2024-12-20,36161621015445.57
2024-12-23,36190276558466.62
2024-12-24,36146819184367.10
2024-12-26,36112807709307.61
2024-12-27,36144183375647.43
2024-12-30,36150157230460.04
2024-12-31,36218605311689.91
2025-01-02,36169957618760.21
2025-01-03,36164146727045.82
2025-01-06,36171792705159.98
2025-01-07,36178676019215.59
2025-01-08,36153745342266.30
2025-01-09,36166393613679.73
2025-01-10,36169520000045.49
2025-01-13,36173455107711.11
2025-01-14,36200906538154.24
2025-01-15,36174170135464.01
2025-01-16,36197510998407.58
2025-01-17,36206593315575.15
2025-01-21,36218258403326.35
2025-01-22,36217491332226.53
2025-01-23,36222002723844.24
2025-01-24,36221228533802.26
2025-01-27,36218906298311.33
2025-01-28,36219937278825.22
2025-01-29,36219161589293.08
2025-01-30,36221443082611.85
2025-01-31,36220206738047.96
2025-02-03,36217878252518.89
2025-02-04,36218901460828.96
2025-02-05,36218123595894.41
2025-02-06,36220361045794.81
2025-02-07,36219581958530.58
2025-02-10,36217244743854.40
2025-02-11,36218268281356.50
2025-02-12,36217487855772.08
2025-02-13,36219764087577.56
2025-02-14,36218983690427.99
2025-02-18,36219592701106.67
2025-02-19,36218812100137.31
2025-02-20,36222989450273.97
2025-02-21,36222211606919.46
2025-02-24,36219878534361.59
2025-02-25,36220749649855.42
2025-02-26,36219980655775.79
2025-02-27,36221949836006.93
2025-02-28,36218923369370.10
2025-03-03,36216627186278.78
2025-03-04,36217457726432.81
2025-03-05,36216695558849.86
2025-03-06,36218587006168.51
2025-03-07,36217824184013.37
2025-03-10,36215535706949.98
2025-03-11,36216346495438.75
2025-03-12,36215588741627.31
2025-03-13,36217410341236.57
2025-03-14,36216656361372.88
2025-03-17,36214394370510.05
2025-03-18,36215212669334.38
2025-03-19,36214467819348.16
2025-03-20,36218222045186.34
2025-03-21,36217481307084.84
2025-03-24,36215258907037.79
2025-03-25,36216093287593.75
2025-03-26,36215356534171.37
2025-03-27,36217204329840.19
2025-03-28,36216470672037.87
2025-03-31,36214310420174.13
2025-04-01,36215156673113.80
2025-04-02,36214426211363.76
2025-04-03,36216495027787.96
2025-04-04,36215761618891.11
2025-04-07,36213561491981.13
2025-04-08,36214508751190.01
2025-04-09,36213771222289.59
2025-04-10,36215701317831.94
2025-04-11,36214966389282.11
2025-04-14,36212761633585.77
2025-04-15,36214325271235.26
2025-04-16,36213590712228.65
2025-04-17,36217480035223.27
2025-04-18,36216754420662.27
2025-04-21,36214577610342.96
2025-04-22,36215469660763.20
2025-04-23,36214749867321.42
2025-04-24,36216691721516.53
2025-04-25,36215973825751.09
2025-04-28,36213820164200.18
2025-04-29,36214714517960.73
2025-04-30,36213557195810.65
2025-05-01,36215576799286.87
2025-05-02,36214860183509.71
2025-05-05,36212710389147.45
2025-05-06,36213602874250.21
2025-05-07,36212886111158.26
2025-05-08,36214896100379.00
2025-05-09,36214181120572.57
2025-05-12,36212036164590.27
2025-05-13,36212978908050.01
2025-05-14,36212261421742.89
2025-05-15,36216429412019.81
2025-05-16,36215714628553.09
2025-05-19,36213570763720.98
2025-05-20,36214475432210.84
2025-05-21,36213761221110.82
2025-05-22,36215801485838.54
2025-05-23,36215088402345.87
2025-05-27,36213853751952.05
2025-05-28,36213141126266.06
2025-05-29,36215176317298.42
2025-05-30,36215818399936.85
2025-06-02,36214400664854.53
2025-06-03,36215207426690.65
2025-06-04,36214501400213.64
2025-06-05,36216389414480.21
2025-06-06,36215685263667.36
2025-06-09,36213572785415.03
2025-06-10,36214280590105.74
2025-06-11,36213581723797.07
2025-06-12,36217452092903.81
2025-06-13,36216756516461.68
2025-06-16,36214669844058.55
2025-06-17,36215397741847.76
2025-06-18,36214707136233.83
2025-06-20,36215873428835.86
2025-06-23,36213808426999.56
2025-06-24,36214553337753.25
2025-06-25,36213869568117.00
2025-06-26,36215806064740.36
2025-06-27,36215124313382.16
2025-06-30,36211469351821.31
2025-07-01,36214482241911.14
2025-07-02,36213797741182.40
2025-07-03,36215869297299.75
2025-07-07,36582313190019.76
2025-07-08,36625815401249.79
2025-07-09,36600645372974.92
2025-07-10,36595101611079.13
2025-07-11,36595800737387.36
2025-07-14,36598345542154.94
2025-07-15,36651611116545.83
2025-07-16,36627854976862.70
2025-07-17,36655280579113.61
2025-07-18,36653918652499.85
2025-07-21,36661693720250.59
2025-07-22,36711532407363.75
2025-07-23,36686937742311.50
2025-07-24,36721531033602.97
2025-07-25,36732899946782.52
2025-07-28,36734926076305.30
2025-07-29,36803837518918.21
2025-07-30,36802240561898.39
2025-07-31,36916987311998.03
2025-08-01,36826902934749.25
2025-08-04,36828164797914.31
2025-08-05,36930452345865.16
2025-08-06,36950459859111.56
2025-08-07,36996205967149.22
2025-08-08,36998491853555.08
2025-08-11,37004817625842.56
2025-08-12,37070422809316.32
2025-08-13,37045338077527.04
2025-08-14,37089430594354.58
2025-08-15,37137282641767.74
2025-08-18,37144076750410.16
2025-08-19,37208856314804.55
2025-08-20,37180190981823.32
2025-08-21,37232288662023.91
2025-08-22,37234066149278.96
2025-08-25,37254222904720.97
2025-08-26,37204886498253.39
2025-08-27,37283968901443.54
2025-08-28,37310153970210.76
2025-08-29,37274265917907.03
2025-09-02,37413538427516.19
2025-09-03,37412679963880.17
2025-09-04,37430128115822.76
"""),
        # series/debt-total/2025/6824d6bb7a8e92ac.csv, series/debt-total/2026/5887d4e2d75647f0.csv
        ("2025-11-01", "2026-11-23", """\
2025-11-03,38004366480104.18
2025-11-04,38047239753103.02
2025-11-05,38091526352867.96
2025-11-06,38118268221748.03
2025-11-07,38117224885993.65
2025-11-10,38125731687631.03
2025-11-12,38121217149187.64
2025-11-13,38150716416656.92
2025-11-14,38153732193790.00
2025-11-17,38181184806486.51
2025-11-18,38265355580035.02
2025-11-19,38299373085978.18
2025-11-20,38326967559564.53
2025-11-21,38333530047031.29
2025-11-24,38336291718985.39
2025-11-25,38360841844745.79
2025-11-26,38335267983846.11
2025-11-28,38396211497613.65
2025-12-01,38425673178874.63
2025-12-02,38423764679404.02
2025-12-03,38403532042006.28
2025-12-04,38389369875885.10
2025-12-05,38390532833611.70
2025-12-08,38395956139411.28
2025-12-09,38377110471869.66
2025-12-10,38352200418068.14
2025-12-11,38349795034550.24
2025-12-12,38339541810902.33
2025-12-15,38419380255240.59
2025-12-16,38396179577012.10
2025-12-17,38378996619785.02
2025-12-18,38375371484790.79
2025-12-19,38372869364189.14
2025-12-22,38378413234316.13
2025-12-23,38375349596930.58
2025-12-24,38352846701813.17
2025-12-26,38380536147996.03
2025-12-29,38386384190622.68
2025-12-30,38372153717621.09
2025-12-31,38514009184232.72
2026-01-02,38422818570606.72
2026-01-05,38441088237227.94
2026-01-06,38430410089259.84
2026-01-07,38432287507801.52
2026-01-08,38432587259757.29
2026-01-09,38433330126292.37
2026-01-12,38437700892419.68
2026-01-13,38433852753680.03
2026-01-14,38396062667874.39
2026-01-15,38453108492348.67
2026-01-16,38460239071716.76
2026-01-20,38484705102395.33
2026-01-21,38473375474319.00
2026-01-22,38490798138585.90
2026-01-23,38491020558407.85
2026-01-26,38513523578580.59
2026-01-27,38567114207655.70
2026-01-28,38542542471886.84
2026-01-29,38568501122811.36
2026-01-30,38521368112341.66
2026-02-02,38515650269880.94
2026-02-03,38564278020214.60
2026-02-04,38564513699490.46
2026-02-05,38587617094083.77
2026-02-06,38588547251497.72
2026-02-09,38593206197018.13
2026-02-10,38645729764967.98
2026-02-11,38620772876638.50
2026-02-12,38647755796057.39
2026-02-13,38647355475525.93
2026-02-17,38720327822350.87
2026-02-18,38717487211821.37
2026-02-19,38743577500254.48
2026-02-20,38749020004219.30
2026-02-23,38758072042435.60
2026-02-24,38787781432126.22
2026-02-25,38764882203837.59
2026-02-26,38789591923403.59
2026-02-27,38769805982273.81
2026-03-02,38824463573452.26
2026-03-03,38853352399880.18
2026-03-04,38857671304563.85
2026-03-05,38873529611754.22
2026-03-06,38869818249468.38
2026-03-09,38882801672400.64
2026-03-10,38918862057676.91
2026-03-11,38882422422396.88
2026-03-12,38900879040970.80
2026-03-13,38902637810572.47
2026-03-16,38992187847500.92
2026-03-17,39016762910245.14
2026-03-18,38976827976841.63
2026-03-19,39002265870014.23
2026-03-20,39002071364584.97
2026-03-23,39006945786204.79
2026-03-24,38999855700424.49
2026-03-25,38990599081861.70
2026-03-26,38990389667489.38
2026-03-27,39015632027421.67
2026-03-30,39023028185485.25
2026-03-31,39065421393640.82
2026-04-01,39016191534959.54
2026-04-02,39000264506637.00
2026-04-03,38981755126540.77
2026-04-06,38994100716395.00
2026-04-07,38969941867504.03
2026-04-08,38949925615242.17
2026-04-09,38942790613086.55
2026-04-10,38946541987812.28
2026-04-13,38954924765330.86
2026-04-14,38933404100463.29
2026-04-15,38988471242937.32
2026-04-16,38985997093766.37
2026-04-17,38979318629209.68
2026-04-20,38992782604302.01
2026-04-21,38979261041490.82
2026-04-22,38957839768374.44
2026-04-23,38935486920284.75
2026-04-24,38953670272769.58
2026-04-27,38960955558731.97
2026-04-28,38951791901141.80
2026-04-29,38952075248701.65
2026-04-30,38967833861543.11
2026-05-01,38882147615630.53
2026-05-04,38905034125404.78
2026-05-05,38910619550278.10
2026-05-06,38918837926582.90
2026-05-07,38931651718802.09
2026-05-08,38937475342585.80
2026-05-11,38946800561409.14
2026-05-12,38968295059805.35
2026-05-13,38942623681847.68
2026-05-14,38954466670318.20
2026-05-15,38997244508055.09
2026-05-18,39008999901378.68
2026-05-19,39070752626994.13
2026-05-20,39049639932662.87
2026-05-21,39071200457366.45
2026-05-22,39112192265187.75
2026-05-26,39171154946667.59
2026-05-27,39163302863182.10
2026-05-28,39176301795549.40
2026-05-29,39207759598302.62
2026-06-01,39195502287422.08
2026-06-02,39221984586285.30
2026-06-03,39204974715248.65
2026-06-04,39232150577283.87
2026-06-05,39219582387346.71
2026-06-08,39230385715009.09
2026-06-09,39241722848798.66
2026-06-10,39213266279741.16
2026-06-11,39220785117318.68
2026-06-12,39209984063577.76
2026-06-15,39293074039354.64
2026-06-16,39289865167568.98
2026-06-17,39283052266270.91
2026-06-18,39305293944733.24
2026-06-22,39323731819938.67
2026-06-23,39320607875889.32
2026-06-24,39320508743100.40
2026-06-25,39311022730162.44
2026-06-26,39337503706976.53
2026-06-29,39345340787969.72
2026-06-30,39462398380774.37
2026-07-01,39389304788902.60
2026-07-02,39375254020492.22
2026-07-03,39375989952866.26
2026-07-06,39387881222485.61
2026-07-07,39414977491738.78
2026-07-08,39394977645639.05
2026-07-09,39414179016130.09
2026-07-10,39412981341965.62
2026-07-13,39417905469064.21
2026-07-14,39470152218599.01
2026-07-15,39488616467668.43
2026-07-16,39518859758919.12
2026-07-17,39581848442144.38
2026-07-20,39588242618845.71
2026-07-21,39660369665133.47
2026-07-22,39635799057233.84
2026-07-23,39676938407949.77
2026-07-24,39692374867364.99
2026-07-27,39713964053447.11
2026-07-28,39797152899275.21
2026-07-29,39799618642771.12
2026-07-30,39841114561022.68
2026-07-31,39771617162466.97
2026-08-03,39739223157130.73
2026-08-04,39828435390891.55
2026-08-05,39829652708623.61
2026-08-06,39890263441627.83
2026-08-07,39885247772395.56
2026-08-10,39891773994021.93
2026-08-11,39941929832070.77
2026-08-12,39913529319464.71
2026-08-13,39934816207844.37
2026-08-14,39933634466112.78
2026-08-17,39986657878071.92
2026-08-18,40047425768420.22
2026-08-19,40012700535679.44
2026-08-20,40033256786764.37
2026-08-21,40032876505819.31
2026-08-24,40035385103646.14
2026-08-25,40098864155027.57
2026-08-26,40069751423220.72
2026-08-27,40077529831942.94
2026-08-28,40104097482666.58
2026-08-31,40175641071634.14
2026-09-01,40112464593206.30
2026-09-02,40117045127072.57
2026-09-03,40102964278586.10
2026-09-04,40094590636301.70
2026-09-08,40084090785446.35
2026-09-09,40074284925786.50
2026-09-10,40047726949770.15
2026-09-11,40046178322792.78
2026-09-14,40054421967786.91
2026-09-15,40114445691166.84
2026-09-16,40094080427790.97
2026-09-17,40093343468150.50
2026-09-18,40101500516712.09
2026-09-21,40112118151111.92
2026-09-22,40097834028442.07
2026-09-23,40073558531201.68
2026-09-24,40068807991924.84
2026-09-25,40097178119750.91
2026-09-28,40102185696865.37
2026-09-29,40096954633566.68
2026-09-30,40171825101340.31
2026-10-01,40260641972390.03
2026-10-02,40242446619209.33
2026-10-05,40249104431078.48
2026-10-06,40273024579219.17
2026-10-07,40284036147367.19
2026-10-08,40305316210829.72
2026-10-09,40301480531899.65
2026-10-13,40343879238035.67
2026-10-14,40329229827541.02
2026-10-15,40388317675071.91
2026-10-16,40387508795231.67
2026-10-19,40396401120485.05
2026-10-20,40439546016039.08
2026-10-21,40413639012305.97
2026-10-22,40444342709389.15
2026-10-23,40463151897249.19
2026-10-26,40528358939415.85
2026-10-27,40582274254843.57
2026-10-28,40551054852362.41
2026-10-29,40593637262883.48
2026-10-30,40524510013062.41
2026-11-02,40502080966097.14
2026-11-03,40547403570984.82
2026-11-04,40550230047609.15
2026-11-05,40556120784983.65
2026-11-06,40552751019092.61
2026-11-09,40559796589243.37
2026-11-10,40584136080272.89
2026-11-12,40608506856903.25
2026-11-13,40610506856903.25
2026-11-16,40614506856903.25
2026-11-17,40617506856903.25
2026-11-18,40620506856903.25
2026-11-19,40622506856903.25
2026-11-20,40624506856903.25
2026-11-23,40626506856903.25
"""),
    ],
    "debt-held-public": [
        # series/debt-held-public/1997/9e3bb7cfac248889.csv
        ("1997-09-22", "1997-10-09", """\
1997-09-22,
1997-09-23,
1997-09-24,
1997-09-25,
1997-09-26,
1997-09-29,
1997-09-30,3789667546849.60
1997-10-01,
1997-10-02,
1997-10-03,
1997-10-06,
1997-10-07,
1997-10-08,
1997-10-09,
"""),
        # series/debt-held-public/2005/dd0614e4a8335340.csv
        ("2005-03-24", "2005-04-08", """\
2005-03-24,
2005-03-25,
2005-03-28,
2005-03-29,
2005-03-30,
2005-03-31,4572715640119.20
2005-04-04,4597839825974.99
2005-04-05,4598953967857.68
2005-04-06,4600104964187.60
2005-04-07,4605268977787.14
2005-04-08,4605367450493.05
"""),
        # series/debt-held-public/2011/86ab308eb257cb6d.csv
        ("2011-01-31", "2011-02-02", """\
2011-01-31,9485416860164.29
2011-02-01,9482575172379.45
2011-02-02,9482735273832.17
"""),
        # series/debt-held-public/2019/8ac05a343094a348.csv, series/debt-held-public/2020/743c7520889b165a.csv
        ("2019-12-30", "2020-01-02", """\
2019-12-30,17133687951263.30
2019-12-31,17170442487631.56
2020-01-02,17162410209193.34
"""),
        # series/debt-held-public/2025/25adc54836b3c8c4.csv
        ("2025-08-01", "2025-08-05", """\
2025-08-01,29522548953929.98
2025-08-04,29523300148538.85
2025-08-05,29601407493123.21
"""),
        # series/debt-held-public/2025/25adc54836b3c8c4.csv, series/debt-held-public/2026/05af960b7be158e3.csv
        ("2025-11-01", "2026-11-23", """\
2025-11-03,30567833810363.02
2025-11-04,30588445700448.40
2025-11-05,30589653976794.86
2025-11-06,30610666797441.52
2025-11-07,30611508844516.16
2025-11-10,30613346931589.27
2025-11-12,30629115020089.01
2025-11-13,30653919436694.72
2025-11-14,30654607353084.03
2025-11-17,30675159827981.92
2025-11-18,30690574250262.63
2025-11-19,30687812251917.30
2025-11-20,30707975239396.64
2025-11-21,30706639126551.86
2025-11-24,30706241277353.57
2025-11-25,30722912264691.05
2025-11-26,30720877603388.67
2025-11-28,30774117238206.31
2025-12-01,30853068463300.35
2025-12-02,30843863156002.45
2025-12-03,30843637085897.30
2025-12-04,30824381406045.22
2025-12-05,30822518818972.69
2025-12-08,30822913626328.95
2025-12-09,30793663184220.67
2025-12-10,30793542262019.16
2025-12-11,30787372595984.82
2025-12-12,30774528464721.58
2025-12-15,30852855298143.76
2025-12-16,30816834775843.42
2025-12-17,30816952898858.15
2025-12-18,30807754246644.19
2025-12-19,30804983565149.29
2025-12-22,30804343347355.44
2025-12-23,30765540678107.58
2025-12-24,30767152990652.20
2025-12-26,30789162165471.37
2025-12-29,30788927240091.41
2025-12-30,30758836564019.29
2025-12-31,30846716536213.26
2026-01-02,30830898741274.12
2026-01-05,30829627778734.90
2026-01-06,30809021616341.38
2026-01-07,30810025746721.36
2026-01-08,30806172192100.19
2026-01-09,30803872985803.55
2026-01-12,30802877100962.48
2026-01-13,30786665721842.47
2026-01-14,30787151283904.07
2026-01-15,30811929736380.71
2026-01-16,30811997567291.18
2026-01-20,30824259874597.25
2026-01-21,30825455797755.52
2026-01-22,30841780130036.30
2026-01-23,30839033479994.45
2026-01-26,30839469782091.59
2026-01-27,30878428226102.52
2026-01-28,30876617956619.42
2026-01-29,30898303196814.87
2026-01-30,30919122670062.31
2026-02-02,30915426727781.28
2026-02-03,30957184531162.23
2026-02-04,30956315394310.42
2026-02-05,30974189194630.76
2026-02-06,30969650188685.63
2026-02-09,30969105519646.32
2026-02-10,31010830716181.61
2026-02-11,31009198594125.31
2026-02-12,31032365231612.70
2026-02-13,31031921227566.66
2026-02-17,31087884326300.86
2026-02-18,31088483280078.60
2026-02-19,31112549990945.54
2026-02-20,31113584300966.47
2026-02-23,31113461801511.79
2026-02-24,31129399758399.04
2026-02-25,31126463055912.55
2026-02-26,31149029033685.39
2026-02-27,31186965290815.89
2026-03-02,31244382920777.66
2026-03-03,31268820109081.36
2026-03-04,31271271922985.85
2026-03-05,31281694069404.27
2026-03-06,31280012029379.25
2026-03-09,31280623244306.89
2026-03-10,31298790579980.06
2026-03-11,31285946384224.81
2026-03-12,31300175076619.99
2026-03-13,31300165451609.92
2026-03-16,31381345411579.55
2026-03-17,31379706593178.71
2026-03-18,31364647874667.34
2026-03-19,31385414419029.53
2026-03-20,31384605282290.22
2026-03-23,31385566969958.40
2026-03-24,31362014213440.21
2026-03-25,31363230287736.49
2026-03-26,31361115540758.11
2026-03-27,31388492802178.27
2026-03-30,31385929126772.90
2026-03-31,31431182280136.26
2026-04-01,31431328591198.51
2026-04-02,31409363156320.44
2026-04-03,31409491869379.24
2026-04-06,31413833699845.38
2026-04-07,31371921154820.79
2026-04-08,31373299420088.83
2026-04-09,31364679558344.11
2026-04-10,31363210882603.11
2026-04-13,31364172953118.05
2026-04-14,31327076933755.06
2026-04-15,31374528030445.60
2026-04-16,31359379088304.58
2026-04-17,31344221423413.60
2026-04-20,31343959370344.72
2026-04-21,31317297210883.89
2026-04-22,31318022210274.80
2026-04-23,31289249969317.98
2026-04-24,31289224791422.95
2026-04-27,31289756388875.06
2026-04-28,31266604928934.45
2026-04-29,31264482575337.52
2026-04-30,31272489865435.88
2026-05-01,31271957838023.21
2026-05-04,31274803442683.56
2026-05-05,31261787439569.55
2026-05-06,31263383766000.16
2026-05-07,31262325604447.63
2026-05-08,31260345834577.53
2026-05-11,31262108319021.06
2026-05-12,31268302404373.30
2026-05-13,31269241615132.64
2026-05-14,31277752122232.96
2026-05-15,31315583263208.62
2026-05-18,31317917051386.19
2026-05-19,31359065157830.45
2026-05-20,31358949739922.20
2026-05-21,31374788661132.13
2026-05-22,31400817772622.92
2026-05-26,31447423137771.69
2026-05-27,31450452898651.64
2026-05-28,31466045143781.76
2026-05-29,31515369798622.98
2026-06-01,31581373375160.92
2026-06-02,31597886394124.88
2026-06-03,31599703500408.55
2026-06-04,31610718934247.54
2026-06-05,31597881328951.17
2026-06-08,31600133143674.75
2026-06-09,31595464942057.47
2026-06-10,31592369611735.25
2026-06-11,31594717601039.83
2026-06-12,31582353473994.95
2026-06-15,31662560557978.68
2026-06-16,31642663562697.08
2026-06-17,31643344541986.99
2026-06-18,31613484231007.52
2026-06-22,31625610531064.27
2026-06-23,31606133955273.55
2026-06-24,31606937181849.92
2026-06-25,31594497290975.03
2026-06-26,31620872393262.40
2026-06-29,31621329805348.19
2026-06-30,31681308373695.03
2026-07-01,31677634703147.37
2026-07-02,31678903447798.93
2026-07-03,31676896645959.71
2026-07-06,31680155395885.35
2026-07-07,31696800244689.86
2026-07-08,31695882336712.26
2026-07-09,31709399350223.40
2026-07-10,31707316963764.64
2026-07-13,31707770448042.27
2026-07-14,31751114853068.90
2026-07-15,31793476990367.91
2026-07-16,31818450437358.76
2026-07-17,31816915417245.04
2026-07-20,31817640840048.45
2026-07-21,31874795478548.56
2026-07-22,31874681300216.33
2026-07-23,31911919221141.67
2026-07-24,31922906015670.09
2026-07-27,31923702843165.38
2026-07-28,31995278756120.16
2026-07-29,31994676087491.92
2026-07-30,32035731397438.63
2026-07-31,32045863694464.30
2026-08-03,32038115995948.67
2026-08-04,32100703256953.12
2026-08-05,32101179235743.02
2026-08-06,32148910864804.21
2026-08-07,32144621002644.97
2026-08-10,32143066242802.75
2026-08-11,32182460756111.37
2026-08-12,32180112234304.32
2026-08-13,32200971487306.14
2026-08-14,32200393497585.51
2026-08-17,32227199001687.30
2026-08-18,32265798542898.08
2026-08-19,32263508863255.09
2026-08-20,32278964736853.40
2026-08-21,32276141923440.99
2026-08-24,32274806592449.50
2026-08-25,32307785364850.31
2026-08-26,32305769839476.37
2026-08-27,32313802811901.63
2026-08-28,32340688588401.83
2026-08-31,32414988847175.22
2026-09-01,32420529452197.11
2026-09-02,32421027120428.18
2026-09-03,32423635247198.78
2026-09-04,32410785543623.23
2026-09-08,32387921094746.81
2026-09-09,32388611390871.80
2026-09-10,32363418108364.11
2026-09-11,32357573654300.31
2026-09-14,32358452350574.73
2026-09-15,32406391951586.01
2026-09-16,32406353922774.30
2026-09-17,32392786557372.46
2026-09-18,32401926526743.72
2026-09-21,32402191477341.65
2026-09-22,32375685818022.20
2026-09-23,32376938482751.49
2026-09-24,32362728656693.39
2026-09-25,32385874118414.11
2026-09-28,32386263609755.87
2026-09-29,32367872193303.63
2026-09-30,32425012546390.57
2026-10-01,32433790394253.86
2026-10-02,32428913787327.44
2026-10-05,32426124989617.49
2026-10-06,32440264284905.73
2026-10-07,32439260138550.17
2026-10-08,32454086117711.32
2026-10-09,32447832644923.87
2026-10-13,32483641012611.98
2026-10-14,32483712019721.84
2026-10-15,32538236547452.08
2026-10-16,32532409708643.41
2026-10-19,32533474452928.98
2026-10-20,32566198492042.62
2026-10-21,32566346587338.02
2026-10-22,32597664070880.23
2026-10-23,32610649676158.39
2026-10-26,32635294814294.48
2026-10-27,32677379585770.57
2026-10-28,32671924859186.91
2026-10-29,32712190190967.42
2026-10-30,32738422032176.85
2026-11-02,32719901942674.43
2026-11-03,32765330118710.62
2026-11-04,32765175912225.50
2026-11-05,32766722473715.61
2026-11-06,32762925356629.47
2026-11-09,32763773414012.50
2026-11-10,32800204226578.75
2026-11-12,32824386143424.80
2026-11-13,32825386143424.80
2026-11-16,32827386143424.80
2026-11-17,32828886143424.80
2026-11-18,32830386143424.80
2026-11-19,32831386143424.80
2026-11-20,32832386143424.80
2026-11-23,32833386143424.80
"""),
    ],
    "debt-intragov": [
        # series/debt-intragov/2011/965b6d3080685ec2.csv
        ("2011-01-31", "2011-02-02", """\
2011-01-31,4645634195846.55
2011-02-01,4627267706524.08
2011-02-02,4633777159576.52
"""),
        # series/debt-intragov/2019/37a9b6bf61da477c.csv, series/debt-intragov/2020/b0d1e5eb5e4c57c6.csv
        ("2019-12-30", "2020-01-02", """\
2019-12-30,5975139843829.56
2019-12-31,6030937647175.17
2020-01-02,6009588924637.43
"""),
        # series/debt-intragov/2025/8a6541b6f5c3149c.csv
        ("2025-08-01", "2025-08-05", """\
2025-08-01,7304353980819.27
2025-08-04,7314864649375.46
2025-08-05,7329044852741.95
"""),
        # series/debt-intragov/2025/8a6541b6f5c3149c.csv, series/debt-intragov/2026/fa2d8e982817d4f1.csv
        ("2025-11-01", "2026-11-23", """\
2025-11-03,7436532669741.16
2025-11-04,7458794052654.62
2025-11-05,7501872376073.10
2025-11-06,7507601424306.51
2025-11-07,7505716041477.49
2025-11-10,7512384756041.76
2025-11-12,7492102129098.63
2025-11-13,7496796979962.20
2025-11-14,7499124840705.97
2025-11-17,7506024978504.59
2025-11-18,7574781329772.39
2025-11-19,7611560834060.88
2025-11-20,7618992320167.89
2025-11-21,7626890920479.43
2025-11-24,7630050441631.82
2025-11-25,7637929580054.74
2025-11-26,7614390380457.44
2025-11-28,7622094259407.34
2025-12-01,7572604715574.28
2025-12-02,7579901523401.57
2025-12-03,7559894956108.98
2025-12-04,7564988469839.88
2025-12-05,7568014014639.01
2025-12-08,7573042513082.33
2025-12-09,7583447287648.99
2025-12-10,7558658156048.98
2025-12-11,7562422438565.42
2025-12-12,7565013346180.75
2025-12-15,7566524957096.83
2025-12-16,7579344801168.68
2025-12-17,7562043720926.87
2025-12-18,7567617238146.60
2025-12-19,7567885799039.85
2025-12-22,7574069886960.69
2025-12-23,7609808918823.00
2025-12-24,7585693711160.97
2025-12-26,7591373982524.66
2025-12-29,7597456950531.27
2025-12-30,7613317153601.80
2025-12-31,7667292648019.46
2026-01-02,7591919829332.60
2026-01-05,7611460458493.04
2026-01-06,7621388472918.46
2026-01-07,7622261761080.16
2026-01-08,7626415067657.10
2026-01-09,7629457140488.82
2026-01-12,7634823791457.20
2026-01-13,7647187031837.56
2026-01-14,7608911383970.32
2026-01-15,7641178755967.96
2026-01-16,7648241504425.58
2026-01-20,7660445227798.08
2026-01-21,7647919676563.48
2026-01-22,7649018008549.60
2026-01-23,7651987078413.40
2026-01-26,7674053796489.00
2026-01-27,7688685981553.18
2026-01-28,7665924515267.42
2026-01-29,7670197925996.49
2026-01-30,7602245442279.35
2026-02-02,7600223542099.66
2026-02-03,7607093489052.37
2026-02-04,7608198305180.04
2026-02-05,7613427899453.01
2026-02-06,7618897062812.09
2026-02-09,7624100677371.81
2026-02-10,7634899048786.37
2026-02-11,7611574282513.19
2026-02-12,7615390564444.69
2026-02-13,7615434247959.27
2026-02-17,7632443496050.01
2026-02-18,7629003931742.77
2026-02-19,7631027509308.94
2026-02-20,7635435703252.83
2026-02-23,7644610240923.81
2026-02-24,7658381673727.18
2026-02-25,7638419147925.04
2026-02-26,7640562889718.20
2026-02-27,7582840691457.92
2026-03-02,7580080652674.60
2026-03-03,7584532290798.82
2026-03-04,7586399381578.00
2026-03-05,7591835542349.95
2026-03-06,7589806220089.13
2026-03-09,7602178428093.75
2026-03-10,7620071477696.85
2026-03-11,7596476038172.07
2026-03-12,7600703964350.81
2026-03-13,7602472358962.55
2026-03-16,7610842435921.37
2026-03-17,7637056317066.43
2026-03-18,7612180102174.29
2026-03-19,7616851450984.70
2026-03-20,7617466082294.75
2026-03-23,7621378816246.39
2026-03-24,7637841486984.28
2026-03-25,7627368794125.21
2026-03-26,7629274126731.27
2026-03-27,7627139225243.40
2026-03-30,7637099058712.35
2026-03-31,7634239113504.56
2026-04-01,7584862943761.03
2026-04-02,7590901350316.56
2026-04-03,7572263257161.53
2026-04-06,7580267016549.62
2026-04-07,7598020712683.24
2026-04-08,7576626195153.34
2026-04-09,7578111054742.44
2026-04-10,7583331105209.17
2026-04-13,7590751812212.81
2026-04-14,7606327166708.23
2026-04-15,7613943212491.72
2026-04-16,7626618005461.79
2026-04-17,7635097205796.08
2026-04-20,7648823233957.29
2026-04-21,7661963830606.93
2026-04-22,7639817558099.64
2026-04-23,7646236950966.77
2026-04-24,7664445481346.63
2026-04-27,7671199169856.91
2026-04-28,7685186972207.35
2026-04-29,7687592673364.13
2026-04-30,7695343996107.23
2026-05-01,7610189777607.32
2026-05-04,7630230682721.22
2026-05-05,7648832110708.55
2026-05-06,7655454160582.74
2026-05-07,7669326114354.46
2026-05-08,7677129508008.27
2026-05-11,7684692242388.08
2026-05-12,7699992655432.05
2026-05-13,7673382066715.04
2026-05-14,7676714548085.24
2026-05-15,7681661244846.47
2026-05-18,7691082849992.49
2026-05-19,7711687469163.68
2026-05-20,7690690192740.67
2026-05-21,7696411796234.32
2026-05-22,7711374492564.83
2026-05-26,7723731808895.90
2026-05-27,7712849964530.46
2026-05-28,7710256651767.64
2026-05-29,7692389799679.64
2026-06-01,7614128912261.16
2026-06-02,7624098192160.42
2026-06-03,7605271214840.10
2026-06-04,7621431643036.33
2026-06-05,7621701058395.54
2026-06-08,7630252571334.34
2026-06-09,7646257906741.19
2026-06-10,7620896668005.91
2026-06-11,7626067516278.85
2026-06-12,7627630589582.81
2026-06-15,7630513481375.96
2026-06-16,7647201604871.90
2026-06-17,7639707724283.92
2026-06-18,7691809713725.72
2026-06-22,7698121288874.40
2026-06-23,7714473920615.77
2026-06-24,7713571561250.48
2026-06-25,7716525439187.41
2026-06-26,7716631313714.13
2026-06-29,7724010982621.53
2026-06-30,7781090007079.34
2026-07-01,7711670085755.23
2026-07-02,7696350572693.29
2026-07-03,7699093306906.55
2026-07-06,7707725826600.26
2026-07-07,7718177247048.92
2026-07-08,7699095308926.79
2026-07-09,7704779665906.69
2026-07-10,7705664378200.98
2026-07-13,7710135021021.94
2026-07-14,7719037365530.11
2026-07-15,7695139477300.52
2026-07-16,7700409321560.36
2026-07-17,7764933024899.34
2026-07-20,7770601778797.26
2026-07-21,7785574186584.91
2026-07-22,7761117757017.51
2026-07-23,7765019186808.10
2026-07-24,7769468851694.90
2026-07-27,7790261210281.73
2026-07-28,7801874143155.05
2026-07-29,7804942555279.20
2026-07-30,7805383163584.05
2026-07-31,7725753468002.67
2026-08-03,7701107161182.06
2026-08-04,7727732133938.43
2026-08-05,7728473472880.59
2026-08-06,7741352576823.62
2026-08-07,7740626769750.59
2026-08-10,7748707751219.18
2026-08-11,7759469075959.40
2026-08-12,7733417085160.39
2026-08-13,7733844720538.23
2026-08-14,7733240968527.27
2026-08-17,7759458876384.62
2026-08-18,7781627225522.14
2026-08-19,7749191672424.35
2026-08-20,7754292049910.97
2026-08-21,7756734582378.32
2026-08-24,7760578511196.64
2026-08-25,7791078790177.26
2026-08-26,7763981583744.35
2026-08-27,7763727020041.31
2026-08-28,7763408894264.75
2026-08-31,7760652224458.92
2026-09-01,7691935141009.19
2026-09-02,7696018006644.39
2026-09-03,7679329031387.32
2026-09-04,7683805092678.47
2026-09-08,7696169690699.54
2026-09-09,7685673534914.70
2026-09-10,7684308841406.04
2026-09-11,7688604668492.47
2026-09-14,7695969617212.18
2026-09-15,7708053739580.83
2026-09-16,7687726505016.67
2026-09-17,7700556910778.04
2026-09-18,7699573989968.37
2026-09-21,7709926673770.27
2026-09-22,7722148210419.87
2026-09-23,7696620048450.19
2026-09-24,7706079335231.45
2026-09-25,7711304001336.80
2026-09-28,7715922087109.50
2026-09-29,7729082440263.05
2026-09-30,7746812554949.74
2026-10-01,7826851578136.17
2026-10-02,7813532831881.89
2026-10-05,7822979441460.99
2026-10-06,7832760294313.44
2026-10-07,7844776008817.02
2026-10-08,7851230093118.40
2026-10-09,7853647886975.78
2026-10-13,7860238225423.69
2026-10-14,7845517807819.18
2026-10-15,7850081127619.83
2026-10-16,7855099086588.26
2026-10-19,7862926667556.07
2026-10-20,7873347523996.46
2026-10-21,7847292424967.95
2026-10-22,7846678638508.92
2026-10-23,7852502221090.80
2026-10-26,7893064125121.37
2026-10-27,7904894669073.00
2026-10-28,7879129993175.50
2026-10-29,7881447071916.06
2026-10-30,7786087980885.56
2026-11-02,7782179023422.71
2026-11-03,7782073452274.20
2026-11-04,7785054135383.65
2026-11-05,7789398311268.04
2026-11-06,7789825662463.14
2026-11-09,7796023175230.87
2026-11-10,7783925853694.14
2026-11-12,7784120713478.45
2026-11-13,7785120713478.45
"""),
    ],
}


def fixture_rows(series, start, end):
    """The fixture records of a series from start to end (both included), from one block."""
    for first, last, text in FIXTURE_BLOCKS[series]:
        if day_number(first) <= day_number(start) and day_number(end) <= day_number(last):
            rows = []
            for line in text.splitlines():
                day, value = line.split(",")
                if day_number(start) <= day_number(day) <= day_number(end):
                    rows.append((day, value or None))
            return rows
    raise ValueError(f"no fixture block of {series} covers {start} to {end}")


def check_fixture_blocks():
    for series in SERIES:
        for first, last, text in FIXTURE_BLOCKS[series]:
            rows = [line.split(",") for line in text.splitlines()]
            where = f"fixture block {series} {first}"
            check(all(len(row) == 2 for row in rows), f"{where}: two columns")
            check(day_number(rows[0][0]) >= day_number(first), f"{where}: start")
            check(day_number(rows[-1][0]) <= day_number(last), f"{where}: end")
            for day, value in rows:
                check(value == "" or RECORD_VALUE_PATTERN.fullmatch(value) is not None, f"{where}: {day} value")
            validate_records([(day, value or None) for day, value in rows], where)


# Synthetic cases

def R(*rows):
    """Synthetic records, each "YYYY-MM-DD value" with "-" for a record without a value."""
    records = []
    for row in rows:
        day, value = row.split(" ")
        records.append((day, None if value == "-" else value))
    return records


def E(comparison, gap, outcome, base=None):
    """A change worked out by hand: outcome is the D7 reason, or the D8 change when valid."""
    reason = outcome if outcome in REASONS else None
    return {"base": base, "comparison": comparison, "gap_days": gap, "reason": reason,
            "change": None if reason else outcome}


NONE = E(None, None, "no-latest")

# (date, months, base worked out by hand)
BASE_DATES = (
    ("2024-03-31", 1, "2024-02-29"), ("2023-03-31", 1, "2023-02-28"), ("2024-03-30", 1, "2024-02-29"),
    ("2024-03-29", 1, "2024-02-29"), ("2024-03-28", 1, "2024-02-28"), ("2023-03-29", 1, "2023-02-28"),
    ("2023-03-30", 1, "2023-02-28"), ("2024-02-29", 12, "2023-02-28"), ("2024-02-29", 1, "2024-01-29"),
    ("2025-02-28", 12, "2024-02-28"), ("2025-03-01", 12, "2024-03-01"), ("2024-12-31", 1, "2024-11-30"),
    ("2025-01-31", 1, "2024-12-31"), ("2025-01-31", 12, "2024-01-31"), ("2025-01-15", 1, "2024-12-15"),
    ("2024-05-31", 1, "2024-04-30"), ("2024-07-31", 1, "2024-06-30"), ("2024-08-31", 1, "2024-07-31"),
    ("2024-10-31", 1, "2024-09-30"), ("2025-03-01", 1, "2025-02-01"), ("2024-01-01", 1, "2023-12-01"),
    ("2024-01-01", 12, "2023-01-01"), ("2026-11-23", 1, "2026-10-23"), ("2026-11-23", 12, "2025-11-23"),
    ("2026-11-13", 12, "2025-11-13"), ("2000-03-31", 1, "2000-02-29"), ("2000-02-29", 12, "1999-02-28"),
    ("2100-03-31", 1, "2100-02-28"), ("2028-02-29", 12, "2027-02-28"), ("2028-03-31", 1, "2028-02-29"),
    ("2025-08-04", 1, "2025-07-04"), ("2011-03-01", 1, "2011-02-01"), ("1993-04-01", 12, "1992-04-01"),
)

# (from, to, days worked out by hand)
DAYS_BETWEEN = (
    ("2024-03-08", "2024-03-11", 3), ("2024-04-10", "2024-04-16", 6), ("2024-04-10", "2024-04-17", 7),
    ("2023-12-29", "2024-01-02", 4), ("2024-02-28", "2024-03-01", 2), ("2023-02-28", "2023-03-01", 1),
    ("2024-03-31", "2024-03-31", 0), ("2023-02-28", "2024-02-29", 366), ("2024-02-29", "2025-02-28", 365),
    ("2023-01-01", "2024-01-01", 365), ("2024-01-01", "2025-01-01", 366), ("2000-02-28", "2000-03-01", 2),
    ("2100-02-28", "2100-03-01", 1), ("1999-12-31", "2000-01-01", 1), ("2019-04-02", "2019-04-04", 2),
    ("2025-11-21", "2025-11-23", 2), ("1993-04-01", "2026-11-23", 12289),
)

# (value, exact, exact signed, rounded, rounded signed), worked out by hand from D9 and D10
AMOUNTS = (
    ("0.00", "$0.00", "$0.00", None, None),
    ("0.01", "$0.01", "+$0.01", None, None),
    ("-0.01", "-$0.01", "-$0.01", None, None),
    ("-0.03", "-$0.03", "-$0.03", None, None),
    ("0.10", "$0.10", "+$0.10", None, None),
    ("1.00", "$1.00", "+$1.00", None, None),
    ("12.34", "$12.34", "+$12.34", None, None),
    ("999.99", "$999.99", "+$999.99", None, None),
    ("1000.00", "$1,000.00", "+$1,000.00", None, None),
    ("-1234.56", "-$1,234.56", "-$1,234.56", None, None),
    ("100000.00", "$100,000.00", "+$100,000.00", None, None),
    ("999999.99", "$999,999.99", "+$999,999.99", None, None),
    ("-999999.99", "-$999,999.99", "-$999,999.99", None, None),
    ("1000000.00", "$1,000,000.00", "+$1,000,000.00", "$1.00 million", "+$1.00 million"),
    ("-1000000.00", "-$1,000,000.00", "-$1,000,000.00", "-$1.00 million", "-$1.00 million"),
    ("1004999.99", "$1,004,999.99", "+$1,004,999.99", "$1.00 million", "+$1.00 million"),
    ("1005000.00", "$1,005,000.00", "+$1,005,000.00", "$1.01 million", "+$1.01 million"),
    ("-1005000.00", "-$1,005,000.00", "-$1,005,000.00", "-$1.01 million", "-$1.01 million"),
    ("999994999.99", "$999,994,999.99", "+$999,994,999.99", "$999.99 million", "+$999.99 million"),
    ("999995000.00", "$999,995,000.00", "+$999,995,000.00", "$1,000.00 million", "+$1,000.00 million"),
    ("999999999.99", "$999,999,999.99", "+$999,999,999.99", "$1,000.00 million", "+$1,000.00 million"),
    ("1000000000.00", "$1,000,000,000.00", "+$1,000,000,000.00", "$1.00 billion", "+$1.00 billion"),
    ("1225000000.00", "$1,225,000,000.00", "+$1,225,000,000.00", "$1.23 billion", "+$1.23 billion"),
    ("1235000000.00", "$1,235,000,000.00", "+$1,235,000,000.00", "$1.24 billion", "+$1.24 billion"),
    ("-1235000000.00", "-$1,235,000,000.00", "-$1,235,000,000.00", "-$1.24 billion", "-$1.24 billion"),
    ("1244999999.99", "$1,244,999,999.99", "+$1,244,999,999.99", "$1.24 billion", "+$1.24 billion"),
    ("1245000000.00", "$1,245,000,000.00", "+$1,245,000,000.00", "$1.25 billion", "+$1.25 billion"),
    ("-1245000000.00", "-$1,245,000,000.00", "-$1,245,000,000.00", "-$1.25 billion", "-$1.25 billion"),
    ("2000000000.00", "$2,000,000,000.00", "+$2,000,000,000.00", "$2.00 billion", "+$2.00 billion"),
    ("2675000000.00", "$2,675,000,000.00", "+$2,675,000,000.00", "$2.68 billion", "+$2.68 billion"),
    ("-2675000000.00", "-$2,675,000,000.00", "-$2,675,000,000.00", "-$2.68 billion", "-$2.68 billion"),
    ("10000000000.00", "$10,000,000,000.00", "+$10,000,000,000.00", "$10.00 billion", "+$10.00 billion"),
    ("999999999999.99", "$999,999,999,999.99", "+$999,999,999,999.99", "$1,000.00 billion", "+$1,000.00 billion"),
    ("-999999999999.99", "-$999,999,999,999.99", "-$999,999,999,999.99", "-$1,000.00 billion",
     "-$1,000.00 billion"),
    ("1000000000000.00", "$1,000,000,000,000.00", "+$1,000,000,000,000.00", "$1.00 trillion", "+$1.00 trillion"),
    ("-1000000000000.00", "-$1,000,000,000,000.00", "-$1,000,000,000,000.00", "-$1.00 trillion",
     "-$1.00 trillion"),
    ("7785120713478.45", "$7,785,120,713,478.45", "+$7,785,120,713,478.45", "$7.79 trillion", "+$7.79 trillion"),
    ("-9928007452590.07", "-$9,928,007,452,590.07", "-$9,928,007,452,590.07", "-$9.93 trillion",
     "-$9.93 trillion"),
    ("40624999999999.99", "$40,624,999,999,999.99", "+$40,624,999,999,999.99", "$40.62 trillion",
     "+$40.62 trillion"),
    ("40625000000000.00", "$40,625,000,000,000.00", "+$40,625,000,000,000.00", "$40.63 trillion",
     "+$40.63 trillion"),
    ("-40625000000000.00", "-$40,625,000,000,000.00", "-$40,625,000,000,000.00", "-$40.63 trillion",
     "-$40.63 trillion"),
    ("40626506856903.25", "$40,626,506,856,903.25", "+$40,626,506,856,903.25", "$40.63 trillion",
     "+$40.63 trillion"),
    ("90071992547409.93", "$90,071,992,547,409.93", "+$90,071,992,547,409.93", "$90.07 trillion",
     "+$90.07 trillion"),
    ("123456789012345678.90", "$123,456,789,012,345,678.90", "+$123,456,789,012,345,678.90",
     "$123,456.79 trillion", "+$123,456.79 trillion"),
    ("-123456789012345678.90", "-$123,456,789,012,345,678.90", "-$123,456,789,012,345,678.90",
     "-$123,456.79 trillion", "-$123,456.79 trillion"),
)

SYNTHETIC_CHANGES = (
    {"id": "synthetic-weekend", "note": "A weekend between the last two records; the monthly base date "
     "2024-02-11 is a Sunday and the yearly base date 2023-03-11 a Saturday, so each comparison is the Friday "
     "before.",
     "records": R("2023-03-10 900.00", "2024-02-09 950.00", "2024-03-07 990.00", "2024-03-08 1000.00",
                  "2024-03-11 1012.34"),
     "latest": "2024-03-11",
     "daily": E("2024-03-08", 3, "12.34"), "monthly": E("2024-02-09", 2, "62.34", "2024-02-11"),
     "yearly": E("2023-03-10", 1, "112.34", "2023-03-11")},
    {"id": "synthetic-monday-holiday", "note": "Martin Luther King Jr. Day (Monday 2024-01-15) between the "
     "last two records, a negative daily change, and a yearly base date on the 2023 holiday (Monday "
     "2023-01-16).",
     "records": R("2023-01-13 500.00", "2023-12-15 600.00", "2024-01-12 650.00", "2024-01-16 640.50"),
     "latest": "2024-01-16",
     "daily": E("2024-01-12", 4, "-9.50"), "monthly": E("2023-12-15", 1, "40.50", "2023-12-16"),
     "yearly": E("2023-01-13", 3, "140.50", "2023-01-16")},
    {"id": "synthetic-thanksgiving", "note": "Thanksgiving (2023-11-23) between the last two records, a zero "
     "daily change, a monthly comparison on its base date, and a yearly base date on Thanksgiving 2022.",
     "records": R("2022-11-23 700.00", "2023-10-24 710.00", "2023-11-22 720.00", "2023-11-24 720.00"),
     "latest": "2023-11-24",
     "daily": E("2023-11-22", 2, "0.00"), "monthly": E("2023-10-24", 0, "10.00", "2023-10-24"),
     "yearly": E("2022-11-23", 1, "20.00", "2022-11-24")},
    {"id": "synthetic-christmas", "note": "Christmas (Monday 2023-12-25) and the weekend before it between the "
     "last two records; the yearly base date is the observed Christmas holiday of 2022 (Monday 2022-12-26).",
     "records": R("2022-12-23 300.00", "2023-11-24 310.00", "2023-12-22 320.00", "2023-12-26 319.00"),
     "latest": "2023-12-26",
     "daily": E("2023-12-22", 4, "-1.00"), "monthly": E("2023-11-24", 2, "9.00", "2023-11-26"),
     "yearly": E("2022-12-23", 3, "19.00", "2022-12-26")},
    {"id": "synthetic-new-year", "note": "New Year's Day (Monday 2024-01-01) between the last two records, a "
     "change of one cent down, and a yearly base date on the observed 2023 holiday (Monday 2023-01-02).",
     "records": R("2022-12-29 800.00", "2022-12-30 801.00", "2023-01-03 802.00", "2023-12-01 850.00",
                  "2023-12-22 860.00", "2023-12-26 861.11", "2023-12-29 870.00", "2024-01-02 869.99"),
     "latest": "2024-01-02",
     "daily": E("2023-12-29", 4, "-0.01"), "monthly": E("2023-12-01", 1, "19.99", "2023-12-02"),
     "yearly": E("2022-12-30", 3, "68.99", "2023-01-02")},
    {"id": "synthetic-march-31-common-year", "note": "A monthly change from March 31 in a common year: the "
     "base date is February 28, and the record of March 1 after it is not the comparison.",
     "records": R("2022-03-31 1000.00", "2023-02-27 1100.00", "2023-02-28 1110.00", "2023-03-01 1120.00",
                  "2023-03-30 1190.00", "2023-03-31 1200.00"),
     "latest": "2023-03-31",
     "daily": E("2023-03-30", 1, "10.00"), "monthly": E("2023-02-28", 0, "90.00", "2023-02-28"),
     "yearly": E("2022-03-31", 0, "200.00", "2022-03-31")},
    {"id": "synthetic-march-31-leap-year-weekend", "note": "A monthly change from March 31 in a leap year: the "
     "base date is February 29 (a Saturday), so the comparison is February 28 with a gap of one day.",
     "records": R("2019-03-29 2000.00", "2020-02-27 2100.00", "2020-02-28 2110.00", "2020-03-02 2120.00",
                  "2020-03-30 2190.00", "2020-03-31 2200.00"),
     "latest": "2020-03-31",
     "daily": E("2020-03-30", 1, "10.00"), "monthly": E("2020-02-28", 1, "90.00", "2020-02-29"),
     "yearly": E("2019-03-29", 2, "200.00", "2019-03-31")},
    {"id": "synthetic-march-31-leap-year-record", "note": "A monthly change from March 31 in a leap year with "
     "records on both February 28 and February 29: the comparison is February 29.",
     "records": R("2027-03-31 4000.00", "2028-02-28 4100.00", "2028-02-29 4110.00", "2028-03-30 4190.00",
                  "2028-03-31 4200.00"),
     "latest": "2028-03-31",
     "daily": E("2028-03-30", 1, "10.00"), "monthly": E("2028-02-29", 0, "90.00", "2028-02-29"),
     "yearly": E("2027-03-31", 0, "200.00", "2027-03-31")},
    {"id": "synthetic-yearly-from-february-29", "note": "A yearly change from February 29: the base date is "
     "February 28 of the year before, not March 1, which also has a record.",
     "records": R("2023-02-27 5000.00", "2023-02-28 5010.00", "2023-03-01 5020.00", "2024-01-26 5100.00",
                  "2024-01-29 5110.00", "2024-02-28 5190.00", "2024-02-29 5200.00"),
     "latest": "2024-02-29",
     "daily": E("2024-02-28", 1, "10.00"), "monthly": E("2024-01-29", 0, "90.00", "2024-01-29"),
     "yearly": E("2023-02-28", 0, "190.00", "2023-02-28")},
    {"id": "synthetic-december-31", "note": "A monthly change from December 31: the base date is November 30 "
     "(a Saturday after Thanksgiving), so the comparison is November 29; the record of December 2 is after "
     "the base date.",
     "records": R("2023-12-28 6000.00", "2023-12-29 6010.00", "2024-11-27 6100.00", "2024-11-29 6110.00",
                  "2024-12-02 6120.00", "2024-12-30 6190.00", "2024-12-31 6200.00"),
     "latest": "2024-12-31",
     "daily": E("2024-12-30", 1, "10.00"), "monthly": E("2024-11-29", 1, "90.00", "2024-11-30"),
     "yearly": E("2023-12-29", 2, "190.00", "2023-12-31")},
    {"id": "synthetic-january-31", "note": "A monthly change from January 31 goes back across the year end to "
     "December 31.",
     "records": R("2024-01-31 7000.00", "2024-12-30 7090.00", "2024-12-31 7100.00", "2025-01-30 7190.00",
                  "2025-01-31 7200.00"),
     "latest": "2025-01-31",
     "daily": E("2025-01-30", 1, "10.00"), "monthly": E("2024-12-31", 0, "100.00", "2024-12-31"),
     "yearly": E("2024-01-31", 0, "200.00", "2024-01-31")},
    {"id": "synthetic-may-31", "note": "A monthly change from May 31 to April 30, and a daily change of three "
     "cents down.",
     "records": R("2023-05-31 100.00", "2024-04-30 150.00", "2024-05-01 151.00", "2024-05-30 160.00",
                  "2024-05-31 159.97"),
     "latest": "2024-05-31",
     "daily": E("2024-05-30", 1, "-0.03"), "monthly": E("2024-04-30", 0, "9.97", "2024-04-30"),
     "yearly": E("2023-05-31", 0, "59.97", "2023-05-31")},
    {"id": "synthetic-march-29-common-year", "note": "A monthly change from March 29 in a common year: the base "
     "date is February 28.",
     "records": R("2022-03-29 10.00", "2023-02-28 20.00", "2023-03-28 30.00", "2023-03-29 40.00"),
     "latest": "2023-03-29",
     "daily": E("2023-03-28", 1, "10.00"), "monthly": E("2023-02-28", 0, "20.00", "2023-02-28"),
     "yearly": E("2022-03-29", 0, "30.00", "2022-03-29")},
    {"id": "synthetic-daily-gap-6", "note": "A daily gap of exactly the limit (6 days) is valid; there is no "
     "record on or before the monthly or yearly base date.",
     "records": R("2024-04-10 100.00", "2024-04-16 106.00"),
     "latest": "2024-04-16",
     "daily": E("2024-04-10", 6, "6.00"), "monthly": E(None, None, "no-comparison", "2024-03-16"),
     "yearly": E(None, None, "no-comparison", "2023-04-16")},
    {"id": "synthetic-daily-gap-7", "note": "A daily gap of one day more than the limit (7 days) is not valid; "
     "the comparison and the gap are still reported.",
     "records": R("2024-04-10 100.00", "2024-04-17 107.00"),
     "latest": "2024-04-17",
     "daily": E("2024-04-10", 7, "gap"), "monthly": E(None, None, "no-comparison", "2024-03-17"),
     "yearly": E(None, None, "no-comparison", "2023-04-17")},
    {"id": "synthetic-limit-from-case", "note": "The limit comes from the series (here 3 days), not a constant: "
     "a daily gap of 4 days is not valid.",
     "max_gap_days": 3,
     "records": R("2024-01-11 640.00", "2024-01-12 650.00", "2024-01-16 640.50"),
     "latest": "2024-01-16",
     "daily": E("2024-01-12", 4, "gap"), "monthly": E(None, None, "no-comparison", "2023-12-16"),
     "yearly": E(None, None, "no-comparison", "2023-01-16")},
    {"id": "synthetic-monthly-yearly-gap-6", "note": "Monthly and yearly gaps of exactly the limit (6 days from "
     "the comparison record to the base date) are valid; the records just after each base date are not the "
     "comparison.",
     "records": R("2023-05-09 100.00", "2023-05-16 101.00", "2024-04-09 200.00", "2024-04-16 201.00",
                  "2024-05-14 299.00", "2024-05-15 300.00"),
     "latest": "2024-05-15",
     "daily": E("2024-05-14", 1, "1.00"), "monthly": E("2024-04-09", 6, "100.00", "2024-04-15"),
     "yearly": E("2023-05-09", 6, "200.00", "2023-05-15")},
    {"id": "synthetic-monthly-yearly-gap-7", "note": "Monthly and yearly gaps of one day more than the limit (7 "
     "days) are not valid.",
     "records": R("2023-05-08 100.00", "2023-05-16 101.00", "2024-04-08 200.00", "2024-04-16 201.00",
                  "2024-05-14 299.00", "2024-05-15 300.00"),
     "latest": "2024-05-15",
     "daily": E("2024-05-14", 1, "1.00"), "monthly": E("2024-04-08", 7, "gap", "2024-04-15"),
     "yearly": E("2023-05-08", 7, "gap", "2023-05-15")},
    {"id": "synthetic-daily-comparison-not-published", "note": "The record before the latest record has no "
     "value: it is still the comparison (never read as zero), and the change is not published.",
     "records": R("2024-07-01 100.00", "2024-07-02 -", "2024-07-03 102.00"),
     "latest": "2024-07-03",
     "daily": E("2024-07-02", 1, "not-published"), "monthly": E(None, None, "no-comparison", "2024-06-03"),
     "yearly": E(None, None, "no-comparison", "2023-07-03")},
    {"id": "synthetic-trailing-unpublished", "note": "The last two records have no value: the latest record is "
     "the last one with a value (D2).",
     "records": R("2024-07-05 100.00", "2024-07-08 101.00", "2024-07-09 -", "2024-07-10 -"),
     "latest": "2024-07-08",
     "daily": E("2024-07-05", 3, "1.00"), "monthly": E(None, None, "no-comparison", "2024-06-08"),
     "yearly": E(None, None, "no-comparison", "2023-07-08")},
    {"id": "synthetic-monthly-comparison-not-published", "note": "The monthly comparison record (the last "
     "record on or before the base date) has no value.",
     "records": R("2024-06-14 -", "2024-07-12 110.00", "2024-07-15 111.00"),
     "latest": "2024-07-15",
     "daily": E("2024-07-12", 3, "1.00"), "monthly": E("2024-06-14", 1, "not-published", "2024-06-15"),
     "yearly": E(None, None, "no-comparison", "2023-07-15")},
    {"id": "synthetic-leading-unpublished", "note": "Only the last record has a value; the record before it "
     "has none.",
     "records": R("2024-08-01 -", "2024-08-02 500.00"),
     "latest": "2024-08-02",
     "daily": E("2024-08-01", 1, "not-published"), "monthly": E(None, None, "no-comparison", "2024-07-02"),
     "yearly": E(None, None, "no-comparison", "2023-08-02")},
    {"id": "synthetic-single-record", "note": "A single record: there is no comparison record, and the base "
     "dates are still reported.",
     "records": R("2024-09-03 100.00"),
     "latest": "2024-09-03",
     "daily": E(None, None, "no-comparison"), "monthly": E(None, None, "no-comparison", "2024-08-03"),
     "yearly": E(None, None, "no-comparison", "2023-09-03")},
    {"id": "synthetic-all-unpublished", "note": "No record has a value: there is no latest record.",
     "records": R("2024-09-03 -", "2024-09-04 -"),
     "latest": None, "daily": NONE, "monthly": NONE, "yearly": NONE},
    {"id": "synthetic-no-records", "note": "No records at all: there is no latest record.",
     "records": [],
     "latest": None, "daily": NONE, "monthly": NONE, "yearly": NONE},
    {"id": "synthetic-anomaly-latest", "note": "The latest record date is an anomaly date; the yearly change "
     "has no comparison record, which is checked first.",
     "records": R("2024-08-30 90.00", "2024-10-01 100.00", "2024-10-02 105.00"),
     "anomalies": [["2024-10-02", "Synthetic anomaly on the latest record date."]],
     "latest": "2024-10-02",
     "daily": E("2024-10-01", 1, "anomaly-latest"), "monthly": E("2024-08-30", 3, "anomaly-latest", "2024-09-02"),
     "yearly": E(None, None, "no-comparison", "2023-10-02")},
    {"id": "synthetic-anomaly-comparison", "note": "The daily comparison record date is an anomaly date; an "
     "anomaly on the monthly base date, which has no record (Labor Day), does not touch the monthly change.",
     "records": R("2024-08-30 90.00", "2024-10-01 100.00", "2024-10-02 105.00"),
     "anomalies": [["2024-09-02", "Synthetic anomaly on a date without a record."],
                   ["2024-10-01", "Synthetic anomaly on the daily comparison date."]],
     "latest": "2024-10-02",
     "daily": E("2024-10-01", 1, "anomaly-comparison"), "monthly": E("2024-08-30", 3, "15.00", "2024-09-02"),
     "yearly": E(None, None, "no-comparison", "2023-10-02")},
    {"id": "synthetic-order-no-comparison-first", "note": "D7 order: a single record on an anomaly date fails "
     "with no-comparison, not anomaly-latest.",
     "records": R("2024-09-03 100.00"),
     "anomalies": [["2024-09-03", "Synthetic anomaly on the only record."]],
     "latest": "2024-09-03",
     "daily": E(None, None, "no-comparison"), "monthly": E(None, None, "no-comparison", "2024-08-03"),
     "yearly": E(None, None, "no-comparison", "2023-09-03")},
    {"id": "synthetic-order-not-published-first", "note": "D7 order: the comparison has no value, the gap (11 "
     "days, across Veterans Day) is over the limit, and both dates are anomaly dates: the reason is "
     "not-published, with the gap still reported.",
     "records": R("2024-11-01 -", "2024-11-12 100.00"),
     "anomalies": [["2024-11-01", "Synthetic anomaly on the comparison date."],
                   ["2024-11-12", "Synthetic anomaly on the latest record date."]],
     "latest": "2024-11-12",
     "daily": E("2024-11-01", 11, "not-published"), "monthly": E(None, None, "no-comparison", "2024-10-12"),
     "yearly": E(None, None, "no-comparison", "2023-11-12")},
    {"id": "synthetic-order-gap-before-anomalies", "note": "D7 order: the gap is over the limit and both dates "
     "are anomaly dates: the reason is gap.",
     "records": R("2024-11-01 90.00", "2024-11-12 100.00"),
     "anomalies": [["2024-11-01", "Synthetic anomaly on the comparison date."],
                   ["2024-11-12", "Synthetic anomaly on the latest record date."]],
     "latest": "2024-11-12",
     "daily": E("2024-11-01", 11, "gap"), "monthly": E(None, None, "no-comparison", "2024-10-12"),
     "yearly": E(None, None, "no-comparison", "2023-11-12")},
    {"id": "synthetic-order-mixed", "note": "D7 order with every date an anomaly date: the daily change fails "
     "with anomaly-latest (before anomaly-comparison), the monthly change with gap (8 days), the yearly change "
     "with not-published.",
     "records": R("2023-11-10 -", "2024-10-04 80.00", "2024-11-08 90.00", "2024-11-12 100.00"),
     "anomalies": [["2023-11-10", "Synthetic anomaly A."], ["2024-10-04", "Synthetic anomaly B."],
                   ["2024-11-08", "Synthetic anomaly C."], ["2024-11-12", "Synthetic anomaly D."]],
     "latest": "2024-11-12",
     "daily": E("2024-11-08", 4, "anomaly-latest"), "monthly": E("2024-10-04", 8, "gap", "2024-10-12"),
     "yearly": E("2023-11-10", 2, "not-published", "2023-11-12")},
    {"id": "synthetic-large-values", "note": "Values above 2^53 cents: the daily change of one cent and the "
     "negative monthly change must be exact.",
     "records": R("2023-12-01 12345678901234.56", "2024-11-01 100000000000000.00", "2024-12-02 90071992547409.92",
                  "2024-12-03 90071992547409.93"),
     "latest": "2024-12-03",
     "daily": E("2024-12-02", 1, "0.01"), "monthly": E("2024-11-01", 2, "-9928007452590.07", "2024-11-03"),
     "yearly": E("2023-12-01", 2, "77726313646175.37", "2023-12-03")},
)

SYNTHETIC_PARTS = (
    {"id": "synthetic-parts", "note": "Differences up and down, a date where a part has no value, where a part "
     "has no record, where the total has no value or no record, an anomaly date with a difference (its text "
     "is the note) and one without, and large values.",
     "total": R("2024-01-02 100.00", "2024-01-03 100.00", "2024-01-04 100.05", "2024-01-05 100.00",
                "2024-01-08 100.00", "2024-01-09 -", "2024-01-11 100.00", "2024-01-12 100.00",
                "2024-01-16 40000000000000.00", "2024-01-17 50.00"),
     "held": R("2024-01-02 60.00", "2024-01-03 60.00", "2024-01-04 60.00", "2024-01-05 -", "2024-01-08 60.00",
               "2024-01-09 60.00", "2024-01-10 60.00", "2024-01-11 61.00", "2024-01-12 60.00",
               "2024-01-16 32000000000000.00", "2024-01-17 25.00"),
     "intragov": R("2024-01-02 40.00", "2024-01-03 40.03", "2024-01-04 40.00", "2024-01-05 40.00",
                   "2024-01-09 40.00", "2024-01-10 41.00", "2024-01-11 40.00", "2024-01-12 40.00",
                   "2024-01-16 7999999999999.99", "2024-01-17 25.00"),
     "anomalies": [["2024-01-11", "Synthetic: the parts exceed the total by $1.00."],
                   ["2024-01-12", "Synthetic: an anomaly date on which the parts equal the total."]],
     "hand": [("2024-01-03", "0.03", None), ("2024-01-04", "-0.05", None),
              ("2024-01-11", "1.00", "Synthetic: the parts exceed the total by $1.00."),
              ("2024-01-16", "-0.01", None)]},
    {"id": "synthetic-parts-start", "note": "The parts have no values at first, so only the last date is "
     "compared.",
     "total": R("2024-02-01 10.00", "2024-02-02 10.00", "2024-02-05 10.00"),
     "held": R("2024-02-01 -", "2024-02-02 -", "2024-02-05 6.00"),
     "intragov": R("2024-02-01 -", "2024-02-02 -", "2024-02-05 4.01"),
     "anomalies": [],
     "hand": [("2024-02-05", "0.01", None)]},
)

SYNTHETIC_MISSING = (
    ("synthetic-missing-all-published", "Every record has a value.",
     R("2024-03-01 1.00", "2024-03-04 2.00", "2024-03-05 3.00"), ("2024-03-01", 0, None, "2024-03-01")),
    ("synthetic-missing-all-unpublished", "No record has a value.",
     R("2024-03-01 -", "2024-03-04 -", "2024-03-05 -"), (None, 3, "2024-03-05", None)),
    ("synthetic-missing-start-unpublished", "The first records have no value.",
     R("2024-03-01 -", "2024-03-04 -", "2024-03-05 3.00", "2024-03-06 4.00"),
     ("2024-03-05", 2, "2024-03-04", "2024-03-05")),
    ("synthetic-missing-end-unpublished", "The last record has no value.",
     R("2024-03-01 1.00", "2024-03-04 2.00", "2024-03-05 -"), ("2024-03-01", 1, "2024-03-05", None)),
    ("synthetic-missing-alternate", "Values and records without a value alternate, ending with a value.",
     R("2024-03-01 1.00", "2024-03-04 -", "2024-03-05 3.00", "2024-03-06 -", "2024-03-07 5.00"),
     ("2024-03-01", 2, "2024-03-06", "2024-03-07")),
    ("synthetic-missing-alternate-unpublished-ends", "Records without a value and values alternate, starting and "
     "ending without a value.",
     R("2024-03-01 -", "2024-03-04 2.00", "2024-03-05 -", "2024-03-06 4.00", "2024-03-07 -"),
     ("2024-03-04", 3, "2024-03-07", None)),
    ("synthetic-missing-single-published", "A single record with a value.",
     R("2024-03-01 1.00"), ("2024-03-01", 0, None, "2024-03-01")),
    ("synthetic-missing-single-unpublished", "A single record without a value.",
     R("2024-03-01 -"), (None, 1, "2024-03-01", None)),
)

SYNTHETIC_RECENT = (
    {"id": "synthetic-recent-fewer-than-n", "note": "Fewer records than N: all of them, newest first.", "n": 30,
     "total": R("2024-04-01 100.00", "2024-04-02 101.00", "2024-04-03 102.00"),
     "held": R("2024-04-01 60.00", "2024-04-02 61.00", "2024-04-03 62.00"),
     "intragov": R("2024-04-01 40.00", "2024-04-02 40.00", "2024-04-03 40.00"),
     "hand": [("2024-04-03", "102.00", ("published", "62.00"), ("published", "40.00")),
              ("2024-04-02", "101.00", ("published", "61.00"), ("published", "40.00")),
              ("2024-04-01", "100.00", ("published", "60.00"), ("published", "40.00"))]},
    {"id": "synthetic-recent-part-states", "note": "The last 5 of 8 total records (one without a value), with parts "
     "published, not published, without a record in the middle and after their own last record; a held "
     "record after the total's last record is not used.", "n": 5,
     "total": R("2024-05-01 10.00", "2024-05-02 11.00", "2024-05-03 12.00", "2024-05-06 -", "2024-05-07 14.00",
                "2024-05-08 15.00", "2024-05-09 16.00", "2024-05-10 17.00"),
     "held": R("2024-05-01 6.00", "2024-05-02 6.50", "2024-05-03 7.00", "2024-05-06 8.00", "2024-05-07 -",
               "2024-05-08 9.00", "2024-05-09 9.50", "2024-05-10 -", "2024-05-13 11.00"),
     "intragov": R("2024-05-01 4.00", "2024-05-02 4.10", "2024-05-03 4.20", "2024-05-07 4.70", "2024-05-08 -"),
     "hand": [("2024-05-10", "17.00", ("not-published", None), ("no-record", None)),
              ("2024-05-09", "16.00", ("published", "9.50"), ("no-record", None)),
              ("2024-05-08", "15.00", ("published", "9.00"), ("not-published", None)),
              ("2024-05-07", "14.00", ("not-published", None), ("published", "4.70")),
              ("2024-05-06", None, ("published", "8.00"), ("no-record", None))]},
)

SYNTHETIC_CHARTS = (
    {"id": "synthetic-chart-leading-unpublished", "note": "Records before the first value are left out; "
     "documented gaps before the first point, on the first and last point dates, on a date with a record, and "
     "after the last point add nothing; the one inside without a record (2024-01-08) adds a gap point; the "
     "weekend adds nothing.",
     "records": R("2024-01-02 -", "2024-01-03 -", "2024-01-04 10.00", "2024-01-05 -", "2024-01-09 12.00",
                  "2024-01-10 13.00"),
     "known_gaps": ["2024-01-01", "2024-01-03", "2024-01-04", "2024-01-08", "2024-01-09", "2024-01-10",
                    "2024-01-11"],
     "window": None,
     "hand": [["2024-01-04", "10.00"], ["2024-01-05", None], ["2024-01-08", None], ["2024-01-09", "12.00"],
              ["2024-01-10", "13.00"]]},
    {"id": "synthetic-chart-trailing-unpublished", "note": "Records without a value after the last value are "
     "kept as gap points, and a documented gap before them adds a gap point.",
     "records": R("2024-02-01 20.00", "2024-02-02 21.00", "2024-02-06 -", "2024-02-07 -"),
     "known_gaps": ["2024-02-05", "2024-02-07", "2024-02-08"],
     "window": None,
     "hand": [["2024-02-01", "20.00"], ["2024-02-02", "21.00"], ["2024-02-05", None], ["2024-02-06", None],
              ["2024-02-07", None]]},
    {"id": "synthetic-chart-twelve-months-february-29", "note": "The twelve-month window starts at the yearly "
     "base date of the latest record date 2024-02-29 (D2; the record after it has no value), which is "
     "2023-02-28: that record is kept and the ones before it are left out, with the documented gaps.",
     "records": R("2023-02-24 30.00", "2023-02-27 31.00", "2023-02-28 32.00", "2023-03-01 33.00",
                  "2023-03-03 34.00", "2023-09-01 35.00", "2024-02-28 36.00", "2024-02-29 37.00",
                  "2024-03-01 -"),
     "known_gaps": ["2023-02-27", "2023-03-02", "2023-09-01", "2024-03-04"],
     "window": "twelve-months",
     "hand": [["2023-02-28", "32.00"], ["2023-03-01", "33.00"], ["2023-03-02", None], ["2023-03-03", "34.00"],
              ["2023-09-01", "35.00"], ["2024-02-28", "36.00"], ["2024-02-29", "37.00"], ["2024-03-01", None]]},
    {"id": "synthetic-chart-twelve-months-weekend", "note": "The twelve-month window start 2023-06-10 is a "
     "Saturday without a record: the chart starts at the next record, leaving out the series' first value.",
     "records": R("2023-06-09 1.00", "2023-06-12 2.00", "2024-06-10 3.00"),
     "known_gaps": ["2023-06-09", "2023-06-13"],
     "window": "twelve-months",
     "hand": [["2023-06-12", "2.00"], ["2023-06-13", None], ["2024-06-10", "3.00"]]},
    {"id": "synthetic-chart-plain", "note": "Every record has a value and there are no documented gaps: one "
     "point per record, nothing for the weekend.",
     "records": R("2024-03-01 1.00", "2024-03-04 2.00", "2024-03-05 3.00"),
     "known_gaps": [],
     "window": None,
     "hand": [["2024-03-01", "1.00"], ["2024-03-04", "2.00"], ["2024-03-05", "3.00"]]},
    {"id": "synthetic-chart-single-point", "note": "A single record with a value after one without: one point, "
     "and a documented gap on its date adds nothing.",
     "records": R("2024-03-01 -", "2024-03-04 5.00"),
     "known_gaps": ["2024-03-04"],
     "window": None,
     "hand": [["2024-03-04", "5.00"]]},
)


# Fixture cases (rows copied from the fixture data)

FIXTURE_NOTE = "Fixture data (test data, never a publication), rows copied exactly"


def fixture_changes():
    anomalies = registry_anomalies()
    cases = []
    for series in SERIES:
        end = FIXTURE_LAST_PERIOD[series]
        cases.append({"id": f"fixture-latest-{series}", "series": series,
                      "note": f"{FIXTURE_NOTE}: {series} records from 2025-11-01 through its last record {end}. The "
                              "TypeScript test compares these results with the same computation on the full fixture "
                              "series.",
                      "records": fixture_rows(series, "2025-11-01", end), "anomalies": anomalies})
    for end, what in (("2025-08-04", "the latest record date is the anomaly date 2025-08-04"),
                      ("2025-08-05", "the daily comparison is the anomaly date 2025-08-04"),
                      ("2025-09-04", "the monthly comparison is the anomaly date 2025-08-04")):
        cases.append({"id": f"fixture-anomaly-2025-08-04-to-{end}", "series": "debt-total",
                      "note": f"{FIXTURE_NOTE}: debt-total records from 2024-07-01 through {end}; {what}.",
                      "records": fixture_rows("debt-total", "2024-07-01", end), "anomalies": anomalies})
    for end, what in (("2011-02-01", "the latest record date is the anomaly date 2011-02-01"),
                      ("2011-03-01", "the monthly comparison is the anomaly date 2011-02-01")):
        cases.append({"id": f"fixture-anomaly-2011-02-01-to-{end}", "series": "debt-total",
                      "note": f"{FIXTURE_NOTE}: debt-total records from 2010-01-04 through {end}; {what}.",
                      "records": fixture_rows("debt-total", "2010-01-04", end), "anomalies": anomalies})
    cases.append({"id": "fixture-gap-2019-04-03", "series": "debt-total",
                  "note": f"{FIXTURE_NOTE}: debt-total records from 2018-03-01 through 2019-04-04; the documented gap "
                          "2019-04-03 has no record, so the daily comparison is 2019-04-02 (a gap of 2 days).",
                  "records": fixture_rows("debt-total", "2018-03-01", "2019-04-04"), "anomalies": anomalies})
    cases.append({"id": "fixture-held-public-start-1997", "series": "debt-held-public",
                  "note": f"{FIXTURE_NOTE}: debt-held-public records from 1997-09-22 through 1997-10-09, where only "
                          "1997-09-30 has a value; the daily comparison has no value and the monthly and yearly base "
                          "dates are before the first record of the case.",
                  "records": fixture_rows("debt-held-public", "1997-09-22", "1997-10-09"), "anomalies": anomalies})
    return cases


# Hand expectations for the fixture change cases, worked out from the dates alone (reasons,
# comparison dates and gaps; the values come from the data).
FIXTURE_HAND = {
    "fixture-anomaly-2025-08-04-to-2025-08-04": {
        "daily": ("2025-08-01", 3, "anomaly-latest"), "monthly": ("2025-07-03", 1, "anomaly-latest"),
        "yearly": ("2024-08-02", 2, "anomaly-latest")},
    "fixture-anomaly-2025-08-04-to-2025-08-05": {
        "daily": ("2025-08-04", 1, "anomaly-comparison"), "monthly": ("2025-07-03", 2, None),
        "yearly": ("2024-08-05", 0, None)},
    "fixture-anomaly-2025-08-04-to-2025-09-04": {
        "daily": ("2025-09-03", 1, None), "monthly": ("2025-08-04", 0, "anomaly-comparison"),
        "yearly": ("2024-09-04", 0, None)},
    "fixture-anomaly-2011-02-01-to-2011-02-01": {
        "daily": ("2011-01-31", 1, "anomaly-latest"), "monthly": ("2010-12-31", 1, "anomaly-latest"),
        "yearly": ("2010-02-01", 0, "anomaly-latest")},
    "fixture-anomaly-2011-02-01-to-2011-03-01": {
        "daily": ("2011-02-28", 1, None), "monthly": ("2011-02-01", 0, "anomaly-comparison"),
        "yearly": ("2010-03-01", 0, None)},
    "fixture-gap-2019-04-03": {
        "daily": ("2019-04-02", 2, None), "monthly": ("2019-03-04", 0, None), "yearly": ("2018-04-04", 0, None)},
    "fixture-held-public-start-1997": {
        "daily": ("1997-09-29", 1, "not-published"), "monthly": (None, None, "no-comparison"),
        "yearly": (None, None, "no-comparison")},
    "fixture-latest-debt-total": {
        "daily": ("2026-11-20", 3, None), "monthly": ("2026-10-23", 0, None), "yearly": ("2025-11-21", 2, None)},
    "fixture-latest-debt-held-public": {
        "daily": ("2026-11-20", 3, None), "monthly": ("2026-10-23", 0, None), "yearly": ("2025-11-21", 2, None)},
    "fixture-latest-debt-intragov": {
        "daily": ("2026-11-12", 1, None), "monthly": ("2026-10-13", 0, None), "yearly": ("2025-11-13", 0, None)},
}

PARTS_RANGES = (("2011-01-31", "2011-02-02"), ("2019-12-30", "2020-01-02"), ("2025-08-01", "2025-08-05"),
                ("2026-11-06", "2026-11-16"))


def fixture_parts():
    rows = {series: [] for series in SERIES}
    for start, end in PARTS_RANGES:
        for series in SERIES:
            rows[series].extend(fixture_rows(series, start, end))
    ranges = ", ".join(f"{start} to {end}" for start, end in PARTS_RANGES)
    return {"id": "fixture-parts", "note": f"{FIXTURE_NOTE}: the three series on {ranges} (each series' own rows), "
            "with the registry anomalies. Every date whose difference is not zero is listed, in the registry or "
            "not; debt-intragov has no records after 2026-11-13.",
            "total": rows["debt-total"], "held": rows["debt-held-public"], "intragov": rows["debt-intragov"],
            "anomalies": registry_anomalies()}


def fixture_recent():
    total = fixture_rows("debt-total", "2025-11-01", FIXTURE_LAST_PERIOD["debt-total"])[-31:]
    dates = {day for day, _ in total}
    start, end = total[0][0], total[-1][0]
    held = [row for row in fixture_rows("debt-held-public", start, end) if row[0] in dates]
    intragov = [row for row in fixture_rows("debt-intragov", start, end) if row[0] in dates]
    return {"id": "fixture-recent", "note": f"{FIXTURE_NOTE}: the last 31 debt-total records ({start} to {end}) and "
            "the debt-held-public and debt-intragov rows of the same dates; N is 30, and debt-intragov has no "
            "record after its last record 2026-11-13.", "n": 30, "total": total, "held": held, "intragov": intragov}


def fixture_missing():
    return [
        {"id": "fixture-missing-held-public-2005", "note": f"{FIXTURE_NOTE}: debt-held-public 2005-03-24 to "
         "2005-04-08, where the values start on 2005-03-31 (the documented gap 2005-04-01 has no record).",
         "records": fixture_rows("debt-held-public", "2005-03-24", "2005-04-08"),
         "hand": ("2005-03-31", 5, "2005-03-30", "2005-03-31")},
        {"id": "fixture-missing-held-public-1997", "note": f"{FIXTURE_NOTE}: debt-held-public 1997-09-22 to "
         "1997-10-09, where only 1997-09-30 has a value.",
         "records": fixture_rows("debt-held-public", "1997-09-22", "1997-10-09"),
         "hand": ("1997-09-30", 13, "1997-10-09", None)},
    ]


def fixture_charts():
    gaps = list(REGISTRY_KNOWN_GAPS)
    return [
        {"id": "fixture-chart-gap-2019-04-03", "note": f"{FIXTURE_NOTE}: debt-total 2019-03-25 to 2019-04-12 with "
         "the 18 documented gaps of the registry: the documented gap 2019-04-03 adds a gap point.",
         "records": fixture_rows("debt-total", "2019-03-25", "2019-04-12"), "known_gaps": gaps, "window": None,
         "hand_gaps": ["2019-04-03"]},
        {"id": "fixture-chart-held-public-2005", "note": f"{FIXTURE_NOTE}: debt-held-public 2005-03-24 to "
         "2005-04-08 with the 18 documented gaps: the records before the first value (2005-03-31) are left out "
         "and the documented gap 2005-04-01 adds a gap point.",
         "records": fixture_rows("debt-held-public", "2005-03-24", "2005-04-08"), "known_gaps": gaps,
         "window": None, "hand_gaps": ["2005-04-01"]},
        {"id": "fixture-chart-twelve-months", "note": f"{FIXTURE_NOTE}: debt-total from 2025-11-01 through "
         "2026-11-23 with the 18 documented gaps and the twelve-month window, which starts at 2025-11-23.",
         "records": fixture_rows("debt-total", "2025-11-01", "2026-11-23"), "known_gaps": gaps,
         "window": "twelve-months", "hand_gaps": []},
    ]


# Building the fixture

def plain(records):
    return [[day, value] for day, value in records]


def build_base_dates():
    rows = []
    for day, months, hand in BASE_DATES:
        base = base_date(day, months)
        year, month, _ = parse_date(base)
        check(calendar.monthrange(year, month)[1] == days_in_month(year, month), f"D4 {base}: days in month")
        check(base == base_date_by_calendar(day, months) == hand, f"D4 {day} {months}: {base}, hand {hand}")
        rows.append({"date": day, "months": months, "base": base})
    return rows


def build_days_between():
    rows = []
    for start, end, hand in DAYS_BETWEEN:
        days = days_between(start, end)
        check(days == (date.fromisoformat(end) - date.fromisoformat(start)).days == hand,
              f"D5 {start} to {end}: {days}, hand {hand}")
        rows.append({"from": start, "to": end, "days": days})
    return rows


def build_amounts():
    rows = []
    for value, exact, exact_signed, rounded, rounded_signed in AMOUNTS:
        got = {"value": value, "exact": exact_display(value), "exact_signed": exact_display(value, True),
               "rounded": rounded_display(value), "rounded_signed": rounded_display(value, True)}
        hand = {"value": value, "exact": exact, "exact_signed": exact_signed, "rounded": rounded,
                "rounded_signed": rounded_signed}
        check(got == hand, f"D9/D10 {value}: {got} against the hand values {hand}")
        check_exact_display(value)
        check_rounded_display(value)
        rows.append(got)
    return rows


def change_case(case_id, note, records, anomalies, max_gap, where):
    validate_records(records, where)
    output = {"id": case_id, "note": note, "records": plain(records), "anomalies": [list(a) for a in anomalies],
              "max_gap_days": max_gap}
    for kind, months in KINDS:
        got = change_result(records, months, anomalies, max_gap)
        check_change(records, months, anomalies, max_gap, got, f"{where} {kind}")
        output[kind] = got
    return output


def build_changes():
    cases = []
    for spec in SYNTHETIC_CHANGES:
        anomalies = spec.get("anomalies", [])
        out = change_case(spec["id"], spec["note"], spec["records"], anomalies, spec.get("max_gap_days", 6),
                          spec["id"])
        for kind, _ in KINDS:
            hand = dict(spec[kind], latest=spec["latest"], valid=spec[kind]["reason"] is None)
            check(out[kind] == hand, f"{spec['id']} {kind}: {out[kind]} against the hand values {hand}")
        cases.append(out)
    for spec in fixture_changes():
        out = change_case(spec["id"], spec["note"], spec["records"], spec["anomalies"], REGISTRY_MAX_GAP, spec["id"])
        series = spec["series"]
        for kind, _ in KINDS:
            comparison, gap, reason = FIXTURE_HAND[spec["id"]][kind]
            got = out[kind]
            check((got["comparison"], got["gap_days"], got["reason"]) == (comparison, gap, reason),
                  f"{spec['id']} {kind}: {got} against the hand values {(comparison, gap, reason)}")
            if spec["id"].startswith("fixture-latest-"):
                # The slice is contiguous and ends at the series' last record, so a comparison found in
                # it is the comparison on the full series.
                check(got["latest"] == FIXTURE_LAST_PERIOD[series] and got["comparison"] is not None,
                      f"{spec['id']} {kind}: the slice must hold every record the change looks at")
        cases.append(out)
    return cases


def build_parts():
    cases = []
    specs = [dict(spec) for spec in SYNTHETIC_PARTS] + [fixture_parts()]
    for spec in specs:
        for name in ("total", "held", "intragov"):
            validate_records(spec[name], f"{spec['id']} {name}")
        got = parts_differences(spec["total"], spec["held"], spec["intragov"], spec["anomalies"])
        check_parts(spec["total"], spec["held"], spec["intragov"], spec["anomalies"], got, spec["id"])
        if "hand" in spec:
            check([(row["period"], row["difference"], row["note"]) for row in got] == spec["hand"],
                  f"{spec['id']}: {got} against the hand values")
        cases.append({"id": spec["id"], "note": spec["note"], "total": plain(spec["total"]),
                      "held": plain(spec["held"]), "intragov": plain(spec["intragov"]),
                      "anomalies": [list(a) for a in spec["anomalies"]], "expected": got})
    return cases


def build_missing():
    cases = []
    specs = [{"id": case_id, "note": note, "records": records, "hand": hand}
             for case_id, note, records, hand in SYNTHETIC_MISSING] + fixture_missing()
    for spec in specs:
        validate_records(spec["records"], spec["id"])
        got = missing_values(spec["records"])
        check_missing(spec["records"], got, spec["id"])
        hand = dict(zip(("first_published", "not_published", "last_not_published", "daily_from"), spec["hand"]))
        check(got == hand, f"{spec['id']}: {got} against the hand values {hand}")
        cases.append({"id": spec["id"], "note": spec["note"], "records": plain(spec["records"]), "expected": got})
    return cases


def build_recent():
    cases = []
    for spec in list(SYNTHETIC_RECENT) + [fixture_recent()]:
        for name in ("total", "held", "intragov"):
            validate_records(spec[name], f"{spec['id']} {name}")
        check(spec["n"] >= 1, f"{spec['id']}: N is at least 1")
        got = recent_records(spec["total"], spec["held"], spec["intragov"], spec["n"])
        check_recent(spec["total"], spec["held"], spec["intragov"], spec["n"], got, spec["id"])
        if "hand" in spec:
            hand = [{"period": day, "total": total, "held": {"state": held[0], "value": held[1]},
                     "intragov": {"state": intragov[0], "value": intragov[1]}}
                    for day, total, held, intragov in spec["hand"]]
            check(got == hand, f"{spec['id']}: {got} against the hand values")
        else:
            check(len(got) == 30 and got[0]["period"] == "2026-11-23" and got[-1]["period"] == "2026-10-09",
                  f"{spec['id']}: the last 30 debt-total records")
            no_record = [row["period"] for row in got if row["intragov"]["state"] == "no-record"]
            check(no_record == ["2026-11-23", "2026-11-20", "2026-11-19", "2026-11-18", "2026-11-17", "2026-11-16"],
                  f"{spec['id']}: debt-intragov has no record after 2026-11-13")
        cases.append({"id": spec["id"], "note": spec["note"], "n": spec["n"], "total": plain(spec["total"]),
                      "held": plain(spec["held"]), "intragov": plain(spec["intragov"]), "expected": got})
    return cases


def build_charts():
    cases = []
    for spec in list(SYNTHETIC_CHARTS) + fixture_charts():
        validate_records(spec["records"], spec["id"])
        for day in spec["known_gaps"]:
            parse_date(day)
        check(len(set(spec["known_gaps"])) == len(spec["known_gaps"]), f"{spec['id']}: documented gaps listed once")
        window_start, got = chart_points(spec["records"], spec["known_gaps"], spec["window"])
        check_chart(spec["records"], spec["known_gaps"], spec["window"], window_start, got, spec["id"])
        if "hand" in spec:
            check(got == spec["hand"], f"{spec['id']}: {got} against the hand values")
        else:
            values = dict(spec["records"])
            check([day for day, value in got if day not in values] == spec["hand_gaps"],
                  f"{spec['id']}: documented gap points")
        cases.append({"id": spec["id"], "note": spec["note"], "records": plain(spec["records"]),
                      "known_gaps": list(spec["known_gaps"]), "window": spec["window"],
                      "window_start": window_start, "expected": got})
    return cases


def check_spec_examples(parts):
    """The examples written in the rules, restated."""
    check(exact_display("40626506856903.25") == "$40,626,506,856,903.25", "D9 example")
    check([rounded_display(v) for v in ("40626506856903.25", "7785120713478.45", "2000000000.00")]
          == ["$40.63 trillion", "$7.79 trillion", "$2.00 billion"], "D10 examples")
    check(rounded_display("999999999999.99") == "$1,000.00 billion", "D10 scale before rounding")
    check(exact_display("0.00", True) == "$0.00" and exact_display("-0.03", True) == "-$0.03", "D9 signs")
    check([decimal_text(cents(a) - cents(b)) for a, b in (("2000000000.01", "0.01"), ("0.00", "0.03"),
                                                            ("5.00", "5.00"))]
          == ["2000000000.00", "-0.03", "0.00"], "D8 examples")
    check(base_date("2024-03-31", 1) == "2024-02-29" and base_date("2023-03-31", 1) == "2023-02-28"
          and base_date("2024-02-29", 12) == "2023-02-28", "D4 examples")
    check([day for day, _ in registry_anomalies()] == ["2011-02-01", "2025-08-04"], "D6 v0.8 anomaly dates")
    # The registry texts state the parts' excess over the total; the fixture rows agree (D11).
    fixture = next(case for case in parts if case["id"] == "fixture-parts")
    differences = {row["period"]: row for row in fixture["expected"]}
    for day, text in registry_anomalies():
        row = differences[day]
        check(row["note"] == text and f"by {exact_display(row['difference'])}." in text,
              f"D11 {day}: the difference {row['difference']} against the registry text")
    check(cents("40626506856903.25") == 4062650685690325, "D1 parse")
    for bad in ("1.5", "1", "1.000", "", " 1.00", "1,000.00", "+1.00", "1.00 ", None):
        try:
            cents(bad)
        except ValueError:
            check(True, "D1 error")
        else:
            check(False, f"D1: {bad!r} must be an error")


def main():
    check_fixture_blocks()
    content = {
        "generator": GENERATOR,
        "rules": RULES,
        "base_dates": build_base_dates(),
        "days_between": build_days_between(),
        "amounts": build_amounts(),
        "changes": build_changes(),
        "parts": build_parts(),
        "missing": build_missing(),
        "recent": build_recent(),
        "chart": build_charts(),
    }
    check_spec_examples(content["parts"])
    ids = [case["id"] for name in ("changes", "parts", "missing", "recent", "chart") for case in content[name]]
    check(len(ids) == len(set(ids)), "case ids are unique")
    text = json.dumps(content, indent=2, ensure_ascii=False) + "\n"
    check(json.loads(text) == content, "the JSON reads back")
    FIXTURE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(FIXTURE_FILE, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    counts = ", ".join(f"{len(content[name])} {name.replace('_', ' ')}" for name in
                       ("base_dates", "days_between", "amounts", "changes", "parts", "missing", "recent", "chart"))
    print(f"econ-debt.json: {counts}; {CHECKS[0]:,} self-checks passed; {len(text.encode('utf-8')):,} bytes")


if __name__ == "__main__":
    main()
