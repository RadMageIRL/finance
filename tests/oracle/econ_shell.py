"""Independent reference oracle for the display rules of the shared dashboard shell (brief Q,
agent 4): the rules T1 to T7 of src/lib/data/shell-text.ts, S1 to S5 of src/lib/data/status.ts
and C1 to C8 of src/lib/data/line-chart.ts, as written in plain English at the top of those
modules. It is written from those rules alone, with the Python standard library: exact
decimals (decimal.Decimal and integers), calendar dates (datetime.date) and no shared code.

Run from the repository root (tests/oracle/generate.py also runs it):

    python -I tests/oracle/econ_shell.py

It writes tests/oracle/fixtures/econ-shell.json from the cases embedded below; the unit tests
in tests/unit/data/shell/ compare the TypeScript modules with it. The cases are test inputs,
never data: no case is presented as an observation of any series.
"""

import json
import math
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "econ-shell.json"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
SHORT = [m[:3] for m in MONTHS]
EPOCH = date(1970, 1, 1).toordinal()


# ---- helpers ------------------------------------------------------------------------------

def is_decimal(s):
    return isinstance(s, str) and re.fullmatch(r"-?\d+(\.\d+)?", s) is not None


def group(s):
    """Groups the whole part of an unsigned decimal string by commas, keeping the fraction."""
    whole, _, frac = s.partition(".")
    out = "{:,}".format(int(whole))
    return out + ("." + frac if frac else "")


def day_words(iso):
    y, m, d = (int(p) for p in iso.split("-"))
    return "%s %d, %d" % (MONTHS[m - 1], d, y)


def month_words(iso):
    y, m = (int(p) for p in iso.split("-"))
    return "%s %d" % (MONTHS[m - 1], y)


def plain(d):
    """A Decimal as a plain string without exponent and without trailing fractional zeros."""
    text = format(d, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    if text in ("-0", ""):
        text = "0"
    return text


# ---- T1 to T7 -----------------------------------------------------------------------------

def value_text(value, unit):
    negative = Decimal(value) < 0
    magnitude = value[1:] if value.startswith("-") else value
    sign = "-" if negative else ""
    if unit == "Percent":
        return sign + magnitude + " percent"
    if unit == "U.S. dollars":
        return sign + "$" + group(magnitude)
    if unit.startswith("Billions of U.S. dollars"):
        return sign + "$" + group(magnitude) + " billion"
    return sign + group(magnitude) + " (" + unit + ")"


def range_text(lower, upper, unit):
    if unit == "Percent":
        return lower + " to " + upper + " percent"
    return value_text(lower, unit) + " to " + value_text(upper, unit)


def period_text(frequency, period):
    if frequency == "business-day":
        return "Business day of " + day_words(period)
    if frequency == "month":
        return month_words(period)
    if frequency == "change-point":
        return "In effect from " + day_words(period)
    return month_words(period) if re.fullmatch(r"\d{4}-\d{2}", period) else day_words(period)


def time_text(t):
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})Z", t)
    seconds = "" if m.group(4) == "00" else ":" + m.group(4)
    return "%s at %s:%s%s UTC" % (day_words(m.group(1)), m.group(2), m.group(3), seconds)


def snapshot_text(snapshot_id):
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z", snapshot_id)
    if not m:
        return snapshot_id
    return time_text("%s-%s-%sT%s:%s:%sZ" % m.groups())


def release_text(basis, day):
    if not day or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        return "Release date not recorded"
    if basis == "rule":
        return "Publication day by the New York Fed's schedule: " + day_words(day)
    if basis == "calendar":
        return "Released in the H.6 release of " + day_words(day)
    if basis == "first-seen":
        return "First seen by RadMage Finance on " + day_words(day) + " (Eastern Time date)"
    return "Release date not recorded"


def compare(a, b):
    x, y = Decimal(a), Decimal(b)
    return (x > y) - (x < y)


# ---- S1 to S5 -----------------------------------------------------------------------------

def is_time(t):
    return isinstance(t, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", t) is not None


def view_status(series, now):
    status = series["status"]
    if status in ("held", "frozen", "not-yet-published", "stale"):
        return status
    if status != "fresh":
        return "unknown"
    if is_time(series["stale_at"]) and now >= series["stale_at"]:
        return "stale"
    if is_time(series["deadline"]) and now > series["deadline"]:
        return "due"
    return "fresh"


LABELS = {
    "fresh": "Up to date", "due": "Update pending", "stale": "May be out of date",
    "held": "Held for review", "frozen": "Updates paused", "not-yet-published": "No data yet",
    "unknown": "Status unknown",
}


def status_sentence(kind, series):
    deadline = time_text(series["deadline"]) if is_time(series["deadline"]) else None
    reason = (series["status_reason"] or "").strip() or None
    if kind == "fresh":
        return "Up to date. Next value expected by %s." % deadline if deadline else "Up to date."
    if kind == "due":
        if deadline:
            return "Update pending: the next value was expected by %s and is not in this data yet." % deadline
        return "Update pending: the next expected value is not in this data yet."
    if kind == "stale":
        return "May be out of date: the next value was expected by %s." % deadline if deadline else "May be out of date."
    if kind == "held":
        return "New data from the source is waiting for review; the values shown are the last accepted ones."
    if kind == "frozen":
        if reason is None:
            return "Updates are paused after a review decision."
        ended = reason if reason[-1] in ".!?" else reason + "."
        if reason.startswith("rolled back"):
            return "Updates are paused after a rollback: " + ended
        return "Updates are paused after a review decision: " + ended
    if kind == "not-yet-published":
        return "No data published yet."
    return "The status of this series is not recognized."


def page_state(source, kinds):
    if source is None:
        return "unavailable"
    if source == "fixture":
        return "fixture"
    return "stale" if "stale" in kinds else "current"


def refresh(build, status, body):
    if status != 200 or not isinstance(body, dict):
        return "failed"
    snap = body.get("snapshot")
    sid = snap.get("id") if isinstance(snap, dict) else None
    if not isinstance(sid, str) or not re.fullmatch(r"\d{8}T\d{6}Z", sid):
        return "failed"
    if sid == build:
        return "same"
    return "newer" if sid > build else "changed"


REFRESH_TEXT = {
    "same": "",
    "newer": "Newer data is available. Reload the page to see it.",
    "changed": "The published data has changed since this page was built. Reload the page to see it.",
    "failed": "Could not check for newer data. This page shows the data it was built with.",
}


# ---- C1 to C8 -----------------------------------------------------------------------------

def day_number(iso):
    y, m, d = (int(p) for p in iso.split("-"))
    return date(y, m, d).toordinal() - EPOCH


def day_of(n):
    return date.fromordinal(n + EPOCH).isoformat()


def month_number(iso):
    y, m = (int(p) for p in iso.split("-"))
    return y * 12 + m - 1


def month_of(n):
    return "%04d-%02d" % (n // 12, n % 12 + 1)


def pos(kind, period):
    return day_number(period) if kind == "day" else month_number(period)


def words(kind, n):
    return day_words(day_of(n)) if kind == "day" else month_words(month_of(n))


def value_axis(values, unit):
    """C2 and C3."""
    scale = max([len(v.split(".")[1]) if "." in v else 0 for v in values] or [0])
    units = [int((Decimal(v) * (Decimal(10) ** scale))) for v in values]
    lo = min([0] + units)
    hi = max([0] + units)
    if lo == hi:
        hi = lo + 1
    span = hi - lo
    step = None
    power = 1
    while step is None:
        for m in ([1, 2] + ([Decimal("2.5")] if power >= 10 else []) + [5]):
            candidate = int(m * power)
            if span <= 5 * candidate:
                step = candidate
                break
        power *= 10
    first = (lo // step) * step
    last = -((-hi) // step) * step
    ticks = [plain(Decimal(t) / (Decimal(10) ** scale)) for t in range(first, last + 1, step)]
    title, shift = unit, 0
    if unit == "U.S. dollars":
        top = max(abs(Decimal(t)) for t in ticks)
        if top >= Decimal(10) ** 12:
            title, shift = "Trillions of U.S. dollars", 12
        elif top >= Decimal(10) ** 9:
            title, shift = "Billions of U.S. dollars", 9
        elif top >= Decimal(10) ** 6:
            title, shift = "Millions of U.S. dollars", 6
    labels = []
    for t in ticks:
        d = Decimal(t) / (Decimal(10) ** shift)
        text = plain(abs(d))
        labels.append(("-" if d < 0 else "") + group(text))
    return {"ticks": ticks, "labels": labels, "title": title}


STEPS = [1, 3, 6, 12, 24, 60, 120, 240, 300, 600]


def period_labels(kind, first, last, most, ends):
    """C4: first and last are positions; ends the first and last points' positions."""
    def month_at(n):
        return month_number(day_of(n)[:7]) if kind == "day" else n

    def candidates(step):
        out = []
        for m in range(month_at(first), month_at(last) + 1):
            if step < 12:
                if m % step:
                    continue
            elif m % 12 or (m // 12) % (step // 12):
                continue
            at = day_number(month_of(m) + "-01") if kind == "day" else m
            if at < first or at > last:
                continue
            text = "%s %d" % (SHORT[m % 12], m // 12) if step < 12 else str(m // 12)
            out.append([at, text])
        return out

    chosen = None
    for step in STEPS:
        c = candidates(step)
        if len(c) <= most:
            chosen = c
            break
    if chosen is None:
        chosen = c
    if chosen:
        return chosen

    def end_word(n):
        if kind == "month":
            return "%s %d" % (SHORT[n % 12], n // 12)
        y, m, d = (int(p) for p in day_of(n).split("-"))
        return "%s %d, %d" % (SHORT[m - 1], d, y)

    if ends[0] == ends[1]:
        return [[ends[0], end_word(ends[0])]]
    return [[ends[0], end_word(ends[0])], [ends[1], end_word(ends[1])]]


def domain(kind, spec):
    ats = [pos(kind, p["x"]) for line in spec["lines"] for p in line["points"]]
    ats += [pos(kind, p["x"]) for band in spec.get("bands", []) for p in band["points"]]
    first, last = min(ats), max(ats)
    if first == last:
        first, last = first - 1, last + 1
    return first, last, min(ats), max(ats)


def column(at, first, last, columns=500):
    """C5 (500 drawing columns) and C6 (125 reading columns)."""
    return min(columns - 1, math.floor(((at - first) / (last - first)) * columns))


def keep(points, first, last, columns):
    """C5 and C6: per column, every point when there are at most two, otherwise the lowest and
    the highest value (the earliest point on a tie). `points` are (position, value) pairs."""
    groups = {}
    for at, y in sorted(points, key=lambda t: t[0]):
        groups.setdefault(column(at, first, last, columns), []).append((at, y))
    out = set()
    for group in groups.values():
        if len(group) <= 2:
            out.update(group)
            continue
        low = high = group[0]
        for at, y in group:
            if Decimal(y) < Decimal(low[1]):
                low = (at, y)
            if Decimal(y) > Decimal(high[1]):
                high = (at, y)
        out.update([low, high])
    return sorted(out, key=lambda t: t[0])


def keep_with_ends(points, first, last, columns):
    """C5 and C6: the kept points plus the first and the last point (by period)."""
    if not points:
        return []
    ordered = sorted(points, key=lambda t: t[0])
    return sorted(set(keep(ordered, first, last, columns)) | {ordered[0], ordered[-1]}, key=lambda t: t[0])


def reading_points(kind, points, first, last):
    """C6: over 125 reading columns, ignoring nulls, with the first and last values."""
    pts = [(pos(kind, p["x"]), p["y"]) for p in points if p["y"] is not None]
    return {at for at, _ in keep_with_ends(pts, first, last, 125)}


def kept_runs(kind, points, first, last):
    """C5: runs split at nulls; per column the lowest and the highest (earliest on a tie)."""
    pts = sorted(((pos(kind, p["x"]), p["y"]) for p in points), key=lambda t: t[0])
    runs, run = [], []
    for at, y in pts:
        if y is None:
            if run:
                runs.append(run)
            run = []
        else:
            run.append((at, y))
    if run:
        runs.append(run)
    return [keep_with_ends(r, first, last, 500) for r in runs]


def named(series):
    """C6: a derived series gets " (derived)" unless its label already says derived."""
    if series["kind"] == "derived" and "derived" not in series["label"].lower():
        return series["label"] + " (derived)"
    return series["label"]


def chart_reading(spec):
    """C6 and C7: the reading positions and the readout at each."""
    kind, unit = spec["periodKind"], spec["unitLabel"]
    first, last, _, _ = domain(kind, spec)
    nav = set()
    for line in spec["lines"]:
        if line["shape"] == "line":
            nav.update(reading_points(kind, line["points"], first, last))
    if not nav:
        nav.update(pos(kind, p["x"]) for line in spec["lines"] for p in line["points"])
        nav.update(pos(kind, p["x"]) for band in spec.get("bands", []) for p in band["points"])
    nav = sorted(nav)

    def in_effect(points, at):
        found = None
        for p in sorted(points, key=lambda q: pos(kind, q["x"])):
            if pos(kind, p["x"]) <= at:
                found = p
        return found

    readouts = []
    for at in nav:
        rows = []
        for line in spec["lines"]:
            label = named(line)
            if line["shape"] == "line":
                hit = [p for p in line["points"] if pos(kind, p["x"]) == at]
                if not hit:
                    continue
                y = hit[0]["y"]
                rows.append([label, "Not available" if y is None else value_text(y, unit)])
            else:
                p = in_effect(line["points"], at)
                if p is not None and p["y"] is not None:
                    rows.append([label, value_text(p["y"], unit)])
        for band in spec.get("bands", []):
            label = named(band)
            p = in_effect(band["points"], at)
            if p is not None:
                rows.append([label, range_text(p["lower"], p["upper"], unit)])
        readouts.append({"period": words(kind, at), "rows": rows})
    return {"first": first, "last": last, "nav": nav, "readouts": readouts}


def annotate(kind, first, last, annotations):
    """C10: numbered in period order (given order on a tie), marked when inside the domain."""
    ordered = sorted(enumerate(annotations), key=lambda t: (pos(kind, t[1]["x"]), t[0]))
    out = []
    for n, (_, a) in enumerate(ordered, start=1):
        at = pos(kind, a["x"])
        out.append([n, at, words(kind, at), a["label"], first <= at <= last])
    return out


def describe(spec):
    """C8."""
    kind, unit = spec["periodKind"], spec["unitLabel"]
    out = []
    for line in spec["lines"]:
        head = "%s (%s)" % (line["label"], line["kind"])
        pts = sorted((p for p in line["points"] if p["y"] is not None), key=lambda p: pos(kind, p["x"]))
        if not pts:
            out.append(head + ": no values in this range.")
            continue
        low = high = pts[0]
        for p in pts:
            if Decimal(p["y"]) < Decimal(low["y"]):
                low = p
            if Decimal(p["y"]) > Decimal(high["y"]):
                high = p
        w = lambda x: words(kind, pos(kind, x))
        latest = pts[-1]
        out.append("%s: %s to %s. Latest %s (%s). Lowest %s (%s); highest %s (%s)." % (
            head, w(pts[0]["x"]), w(latest["x"]), value_text(latest["y"], unit), w(latest["x"]),
            value_text(low["y"], unit), w(low["x"]), value_text(high["y"], unit), w(high["x"])))
    for band in spec.get("bands", []):
        head = "%s (%s)" % (band["label"], band["kind"])
        if not band["points"]:
            out.append(head + ": no values in this range.")
            continue
        latest = sorted(band["points"], key=lambda p: pos(kind, p["x"]))[-1]
        out.append("%s: latest %s, in effect from %s." % (
            head, range_text(latest["lower"], latest["upper"], unit), words(kind, pos(kind, latest["x"]))))
    return " ".join(out)


# ---- cases --------------------------------------------------------------------------------

def business_days(start, count):
    """Weekdays from `start`, as test periods (no holiday calendar: these are inputs only)."""
    out = []
    n = day_number(start)
    while len(out) < count:
        if date.fromordinal(n + EPOCH).weekday() < 5:
            out.append(day_of(n))
        n += 1
    return out


def walk(count, seed, start, spread):
    """A deterministic walk in hundredths (a linear congruential generator): test inputs only."""
    values = []
    state = seed
    v = start
    for _ in range(count):
        state = (state * 1103515245 + 12345) % (2 ** 31)
        v += (state % (2 * spread + 1)) - spread
        sign = "-" if v < 0 else ""
        values.append("%s%d.%02d" % (sign, abs(v) // 100, abs(v) % 100))
    return values


def long_line():
    periods = business_days("2000-01-03", 3000)
    values = walk(3000, 20261120, 500, 9)
    points = []
    for i, (p, v) in enumerate(zip(periods, values)):
        if i % 997 == 500 or i in (1500, 1502):
            points.append({"x": p, "y": None})
        else:
            points.append({"x": p, "y": v})
    return points


def main():
    value_cases = [
        ["3.88", "Percent"], ["4.00", "Percent"], ["-0.25", "Percent"], ["-0.00", "Percent"], ["0", "Percent"],
        ["40626506856903.25", "U.S. dollars"], ["-12.50", "U.S. dollars"], ["0.03", "U.S. dollars"],
        ["999", "U.S. dollars"], ["1000", "U.S. dollars"],
        ["20073.6", "Billions of U.S. dollars, monthly average"], ["286.6", "Billions of U.S. dollars"],
        ["1234567.5", "Index points"], ["-1234.5", "Index points"],
    ]
    range_cases = [["3.75", "4.00", "Percent"], ["0.00", "0.25", "Percent"], ["1000", "2000.5", "U.S. dollars"]]
    period_cases = [["business-day", "2026-11-18"], ["month", "2026-10"], ["change-point", "2026-09-17"],
                    ["weekly", "2026-02-01"], ["annual", "2026-01"]]
    time_cases = ["2026-11-26T08:15:00Z", "2026-01-05T00:00:07Z", "2024-02-29T23:59:00Z"]
    snapshot_cases = ["20261125T151700Z", "20240229T000001Z", "not-a-snapshot"]
    release_cases = [["rule", "2026-11-19"], ["calendar", "2026-11-24"], ["first-seen", "2026-11-24"],
                     ["not-recorded", None], ["rule", None], ["unknown-basis", "2026-11-19"], ["calendar", "2026-11"]]
    compare_cases = [["4.00", "4"], ["-0", "0"], ["3.88", "3.9"], ["-1.5", "-1.25"], ["10", "9.99"],
                     ["0.001", "0.0009"], ["-0.00", "0.00"], ["40626506856903.25", "40626506856903.24"]]

    base = {"status_reason": None, "deadline": "2026-11-20T20:00:00Z", "stale_at": "2026-11-25T20:00:00Z"}
    status_series = [
        dict(base, status="fresh"),
        dict(base, status="stale", status_reason="no new period after 2026-11-18; expected by 2026-11-20T20:00:00Z"),
        dict(base, status="held", status_reason="held for review"),
        dict(base, status="frozen", status_reason="rolled back on 2026-11-24; nothing of the withdrawn data is published until a person with write access clears the lock: example rollback in the fixture scenario"),
        dict(base, status="frozen", status_reason="a proposed revision was rejected on 2026-11-18 and the source still carries it: Synthetic scenario: the changed value does not agree with the published total."),
        dict(base, status="frozen", status_reason=None),
        dict(base, status="not-yet-published", status_reason="no data published yet", deadline=None, stale_at=None),
        dict(base, status="fresh", deadline=None),
        dict(base, status="fresh", deadline=None, stale_at=None),
        dict(base, status="fresh", deadline="not a time", stale_at="2026-13-99"),
        dict(base, status="withdrawn"),
    ]
    times = ["2026-11-19T00:00:00Z", "2026-11-20T20:00:00Z", "2026-11-20T20:00:01Z",
             "2026-11-25T19:59:59Z", "2026-11-25T20:00:00Z", "2027-01-01T00:00:00Z"]
    statuses = []
    for s in status_series:
        for now in times:
            kind = view_status(s, now)
            statuses.append({"series": s, "now": now, "kind": kind, "label": LABELS[kind],
                             "sentence": status_sentence(kind, s)})

    page_cases = [[None, ["fresh"]], ["fixture", ["stale"]], ["release", ["fresh", "due", "frozen"]],
                  ["release", ["fresh", "stale"]], ["release", []]]
    build = "20261125T151700Z"
    refresh_cases = [
        [200, {"snapshot": {"id": build}}], [200, {"snapshot": {"id": "20261125T190000Z"}}],
        [200, {"snapshot": {"id": "20261124T151700Z"}}], [404, {"snapshot": {"id": build}}],
        [0, None], [200, None], [200, []], [200, {"snapshot": "20261125T151700Z"}],
        [200, {"snapshot": {"id": "2026-11-25"}}], [200, {}],
    ]

    axis_cases = [
        [["3.88", "4.40", "5.33", "0.05"], "Percent"],
        [["3.75", "4.00"], "Percent"],
        [["0.04", "0.09"], "Percent"],
        [["40626506856903.25", "36218604622469.33", "4000000000000.00"], "U.S. dollars"],
        [["32833386143424.80", "7785120713478.45"], "U.S. dollars"],
        [["286.6", "23413.9", "20073.6"], "Billions of U.S. dollars, monthly average"],
        [["0", "0.00"], "Percent"],
        [[], "Percent"],
        [["-0.25", "1.5"], "Percent"],
        [["-3", "-12"], "Index points"],
        [["5000000", "1234567.89"], "U.S. dollars"],
        [["999999999.99"], "U.S. dollars"],
        [["7"], "Index points"],
        [["123"], "Index points"],
    ]
    axes = [{"values": v, "unit": u, **value_axis(v, u)} for v, u in axis_cases]

    label_cases = [
        ["day", "2000-07-03", "2026-11-18"], ["day", "2021-11-18", "2026-11-18"], ["day", "2025-11-18", "2026-11-18"],
        ["day", "2026-10-01", "2026-11-18"], ["day", "2026-11-03", "2026-11-18"], ["day", "2026-11-18", "2026-11-18"],
        ["month", "1959-01", "2026-10"], ["month", "2024-11", "2026-10"], ["month", "2026-03", "2026-10"],
        ["month", "2026-10", "2026-10"], ["day", "1993-04-01", "2026-11-23"], ["day", "2016-02-29", "2016-03-01"],
    ]
    labels = []
    for kind, a, b in label_cases:
        first, last = pos(kind, a), pos(kind, b)
        ends = [first, last]
        if first == last:
            first, last = first - 1, last + 1
        for most in (8, 4):
            labels.append({"kind": kind, "from": a, "to": b, "most": most,
                           "labels": [[p, t] for p, t in period_labels(kind, first, last, most, ends)]})

    day_cases = ["1970-01-01", "1969-12-31", "1900-02-28", "1900-03-01", "2000-02-29", "2000-03-01",
                 "2024-02-29", "2026-11-18", "0001-01-01", "9999-12-31"]
    days = [[d, day_number(d)] for d in day_cases]
    months = [[m, month_number(m)] for m in ["1959-01", "2026-10", "2000-12", "0001-01"]]

    line = long_line()
    spec_long = {"id": "t-long", "title": "Test walk", "unitLabel": "Percent", "periodKind": "day",
                 "lines": [{"key": "a", "label": "Walk", "shape": "line", "kind": "observed", "points": line}]}
    first, last, _, _ = domain("day", spec_long)
    runs = kept_runs("day", line, first, last)
    decimation = {"points": line, "first": first, "last": last,
                  "runs": [[day_of(at) for at, _ in run] for run in runs],
                  "reading": [day_of(at) for at in sorted(reading_points("day", line, first, last))]}

    spec_rates = {
        "id": "t-rates", "title": "Test rates", "unitLabel": "Percent", "periodKind": "day",
        "lines": [
            {"key": "m", "label": "Market rate", "shape": "line", "kind": "observed", "points": [
                {"x": "2008-12-10", "y": "0.20"}, {"x": "2008-12-11", "y": "0.19"},
                {"x": "2008-12-12", "y": None}, {"x": "2008-12-15", "y": "0.16"},
                {"x": "2008-12-16", "y": "0.11"}, {"x": "2008-12-17", "y": "0.11"},
                {"x": "2008-12-18", "y": "0.18"}]},
            {"key": "t", "label": "Policy target", "shape": "step", "kind": "derived", "points": [
                {"x": "2008-12-09", "y": "1.00"}, {"x": "2008-12-16", "y": None}]},
        ],
        "bands": [{"key": "r", "label": "Policy target range, Derived", "kind": "derived", "points": [
            {"x": "2008-12-16", "lower": "0.00", "upper": "0.25"}]}],
    }
    spec_money = {
        "id": "t-money", "title": "Test money", "unitLabel": "Billions of U.S. dollars, monthly average", "periodKind": "month",
        "lines": [
            {"key": "a", "label": "First", "shape": "line", "kind": "observed", "points": [
                {"x": "2026-07", "y": "20000.1"}, {"x": "2026-08", "y": None}, {"x": "2026-09", "y": "20009.7"},
                {"x": "2026-10", "y": "20073.6"}]},
            {"key": "b", "label": "Second", "shape": "line", "kind": "observed", "points": [
                {"x": "2026-08", "y": "23300.9"}, {"x": "2026-09", "y": "23300.9"}, {"x": "2026-10", "y": "23299.0"}]},
        ],
    }
    spec_empty = {"id": "t-empty", "title": "Nothing", "unitLabel": "Percent", "periodKind": "day",
                  "lines": [{"key": "a", "label": "Gap only", "shape": "line", "kind": "observed",
                             "points": [{"x": "2026-11-18", "y": None}]}]}
    notes_day = [{"x": "2025-08-04", "label": "Second note"}, {"x": "2011-02-01", "label": "Outside"},
                 {"x": "2025-08-04", "label": "Same day, given later"}, {"x": "2026-11-23", "label": "Last day"}]
    notes_month = [{"x": "2020-05", "label": "Definition change"}, {"x": "2027-01", "label": "After the range"},
                   {"x": "2019-01", "label": "First month"}, {"x": "2018-12", "label": "Before the range"}]
    charts = []
    for spec in (spec_rates, spec_money, spec_empty):
        charts.append({"spec": spec, "description": describe(spec), **chart_reading(spec)})

    out = {
        "generator": "tests/oracle/econ_shell.py",
        "rules": "src/lib/data/shell-text.ts T1 to T7, src/lib/data/status.ts S1 to S5, src/lib/data/line-chart.ts C1 to C8",
        "values": [[v, u, value_text(v, u)] for v, u in value_cases],
        "ranges": [[a, b, u, range_text(a, b, u)] for a, b, u in range_cases],
        "periods": [[f, p, period_text(f, p)] for f, p in period_cases],
        "times": [[t, time_text(t)] for t in time_cases],
        "snapshots": [[s, snapshot_text(s)] for s in snapshot_cases],
        "releases": [[b, d, release_text(b, d)] for b, d in release_cases],
        "compares": [[a, b, compare(a, b)] for a, b in compare_cases],
        "statuses": statuses,
        "pages": [[s, k, page_state(s, k)] for s, k in page_cases],
        "refresh": [{"build": build, "status": st, "body": body, "outcome": refresh(build, st, body),
                     "text": REFRESH_TEXT[refresh(build, st, body)]} for st, body in refresh_cases],
        "axes": axes,
        "periodLabels": labels,
        "days": days,
        "months": months,
        "decimation": decimation,
        "charts": charts,
        "annotations": [
            {"kind": "day", "from": "2025-01-02", "to": "2026-11-23", "annotations": notes_day,
             "placed": annotate("day", day_number("2025-01-02"), day_number("2026-11-23"), notes_day)},
            {"kind": "month", "from": "2019-01", "to": "2026-10", "annotations": notes_month,
             "placed": annotate("month", month_number("2019-01"), month_number("2026-10"), notes_month)},
        ],
    }
    text = json.dumps(out, indent=2, ensure_ascii=False) + "\n"
    with open(FIXTURE, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
