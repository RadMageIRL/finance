"""Independent reference oracle for the RadMage Finance calculation engines.

Writes JSON fixtures to tests/oracle/fixtures/ from the rules in
docs/ENGINE_CONVENTIONS.md (v1.2), sections 2 to 6 and 9. It uses only the
Python standard library and exact decimal arithmetic, and it is written from
that specification alone, not from the TypeScript engines, so that a mistake
shared by both is unlikely.

Run from the repository root:

    python -I tests/oracle/generate.py

Every published Regulation DD figure (12 CFR part 1030, Appendix A) and every
identity in sections 5 and 6 is checked. The compound interest ledger follows
section 5 of v1.2: a 365-day calendar of common years, compounding periods
between calendar boundaries, contributions on their own weekly, biweekly,
monthly, quarterly or annual dates, and interest on the average daily balance
of each compounding period. The v1.1 per-period model is kept as a separate
function, and the v1.2 ledger must equal it year by year wherever the two
frequencies coincide and wherever there are no contributions. If any check
fails, the generator prints the failing cases, writes nothing and exits with
status 1.
"""

import json
import sys
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Context, Decimal, setcontext
from pathlib import Path

GENERATOR = "tests/oracle/generate.py"
CONVENTIONS = "v1.2"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

# Section 2 asks for at least 60 digits; 100 leaves a wide margin everywhere.
PRECISION = 100
setcontext(Context(prec=PRECISION, rounding=ROUND_HALF_UP, Emax=999_999, Emin=-999_999))

ONE = Decimal(1)
HALF = Decimal("0.5")
# A value this close to a half, but not on it, means the arithmetic was not
# precise enough to decide the rounding. That is an error, never a guess.
TIE_GUARD = Decimal("1e-50")
# Section 2: before rounding, the TypeScript engines treat a value whose
# fractional part is within 2^-50 of its magnitude of one half, capped at
# 2^-20 of a cent, as an exact half. The audit below reports every rounding
# point inside that window that is not an exact half, where a float engine
# would snap to a half the exact value does not have. Both bounds are powers
# of two, so these Decimal values are exact.
SNAP_RELATIVE = Decimal(2) ** -50
SNAP_CAP = Decimal(2) ** -20
# Largest integer a JavaScript number holds exactly (2^53 - 1).
MAX_SAFE_INTEGER = 2**53 - 1
SIGNIFICANT_DIGITS = 25


class OracleError(Exception):
    """A rule or a check could not be applied."""


class RoundingAudit:
    """Counts exact half ties, and rounding points inside the section 2 half tolerance that are not halves."""

    def __init__(self):
        self.case = ""
        self.ties = {}
        self.snapped = []
        # Cross-check computations repeat rounding points already counted, so
        # they pause the audit; the tie guard in round_half_up still applies.
        self.paused = False

    def record(self, scaled, distance):
        """`scaled` is the value in units of the last place kept (cents for money,
        0.01 percentage point for percents); `distance` is |fraction - 0.5|."""
        if self.paused:
            return
        if distance == 0:
            self.ties[self.case] = self.ties.get(self.case, 0) + 1
        elif distance <= min(max(abs(scaled), ONE) * SNAP_RELATIVE, SNAP_CAP):
            self.snapped.append((self.case, scaled))


AUDIT = RoundingAudit()
FAILURES = []


def check(condition, case_id, message):
    """Records a failed check; the run fails at the end if any were recorded."""
    if not condition:
        FAILURES.append(f"{case_id}: {message}")


# Section 2: rounding


def round_half_up(value, places):
    """Section 2: round half away from zero to `places` decimal places.

    Money is held in cents, so a cent amount rounds with places = 0; APY and
    other percent values round to the nearest 0.01 percentage point with
    places = 2. ROUND_HALF_UP in Python's decimal module rounds away from zero.
    """
    scaled = value.scaleb(places)
    distance = abs(scaled - scaled.to_integral_value(rounding=ROUND_FLOOR) - HALF)
    if 0 < distance <= max(abs(scaled), ONE) * TIE_GUARD:
        raise OracleError(f"{AUDIT.case}: {value} is too close to a half to round safely")
    AUDIT.record(scaled, distance)
    return value.quantize(ONE.scaleb(-places), rounding=ROUND_HALF_UP)


def round_cents(value):
    """Section 2: a cent amount rounded half away from zero to a whole cent."""
    return int(round_half_up(value, 0))


def round_percent(value):
    """Section 2: a percent rounded to the nearest 0.01 percentage point."""
    return round_half_up(value, 2)


def periodic_interest(balance_cents, annual_rate, n):
    """Section 2 order of operations: balance * annual_rate / n, multiply first.

    The product of an integer and a short decimal is exact, so a true half
    cent stays exactly a half after the single division.
    """
    return Decimal(balance_cents) * annual_rate / n


def power(base, numerator, denominator=1):
    """base raised to numerator / denominator.

    An integral exponent is an integer power, exact whenever the result fits
    the context. Any other exponent is exp(ln(base) * exponent) in the
    high-precision context (sections 3 and 4).
    """
    if numerator % denominator == 0:
        return base ** (numerator // denominator)
    return (base.ln() * numerator / denominator).exp()


# Section 3: interest rate and APY conversions


def apy_from_nominal(annual_rate, n):
    """Section 3: APY = (1 + r/n)^n - 1, an unrounded fraction."""
    return power(ONE + annual_rate / n, n) - ONE


def nominal_from_apy(apy, n):
    """Section 3: r = n * ((1 + APY)^(1/n) - 1), an unrounded fraction."""
    return n * (power(ONE + apy, 1, n) - ONE)


# Section 4: Regulation DD formulas


def regdd_apy_percent(interest_cents, principal_cents, days):
    """Section 4: APY = 100 * ((1 + Interest/Principal)^(365/Days) - 1).

    Interest and Principal are cent amounts. Returns the unrounded percent.
    The APY earned uses the same formula with the interest credited and the
    average daily balance for the period.
    """
    ratio = Decimal(interest_cents) / principal_cents
    return 100 * (power(ONE + ratio, 365, days) - ONE)


def daily_growth(stretch):
    """Section 4: product of (1 + r/365)^d over (rate, days) pieces, 365-day basis."""
    growth = ONE
    for rate, days in stretch:
        growth *= power(ONE + rate / 365, days)
    return growth


def crediting_periods(segments):
    """Section 4: the crediting assumption for the Appendix A examples.

    Splits the rate segments at the end of each 365-day year of the term and
    at maturity. A rate change inside a year is not a crediting point.

    This rule is an INFERENCE, not stated in the regulation: Appendix A gives
    the interest amounts but does not say when the example accounts credit
    interest, and crediting at each year end and at maturity is the simplest
    rule found that reproduces every Appendix A figure. It is used only to
    reproduce those examples (regdd.json). It is not a required or universal
    interest-crediting behavior: 12 CFR 1030.7(b) says the regulation "does
    not require institutions to compound or credit interest at any particular
    frequency".

    Returns a list of (end_day, stretch) where stretch is the (rate, days)
    pieces inside that crediting period.
    """
    term = sum(days for _, days in segments)
    ends = list(range(365, term, 365)) + [term]
    periods = []
    start = 0
    for end in ends:
        stretch = []
        offset = 0
        for rate, days in segments:
            low = max(start, offset)
            high = min(end, offset + days)
            if high > low:
                stretch.append((rate, high - low))
            offset += days
        periods.append((end, stretch))
        start = end
    return periods


def regdd_credited_interest(principal_cents, segments):
    """Section 4: daily compounding, credited per the Appendix A crediting assumption.

    The crediting points are those of crediting_periods: the end of each
    365-day year and maturity. That timing is an INFERENCE that reproduces the
    Appendix A figures, not a rule of the regulation, and it is used only for
    those examples; 12 CFR 1030.7(b) does not require crediting at any
    particular frequency. Each credit is round_cents(balance * growth -
    balance) on the balance that includes earlier credits. Returns the list of
    credits as (end_day, unrounded_cents, credited_cents).
    """
    balance = principal_cents
    credits = []
    for end_day, stretch in crediting_periods(segments):
        unrounded = balance * daily_growth(stretch) - balance
        credited = round_cents(unrounded)
        credits.append((end_day, unrounded, credited))
        balance += credited
    return credits


def tiered_method_b_interest(balance_cents, tiers, days):
    """Section 4, tiered rates Method B (Appendix A, part I.D).

    Each tier's slice of the balance earns daily-compounded interest at that
    tier's rate, computed unrounded; the caller rounds the total once.
    `tiers` is a list of (upper limit in cents or None, annual rate).
    """
    total = Decimal(0)
    lower = 0
    for upper, rate in tiers:
        top = balance_cents if upper is None else min(balance_cents, upper)
        piece = max(0, top - lower)
        total += piece * daily_growth([(rate, days)]) - piece
        if upper is None or balance_cents <= upper:
            break
        lower = upper
    return total


# Section 5: compound interest calculator engine (v1.2)

YEAR_DAYS = 365
# Section 5.1: every year has the months of a common year; leap days are ignored.
MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MONTH_STARTS = [sum(MONTH_LENGTHS[:month]) for month in range(12)]
# Quarters start with January, April, July and October; half years with January and July.
QUARTER_STARTS = [MONTH_STARTS[month] for month in (0, 3, 6, 9)]
HALF_YEAR_STARTS = [MONTH_STARTS[month] for month in (0, 6)]
YEAR_STARTS = [0]

# Section 5.2: the boundaries inside a year for each compounding frequency n.
COMPOUNDING_OFFSETS = {
    1: YEAR_STARTS,
    2: HALF_YEAR_STARTS,
    4: QUARTER_STARTS,
    12: MONTH_STARTS,
    365: list(range(YEAR_DAYS)),
}
COMPOUNDING_FREQUENCIES = [1, 2, 4, 12, 365]

# Section 5.3: weekly and biweekly contributions follow a cycle of days counted
# from day 0 that runs across year ends; the others follow the calendar
# boundaries of section 5.1.
CONTRIBUTION_FREQUENCIES = ["none", "weekly", "biweekly", "monthly", "quarterly", "annually"]
CONTRIBUTION_CYCLE_DAYS = {"weekly": 7, "biweekly": 14}
CONTRIBUTION_OFFSETS = {"monthly": MONTH_STARTS, "quarterly": QUARTER_STARTS, "annually": YEAR_STARTS}

# Section 5 (v1.2 preamble): the frequency pairs whose results must equal v1.1's.
COINCIDING_FREQUENCIES = {"monthly": 12, "quarterly": 4, "annually": 1}


def calendar_boundaries(offsets, years):
    """Section 5.1: the offsets repeated every year at 365(y-1) + offset, then boundary T."""
    term = YEAR_DAYS * years
    repeated = [YEAR_DAYS * (year - 1) + offset for year in range(1, years + 1) for offset in offsets]
    return repeated + [term]


def compounding_periods(n, years):
    """Section 5.2: (year, a, b) for each stretch between consecutive boundaries for n.

    Every compounding period must lie inside one year; year y covers days
    365(y-1) to 365y - 1, so a period from a to b lies in year a // 365 + 1.
    """
    boundaries = calendar_boundaries(COMPOUNDING_OFFSETS[n], years)
    periods = []
    for a, b in zip(boundaries, boundaries[1:]):
        year = a // YEAR_DAYS + 1
        if not YEAR_DAYS * (year - 1) <= a < b <= YEAR_DAYS * year:
            raise OracleError(f"compounding period {a} to {b} is not inside one year")
        periods.append((year, a, b))
    return periods


def contribution_boundaries(frequency, years, timing):
    """Section 5.3: the sorted set S of contribution boundaries.

    Start timing takes the interval boundaries t with 0 <= t < T, end timing
    those with 0 < t <= T. The weekly and biweekly boundaries are the
    multiples of 7 or 14 days, so boundary T is one of them only when T is a
    multiple of the cycle; this gives the counts ceil(T/d) and floor(T/d)
    stated in section 5.3. The calendar frequencies include boundary T (5.1).
    """
    term = YEAR_DAYS * years
    if frequency == "none":
        return []
    if frequency in CONTRIBUTION_CYCLE_DAYS:
        interval = list(range(0, term + 1, CONTRIBUTION_CYCLE_DAYS[frequency]))
    elif frequency in CONTRIBUTION_OFFSETS:
        interval = calendar_boundaries(CONTRIBUTION_OFFSETS[frequency], years)
    else:
        raise OracleError(f"unknown contribution frequency {frequency}")
    if timing == "start":
        return [t for t in interval if 0 <= t < term]
    if timing == "end":
        return [t for t in interval if 0 < t <= term]
    raise OracleError(f"unknown timing {timing}")


def expected_contribution_count(frequency, years, timing):
    """Section 5.3: ceil(T/d) for start and floor(T/d) for end timing (d = 7 or 14).

    Monthly, quarterly and annual contributions make 12, 4 and 1 a year; none makes 0.
    """
    term = YEAR_DAYS * years
    if frequency == "none":
        return 0
    if frequency in CONTRIBUTION_CYCLE_DAYS:
        cycle = CONTRIBUTION_CYCLE_DAYS[frequency]
        return -(-term // cycle) if timing == "start" else term // cycle
    return {"monthly": 12, "quarterly": 4, "annually": 1}[frequency] * years


def average_daily_balance_interest(balance_cents, length, contribution_cents, weighted_days, annual_rate, n):
    """Section 5.4 steps 3 and 4: the interest of one compounding period, unrounded.

    The sum of the daily balances is balance * L + C * W cent-days, an
    integer. It is multiplied by the short decimal rate first, which is exact,
    and divided once by n * L, so an exact half cent stays exactly a half.
    """
    cent_days = balance_cents * length + contribution_cents * weighted_days
    return Decimal(cent_days) * annual_rate / (n * length)


def compound_ledger(principal_cents, annual_rate, n, years, frequency, contribution_cents, timing):
    """Section 5.4: interest on the average daily balance of each compounding period.

    For each period from boundary a to boundary b, in order: D is the set of
    contributions that belong to it (a <= t < b for start timing, a < t <= b
    for end timing), W is the sum of b - t over D, interest is
    round_cents((balance * L + C * W) * annual_rate / (n * L)), and then
    balance += C * |D| + interest. The running balance at boundary a does not
    yet include the contributions of D: a start-timing contribution at a is
    counted through W, in the account for b - a = L days.

    Returns a dict with the yearly table as section 5.5 rows [year,
    start_balance, contributions, interest, end_balance], the number of
    contributions belonging to each year, contribution_count (|S|), the
    interest summed over every period, and the periods (a, b, value,
    interest) where the step 4 value is an exact half cent while a
    contribution lies strictly inside the period.
    """
    contributions = contribution_boundaries(frequency, years, timing)
    yearly = []
    year_counts = []
    total_interest = 0
    mid_period_halves = []
    balance = principal_cents
    position = 0
    for year, a, b in compounding_periods(n, years):
        if len(yearly) < year:
            # Start balance: the balance at boundary 365(y-1), before the year's first period.
            yearly.append([year, balance, 0, 0, balance])
            year_counts.append(0)
        row = yearly[-1]
        length = b - a
        # Step 1. S is sorted and the earlier periods took every boundary before
        # this one, so D is the run of boundaries from `position` that belong here.
        members = []
        while position < len(contributions):
            t = contributions[position]
            if not (a <= t < b if timing == "start" else a < t <= b):
                break
            members.append(t)
            position += 1
        # Step 2: each contribution in D is in the account for b - t days of the period.
        weighted_days = sum(b - t for t in members)
        # Steps 3 and 4.
        value = average_daily_balance_interest(balance, length, contribution_cents, weighted_days, annual_rate, n)
        interest = round_cents(value)
        if value - value.to_integral_value(rounding=ROUND_FLOOR) == HALF and any(a < t < b for t in members):
            mid_period_halves.append((a, b, value, interest))
        # Step 5.
        added = contribution_cents * len(members)
        balance += added + interest
        row[2] += added
        row[3] += interest
        row[4] = balance
        year_counts[-1] += len(members)
        total_interest += interest
    if position != len(contributions):
        raise OracleError(f"{len(contributions) - position} contribution(s) belong to no compounding period")
    return {
        "yearly": yearly,
        "year_counts": year_counts,
        "contribution_count": len(contributions),
        "total_interest": total_interest,
        "mid_period_halves": mid_period_halves,
    }


def compound_daily_balances(principal_cents, annual_rate, n, years, frequency, contribution_cents, timing):
    """Section 5.4 restated day by day, a cross-check of the ledger's D and W arithmetic.

    On day d the account holds the principal, every contribution at a
    boundary t <= d (a contribution at boundary t is in the account from day
    t on, 5.3) and the interest posted at the end of each earlier compounding
    period. A period's interest is round_cents(sum of its daily balances *
    annual_rate / (n * L)). A contribution is reported in the year of the
    period it starts (start timing, year t // 365 + 1) or ends (end timing,
    year (t - 1) // 365 + 1), per 5.4 step 1. Returns the yearly table.
    """
    contribution_days = set(contribution_boundaries(frequency, years, timing))
    period_ends = {b for _, _, b in compounding_periods(n, years)}
    yearly_contributions = [0] * years
    for t in contribution_days:
        yearly_contributions[t // YEAR_DAYS if timing == "start" else (t - 1) // YEAR_DAYS] += contribution_cents
    yearly_interest = [0] * years
    in_account = principal_cents
    period_sum = 0
    period_start = 0
    for day in range(YEAR_DAYS * years):
        if day in contribution_days:
            in_account += contribution_cents
        period_sum += in_account
        if day + 1 in period_ends:
            interest = round_cents(Decimal(period_sum) * annual_rate / (n * (day + 1 - period_start)))
            in_account += interest
            yearly_interest[day // YEAR_DAYS] += interest
            period_sum = 0
            period_start = day + 1
    rows = []
    balance = principal_cents
    for index in range(years):
        end = balance + yearly_contributions[index] + yearly_interest[index]
        rows.append([index + 1, balance, yearly_contributions[index], yearly_interest[index], end])
        balance = end
    return rows


def compound_schedule_v11(principal_cents, annual_rate, n, years, contribution_cents, timing):
    """Section 5 as of v1.1, kept only as a cross-check of the v1.2 ledger.

    One contribution per compounding period. For each period: a start-timing
    contribution, then interest rounded to the cent on the balance, then an
    end-timing contribution. Returns the yearly table as [year,
    start_balance, contributions, interest, end_balance]. Section 5 (v1.2)
    says the v1.2 results equal these whenever the contribution and
    compounding frequencies coincide, and with no contributions.
    """
    balance = principal_cents
    yearly = []
    for year in range(1, years + 1):
        start_balance = balance
        contributions = 0
        interest_total = 0
        for _ in range(n):
            if timing == "start":
                balance += contribution_cents
                contributions += contribution_cents
            interest = round_cents(periodic_interest(balance, annual_rate, n))
            balance += interest
            interest_total += interest
            if timing == "end":
                balance += contribution_cents
                contributions += contribution_cents
        yearly.append([year, start_balance, contributions, interest_total, balance])
    return yearly


def without_audit(function, *args):
    """Runs a cross-check computation without counting its rounding points twice."""
    AUDIT.paused = True
    try:
        return function(*args)
    finally:
        AUDIT.paused = False


# Section 6: loan amortization engine


def monthly_interest(balance_cents, annual_rate):
    """Section 6: round_cents(balance * i) with i = annual_rate / 12 (section 2 order)."""
    return round_cents(periodic_interest(balance_cents, annual_rate, 12))


def scheduled_payment(principal_cents, annual_rate, term_months):
    """Section 6: M = round_cents(P * i / (1 - (1 + i)^(-N))), or round_cents(P / N) at i = 0.

    The formula is evaluated in the algebraically identical form
    P * r * (12 + r)^N / (12 * ((12 + r)^N - 12^N)), which keeps an exact
    half cent exact (section 2). The form written in section 6 is computed as
    well, and the two must agree to 80 significant digits.
    """
    if annual_rate == 0:
        return round_cents(Decimal(principal_cents) / term_months)
    grown = (12 + annual_rate) ** term_months
    exact_form = principal_cents * annual_rate * grown / (12 * (grown - Decimal(12) ** term_months))
    i = annual_rate / 12
    written_form = principal_cents * i / (ONE - (ONE + i) ** -term_months)
    if abs(exact_form - written_form) > exact_form * Decimal("1e-80"):
        raise OracleError(f"payment forms disagree: {exact_form} and {written_form}")
    return round_cents(exact_form)


def payment_refused(principal_cents, annual_rate, term_months):
    """Section 6: payment-does-not-cover-interest when i > 0 and M <= round_cents(P * i)."""
    if annual_rate == 0:
        return False
    payment = scheduled_payment(principal_cents, annual_rate, term_months)
    return payment <= monthly_interest(principal_cents, annual_rate)


def amortize(principal_cents, annual_rate, term_months, extra_monthly_cents, one_time):
    """Section 6: the amortization schedule, one row per month.

    Rows are [month, payment, interest, principal, extra, balance]. The final
    payment (month N, or the first month where balance + interest <= M) pays
    the balance plus that month's interest with no extra; otherwise the
    scheduled payment M is paid, then the extra due that month, capped at the
    remaining balance.
    """
    payment = scheduled_payment(principal_cents, annual_rate, term_months)
    if payment_refused(principal_cents, annual_rate, term_months):
        raise OracleError("payment-does-not-cover-interest")
    one_time_due = {}
    for item in one_time:
        one_time_due[item["month"]] = one_time_due.get(item["month"], 0) + item["amount_cents"]
    rows = []
    balance = principal_cents
    month = 0
    while True:
        month += 1
        interest = monthly_interest(balance, annual_rate)
        if month == term_months or balance + interest <= payment:
            rows.append([month, balance + interest, interest, balance, 0, 0])
            break
        principal = payment - interest
        balance -= principal
        extra = min(extra_monthly_cents + one_time_due.get(month, 0), balance)
        balance -= extra
        rows.append([month, payment, interest, principal, extra, balance])
        if balance == 0:
            break
    return payment, rows


# Section 9: fixtures


def sig(value):
    """An unrounded value as a plain decimal string with 25 significant digits.

    Exponent notation is never used, and exact zero is written as "0".
    """
    if value == 0:
        return "0"
    exponent = value.adjusted() - (SIGNIFICANT_DIGITS - 1)
    rounded = value.quantize(ONE.scaleb(exponent), rounding=ROUND_HALF_UP)
    if rounded.adjusted() != value.adjusted():
        rounded = value.quantize(ONE.scaleb(exponent + 1), rounding=ROUND_HALF_UP)
    return format(rounded, "f")


def percent_text(value):
    """A percent already rounded to two decimals, as a string such as "5.39"."""
    return format(value, "f")


def check_safe_integers(node, where):
    """Every integer in a fixture must survive JSON.parse in JavaScript exactly."""
    if isinstance(node, bool):
        return
    if isinstance(node, int):
        check(abs(node) <= MAX_SAFE_INTEGER, where, f"integer {node} exceeds 2^53 - 1")
    elif isinstance(node, dict):
        for value in node.values():
            check_safe_integers(value, where)
    elif isinstance(node, list):
        for value in node:
            check_safe_integers(value, where)


def fixture(**arrays):
    """Section 9: every file names its generator and the conventions version."""
    return {"generator": GENERATOR, "conventions": CONVENTIONS, **arrays}


def write_fixture(name, content):
    """Section 9: deterministic JSON, two-space indent, LF line ends, trailing newline."""
    text = json.dumps(content, indent=2, ensure_ascii=False) + "\n"
    with open(FIXTURE_DIR / name, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return len(text.encode("utf-8"))


# regdd.json: 12 CFR part 1030, Appendix A worked examples

REGDD_APY_FROM_INTEREST = [
    # Part I.A example 1: $61.68 for a 365-day year on $1,000 (NOW account).
    ("I.A-1-now-account-365-days", 6168, 100000, 365, "6.17"),
    # Part I.A example 2: $30.37 on a $1,000 six-month certificate of 182 days.
    ("I.A-2-six-month-certificate-182-days", 3037, 100000, 182, "6.18"),
]

REGDD_DAILY_COMPOUNDED = [
    # Part I.B example 1: 5% for 91 days, then 5.5% for 92 days.
    ("I.B-1-stepped-six-month-certificate", 100000, [("0.05", 91), ("0.055", 92)], 183, 2668, "5.39"),
    # Part I.B example 2: 6% for the first year, then 6.5% for the next.
    ("I.B-2-stepped-two-year-certificate", 100000, [("0.06", 365), ("0.065", 365)], 730, 13313, "6.45"),
    # Part I.C: 7% introductory rate for 91 days, then 5% for 274 days.
    ("I.C-variable-introductory-rate", 100000, [("0.07", 91), ("0.05", 274)], 365, 5652, "5.65"),
    # Part I.D, Method A: the tier's rate on the full balance.
    ("I.D-method-a-tier-1", 100000, [("0.0525", 365)], 365, 5390, "5.39"),
    ("I.D-method-a-tier-2", 800000, [("0.055", 365)], 365, 45229, "5.65"),
    ("I.D-method-a-tier-3", 2000000, [("0.0575", 365)], 365, 118361, "5.92"),
]

# Part I.D tiers: 5.25% up to $2,500, 5.50% above $2,500 to $15,000, 5.75% above $15,000.
REGDD_TIERS = [(250000, "0.0525"), (1500000, "0.055"), (None, "0.0575")]

REGDD_METHOD_B = [
    # (id, balance, published interest, principal the regulation divides by, published APY)
    ("I.D-method-b-tier-1", 100000, 5390, 100000, "5.39"),
    # "APY=100(134.75/2,500)": the regulation divides by $2,500, not $2,500.01.
    ("I.D-method-b-tier-2-low", 250001, 13475, 250000, "5.39"),
    ("I.D-method-b-tier-2-high", 1500000, 84145, 1500000, "5.61"),
    # "APY=100 (841.45/15,000)" for a balance of $15,000.01.
    ("I.D-method-b-tier-3-low", 1500001, 84145, 1500000, "5.61"),
    ("I.D-method-b-tier-3-high-100000", 10000000, 587179, 10000000, "5.87"),
    ("I.D-method-b-tier-3-high-1000000", 100000000, 5913422, 100000000, "5.91"),
]

REGDD_APY_EARNED = [
    # Part II.A example 1: $5.25 on an average daily balance of $1,000 over 30 days.
    ("II.A-1-statement-period-30-days", 525, 100000, 30, "6.58"),
    # Part II.A example 2: $6.50 on $1,500 over 30 days. The printed formula
    # omits the "1+" term; the general formula gives the published 5.40%.
    ("II.A-2-calendar-month-30-days", 650, 150000, 30, "5.40"),
    # Part II.A example 3: $21 on $2,000 over a 91-day quarter.
    ("II.A-3-quarter-91-days", 2100, 200000, 91, "4.28"),
]


def build_regdd():
    """Reproduces every Appendix A figure in parts I.A to I.D and II.A (section 4).

    The daily compounded examples use the crediting assumption of
    crediting_periods, an inference made only to reproduce these published
    figures, not a crediting rule the regulation imposes.
    """
    apy_rows = []
    for case_id, interest, principal, days, published in REGDD_APY_FROM_INTEREST:
        AUDIT.case = case_id
        unrounded = regdd_apy_percent(interest, principal, days)
        apy = percent_text(round_percent(unrounded))
        check(apy == published, case_id, f"APY {apy}%, published {published}%")
        apy_rows.append({
            "id": case_id,
            "interest_cents": interest,
            "principal_cents": principal,
            "days": days,
            "published_apy_percent": published,
            "oracle_apy_percent": apy,
            "oracle_apy_unrounded": sig(unrounded),
        })

    daily_rows = []
    for case_id, principal, segments, term_days, published_interest, published_apy in REGDD_DAILY_COMPOUNDED:
        AUDIT.case = case_id
        rates = [(Decimal(rate), days) for rate, days in segments]
        check(sum(days for _, days in segments) == term_days, case_id, "segment days differ from the term")
        uncredited = principal * daily_growth(rates) - principal
        credits = regdd_credited_interest(principal, rates)
        interest = sum(credited for _, _, credited in credits)
        apy = percent_text(round_percent(regdd_apy_percent(interest, principal, term_days)))
        check(interest == published_interest, case_id, f"interest {interest} cents, published {published_interest}")
        check(apy == published_apy, case_id, f"APY {apy}%, published {published_apy}%")
        daily_rows.append({
            "id": case_id,
            "principal_cents": principal,
            "segments": [{"annual_rate": rate, "days": days} for rate, days in segments],
            "term_days": term_days,
            "credits": [
                {"end_day": end_day, "unrounded_cents": sig(unrounded), "credited_cents": credited}
                for end_day, unrounded, credited in credits
            ],
            "published_interest_cents": published_interest,
            "oracle_interest_unrounded_cents": sig(uncredited),
            "oracle_interest_cents": interest,
            "published_apy_percent": published_apy,
            "oracle_apy_percent": apy,
        })

    tiers = [(upper, Decimal(rate)) for upper, rate in REGDD_TIERS]
    method_b_rows = []
    for case_id, balance, published_interest, apy_principal, published_apy in REGDD_METHOD_B:
        AUDIT.case = case_id
        interest = round_cents(tiered_method_b_interest(balance, tiers, 365))
        apy = percent_text(round_percent(regdd_apy_percent(interest, apy_principal, 365)))
        check(interest == published_interest, case_id, f"interest {interest} cents, published {published_interest}")
        check(apy == published_apy, case_id, f"APY {apy}%, published {published_apy}%")
        method_b_rows.append({
            "id": case_id,
            "balance_cents": balance,
            "tiers": [{"up_to_cents": upper, "annual_rate": rate} for upper, rate in REGDD_TIERS],
            "days": 365,
            "published_interest_cents": published_interest,
            "oracle_interest_cents": interest,
            "apy_principal_cents": apy_principal,
            "published_apy_percent": published_apy,
            "oracle_apy_percent": apy,
        })

    earned_rows = []
    for case_id, interest, balance, days, published in REGDD_APY_EARNED:
        AUDIT.case = case_id
        apy = percent_text(round_percent(regdd_apy_percent(interest, balance, days)))
        check(apy == published, case_id, f"APY earned {apy}%, published {published}%")
        earned_rows.append({
            "id": case_id,
            "interest_cents": interest,
            "balance_cents": balance,
            "days": days,
            "published_apy_earned_percent": published,
            "oracle_apy_earned_percent": apy,
        })

    return fixture(
        apy_from_interest=apy_rows,
        daily_compounded=daily_rows,
        tiered_method_b=method_b_rows,
        apy_earned=earned_rows,
    )


# conversions.json

CONVERSION_PERIODS = [1, 2, 4, 12, 52, 365]
NOMINAL_RATES = ["0", "0.0001", "0.005", "0.01", "0.035", "0.0425", "0.05", "0.0525",
                 "0.06", "0.075", "0.1", "0.2499", "0.5", "1"]
APY_VALUES = ["0", "0.0001", "0.01", "0.0425", "0.05", "0.0539", "0.1", "0.5", "1"]


def build_conversions():
    """Section 3 conversions over a grid of rates and compounding frequencies."""
    to_apy = []
    for rate in NOMINAL_RATES:
        for n in CONVERSION_PERIODS:
            AUDIT.case = f"apy_from_nominal {rate} n={n}"
            apy = apy_from_nominal(Decimal(rate), n)
            to_apy.append({
                "annual_rate": rate,
                "periods_per_year": n,
                "apy": sig(apy),
                "apy_percent": percent_text(round_percent(100 * apy)),
            })
    to_nominal = []
    for apy in APY_VALUES:
        for n in CONVERSION_PERIODS:
            AUDIT.case = f"nominal_from_apy {apy} n={n}"
            rate = nominal_from_apy(Decimal(apy), n)
            # Round trip: the rate found must give back the APY (section 3).
            back = apy_from_nominal(rate, n)
            check(abs(back - Decimal(apy)) <= Decimal("1e-80"), AUDIT.case, f"round trip gives {back}")
            to_nominal.append({"apy": apy, "periods_per_year": n, "annual_rate": sig(rate)})
    return fixture(apy_from_nominal=to_apy, nominal_from_apy=to_nominal)


# loans.json


def loan_case(case_id, principal, rate, months, extra=0, one_time=()):
    return {"id": case_id, "principal_cents": principal, "annual_rate": rate, "term_months": months,
            "extra_monthly_cents": extra, "one_time": [{"month": m, "amount_cents": a} for m, a in one_time]}


def balance_after(principal, rate, months, month):
    """Balance after the scheduled payment of `month` with no extra payments (section 6)."""
    _, rows = amortize(principal, Decimal(rate), months, 0, [])
    return rows[month - 1][5]


def equality_balance(payment, rate):
    """A balance b with b + round_cents(b * i) exactly equal to the payment."""
    for balance in range(payment, 0, -1):
        if balance + monthly_interest(balance, Decimal(rate)) == payment:
            return balance
    raise OracleError(f"no balance pays off exactly with payment {payment}")


def loan_cases():
    """Section 6 cases: ordinary loans, extra and one-time payments, and edge cases."""
    reference = (20_000_000, "0.06", 360)
    payoff_amount = balance_after(*reference, 120)
    equality_payment = scheduled_payment(1_000_000, Decimal("0.06"), 60)
    equality_amount = balance_after(1_000_000, "0.06", 60, 24) - equality_balance(equality_payment, "0.06")
    return [
        # FINANCIAL_MODEL_REQUIREMENTS.md 5.1 reference: payment 119,910 cents.
        loan_case("reference-30-year-6-percent", *reference),
        loan_case("15-year-4.5-percent", 30_000_000, "0.045", 180),
        loan_case("5-year-7.9-percent", 3_500_000, "0.079", 60),
        loan_case("30-year-6.5-percent-extra-20000", 35_000_000, "0.065", 360, extra=20_000),
        # The one-time amount equals the balance left after month 120's payment.
        loan_case("one-time-pays-off-exactly-month-120", *reference, one_time=[(120, payoff_amount)]),
        loan_case("one-time-larger-than-balance", *reference, one_time=[(60, 50_000_000)]),
        loan_case("one-time-large-mid-term-no-payoff", *reference, one_time=[(60, 5_000_000)]),
        loan_case("two-one-time-same-month", 25_000_000, "0.055", 360,
                  one_time=[(24, 100_000), (24, 250_000), (36, 75_000)]),
        loan_case("one-time-month-1-and-extra", 5_000_000, "0.0699", 120, extra=7_500, one_time=[(1, 300_000)]),
        # Paid off long before month 100, so that one-time amount is never paid.
        loan_case("one-time-after-payoff-not-paid", 2_000_000, "0.06", 120, extra=100_000,
                  one_time=[(100, 500_000)]),
        # Month N is always the final payment, which has no extra, so the one-time is not paid.
        loan_case("one-time-in-final-month-not-paid", 1_000_000, "0.05", 12, one_time=[(12, 100_000)]),
        loan_case("extra-ends-loan-in-month-2", 1_000_000, "0.05", 60, extra=500_000),
        loan_case("extra-ends-loan-in-month-1", 100_000, "0.06", 12, extra=1_000_000),
        # After month 24 the balance b satisfies b + round(b * i) = M, so month 25 is final.
        loan_case("balance-plus-interest-equals-payment", 1_000_000, "0.06", 60,
                  one_time=[(24, equality_amount)]),
        loan_case("zero-rate-120-months", 1_200_000, "0", 120),
        loan_case("zero-rate-uneven-7-months", 100_000, "0", 7),
        loan_case("zero-rate-with-extra-exact-payoff", 1_200_000, "0", 120, extra=5_000),
        # M = round(9 / 6) = round(1.5) = 2, so the loan ends in month 5 of 6.
        loan_case("zero-rate-half-cent-payment-early-payoff", 9, "0", 6),
        # Balance 2 equals M = 2 in month 5 of 6: the final payment is triggered by equality.
        loan_case("zero-rate-equality-final-payment", 10, "0", 6),
        # M = round(1 / 12) = 0: eleven payments of 0, then a final payment of 1.
        loan_case("one-cent-zero-rate-12-months", 1, "0", 12),
        # M = round(0.5037...) = 1 and interest rounds to 0, so month 1 is final.
        loan_case("one-cent-6-percent-2-months", 1, "0.06", 2),
        loan_case("100-cents-0.5-percent-12-months", 100, "0.005", 12),
        # 100 * 0.06 / 12 = 0.5 exactly: month 1 interest rounds up to 1 cent.
        loan_case("half-cent-interest-month-1", 100, "0.06", 12),
        loan_case("1-month-term", 500_000, "0.07", 1),
        # M = round(50 * 1.01) = round(50.5) = 51 and interest round(0.5) = 1.
        loan_case("1-month-term-half-cent", 50, "0.12", 1),
        loan_case("30-percent-36-months", 500_000, "0.30", 36),
        loan_case("max-principal-rate-1-120-months", 10_000_000_000, "1", 120),
        # Longest accepted term for this principal and rate: 280 months is refused
        # (payment-does-not-cover-interest). The exact payment is 833,333,333.5001 cents,
        # so M rounds up and the principal part is 1 cent instead of 0.17: the loan
        # ends in month 262, not 279.
        loan_case("max-principal-rate-1-279-months-longest-accepted", 10_000_000_000, "1", 279),
        loan_case("max-principal-6-percent-600-months", 10_000_000_000, "0.06", 600),
        # M is rounded down by 0.497 cents; the forced final payment absorbs the residual.
        loan_case("payment-rounded-down-final-payment-larger", 20_000_399, "0.06", 360),
        # M is rounded up by 0.499 cents; the final payment is smaller than M.
        loan_case("payment-rounded-up-final-payment-smaller", 20_000_066, "0.06", 360),
    ]


def build_loans():
    """Section 6 schedules, with every identity checked."""
    check(payment_refused(10_000_000_000, Decimal("1"), 280), "max-principal-rate-1-279-months-longest-accepted",
          "280 months should be refused")
    cases = []
    for spec in loan_cases():
        case_id = spec["id"]
        AUDIT.case = case_id
        rate = Decimal(spec["annual_rate"])
        principal = spec["principal_cents"]
        term = spec["term_months"]
        payment, rows = amortize(principal, rate, term, spec["extra_monthly_cents"], spec["one_time"])
        total_interest = sum(row[2] for row in rows)
        total_paid = sum(row[1] + row[4] for row in rows)

        # Section 6 identities, and the row arithmetic they rest on.
        check(sum(row[3] + row[4] for row in rows) == principal, case_id, "principal plus extra differs from P")
        check(rows[-1][5] == 0, case_id, "final balance is not 0")
        check(total_paid == principal + total_interest, case_id, "total paid differs from P plus interest")
        check(len(rows) <= term, case_id, "more rows than the term")
        balance = principal
        for month, paid, interest, principal_part, extra, after in rows:
            check(paid == interest + principal_part, case_id, f"month {month}: payment is not interest plus principal")
            check(after == balance - principal_part - extra, case_id, f"month {month}: balance does not carry")
            check(min(paid, interest, principal_part, extra, after) >= 0, case_id, f"month {month}: negative value")
            if month < len(rows):
                check(paid == payment and after > 0, case_id, f"month {month}: not a scheduled payment")
            balance = after
        if case_id == "reference-30-year-6-percent":
            check(payment == 119_910, case_id, f"reference payment {payment}, expected 119,910")

        cases.append({
            **spec,
            "payment_cents": payment,
            "months": len(rows),
            "total_interest_cents": total_interest,
            "total_paid_cents": total_paid,
            "rows": rows,
        })
    return fixture(cases=cases)


# compound.json


def compound_case(case_id, principal, rate, n, years, frequency, contribution, timing):
    """Section 5.6 inputs, in fixture order."""
    return {"id": case_id, "principal_cents": principal, "annual_rate": rate, "periods_per_year": n,
            "years": years, "contribution_frequency": frequency, "contribution_cents": contribution,
            "timing": timing}


def no_contribution_case(case_id, principal, rate, n, years):
    """Section 5.6: a `none` case still records contribution 0 and timing "end"."""
    return compound_case(case_id, principal, rate, n, years, "none", 0, "end")


# Ordinary inputs for the grid, cycled so that neighboring cases differ.
GRID_PRINCIPALS = [1_000_000, 250_000, 5_000_000, 1_234_567, 75_000, 2_000_000, 500_000]
GRID_RATES = ["0.05", "0.0425", "0.07", "0.035", "0.06", "0.0525", "0.08", "0.045", "0.0299", "0.1", "0.0375"]
GRID_YEARS = [30, 10, 25, 5, 20, 15, 12, 7, 18]
GRID_CONTRIBUTIONS = {"weekly": 5_000, "biweekly": 15_000, "monthly": 25_000, "quarterly": 100_000,
                      "annually": 600_000}

# Cases whose step 4 value must hit an exact half cent in a period with a
# contribution strictly inside it: the first such period (a, b), its exact
# value worked out by hand in compound_cases, and the interest rounded half
# away from zero (checked in build_compound).
MID_PERIOD_HALF_CASES = {
    "exact-half-mid-period-weekly-monthly-start": (0, 31, Decimal("58.5"), 59),
    "exact-half-mid-period-weekly-quarterly-end": (0, 90, Decimal("23.5"), 24),
    "exact-half-mid-period-biweekly-annual-start": (0, 365, Decimal("2520.5"), 2521),
    "exact-half-mid-period-monthly-semiannual-start": (0, 181, Decimal("796.5"), 797),
}


def compound_cases():
    """Section 5 cases: every contribution frequency, compounding frequency and timing, then edge cases."""
    cases = []
    index = 0
    for frequency in CONTRIBUTION_FREQUENCIES:
        for n in COMPOUNDING_FREQUENCIES:
            principal = GRID_PRINCIPALS[index % len(GRID_PRINCIPALS)]
            rate = GRID_RATES[index % len(GRID_RATES)]
            years = GRID_YEARS[index % len(GRID_YEARS)]
            index += 1
            if frequency == "none":
                cases.append(no_contribution_case(f"none-n{n}", principal, rate, n, years))
                continue
            for timing in ("start", "end"):
                cases.append(compound_case(f"{frequency}-n{n}-{timing}", principal, rate, n, years, frequency,
                                           GRID_CONTRIBUTIONS[frequency], timing))
    cases += [
        # Section 5.3: 53 weekly contributions in year 1 with start timing (days 0 to 364), 52 with
        # end timing (days 7 to 364); biweekly makes 27 (days 0 to 364) and 26 (days 14 to 364).
        compound_case("weekly-1-year-start", 1_000_000, "0.05", 12, 1, "weekly", 10_000, "start"),
        compound_case("weekly-1-year-end", 1_000_000, "0.05", 12, 1, "weekly", 10_000, "end"),
        compound_case("biweekly-1-year-start", 1_000_000, "0.05", 2, 1, "biweekly", 20_000, "start"),
        compound_case("biweekly-1-year-end", 1_000_000, "0.05", 2, 1, "biweekly", 20_000, "end"),
        # T = 2,555 = 7 * 365 days: both timings make 365 weekly contributions, and the last
        # end-timing contribution, at boundary T, is in the final balance but earns no interest.
        compound_case("weekly-7-years-start", 500_000, "0.045", 12, 7, "weekly", 2_500, "start"),
        compound_case("weekly-7-years-end", 500_000, "0.045", 12, 7, "weekly", 2_500, "end"),
        compound_case("zero-rate-weekly-start", 250_000, "0", 12, 10, "weekly", 5_000, "start"),
        compound_case("zero-rate-monthly-start", 500_000, "0", 12, 20, "monthly", 10_000, "start"),
        compound_case("zero-rate-annual-100-years-end", 100_000, "0", 1, 100, "annually", 1_000, "end"),
        compound_case("zero-principal-biweekly-quarterly-end", 0, "0.05", 4, 20, "biweekly", 20_000, "end"),
        compound_case("zero-principal-monthly-contributions-end", 0, "0.05", 12, 30, "monthly", 50_000, "end"),
        compound_case("zero-principal-weekly-daily-start", 0, "0.04", 365, 5, "weekly", 3_500, "start"),
        # A zero contribution with a frequency must give the same balances as `none`.
        compound_case("zero-contribution-weekly-monthly-start", 1_000_000, "0.05", 12, 10, "weekly", 0,
                      "start"),
        no_contribution_case("zero-contribution-weekly-monthly-start-none-twin", 1_000_000, "0.05", 12, 10),
        no_contribution_case("principal-only-quarterly", 2_500_000, "0.035", 4, 30),
        compound_case("principal-only-semiannual-zero-quarterly-contribution-start", 2_500_000, "0.035", 2, 30,
                      "quarterly", 0, "start"),
        no_contribution_case("max-principal-monthly-30-years", 10_000_000_000, "0.05", 12, 30),
        no_contribution_case("max-principal-daily-1-year", 10_000_000_000, "0.0525", 365, 1),
        compound_case("max-principal-max-contribution-annual-start", 10_000_000_000, "0.05", 1, 30,
                      "annually", 10_000_000_000, "start"),
        # Every input at its maximum: 53 contributions of 10,000,000,000 cents at 100% daily.
        compound_case("max-principal-max-contribution-rate-1-weekly-daily-1-year-start", 10_000_000_000, "1",
                      365, 1, "weekly", 10_000_000_000, "start"),
        # Largest principal and contribution at 100% with annual compounding and biweekly
        # contributions inside the year: 14 years is the longest term under 2^53 - 1 cents (year 15
        # ends at about 1.33e16). The cent-days of step 3 reach about 1.2e18, beyond 2^53.
        compound_case("max-principal-max-contribution-rate-1-annual-biweekly-14-years-start", 10_000_000_000,
                      "1", 1, 14, "biweekly", 10_000_000_000, "start"),
        # 10,000,000,000 * 2^19 is just below 2^53 - 1, the largest exact JSON integer for JavaScript.
        no_contribution_case("rate-1-annual-19-years-max-principal", 10_000_000_000, "1", 1, 19),
        no_contribution_case("rate-1-monthly-30-years", 100, "1", 12, 30),
        compound_case("rate-1-daily-1-year-weekly-start", 100_000, "1", 365, 1, "weekly", 7_000, "start"),
        compound_case("rate-1-daily-5-years-monthly-start", 100_000, "1", 365, 5, "monthly", 10_000, "start"),
        compound_case("rate-1-daily-5-years-monthly-end", 100_000, "1", 365, 5, "monthly", 10_000, "end"),
        compound_case("one-year-monthly-start", 100_000, "0.045", 12, 1, "monthly", 10_000, "start"),
        compound_case("one-year-daily-monthly-end", 100_000, "0.045", 365, 1, "monthly", 3_000, "end"),
        compound_case("hundred-years-annual-end", 100_000, "0.05", 1, 100, "annually", 120_000, "end"),
        compound_case("hundred-years-annual-zero-contribution-start", 1_000_000, "0.08", 1, 100, "annually", 0,
                      "start"),
        compound_case("hundred-years-weekly-daily-start", 100_000, "0.07", 365, 100, "weekly", 2_000, "start"),
        compound_case("hundred-years-weekly-daily-end", 100_000, "0.07", 365, 100, "weekly", 2_000, "end"),
        compound_case("daily-5.25-percent-30-years-monthly-30000-end", 1_000_000, "0.0525", 365, 30, "monthly",
                      30_000, "end"),
        compound_case("daily-5.25-percent-30-years-monthly-30000-start", 1_000_000, "0.0525", 365, 30, "monthly",
                      30_000, "start"),
        # Contributions inside compounding periods.
        compound_case("quarterly-compounding-weekly-end", 1_500_000, "0.04", 4, 15, "weekly", 7_500, "end"),
        compound_case("annual-compounding-biweekly-start", 2_000_000, "0.06", 1, 10, "biweekly", 20_000, "start"),
        compound_case("semiannual-compounding-monthly-end", 750_000, "0.045", 2, 12, "monthly", 15_000, "end"),
        # 10 * 0.05 = 0.5 exactly: the first year's interest rounds up to 1 cent.
        no_contribution_case("exact-half-annual-10-cents", 10, "0.05", 1, 5),
        # 3,650 * 0.05 / 365 = 0.5 exactly; rounding it down would stop all growth.
        no_contribution_case("exact-half-daily-3650-cents", 3_650, "0.05", 365, 1),
        # Day 0: the start-timing contribution is in the account for the whole 1-day period,
        # 3,650 * 1 * 0.05 / (365 * 1) = 0.5 exactly (a contribution on a compounding boundary).
        compound_case("exact-half-daily-weekly-start-contribution", 0, "0.05", 365, 1, "weekly", 3_650, "start"),
        # 100 * 0.06 / 12 = 0.5 exactly in the first month.
        no_contribution_case("exact-half-monthly-100-cents", 100, "0.06", 12, 2),
        # 99 * 0.05 / 12 = 0.4125: interest rounds to 0 every month and the balance never grows.
        no_contribution_case("sub-cent-interest-never-credited", 99, "0.05", 12, 30),
        # Exact half cents with contributions inside the period (found by searching small inputs).
        # January is days 0 to 30 (L = 31) with start-timing contributions on days 0, 7, 14, 21 and
        # 28, in the account for 31, 24, 17, 10 and 3 days: W = 85. Cent-days 10,000 * 31 + 620 * 85
        # = 362,700, and 362,700 * 0.06 / (12 * 31) = 21,762 / 372 = 58.5 exactly.
        compound_case("exact-half-mid-period-weekly-monthly-start", 10_000, "0.06", 12, 2, "weekly", 620, "start"),
        # The first quarter is days 0 to 89 (L = 90) with end-timing contributions on days 7 to 84,
        # twelve of them: W = 12 * 90 - 7 * 78 = 534. Cent-days 100 * 90 + 300 * 534 = 169,200, and
        # 169,200 * 0.05 / (4 * 90) = 8,460 / 360 = 23.5 exactly.
        compound_case("exact-half-mid-period-weekly-quarterly-end", 100, "0.05", 4, 2, "weekly", 300, "end"),
        # Year 1 (L = 365) has 27 start-timing biweekly contributions on days 0 to 364:
        # W = 27 * 365 - 14 * 351 = 4,941. Cent-days 1,000 * 365 + 3,650 * 4,941 = 18,399,650, and
        # 18,399,650 * 0.05 / (1 * 365) = 919,982.5 / 365 = 2,520.5 exactly.
        compound_case("exact-half-mid-period-biweekly-annual-start", 1_000, "0.05", 1, 2, "biweekly", 3_650,
                      "start"),
        # The first half year is days 0 to 180 (L = 181) with start-timing monthly contributions on
        # days 0, 31, 59, 90, 120 and 151: W = 181 + 150 + 122 + 91 + 61 + 30 = 635. Cent-days
        # 10,000 * 181 + 7,240 * 635 = 6,407,400, and 6,407,400 * 0.045 / (2 * 181) = 288,333 / 362
        # = 796.5 exactly.
        compound_case("exact-half-mid-period-monthly-semiannual-start", 10_000, "0.045", 2, 2, "monthly", 7_240,
                      "start"),
    ]
    return cases


def check_calendar():
    """Section 5.1 and 5.2 figures, as written in the specification."""
    where = "section 5 calendar"
    check(sum(MONTH_LENGTHS) == YEAR_DAYS, where, "month lengths do not add up to 365")
    check(MONTH_STARTS == [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], where,
          f"month starts {MONTH_STARTS}")
    check(QUARTER_STARTS == [0, 90, 181, 273], where, f"quarter starts {QUARTER_STARTS}")
    check(HALF_YEAR_STARTS == [0, 181], where, f"half-year starts {HALF_YEAR_STARTS}")
    written_lengths = {
        1: [365],
        2: [181, 184],
        4: [90, 91, 92, 92],
        12: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        365: [1] * 365,
    }
    for n, lengths in written_lengths.items():
        for years in (1, 3):
            found = [b - a for _, a, b in compounding_periods(n, years)]
            check(found == lengths * years, where, f"n = {n}, {years} year(s): period lengths differ from 5.2")


def first_difference(left, right):
    """The first yearly row where two tables differ, for a failure message."""
    for row_left, row_right in zip(left, right):
        if row_left != row_right:
            return f"{row_left} and {row_right}"
    return f"{len(left)} and {len(right)} rows"


def build_compound():
    """Section 5 ledgers, with every identity checked for every case and year.

    Also checks the contribution counts of section 5.3 and its weekly
    examples, the v1.1 cross-check (section 5 preamble), a day-by-day
    restatement of section 5.4, the hand-worked exact half cents, and that a
    zero contribution with a frequency gives the same balances as `none`.
    """
    check_calendar()
    examples = {
        "weekly start, year 1 has 53": False,
        "weekly start, year 2 has 52": False,
        "weekly end, year 1 has 52": False,
        "weekly start over 7 years makes 365": False,
        "weekly end over 7 years makes 365": False,
    }
    cases = []
    for spec in compound_cases():
        case_id = spec["id"]
        AUDIT.case = case_id
        principal = spec["principal_cents"]
        rate = Decimal(spec["annual_rate"])
        n = spec["periods_per_year"]
        years = spec["years"]
        frequency = spec["contribution_frequency"]
        contribution = spec["contribution_cents"]
        timing = spec["timing"]
        if frequency == "none":
            check(contribution == 0 and timing == "end", case_id, "a none case must record 0 and end (5.6)")
        ledger = compound_ledger(principal, rate, n, years, frequency, contribution, timing)
        yearly = ledger["yearly"]
        year_counts = ledger["year_counts"]
        count = ledger["contribution_count"]
        total_contributions = 0 if frequency == "none" else contribution * count
        total_interest = ledger["total_interest"]
        final = yearly[-1][4]

        # Section 5.5 identities, and the yearly table they rest on.
        check(len(yearly) == years, case_id, f"{len(yearly)} yearly rows for {years} years")
        check(final == principal + total_contributions + total_interest, case_id,
              "final differs from principal plus contributions plus interest")
        check(sum(row[2] for row in yearly) == total_contributions, case_id, "yearly contributions do not add up")
        check(sum(row[3] for row in yearly) == total_interest, case_id, "yearly interest does not add up")
        check(sum(year_counts) == count, case_id, "yearly contribution counts do not add up to |S|")
        check(yearly[0][1] == principal, case_id, "year 1 does not start at the principal")
        for index, (year, start, contributions, interest, end) in enumerate(yearly):
            check(year == index + 1, case_id, f"year {year} out of order")
            check(end == start + contributions + interest, case_id, f"year {year}: end differs from the sum")
            check(contributions == contribution * year_counts[index], case_id,
                  f"year {year}: contributions are not C times the year's count")
            check(min(start, contributions, interest, end) >= 0, case_id, f"year {year}: negative value")
            if index > 0:
                check(start == yearly[index - 1][4], case_id, f"year {year}: start differs from last year's end")
        if rate == 0:
            check(total_interest == 0, case_id, "interest at a zero rate")

        # Section 5.3 counts.
        expected = expected_contribution_count(frequency, years, timing)
        check(count == expected, case_id, f"contribution_count {count}, expected {expected}")
        if frequency in COINCIDING_FREQUENCIES:
            per_year = COINCIDING_FREQUENCIES[frequency]
            check(all(found == per_year for found in year_counts), case_id,
                  f"yearly counts {year_counts}, expected {per_year} every year")
        if frequency == "weekly":
            if timing == "start":
                check(year_counts[0] == 53, case_id, f"weekly start year 1 has {year_counts[0]}, expected 53")
                examples["weekly start, year 1 has 53"] = True
                if years >= 2:
                    check(year_counts[1] == 52, case_id, f"weekly start year 2 has {year_counts[1]}, expected 52")
                    examples["weekly start, year 2 has 52"] = True
            else:
                check(year_counts[0] == 52, case_id, f"weekly end year 1 has {year_counts[0]}, expected 52")
                examples["weekly end, year 1 has 52"] = True
            if years == 7:
                check(count == 365, case_id, f"weekly over 7 years makes {count}, expected 365")
                examples[f"weekly {timing} over 7 years makes 365"] = True

        # Section 5 (v1.2): exactly the v1.1 results when the frequencies coincide, and with no
        # contributions (v1.1 with contribution 0).
        if frequency == "none" or COINCIDING_FREQUENCIES.get(frequency) == n:
            v11 = without_audit(compound_schedule_v11, principal, rate, n, years,
                                0 if frequency == "none" else contribution, timing)
            check(v11 == yearly, case_id, f"differs from v1.1: {first_difference(yearly, v11)}")
        # A zero contribution with a frequency changes nothing but contribution_count.
        if frequency != "none" and contribution == 0:
            alone = without_audit(compound_ledger, principal, rate, n, years, "none", 0, "end")
            check(alone["yearly"] == yearly, case_id,
                  f"differs from none: {first_difference(yearly, alone['yearly'])}")
        # Section 5.4 restated with the daily balances summed one day at a time.
        daily = without_audit(compound_daily_balances, principal, rate, n, years, frequency, contribution, timing)
        check(daily == yearly, case_id, f"differs from the day-by-day sum: {first_difference(yearly, daily)}")
        if case_id in MID_PERIOD_HALF_CASES:
            halves = ledger["mid_period_halves"]
            check(halves and halves[0] == MID_PERIOD_HALF_CASES[case_id], case_id,
                  f"first mid-period exact half is {halves[:1]}, expected {MID_PERIOD_HALF_CASES[case_id]}")

        cases.append({
            **spec,
            "final_balance_cents": final,
            "contribution_count": count,
            "total_contributions_cents": total_contributions,
            "total_interest_cents": total_interest,
            "yearly": yearly,
        })

    for example, seen in examples.items():
        check(seen, "section 5.3 examples", f"no case checks: {example}")
    ids = [case["id"] for case in cases]
    check(len(set(ids)) == len(ids), "compound.json", "duplicate case ids")
    check(set(MID_PERIOD_HALF_CASES) <= set(ids), "compound.json", "a mid-period exact half case is missing")
    return fixture(cases=cases)


def main():
    builders = [
        ("regdd.json", build_regdd),
        ("conversions.json", build_conversions),
        ("loans.json", build_loans),
        ("compound.json", build_compound),
    ]
    contents = []
    try:
        for name, build in builders:
            content = build()
            check_safe_integers(content, name)
            contents.append((name, content))
    except OracleError as error:
        FAILURES.append(str(error))

    if FAILURES:
        print(f"oracle: {len(FAILURES)} check(s) failed; no fixtures written", file=sys.stderr)
        for failure in FAILURES:
            print(f"  {failure}", file=sys.stderr)
        return 1

    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, content in contents:
        size = write_fixture(name, content)
        total += size
        counts = ", ".join(f"{key} {len(value)}" for key, value in content.items() if isinstance(value, list))
        print(f"{name}: {counts}; {size:,} bytes")
    print(f"total: {total:,} bytes")
    tie_count = sum(AUDIT.ties.values())
    print(f"rounding audit: {tie_count} exact half tie(s) in {len(AUDIT.ties)} case(s)")
    print(f"rounding audit: {len(AUDIT.snapped)} point(s) within the section 2 half tolerance but not a half "
          "(0 < |fraction - 0.5| <= min(max(|value|, 1) * 2^-50, 2^-20))")
    for case_id, scaled in AUDIT.snapped:
        print(f"  {case_id}: {scaled}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
