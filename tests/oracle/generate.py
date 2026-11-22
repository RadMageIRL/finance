"""Independent reference oracle for the RadMage Finance calculation engines.

Writes JSON fixtures to tests/oracle/fixtures/ from the rules in
docs/ENGINE_CONVENTIONS.md (v1.7), sections 2 to 6 and 9 to 14. It uses only
the Python standard library and exact decimal arithmetic (with exact fractions
where section 2 allows them), and it is written from that specification alone,
not from the TypeScript engines, so that a mistake shared by both is unlikely.

Run from the repository root:

    python -I tests/oracle/generate.py

Every published Regulation DD figure (12 CFR part 1030, Appendix A) and every
identity in sections 5 and 6 is checked. The compound interest ledger follows
section 5 of v1.2: a 365-day calendar of common years, compounding periods
between calendar boundaries, contributions on their own weekly, biweekly,
monthly, quarterly or annual dates, and interest on the average daily balance
of each compounding period. The v1.1 per-period model is kept as a separate
function, and the v1.2 ledger must equal it year by year wherever the two
frequencies coincide and wherever there are no contributions.

The savings account ledger follows section 10: each rate entry's APY is
calibrated to an interest rate over one 365-day year, interest is figured
with a daily rate of 1/365 of that rate and credited, rounded to the cent, at
the end of each month, with the APY earned of each month. It is checked
against a day-by-day restatement and against the calibration identity.

The schedules of section 11 walk every day of the term for both engines: the
deposits of the day, the interest accrued on it (unrounded) and the interest
credited on the last day of each crediting period, then group the days into
month and year rows. They are checked against the ledgers above: every
credit is within half a cent of its period's accrued interest, and the month
and year rows equal the ledgers' rows.

The rate illustration of section 12 gives, for each account, the unrounded
balance deposit * (1 + annual_rate / n)^k after the k compounding periods
that have ended by the end of each day, month or year (with the weekly
periods of section 5.2 for n = 52), and that balance rounded to the cent. It
is checked against deposit * (1 + APY)^y at every year end and against an
independent count of k. Each row also carries the interest accrued in it
(12.5, v1.7): every period's interest spread evenly over its days, summed
exactly over the days the period and the row share. It is checked against a
day-by-day walk and against every identity of 12.5: a year's accrued interest
is the sum of its months' and the growth of the balance over the year, and
inside a year the accrued interest runs ahead of the credited interest by the
accrued part of the period still open, never more.

Section 14 (v1.7) shows the month rows under each year row. The month rows of
schedules.json and loan_reports.json are checked, as written, to add up to
their year rows, and those of illustration.json, with the day rows, to their
year and month rows.

The loan reports of section 13 date every payment of the section 6
amortization (the first payment's calendar month plus k - 1 months), add the
running totals of interest and of principal plus extra, group the payments by
calendar year, compare the loan as entered with the same loan without extra
payments, and split the monthly payment into principal and interest and the
other housing costs, with the escrow and mortgage payment subtotals of 13.5
(v1.6). They are checked against a separate restatement in exact
fractions that walks the calendar one month at a time, against the closed
form for the balance, against loans.json where the inputs coincide, and, on
loans from a seeded generator that are not written, against the invariant of
13.4: extra payments never increase interest or months.

If any check fails, the generator prints the failing cases, writes nothing
and exits with status 1.
"""

import json
import math
import random
import sys
from bisect import bisect_right
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Context, Decimal, setcontext
from fractions import Fraction
from pathlib import Path

GENERATOR = "tests/oracle/generate.py"
CONVENTIONS = "v1.7"
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
    interest summed over every period, the periods (a, b, value,
    interest) where the step 4 value is an exact half cent while a
    contribution lies strictly inside the period, and every period as (a,
    b, cent_days, interest, end_balance) for the schedules of section 11.
    """
    contributions = contribution_boundaries(frequency, years, timing)
    yearly = []
    year_counts = []
    total_interest = 0
    mid_period_halves = []
    periods = []
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
        cent_days = balance * length + contribution_cents * weighted_days
        added = contribution_cents * len(members)
        balance += added + interest
        row[2] += added
        row[3] += interest
        row[4] = balance
        year_counts[-1] += len(members)
        total_interest += interest
        periods.append((a, b, cent_days, interest, balance))
    if position != len(contributions):
        raise OracleError(f"{len(contributions) - position} contribution(s) belong to no compounding period")
    return {
        "yearly": yearly,
        "year_counts": year_counts,
        "contribution_count": len(contributions),
        "total_interest": total_interest,
        "mid_period_halves": mid_period_halves,
        "periods": periods,
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


# Section 10: savings account (HYSA) engine (v1.3)

HYSA_COMPOUNDING = ["daily", "monthly"]
# Section 10.3 calibration and the cross-checks of section 10 agree to this relative precision.
HYSA_TOLERANCE = Decimal("1e-80")


def daily_growth_factor(apy):
    """Section 10.3, daily compounding: the daily growth factor g = (1 + APY)^(1/365)."""
    return power(ONE + apy, 1, YEAR_DAYS)


def monthly_calibration_growth(rate):
    """Section 10.3, monthly compounding: prod over the 12 months k of (1 + r * L_k / 365)."""
    growth = ONE
    for length in MONTH_LENGTHS:
        growth *= ONE + rate * length / YEAR_DAYS
    return growth


def monthly_calibrated_rate(apy):
    """Section 10.3, monthly compounding: the root r of prod(1 + r * L_k / 365) = 1 + APY.

    The product is a polynomial in r with positive coefficients, increasing
    and convex for r >= 0, so the root is unique and Newton's method converges
    to it. The start is the textbook 12((1 + APY)^(1/12) - 1), which is never
    above the root: by the concavity of the logarithm, twelve unequal months
    give a smaller product than twelve equal ones at the same rate. The root
    is then bracketed to a relative 1e-80. r = 0 when APY = 0.
    """
    if apy == 0:
        return Decimal(0)
    target = ONE + apy
    rate = 12 * (power(target, 1, 12) - ONE)
    for _ in range(100):
        growth = monthly_calibration_growth(rate)
        slope = sum(growth * length / (YEAR_DAYS + rate * length) for length in MONTH_LENGTHS)
        step = (growth - target) / slope
        rate -= step
        if abs(step) <= rate * Decimal("1e-95"):
            break
    else:
        raise OracleError(f"monthly calibration for APY {apy} did not converge")
    margin = rate * HYSA_TOLERANCE
    if not monthly_calibration_growth(rate - margin) < target < monthly_calibration_growth(rate + margin):
        raise OracleError(f"monthly calibration for APY {apy} is not bracketed")
    return rate


def hysa_rate_entries(rates, compounding):
    """Section 10.3: each entry's APY calibrated to an interest rate r, with g for daily compounding."""
    entries = []
    for entry in rates:
        apy = Decimal(entry["apy"])
        if compounding == "daily":
            growth = daily_growth_factor(apy)
            rate = YEAR_DAYS * (growth - ONE)
        elif compounding == "monthly":
            growth = None
            rate = monthly_calibrated_rate(apy)
        else:
            raise OracleError(f"unknown compounding {compounding}")
        entries.append({"from_month": entry["from_month"], "apy": apy, "rate": rate, "growth": growth})
    return entries


def rate_in_effect(entries, month):
    """Section 10.3: the entry with the largest from_month <= month."""
    found = [entry for entry in entries if entry["from_month"] <= month]
    if not found:
        raise OracleError(f"no rate entry in effect for month {month}")
    return max(found, key=lambda entry: entry["from_month"])


def apy_earned_percent(interest, cent_days, length):
    """Section 10.5: 100 * ((1 + interest / ADB)^(365 / L) - 1) with ADB = cent_days / L, or None when ADB = 0."""
    if cent_days == 0:
        return None
    return 100 * (power(ONE + Decimal(interest) * length / cent_days, YEAR_DAYS, length) - ONE)


def yearly_from_months(monthly):
    """Section 10.6: yearly rows [year, start, contributions, interest, end] from the monthly rows."""
    yearly = []
    for index in range(0, len(monthly), 12):
        months = monthly[index:index + 12]
        yearly.append([index // 12 + 1, months[0][2], sum(row[3] for row in months),
                       sum(row[4] for row in months), months[-1][5]])
    return yearly


def hysa_ledger(principal_cents, years, compounding, rates, frequency, contribution_cents, timing, credit=round_cents):
    """Sections 10.4 and 10.5: interest credited at each month end, and each month's APY earned.

    For month m from boundary a_m to b_m (L_m days), with `balance` the
    balance at a_m before the month's contributions: D and W as in section
    5.4 steps 1 and 2 with months as the periods; the interest is
    round_cents((balance * L + C * W) * r / 365) for monthly compounding, or
    round_cents(balance * (g^L - 1) + C * sum over D of (g^(b - t) - 1)) for
    daily compounding, with the rate entry in effect for the month; then
    balance += C * |D| + interest. `credit` is round_cents, except in the
    calibration cross-check, which credits interest unrounded.

    Returns a dict with the monthly rows [month, days, start_balance,
    contributions, interest, end_balance], the unrounded interest of each
    month, its APY earned (None when the average daily balance is 0), the
    contributions belonging to each month, the cent-days of each month
    (balance * L + C * W, so ADB = cent_days / L), the yearly rows and
    contribution_count (|S|).
    """
    entries = hysa_rate_entries(rates, compounding)
    contributions = contribution_boundaries(frequency, years, timing)
    monthly, unrounded, apy_earned, month_counts, month_cent_days = [], [], [], [], []
    balance = principal_cents
    position = 0
    for month, (_, a, b) in enumerate(compounding_periods(12, years), start=1):
        length = b - a
        # Section 10.2 membership, as in section 5.4 step 1 with months as the periods.
        members = []
        while position < len(contributions):
            t = contributions[position]
            if not (a <= t < b if timing == "start" else a < t <= b):
                break
            members.append(t)
            position += 1
        weighted_days = sum(b - t for t in members)
        entry = rate_in_effect(entries, month)
        cent_days = balance * length + contribution_cents * weighted_days
        if compounding == "monthly":
            value = Decimal(cent_days) * entry["rate"] / YEAR_DAYS
        else:
            growth = entry["growth"]
            value = (balance * (growth ** length - ONE)
                     + contribution_cents * sum(growth ** (b - t) - ONE for t in members))
        interest = credit(value)
        added = contribution_cents * len(members)
        monthly.append([month, length, balance, added, interest, balance + added + interest])
        unrounded.append(value)
        apy_earned.append(apy_earned_percent(interest, cent_days, length))
        month_counts.append(len(members))
        month_cent_days.append(cent_days)
        balance += added + interest
    if position != len(contributions):
        raise OracleError(f"{len(contributions) - position} contribution(s) belong to no month")
    return {
        "monthly": monthly,
        "unrounded": unrounded,
        "apy_earned": apy_earned,
        "month_counts": month_counts,
        "cent_days": month_cent_days,
        "yearly": yearly_from_months(monthly),
        "contribution_count": len(contributions),
    }


def hysa_daily_restatement(principal_cents, years, compounding, rates, frequency, contribution_cents, timing,
                           credit=round_cents):
    """Section 10.4 restated one day at a time, a cross-check of hysa_ledger.

    On day d the account holds the principal, every contribution at a
    boundary t <= d and the interest credited at earlier month ends. With
    monthly compounding each day earns r/365 on that holding; with daily
    compounding each day earns r/365 on the holding plus the interest accrued
    so far in the month. The accrued interest is credited at the month end.
    The month of a day comes from the month starts of section 5.1, and a
    contribution is reported in the month of day t (start timing) or of day
    t - 1 (end timing). Returns the monthly rows and the unrounded interest of
    each month.
    """
    entries = hysa_rate_entries(rates, compounding)
    contribution_days = set(contribution_boundaries(frequency, years, timing))

    def month_of(day):
        return 12 * (day // YEAR_DAYS) + sum(1 for start in MONTH_STARTS if start <= day % YEAR_DAYS)

    reported = [0] * (12 * years)
    for t in contribution_days:
        reported[month_of(t if timing == "start" else t - 1) - 1] += contribution_cents
    rows, unrounded = [], []
    holding = principal_cents
    start_balance = principal_cents
    accrued = Decimal(0)
    days = 0
    term = YEAR_DAYS * years
    for day in range(term):
        month = month_of(day)
        if day in contribution_days:
            holding += contribution_cents
        # The last entry already in force (from_month is strictly increasing, 10.1).
        daily_rate = [entry for entry in entries if entry["from_month"] <= month][-1]["rate"] / YEAR_DAYS
        if compounding == "monthly":
            accrued += holding * daily_rate
        else:
            accrued += (holding + accrued) * daily_rate
        days += 1
        if day + 1 == term or month_of(day + 1) != month:
            interest = credit(accrued)
            end = start_balance + reported[month - 1] + interest
            rows.append([month, days, start_balance, reported[month - 1], interest, end])
            unrounded.append(accrued)
            holding += interest
            start_balance = end
            accrued = Decimal(0)
            days = 0
    return rows, unrounded


def hysa_calibration_growth(apy_text, compounding):
    """Section 10.3 identity: the unrounded growth of one unit held January to December, two ways.

    Returns the growth from hysa_ledger and from hysa_daily_restatement, each
    with a single deposit of 1, no contributions and interest credited
    unrounded. Both must equal 1 + APY.
    """
    rates = [{"from_month": 1, "apy": apy_text}]
    ledger = hysa_ledger(ONE, 1, compounding, rates, "none", 0, "end", credit=lambda value: value)
    rows, _ = hysa_daily_restatement(ONE, 1, compounding, rates, "none", 0, "end", credit=lambda value: value)
    return ledger["monthly"][-1][5], rows[-1][5]


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


# A value written by sig() is within half a unit of its 25th significant digit, at most 5e-25 of its
# magnitude. When the exact values add up, the written ones therefore miss by at most 5e-25 of the sum
# of their magnitudes; the bound used is twice that.
WRITTEN_ROUNDING = Decimal("1e-24")


def written_sum_matches(total, parts):
    """Written values that add up in exact arithmetic: total = sum of parts, as read back from a fixture.

    `total` and `parts` are Decimals read from sig strings (or exact
    integers, or their negatives). True when |total - sum| <= 1e-24 *
    (|total| + sum of |part|), the rounding of the written strings.
    """
    bound = WRITTEN_ROUNDING * (abs(total) + sum(abs(part) for part in parts))
    return abs(total - sum(parts)) <= bound


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


# hysa.json

# A double-precision engine carries a relative error far below this, so a
# rounding point farther than this from a half rounds the same way in floats.
HYSA_NEAR_HALF = Decimal("1e-9")
# At or above this many cents, every value is within 1e-9 of its value of a half.
HYSA_NEAR_HALF_ALWAYS = HALF / HYSA_NEAR_HALF
# Section 10 asks the oracle to keep each credited interest amount below this.
HYSA_INTEREST_LIMIT = 10**11
HYSA_NEAR = []
# The rounding point closest to a half relative to its value: (ratio, case, month, value).
HYSA_CLOSEST = []


def hysa_case(case_id, principal, years, compounding, rates, frequency="none", contribution=0, timing="end"):
    """Section 10.7 inputs. `rates` is one APY string or a list of (from_month, apy) pairs.

    A `none` case records contribution 0 and timing "end", as section 5.6 does.
    """
    if isinstance(rates, str):
        rates = [(1, rates)]
    return {"id": case_id, "principal_cents": principal, "years": years, "compounding": compounding,
            "rates": [{"from_month": month, "apy": apy} for month, apy in rates],
            "contribution_frequency": frequency, "contribution_cents": contribution, "timing": timing}


HYSA_GRID_PRINCIPALS = [1_000_000, 250_000, 2_500_000, 500_000, 1_500_000, 75_000, 4_000_000]
HYSA_GRID_APYS = ["0.045", "0.0435", "0.05", "0.038", "0.0425", "0.0501", "0.0399"]
HYSA_GRID_CONTRIBUTIONS = {"weekly": 2_500, "biweekly": 10_000, "monthly": 50_000, "quarterly": 150_000,
                           "annually": 500_000}
# A rate that falls from 5% to 3.5% over two years, in four steps.
FALLING_RATES = [(1, "0.05"), (7, "0.045"), (13, "0.04"), (19, "0.035")]


def hysa_cases():
    """Section 10 cases: both compounding modes with every contribution frequency and timing, then edge cases."""
    cases = []
    index = 0
    for compounding in HYSA_COMPOUNDING:
        for frequency in CONTRIBUTION_FREQUENCIES:
            principal = HYSA_GRID_PRINCIPALS[index % len(HYSA_GRID_PRINCIPALS)]
            apy = HYSA_GRID_APYS[index % len(HYSA_GRID_APYS)]
            index += 1
            if frequency == "none":
                cases.append(hysa_case(f"{compounding}-none", principal, 3, compounding, apy))
                continue
            for timing in ("start", "end"):
                cases.append(hysa_case(f"{compounding}-{frequency}-{timing}", principal, 3, compounding, apy,
                                       frequency, HYSA_GRID_CONTRIBUTIONS[frequency], timing))
    for compounding in HYSA_COMPOUNDING:
        cases += [
            # Realistic: $10,000 at a 4.5% APY with $500 a month for 5 years.
            hysa_case(f"saver-10000-dollars-4.5-percent-500-monthly-5-years-start-{compounding}", 1_000_000, 5,
                      compounding, "0.045", "monthly", 50_000, "start"),
            hysa_case(f"saver-10000-dollars-4.5-percent-500-monthly-5-years-end-{compounding}", 1_000_000, 5,
                      compounding, "0.045", "monthly", 50_000, "end"),
            # Realistic: a rate that falls from 5% to 3.5% over two years (four entries).
            hysa_case(f"rate-falls-5-to-3.5-percent-over-2-years-{compounding}", 2_000_000, 2, compounding,
                      FALLING_RATES, "monthly", 25_000, "end"),
            # Two entries: an introductory rate for three months.
            hysa_case(f"intro-rate-two-entries-{compounding}", 500_000, 1, compounding,
                      [(1, "0.0525"), (4, "0.04")]),
            # Three entries with a change to 0% for a year.
            hysa_case(f"rate-to-zero-and-back-three-entries-{compounding}", 1_000_000, 3, compounding,
                      [(1, "0.045"), (13, "0"), (25, "0.03")], "weekly", 5_000, "start"),
            # Four entries, the last in force only for the final month (from_month = 12Y).
            hysa_case(f"four-entries-last-in-final-month-{compounding}", 2_000_000, 1, compounding,
                      [(1, "0.04"), (5, "0.045"), (9, "0.0475"), (12, "0.05")], "biweekly", 15_000, "end"),
            # An APY of 0: no interest, and an APY earned of 0 every month.
            hysa_case(f"apy-zero-{compounding}", 1_000_000, 2, compounding, "0", "monthly", 10_000, "start"),
            hysa_case(f"one-year-{compounding}", 1_000_000, 1, compounding, "0.045", "monthly", 50_000, "start"),
            hysa_case(f"ten-years-weekly-end-{compounding}", 500_000, 10, compounding, "0.0435", "weekly", 10_000,
                      "end"),
            hysa_case(f"fifty-years-biweekly-start-{compounding}", 1_000_000, 50, compounding, "0.04", "biweekly",
                      20_000, "start"),
            hysa_case(f"fifty-years-none-{compounding}", 1_000_000, 50, compounding, "0.05"),
            # Zero principal, end timing: January's only contribution arrives at its end, so January
            # has an average daily balance of 0 and no APY earned.
            hysa_case(f"zero-principal-monthly-end-{compounding}", 0, 2, compounding, "0.045", "monthly", 10_000,
                      "end"),
            # The first quarterly contribution is at the end of March: January to March have none.
            hysa_case(f"zero-principal-quarterly-end-{compounding}", 0, 2, compounding, "0.045", "quarterly",
                      100_000, "end"),
            # The first annual contribution is at the end of December: year 1 has no APY earned.
            hysa_case(f"zero-principal-annually-end-{compounding}", 0, 3, compounding, "0.045", "annually",
                      100_000, "end"),
            hysa_case(f"zero-principal-none-{compounding}", 0, 1, compounding, "0.045"),
            # A zero contribution with a frequency must give the same rows as `none`.
            hysa_case(f"zero-contribution-weekly-start-{compounding}", 1_000_000, 2, compounding, "0.045", "weekly",
                      0, "start"),
            # Largest principal and contribution: monthly contributions for 50 years stay under the
            # cap (and each credit under 1e11 cents) at a 4% APY.
            hysa_case(f"max-principal-max-contribution-monthly-50-years-{compounding}", 10_000_000_000, 50,
                      compounding, "0.04", "monthly", 10_000_000_000, "start"),
            # Largest principal and contribution weekly, at the largest APY (100%), for one year.
            hysa_case(f"max-principal-max-contribution-weekly-apy-1-one-year-{compounding}", 10_000_000_000, 1,
                      compounding, "1", "weekly", 10_000_000_000, "start"),
            hysa_case(f"max-principal-none-one-year-{compounding}", 10_000_000_000, 1, compounding, "0.05"),
            hysa_case(f"apy-1-weekly-start-{compounding}", 100_000, 2, compounding, "1", "weekly", 1_000, "start"),
            # 100 cents earns about 0.37 cents a month at 4.5%: nothing is ever credited.
            hysa_case(f"sub-cent-interest-never-credited-{compounding}", 100, 2, compounding, "0.045"),
            # 150 cents earns about 0.55 cents in a 31-day month, credited as 1 cent: a small balance
            # shows an APY earned far from the APY because of rounding to the cent.
            hysa_case(f"small-balance-rounding-{compounding}", 150, 1, compounding, "0.045"),
        ]
    return cases


def check_hysa_inputs(spec):
    """Section 10.1 input rules, so that no case is invalid by mistake."""
    case_id = spec["id"]
    years = spec["years"]
    rates = spec["rates"]
    months = [entry["from_month"] for entry in rates]
    check(0 <= spec["principal_cents"] <= 10_000_000_000, case_id, "principal out of range")
    check(1 <= years <= 50, case_id, "years out of range")
    check(spec["compounding"] in HYSA_COMPOUNDING, case_id, "unknown compounding")
    check(1 <= len(rates) <= 4, case_id, "1 to 4 rate entries")
    check(months[0] == 1 and all(x < y for x, y in zip(months, months[1:])) and months[-1] <= 12 * years,
          case_id, f"rate months {months}")
    check(all(0 <= Decimal(entry["apy"]) <= 1 for entry in rates), case_id, "APY out of range")
    check(spec["contribution_frequency"] in CONTRIBUTION_FREQUENCIES, case_id, "unknown contribution frequency")
    check(0 <= spec["contribution_cents"] <= 10_000_000_000, case_id, "contribution out of range")
    if spec["contribution_frequency"] == "none":
        check(spec["contribution_cents"] == 0 and spec["timing"] == "end", case_id, "a none case records 0 and end")


def check_hysa_calibration(apy_text, compounding, rate, where):
    """Section 10.3: the calibration identity, and the rate against section 3."""
    apy = Decimal(apy_text)
    target = ONE + apy
    for label, growth in zip(("ledger", "day by day"), without_audit(hysa_calibration_growth, apy_text, compounding)):
        check(abs(growth - target) <= target * HYSA_TOLERANCE, where,
              f"{compounding} APY {apy_text}: one year grows by {growth} ({label}), not 1 + APY")
    if compounding == "daily":
        # The daily calibration is section 3's APY to nominal with n = 365.
        nominal = nominal_from_apy(apy, 365)
        check(abs(rate - nominal) <= max(abs(nominal), ONE) * HYSA_TOLERANCE, where,
              f"daily APY {apy_text}: rate {rate} differs from section 3 {nominal}")
    elif apy > 0:
        # Unequal months: above the textbook rate, and below the APY (simple interest within months).
        textbook = nominal_from_apy(apy, 12)
        check(textbook < rate < apy, where, f"monthly APY {apy_text}: rate {rate} not between {textbook} and APY")


def build_hysa():
    """Section 10 ledgers, with the identities of 10.6 for months and years checked for every case.

    Also checks the contribution counts as in section 5, the day-by-day
    restatement of 10.4 (the same unrounded interest every month), the
    calibration identity of 10.3 for every rate entry, the APY earned null
    rule of 10.5, and that a zero contribution with a frequency gives the
    same rows as `none`.
    """
    cases = []
    calibrated = set()
    null_months = 0
    for spec in hysa_cases():
        case_id = spec["id"]
        AUDIT.case = case_id
        check_hysa_inputs(spec)
        principal = spec["principal_cents"]
        years = spec["years"]
        compounding = spec["compounding"]
        rates = spec["rates"]
        frequency = spec["contribution_frequency"]
        contribution = spec["contribution_cents"]
        timing = spec["timing"]
        args = (principal, years, compounding, rates, frequency, contribution, timing)
        ledger = hysa_ledger(*args)
        monthly = ledger["monthly"]
        yearly = ledger["yearly"]
        counts = ledger["month_counts"]
        count = ledger["contribution_count"]
        total_contributions = 0 if frequency == "none" else contribution * count
        total_interest = sum(row[4] for row in monthly)
        final = monthly[-1][5]

        # Section 10.6 identities (as section 5.5) for months and for years.
        check(len(monthly) == 12 * years and len(yearly) == years, case_id, "wrong number of rows")
        check(final == principal + total_contributions + total_interest, case_id,
              "final differs from principal plus contributions plus interest")
        check(final == yearly[-1][4], case_id, "final differs from the last year's end")
        for rows, label in ((monthly, "month"), (yearly, "year")):
            starts = [row[-4] for row in rows]
            check(starts[0] == principal, case_id, f"{label} 1 does not start at the principal")
            check(sum(row[-3] for row in rows) == total_contributions, case_id, f"{label}ly contributions do not add up")
            check(sum(row[-2] for row in rows) == total_interest, case_id, f"{label}ly interest does not add up")
            for index, row in enumerate(rows):
                start, added, interest, end = row[-4:]
                check(row[0] == index + 1, case_id, f"{label} {row[0]} out of order")
                check(end == start + added + interest, case_id, f"{label} {row[0]}: end differs from the sum")
                check(min(start, added, interest, end) >= 0, case_id, f"{label} {row[0]}: negative value")
                if index > 0:
                    check(start == rows[index - 1][-1], case_id, f"{label} {row[0]}: start differs from the last end")
        for year_row in yearly:
            months = monthly[12 * (year_row[0] - 1):12 * year_row[0]]
            check(sum(row[1] for row in months) == YEAR_DAYS, case_id, f"year {year_row[0]}: months do not make 365 days")
            check([row[1] for row in months] == MONTH_LENGTHS, case_id, f"year {year_row[0]}: month lengths differ")
            check(year_row[1] == months[0][2] and year_row[4] == months[-1][5], case_id,
                  f"year {year_row[0]}: start or end differs from its months")
        for row, found in zip(monthly, counts):
            check(row[3] == contribution * found, case_id, f"month {row[0]}: contributions are not C times the count")
        check(max(row[4] for row in monthly) < HYSA_INTEREST_LIMIT, case_id, "a credit of 1e11 cents or more")

        # Contribution counts, as in section 5.3, and their months.
        expected = expected_contribution_count(frequency, years, timing)
        check(count == expected, case_id, f"contribution_count {count}, expected {expected}")
        if frequency in COINCIDING_FREQUENCIES:
            every = 12 // COINCIDING_FREQUENCIES[frequency]
            first = 1 if timing == "start" else every
            pattern = [1 if (month - first) % every == 0 else 0 for month in range(1, 12 * years + 1)]
            check(counts == pattern, case_id, f"{frequency} {timing}: contributions in the wrong months")
        if frequency == "weekly":
            check(sum(counts[:12]) == (53 if timing == "start" else 52), case_id, "weekly year 1 count differs from 5.3")

        # Section 10.5: no APY earned exactly when the average daily balance is 0, which needs a
        # zero start balance, no interest, and every contribution of the month at its end.
        for row, value, cent_days in zip(monthly, ledger["apy_earned"], ledger["cent_days"]):
            check((value is None) == (cent_days == 0), case_id, f"month {row[0]}: APY earned null rule")
            if value is None:
                null_months += 1
                check(row[2] == 0 and row[4] == 0, case_id, f"month {row[0]}: no APY earned with a balance")
                continue
            check(value >= 0, case_id, f"month {row[0]}: negative APY earned")
            # The same value from the section 4 formula (checked against Appendix A, part II).
            regdd = regdd_apy_percent(row[4], Decimal(cent_days) / row[1], row[1])
            check(abs(value - regdd) <= max(abs(regdd), ONE) * HYSA_TOLERANCE, case_id,
                  f"month {row[0]}: APY earned {value}, section 4 formula {regdd}")
        # With daily compounding and no contributions in a month, the unrounded interest
        # annualizes to exactly the APY: (g^L)^(365/L) = g^365 = 1 + APY.
        if compounding == "daily":
            for row, value, found in zip(monthly, ledger["unrounded"], counts):
                if found == 0 and row[2] > 0:
                    apy = Decimal([entry for entry in rates if entry["from_month"] <= row[0]][-1]["apy"])
                    earned = apy_earned_percent(value, row[2] * row[1], row[1])
                    check(abs(earned - 100 * apy) <= HYSA_TOLERANCE * 100, case_id,
                          f"month {row[0]}: unrounded APY earned {earned}, APY {apy}")

        # Section 10.4 restated day by day: the same unrounded interest and the same rows.
        rows, unrounded = without_audit(hysa_daily_restatement, *args)
        check(rows == monthly, case_id, f"differs from the day-by-day restatement: {first_difference(monthly, rows)}")
        for month, (left, right) in enumerate(zip(ledger["unrounded"], unrounded), start=1):
            if abs(left - right) > max(abs(left), ONE) * HYSA_TOLERANCE:
                check(False, case_id, f"month {month}: unrounded interest {left} and day by day {right}")
                break
        # A deposit left alone at one APY grows by (1 + APY) a year (10.3), apart from rounding:
        # each monthly credit is off by at most half a cent, and that error grows at most to
        # (1 + APY)^Y by the end.
        if (frequency == "none" or contribution == 0) and len(rates) == 1:
            growth = (ONE + Decimal(rates[0]["apy"])) ** years
            check(abs(final - principal * growth) <= HALF * 12 * years * growth, case_id,
                  f"final {final} is too far from principal * (1 + APY)^Y = {principal * growth}")
        if frequency != "none" and contribution == 0:
            alone = without_audit(hysa_ledger, principal, years, compounding, rates, "none", 0, "end")
            check(alone["monthly"] == monthly, case_id,
                  f"differs from none: {first_difference(monthly, alone['monthly'])}")

        # Section 10.3: the calibration identity for every rate entry.
        entries = hysa_rate_entries(rates, compounding)
        for entry in rates:
            if (entry["apy"], compounding) not in calibrated:
                calibrated.add((entry["apy"], compounding))
                rate = next(item["rate"] for item in entries if item["from_month"] == entry["from_month"])
                check_hysa_calibration(entry["apy"], compounding, rate, case_id)

        # Section 2 rounding restated for these nonnegative values: half away from zero is floor(value + 1/2).
        for row, value in zip(monthly, ledger["unrounded"]):
            check(row[4] == int((value + HALF).to_integral_value(rounding=ROUND_FLOOR)), case_id,
                  f"month {row[0]}: {value} credited as {row[4]}")

        # Audit: rounding points a double-precision engine could round differently.
        for month, value in enumerate(ledger["unrounded"], start=1):
            distance = abs(value - value.to_integral_value(rounding=ROUND_FLOOR) - HALF)
            if distance < abs(value) * HYSA_NEAR_HALF:
                HYSA_NEAR.append((case_id, month, value))
            if value != 0:
                closest = (distance / abs(value), case_id, month, value)
                if not HYSA_CLOSEST or closest[0] < HYSA_CLOSEST[0][0]:
                    HYSA_CLOSEST[:] = [closest]

        cases.append({
            "id": case_id,
            "principal_cents": principal,
            "years": years,
            "compounding": compounding,
            "rates": [{**entry, "annual_rate": sig(item["rate"])} for entry, item in zip(rates, entries)],
            "contribution_frequency": frequency,
            "contribution_cents": contribution,
            "timing": timing,
            "final_balance_cents": final,
            "contribution_count": count,
            "total_contributions_cents": total_contributions,
            "total_interest_cents": total_interest,
            "monthly": monthly,
            "monthly_apy_earned_percent": [None if value is None else sig(value) for value in ledger["apy_earned"]],
            "yearly": yearly,
        })

    check(null_months > 0, "hysa.json", "no case has a month without APY earned")
    ids = [case["id"] for case in cases]
    check(len(set(ids)) == len(ids), "hysa.json", "duplicate case ids")
    return fixture(cases=cases)


# schedules.json: section 11, day, month and year rows (v1.4)

# Section 11.3: day rows are written only for cases of at most this many years.
SCHEDULE_DAY_YEARS = 2
HALF_FRACTION = Fraction(1, 2)
# Savings credits whose distance from a half is below 1e-9 of the value, as the hysa audit lists.
SCHEDULE_NEAR = []


def as_decimal(value):
    """An accrued amount (an exact Fraction, or a Decimal) as a Decimal in the 100-digit context."""
    if isinstance(value, Fraction):
        return Decimal(value.numerator) / value.denominator
    return Decimal(value)


def schedule_days(principal_cents, years, periods, credits, contributions, contribution_cents, timing, accrual):
    """Section 11.1: one row per day of the term, days 0 to T - 1, in order.

    `periods` are the crediting periods (a, b) in order, covering the term;
    `credits` the engine's credited interest of each (5.4 step 4 or 10.4);
    `contributions` the set S of 5.3; and accrual(index, day_balance, so_far,
    length) the unrounded interest accrued on a day of period `index`, with
    `so_far` the amount accrued on the earlier days of that period (step 4).

    Returns the rows [day, opening, deposits, accrued, credited, closing,
    cumulative_interest] (accrued unrounded) and the day balances of step 3.
    """
    term = YEAR_DAYS * years
    boundaries = set(contributions)
    rows, day_balances = [], []
    closing = principal_cents
    cumulative = 0
    index = 0
    so_far = 0
    for day in range(term):
        a, b = periods[index]
        if day >= b:
            index += 1
            a, b = periods[index]
            so_far = 0
        if not a <= day < b:
            raise OracleError(f"day {day} lies in no crediting period")
        length = b - a
        # Step 1: start timing takes the contribution at boundary d, end timing the one at d + 1.
        made = day if timing == "start" else day + 1
        deposits = contribution_cents * (1 if made in boundaries else 0)
        # Step 2.
        opening = closing
        # Step 3: an end-timing deposit is made at the end of the day and earns from the next.
        day_balance = opening + deposits if timing == "start" else opening
        # Step 4.
        accrued = accrual(index, day_balance, so_far, length)
        so_far += accrued
        # Step 5: a credit only on the last day of a crediting period.
        credited = credits[index] if day == b - 1 else 0
        # Steps 6 and 7.
        closing = opening + deposits + credited
        cumulative += credited
        rows.append([day, opening, deposits, accrued, credited, closing, cumulative])
        day_balances.append(day_balance)
    if index != len(periods) - 1 or periods[-1][1] != term:
        raise OracleError("the crediting periods do not end with the term")
    return rows, day_balances


def schedule_group(day_rows, ranges):
    """Section 11.2: one row per run of consecutive days, given as (number, first day, last day + 1)."""
    rows = []
    for number, low, high in ranges:
        days = day_rows[low:high]
        rows.append([number, days[0][1], sum(row[2] for row in days), sum(row[3] for row in days),
                     sum(row[4] for row in days), days[-1][5], days[-1][6]])
    return rows


def month_ranges(years):
    """Section 11.2: month m is days a_m to b_m - 1 of the 5.1 calendar."""
    boundaries = calendar_boundaries(MONTH_STARTS, years)
    return [(month, a, b) for month, (a, b) in enumerate(zip(boundaries, boundaries[1:]), start=1)]


def year_ranges(years):
    """Section 11.2: year y is days 365(y - 1) to 365y - 1."""
    return [(year, YEAR_DAYS * (year - 1), YEAR_DAYS * year) for year in range(1, years + 1)]


def schedule_output(rows):
    """Section 11.3: money in integer cents, accrued as a decimal string of 25 significant digits."""
    return [[number, opening, deposits, sig(as_decimal(accrued)), credited, closing, cumulative]
            for number, opening, deposits, accrued, credited, closing, cumulative in rows]


def check_schedule_grouping(case_id, label, rows, numbers, principal, final, total_interest, total_deposits):
    """Section 11.2 identities for one grouping (days, months or years), and 11.1's final values."""
    check([row[0] for row in rows] == numbers, case_id, f"{label} rows are not numbered {numbers[0]} to {numbers[-1]}")
    check(rows[0][1] == principal, case_id, f"{label}: the first opening is not the principal")
    cumulative = 0
    for index, (number, opening, deposits, accrued, credited, closing, row_cumulative) in enumerate(rows):
        where = f"{label} {number}"
        check(closing == opening + deposits + credited, case_id, f"{where}: closing differs from the sum")
        if index > 0:
            check(opening == rows[index - 1][5], case_id, f"{where}: opening differs from the last closing")
        cumulative += credited
        check(row_cumulative == cumulative, case_id, f"{where}: cumulative interest does not add up")
        check(min(opening, deposits, credited, closing) >= 0 and accrued >= 0, case_id, f"{where}: negative value")
    check(rows[-1][5] == final, case_id, f"{label}: the last closing differs from the final balance")
    check(rows[-1][6] == total_interest, case_id, f"{label}: the last cumulative differs from the total interest")
    check(sum(row[2] for row in rows) == total_deposits, case_id, f"{label}: deposits do not add up")


def check_schedule(case_id, spec, day_rows, day_balances, periods, credits, values, cent_days, end_balances,
                   period_ends, final, total_interest, total_deposits, exact):
    """The cross-checks of section 11 shared by both engines. Returns the month and year rows.

    (a) every crediting period's credit is within half a cent of the sum of
    its days' accrued amounts, and is that sum rounded half up; that sum is
    the engine's unrounded value (exactly when `exact`, else to a relative
    1e-80) and the sum of the day balances is the engine's cent-days; the
    period's last closing is the engine's end balance. (b) and (d) the
    identities of 11.2 for days, months and years. Also: every day balance
    equals the principal, the contributions at boundaries up to that day and
    the credits of the periods already ended, counted independently of the
    walk; a credit falls only on the last day of a crediting period; a year's
    accrued is the sum of its months'; a year's credits differ from its
    accrued amounts by at most half a cent per crediting period ending in it.
    """
    principal = spec["principal_cents"]
    years = spec["years"]
    contribution = spec["contribution_cents"]
    contributions = contribution_boundaries(spec["contribution_frequency"], years, spec["timing"])
    half = HALF_FRACTION if exact else HALF
    for index, (a, b) in enumerate(periods):
        accrued = sum(row[3] for row in day_rows[a:b])
        credited = credits[index]
        where = f"crediting period {a} to {b}"
        check(-half <= credited - accrued <= half, case_id, f"{where}: credited {credited}, accrued {accrued}")
        check(credited == math.floor(accrued + half), case_id, f"{where}: credit is not the accrued sum rounded")
        value = values[index]
        if exact:
            check(accrued == value, case_id, f"{where}: accrued {accrued}, engine {value}")
        else:
            check(abs(accrued - value) <= max(abs(value), ONE) * HYSA_TOLERANCE, case_id,
                  f"{where}: accrued {accrued}, engine {value}")
        check(sum(day_balances[a:b]) == cent_days[index], case_id, f"{where}: day balances differ from cent-days")
        check(day_rows[b - 1][5] == end_balances[index], case_id, f"{where}: closing differs from the engine")
    # The day balance restated: principal + C * |{t in S : t <= d}| + credits of periods with b <= d.
    credited_before = 0
    next_period = 0
    for day, balance in enumerate(day_balances):
        while next_period < len(periods) and periods[next_period][1] <= day:
            credited_before += credits[next_period]
            next_period += 1
        expected = principal + contribution * bisect_right(contributions, day) + credited_before
        if balance != expected:
            check(False, case_id, f"day {day}: day balance {balance}, restated {expected}")
            break
    ends = {b for _, b in periods}
    contribution_set = set(contributions)
    for row in day_rows:
        if row[4] != 0:
            check(row[0] + 1 in ends, case_id, f"day {row[0]}: a credit on a day that ends no crediting period")
        if spec["contribution_frequency"] != "none":
            made = row[0] if spec["timing"] == "start" else row[0] + 1
            check(row[2] == (contribution if made in contribution_set else 0), case_id, f"day {row[0]}: deposits")
    term = YEAR_DAYS * years
    check_schedule_grouping(case_id, "day", day_rows, list(range(term)), principal, final, total_interest,
                            total_deposits)
    ranges = month_ranges(years)
    months = schedule_group(day_rows, ranges)
    years_rows = schedule_group(day_rows, year_ranges(years))
    check_schedule_grouping(case_id, "month", months, list(range(1, 12 * years + 1)), principal, final,
                            total_interest, total_deposits)
    check_schedule_grouping(case_id, "year", years_rows, list(range(1, years + 1)), principal, final,
                            total_interest, total_deposits)
    for row, (_, _, b) in zip(months, ranges):
        if row[4] != 0:
            check(b in ends, case_id, f"month {row[0]}: a credit in a month that ends no crediting period")
    for row in years_rows:
        in_months = months[12 * (row[0] - 1):12 * row[0]]
        from_months = sum(month[3] for month in in_months)
        if exact:
            check(row[3] == from_months, case_id, f"year {row[0]}: accrued differs from its months")
        else:
            check(abs(row[3] - from_months) <= max(abs(row[3]), ONE) * HYSA_TOLERANCE, case_id,
                  f"year {row[0]}: accrued differs from its months")
        ending = sum(1 for b in ends if YEAR_DAYS * (row[0] - 1) < b <= YEAR_DAYS * row[0])
        check(ending == period_ends, case_id, f"year {row[0]}: {ending} crediting periods end in it")
        check(abs(row[4] - row[3]) <= half * ending, case_id,
              f"year {row[0]}: credited {row[4]} and accrued {row[3]} differ by more than half a cent a period")
    return months, years_rows


def check_year_month_tables(case_id, schedule):
    """Section 14 (v1.7) on a written schedule: the month rows under each year add up to the year row.

    Under year y are the month rows 12(y - 1) + 1 to 12y. Deposits and credited
    add up to the year's exactly; the opening of the first month and the
    closing and cumulative interest of the last are the year's; the accrued
    amounts, written to 25 significant digits, add up to the year's within the
    rounding of the strings (inside the oracle they agree exactly or to
    1e-80, check_schedule).
    """
    months = schedule["months"]
    check(len(months) == 12 * len(schedule["years"]), case_id, "section 14: not twelve months a year")
    for year in schedule["years"]:
        number = year[0]
        under = months[12 * (number - 1):12 * number]
        where = f"section 14: year {number}"
        check([row[0] for row in under] == list(range(12 * (number - 1) + 1, 12 * number + 1)), case_id,
              f"{where}: month numbers")
        check(under[0][1] == year[1], case_id, f"{where}: the first month's opening is not the year's")
        check(sum(row[2] for row in under) == year[2], case_id, f"{where}: deposits do not add up")
        check(sum(row[4] for row in under) == year[4], case_id, f"{where}: credited does not add up")
        check(under[-1][5] == year[5] and under[-1][6] == year[6], case_id,
              f"{where}: the last month's closing or cumulative interest is not the year's")
        check(written_sum_matches(Decimal(year[3]), [Decimal(row[3]) for row in under]), case_id,
              f"{where}: accrued {year[3]} is not the sum of its months'")


def check_compound_inputs(spec):
    """Section 5 input rules, so that no schedule case is invalid by mistake."""
    case_id = spec["id"]
    check(0 <= spec["principal_cents"] <= 10_000_000_000, case_id, "principal out of range")
    check(0 <= Decimal(spec["annual_rate"]) <= 1, case_id, "rate out of range")
    check(spec["periods_per_year"] in COMPOUNDING_FREQUENCIES, case_id, "unsupported compounding frequency")
    check(1 <= spec["years"] <= 100, case_id, "years out of range")
    check(spec["contribution_frequency"] in CONTRIBUTION_FREQUENCIES, case_id, "unknown contribution frequency")
    check(0 <= spec["contribution_cents"] <= 10_000_000_000, case_id, "contribution out of range")
    if spec["contribution_frequency"] == "none":
        check(spec["contribution_cents"] == 0 and spec["timing"] == "end", case_id, "a none case records 0 and end")


def compound_schedule(spec):
    """Section 11 for the section 5 engine: days, months and years, every check applied."""
    case_id = spec["id"]
    check_compound_inputs(spec)
    principal = spec["principal_cents"]
    rate_text = spec["annual_rate"]
    n = spec["periods_per_year"]
    years = spec["years"]
    frequency = spec["contribution_frequency"]
    contribution = spec["contribution_cents"]
    timing = spec["timing"]
    ledger = compound_ledger(principal, Decimal(rate_text), n, years, frequency, contribution, timing)
    periods = [(a, b) for a, b, _, _, _ in ledger["periods"]]
    credits = [interest for _, _, _, interest, _ in ledger["periods"]]
    cent_days = [days for _, _, days, _, _ in ledger["periods"]]
    end_balances = [end for _, _, _, _, end in ledger["periods"]]
    # Section 2 allows exact fractions: the rate is a short decimal, so every accrued amount is exact.
    rate = Fraction(rate_text)
    values = [Fraction(days) * rate / (n * (b - a)) for (a, b), days in zip(periods, cent_days)]

    def accrual(index, day_balance, so_far, length):
        # Section 11.1 step 4, section 5: day_balance * annual_rate / (n * L).
        return Fraction(day_balance) * rate / (n * length)

    contributions = contribution_boundaries(frequency, years, timing)
    day_rows, day_balances = schedule_days(principal, years, periods, credits, contributions, contribution, timing,
                                           accrual)
    final = ledger["yearly"][-1][4]
    total_interest = ledger["total_interest"]
    total_deposits = contribution * ledger["contribution_count"]
    months, years_rows = check_schedule(case_id, spec, day_rows, day_balances, periods, credits, values, cent_days,
                                        end_balances, n, final, total_interest, total_deposits, exact=True)
    # (c) The year rows equal the yearly table of 5.5, and the day-by-day restatement of 5.4.
    as_yearly = [[row[0], row[1], row[2], row[4], row[5]] for row in years_rows]
    check(as_yearly == ledger["yearly"], case_id,
          f"year rows differ from 5.5: {first_difference(as_yearly, ledger['yearly'])}")
    daily = without_audit(compound_daily_balances, principal, Decimal(rate_text), n, years, frequency, contribution,
                          timing)
    check(as_yearly == daily, case_id,
          f"year rows differ from the day-by-day sum: {first_difference(as_yearly, daily)}")
    # Section 11.2: with n = 1, 2 or 4 a month that ends no compounding period credits nothing.
    ends = {b for _, b in periods}
    for month, a, b in month_ranges(years):
        if b not in ends:
            check(months[month - 1][4] == 0, case_id, f"month {month}: credit without a compounding period end")
    if rate == 0:
        check(all(row[3] == 0 and row[4] == 0 for row in day_rows), case_id, "interest at a zero rate")
    return day_rows, months, years_rows


def savings_schedule(spec):
    """Section 11 for the section 10 engine: days, months and years, every check applied."""
    case_id = spec["id"]
    check_hysa_inputs(spec)
    principal = spec["principal_cents"]
    years = spec["years"]
    compounding = spec["compounding"]
    rates = spec["rates"]
    frequency = spec["contribution_frequency"]
    contribution = spec["contribution_cents"]
    timing = spec["timing"]
    args = (principal, years, compounding, rates, frequency, contribution, timing)
    ledger = hysa_ledger(*args)
    monthly = ledger["monthly"]
    entries = hysa_rate_entries(rates, compounding)
    periods = [(a, b) for _, a, b in month_ranges(years)]
    credits = [row[4] for row in monthly]
    in_effect = [rate_in_effect(entries, month) for month in range(1, 12 * years + 1)]

    def accrual(index, day_balance, so_far, length):
        entry = in_effect[index]
        if compounding == "monthly":
            # Section 11.1 step 4, section 10 monthly compounding: day_balance * r / 365.
            return Decimal(day_balance) * entry["rate"] / YEAR_DAYS
        # Daily compounding: (day_balance + A) * (g - 1), A accrued earlier in the period.
        return (day_balance + so_far) * (entry["growth"] - ONE)

    contributions = contribution_boundaries(frequency, years, timing)
    day_rows, day_balances = schedule_days(principal, years, periods, credits, contributions, contribution, timing,
                                           accrual)
    final = monthly[-1][5]
    total_interest = sum(credits)
    total_deposits = contribution * ledger["contribution_count"]
    months, years_rows = check_schedule(case_id, spec, day_rows, day_balances, periods, credits, ledger["unrounded"],
                                        ledger["cent_days"], [row[5] for row in monthly], 12, final, total_interest,
                                        total_deposits, exact=False)
    # (c) The month rows equal the monthly rows of 10.6 and the year rows its yearly rows.
    as_monthly = [[row[0], b - a, row[1], row[2], row[4], row[5]] for row, (a, b) in zip(months, periods)]
    check(as_monthly == monthly, case_id, f"month rows differ from 10.6: {first_difference(as_monthly, monthly)}")
    as_yearly = [[row[0], row[1], row[2], row[4], row[5]] for row in years_rows]
    check(as_yearly == ledger["yearly"], case_id,
          f"year rows differ from 10.6: {first_difference(as_yearly, ledger['yearly'])}")
    # The day-by-day restatement of 10.4 gives the same rows and the same accrued amounts.
    restated, unrounded = without_audit(hysa_daily_restatement, *args)
    check(restated == monthly, case_id,
          f"differs from the day-by-day restatement: {first_difference(monthly, restated)}")
    for row, value in zip(months, unrounded):
        if abs(row[3] - value) > max(abs(value), ONE) * HYSA_TOLERANCE:
            check(False, case_id, f"month {row[0]}: accrued {row[3]}, day by day {value}")
            break
    for row, entry in zip(months, in_effect):
        if entry["apy"] == 0:
            check(row[3] == 0 and row[4] == 0, case_id, f"month {row[0]}: interest at an APY of 0")
    # Audit, as for hysa.json: credits a double-precision engine could round differently.
    for month, value in enumerate(ledger["unrounded"], start=1):
        distance = abs(value - value.to_integral_value(rounding=ROUND_FLOOR) - HALF)
        if distance < abs(value) * HYSA_NEAR_HALF:
            SCHEDULE_NEAR.append((case_id, month, value))
    return day_rows, months, years_rows


def schedule_cases():
    """Section 11 cases: (engine, inputs). Terms of one or two years carry day rows."""
    compound = [
        # Every compounding frequency, every contribution frequency, both timings, with days.
        compound_case("compound-n1-weekly-start-1-year", 1_000_000, "0.05", 1, 1, "weekly", 5_000, "start"),
        compound_case("compound-n2-biweekly-end-1-year", 250_000, "0.0425", 2, 1, "biweekly", 15_000, "end"),
        compound_case("compound-n4-monthly-start-2-years", 5_000_000, "0.07", 4, 2, "monthly", 25_000, "start"),
        compound_case("compound-n12-quarterly-end-1-year", 1_234_567, "0.035", 12, 1, "quarterly", 100_000, "end"),
        compound_case("compound-n365-annually-start-1-year", 75_000, "0.06", 365, 1, "annually", 600_000, "start"),
        compound_case("compound-zero-principal-n365-weekly-end-1-year", 0, "0.04", 365, 1, "weekly", 3_500, "end"),
        compound_case("compound-zero-rate-n4-biweekly-start-1-year", 500_000, "0", 4, 1, "biweekly", 20_000,
                      "start"),
        # January's credit is 59 on exactly 58.5 accrued (compound.json's exact-half case, one year).
        compound_case("compound-exact-half-mid-period-weekly-monthly-start-1-year", 10_000, "0.06", 12, 1, "weekly",
                      620, "start"),
        # Every input at its maximum, daily compounding.
        compound_case("compound-max-principal-max-contribution-rate-1-weekly-daily-1-year-start", 10_000_000_000,
                      "1", 365, 1, "weekly", 10_000_000_000, "start"),
        # Longer terms: months and years only.
        compound_case("compound-n2-weekly-end-5-years", 1_500_000, "0.045", 2, 5, "weekly", 7_500, "end"),
        compound_case("compound-n1-biweekly-start-10-years", 2_000_000, "0.06", 1, 10, "biweekly", 20_000, "start"),
        no_contribution_case("compound-n12-none-10-years", 2_000_000, "0.0525", 12, 10),
        compound_case("compound-n12-monthly-start-30-years", 1_000_000, "0.05", 12, 30, "monthly", 25_000, "start"),
        compound_case("compound-zero-principal-n365-quarterly-end-20-years", 0, "0.0525", 365, 20, "quarterly",
                      100_000, "end"),
    ]
    savings = [
        hysa_case("savings-daily-weekly-start-1-year", 1_000_000, 1, "daily", "0.045", "weekly", 2_500, "start"),
        hysa_case("savings-monthly-biweekly-end-two-entries-1-year", 250_000, 1, "monthly",
                  [(1, "0.0525"), (4, "0.04")], "biweekly", 10_000, "end"),
        hysa_case("savings-daily-four-entries-rate-falls-monthly-end-2-years", 2_000_000, 2, "daily", FALLING_RATES,
                  "monthly", 25_000, "end"),
        hysa_case("savings-monthly-three-entries-through-zero-quarterly-start-1-year", 1_000_000, 1, "monthly",
                  [(1, "0.045"), (5, "0"), (9, "0.03")], "quarterly", 150_000, "start"),
        hysa_case("savings-daily-zero-principal-monthly-end-1-year", 0, 1, "daily", "0.045", "monthly", 10_000,
                  "end"),
        hysa_case("savings-monthly-max-principal-max-contribution-weekly-apy-1-1-year", 10_000_000_000, 1,
                  "monthly", "1", "weekly", 10_000_000_000, "start"),
        # Longer terms: months and years only.
        hysa_case("savings-daily-annually-start-10-years", 500_000, 10, "daily", "0.0435", "annually", 500_000,
                  "start"),
        hysa_case("savings-monthly-weekly-end-four-entries-10-years", 750_000, 10, "monthly",
                  [(1, "0.05"), (25, "0.04"), (61, "0.035"), (100, "0.0425")], "weekly", 5_000, "end"),
        # The longest savings term: 18,250 days of daily accrual, grouped into 600 months.
        hysa_case("savings-daily-biweekly-start-50-years", 100_000, 50, "daily", "0.04", "biweekly", 20_000, "start"),
    ]
    return [("compound", spec) for spec in compound] + [("savings", spec) for spec in savings]


def build_schedules():
    """Section 11 schedules for both engines, with the cross-checks of check_schedule and the engine comparisons."""
    cases = []
    covered = {"n": set(), "frequency": set(), "timing": set(), "compounding": set(), "entries": set()}
    for engine, spec in schedule_cases():
        case_id = spec["id"]
        AUDIT.case = f"schedules {case_id}"
        if engine == "compound":
            day_rows, months, years_rows = compound_schedule(spec)
            covered["n"].add(spec["periods_per_year"])
        else:
            day_rows, months, years_rows = savings_schedule(spec)
            covered["compounding"].add(spec["compounding"])
            covered["entries"].add(len(spec["rates"]))
        covered["frequency"].add(spec["contribution_frequency"])
        if spec["contribution_frequency"] != "none":
            covered["timing"].add(spec["timing"])
        inputs = {key: value for key, value in spec.items() if key != "id"}
        # Section 11.3 names the year rows `years`, which is also the name of the input Y, so the
        # rows go in their own object under `schedule`; the inputs stay exactly as in 5.6 and 10.7.
        schedule = {"months": schedule_output(months), "years": schedule_output(years_rows)}
        if spec["years"] <= SCHEDULE_DAY_YEARS:
            schedule["days"] = schedule_output(day_rows)
        check_year_month_tables(case_id, schedule)
        cases.append({"id": case_id, "engine": engine, **inputs, "schedule": schedule})
    expected = {"n": set(COMPOUNDING_FREQUENCIES), "frequency": set(CONTRIBUTION_FREQUENCIES),
                "timing": {"start", "end"}, "compounding": set(HYSA_COMPOUNDING), "entries": {1, 2, 3, 4}}
    for key, values in expected.items():
        check(covered[key] == values, "schedules.json", f"{key} covered {sorted(covered[key])}, expected all")
    ids = [case["id"] for case in cases]
    check(len(set(ids)) == len(ids), "schedules.json", "duplicate case ids")
    return fixture(cases=cases)


# illustration.json: section 12, the rate illustration (v1.4; 12.5 v1.7)

ILLUSTRATION_FREQUENCIES = [1, 2, 4, 12, 52, 365]
# Section 5.2 (v1.4): weekly periods start at the year offsets 0, 7, ..., 357, and the last of each
# year (days 357 to 364) has 8 days. They restart every year.
WEEKLY_STARTS = list(range(0, 358, 7))
ILLUSTRATION_OFFSETS = {**COMPOUNDING_OFFSETS, 52: WEEKLY_STARTS}
# Section 12.4: near_half lists shown values within this relative distance of a half cent.
ILLUSTRATION_NEAR_HALF = Decimal("1e-13")
ILLUSTRATION_MAX_YEARS = 30
# The cases with entries in near_half, as (case, count, rows checked).
ILLUSTRATION_NEAR = []
# Section 12.5: the oracle's balances B_k are 100-digit decimals, and each period's interest is taken
# as B_p - B_(p-1) exactly, so that every 12.5 identity holds exactly; it must equal the defining
# B_(p-1) * annual_rate / n to this fraction of B_(p-1).
ILLUSTRATION_INTEREST_TOLERANCE = Fraction(1, 10**90)
# Rows written with accrued, periods checked, and the largest |(B_p - B_(p-1)) - B_(p-1) r / n| / B_(p-1).
ILLUSTRATION_ACCRUAL = {"rows": 0, "periods": 0, "deviation": Fraction(0)}


def illustration_period_ends(n, years):
    """Sections 5.2 and 12.2: the end boundary of every compounding period for n, in order.

    Each period lies inside one year, as section 5.2 requires.
    """
    boundaries = calendar_boundaries(ILLUSTRATION_OFFSETS[n], years)
    ends = []
    for a, b in zip(boundaries, boundaries[1:]):
        year = a // YEAR_DAYS + 1
        if not YEAR_DAYS * (year - 1) <= a < b <= YEAR_DAYS * year:
            raise OracleError(f"n = {n}: period {a} to {b} is not inside one year")
        ends.append(b)
    return ends


def illustration_k_counted(n, t):
    """Section 12.2 k(t) counted from the calendar directly, a cross-check of the period ends.

    Each completed year has n periods. Inside a year, at day offset o: none
    have ended for n = 1; o for n = 365; for n = 52 the periods end at 7, 14,
    ..., 357 (7j for j = 1 to 51) and at 365, so min(o // 7, 51); for n = 2,
    4 and 12 the starts after 0 that are at most o.
    """
    done, offset = divmod(t, YEAR_DAYS)
    if n == 1:
        within = 0
    elif n == 365:
        within = offset
    elif n == 52:
        within = min(offset // 7, 51)
    else:
        starts = {2: HALF_YEAR_STARTS, 4: QUARTER_STARTS, 12: MONTH_STARTS}[n]
        within = sum(1 for start in starts if 0 < start <= offset)
    return n * done + within


def illustration_period_days(n, day):
    """Section 5.2 restated from the calendar: the length in days of the compounding period that contains `day`.

    A cross-check of the period boundaries for the day walk of 12.5: 1 day
    for n = 365; for n = 52, 7 days, or 8 in the last week of the year
    (offsets 357 to 364); for n = 1, 2, 4 and 12 the stretch between the
    starts on either side of the day's offset in its year.
    """
    offset = day % YEAR_DAYS
    if n == 365:
        return 1
    if n == 52:
        return 8 if offset >= 357 else 7
    starts = {1: YEAR_STARTS, 2: HALF_YEAR_STARTS, 4: QUARTER_STARTS, 12: MONTH_STARTS}[n] + [YEAR_DAYS]
    index = bisect_right(starts, offset)
    return starts[index] - starts[index - 1]


def illustration_accrued(starts, ends, interests, t0, t1):
    """Section 12.5: the interest accrued from boundary t0 to boundary t1, an exact fraction of a cent.

    The sum over the periods p of I_p * overlap_p / L_p, where period p runs
    from s_p to e_p (L_p = e_p - s_p days) and overlap_p = min(e_p, t1) -
    max(s_p, t0) is the number of days it shares with the row. Only the
    periods that overlap the row are visited: from the first whose end is
    after t0 to the last that starts before t1.
    """
    total = Fraction(0)
    index = bisect_right(ends, t0)
    while index < len(ends) and starts[index] < t1:
        overlap = min(ends[index], t1) - max(starts[index], t0)
        if overlap <= 0:
            raise OracleError(f"period {starts[index]} to {ends[index]} does not overlap the row {t0} to {t1}")
        total += interests[index] * Fraction(overlap, ends[index] - starts[index])
        index += 1
    return total


def illustration_limit(deposit_cents, accounts, years):
    """Section 12.2: the first year up to `years` whose end balance exceeds 2^53 - 1 cents for some account, or None."""
    for year in range(1, years + 1):
        for account in accounts:
            n = account["n"]
            if deposit_cents * (ONE + Decimal(account["annual_rate"]) / n) ** (n * year) > MAX_SAFE_INTEGER:
                return year
    return None


def check_weekly_calendar():
    """Section 5.2 (v1.4): 52 weekly starts, 51 periods of 7 days and a last of 8, every year."""
    where = "section 5.2 weekly periods"
    check(len(WEEKLY_STARTS) == 52 and WEEKLY_STARTS[-1] == 357, where,
          f"starts {WEEKLY_STARTS[:3]} ... {WEEKLY_STARTS[-1]}")
    for years in (1, 3):
        ends = illustration_period_ends(52, years)
        lengths = [b - a for a, b in zip([0] + ends, ends)]
        check(lengths == ([7] * 51 + [8]) * years, where, f"{years} year(s): period lengths differ")


def illustration_case(case_id, deposit_cents, years, accounts):
    """Section 12.4 inputs. Each account is (annual_rate, n) or ("apy", APY, n) for an account entered by its APY.

    An APY account's rate is section 3's n((1 + APY)^(1/n) - 1), written to 25
    significant digits; the APY is kept (outside the fixture) for a check.
    """
    entries, sources = [], []
    for account in accounts:
        if account[0] == "apy":
            _, apy, n = account
            entries.append({"annual_rate": sig(nominal_from_apy(Decimal(apy), n)), "n": n})
            sources.append(apy)
        else:
            rate, n = account
            entries.append({"annual_rate": rate, "n": n})
            sources.append(None)
    return {"id": case_id, "deposit_cents": deposit_cents, "years": years, "accounts": entries}, sources


def illustration_cases():
    """Section 12 cases: every n, 1 to 3 accounts, one-year cases with days, and up to 30 years."""
    return [
        # One year: day, month and year rows.
        illustration_case("three-accounts-one-year-apy-4.5-daily-monthly-weekly", 1_000_000, 1,
                          [("apy", "0.045", 365), ("0.045", 12), ("0.0435", 52)]),
        illustration_case("annual-semiannual-quarterly-one-year", 250_000, 1, [("0.05", 1), ("0.05", 2), ("0.05", 4)]),
        illustration_case("max-deposit-rate-1-weekly-daily-annual-one-year", 10_000_000_000, 1,
                          [("1", 52), ("1", 365), ("1", 1)]),
        # 1 * (1 + 1/2) = 1.5 cents exactly after the first half year: an exact half, rounded up.
        illustration_case("one-cent-rate-1-semiannual-monthly-one-year", 1, 1, [("1", 2), ("1", 12)]),
        illustration_case("zero-rate-daily-weekly-one-year", 500_000, 1, [("0", 365), ("0", 52)]),
        # Several years: month and year rows.
        illustration_case("thirty-years-monthly-daily-annual", 1_000_000, 30, [("0.05", 12), ("0.0499", 365),
                                                                             ("0.0512", 1)]),
        # 14 years would take the daily account to about 1.19e16 cents, above 2^53 - 1 (refused).
        illustration_case("max-deposit-rate-1-thirteen-years-longest-accepted", 10_000_000_000, 13,
                          [("1", 1), ("1", 52), ("1", 365)]),
        # 10,000,000,000 * 2^19 is below 2^53 - 1 and * 2^20 above it.
        illustration_case("max-deposit-rate-1-annual-nineteen-years-longest-accepted", 10_000_000_000, 19,
                          [("1", 1)]),
        illustration_case("max-deposit-thirty-years-daily", 10_000_000_000, 30, [("apy", "0.05", 365)]),
        illustration_case("one-cent-rate-1-thirty-years-quarterly-semiannual", 1, 30, [("1", 4), ("1", 2)]),
        illustration_case("one-cent-zero-rate-five-years-weekly-annual", 1, 5, [("0", 52), ("0", 1)]),
        illustration_case("ten-years-weekly-daily-apy-4.25", 10_000_000, 10, [("apy", "0.0425", 52),
                                                                              ("apy", "0.0425", 365)]),
        illustration_case("two-years-semiannual-quarterly-monthly", 123_457, 2, [("0.035", 2), ("0.035", 4),
                                                                                ("0.035", 12)]),
        # 3 * 1.5 = 4.5 cents exactly from June to November of year 1: half away from zero gives 5,
        # where rounding half to even would give 4.
        illustration_case("three-cents-rate-1-semiannual-two-years-exact-half", 3, 2, [("1", 2)]),
    ]


# The longest accepted cases: (case, the first refused year).
ILLUSTRATION_LIMITS = {
    "max-deposit-rate-1-thirteen-years-longest-accepted": 14,
    "max-deposit-rate-1-annual-nineteen-years-longest-accepted": 20,
}


def check_illustration_inputs(spec):
    """Section 12.1 input rules, so that no case is invalid by mistake."""
    case_id = spec["id"]
    check(1 <= spec["deposit_cents"] <= 10_000_000_000, case_id, "deposit out of range")
    check(1 <= spec["years"] <= ILLUSTRATION_MAX_YEARS, case_id, "years out of range")
    check(1 <= len(spec["accounts"]) <= 3, case_id, "1 to 3 accounts")
    for account in spec["accounts"]:
        check(0 <= Decimal(account["annual_rate"]) <= 1, case_id, "rate out of range")
        check(account["n"] in ILLUSTRATION_FREQUENCIES, case_id, f"unsupported n {account['n']}")


def build_illustration():
    """Section 12 rows for every account, with the year-end, k and cap checks.

    Checks: the weekly periods of 5.2; k(t) from the period ends equals an
    independent count at every boundary of the term, and over each year takes
    every value from n(y - 1) to ny; every year-end balance is deposit * (1 +
    APY)^y with APY from section 3 (and, for an account entered by its APY,
    that APY); every balance equals deposit * exp(k ln(1 + r/n)) computed
    separately; days, months and years agree where they end together; no
    balance exceeds 2^53 - 1 cents, and the longest accepted cases are refused
    one year later.

    Section 12.5 (v1.7), for every row of every account: the accrued interest
    from the periods the row overlaps equals the sum of a day-by-day walk; it
    is positive at a positive rate and 0 at a zero rate; since the start of
    the year it runs ahead of the credited interest (unrounded) by exactly the
    accrued part of the period still open, which is in [0, I_open) and 0 at a
    boundary that ends a period; each year's accrued is B_(ny) - B_(n(y-1)),
    and the sum of its months' (with the credited, opening and closing of
    section 14), and each month's the sum of its days', all exactly. Each
    period's interest B_p - B_(p-1) is the defining B_(p-1) * annual_rate / n
    to a relative 1e-90. The written case is checked again from its strings.
    """
    check_weekly_calendar()
    cases = []
    covered = set()
    covered_accrual = set()
    for spec, sources in illustration_cases():
        case_id = spec["id"]
        AUDIT.case = f"illustration {case_id}"
        check_illustration_inputs(spec)
        deposit = spec["deposit_cents"]
        years = spec["years"]
        term = YEAR_DAYS * years
        limit = illustration_limit(deposit, spec["accounts"], ILLUSTRATION_MAX_YEARS + 1)
        if case_id in ILLUSTRATION_LIMITS:
            check(limit == ILLUSTRATION_LIMITS[case_id], case_id, f"first refused year {limit}")
        check(limit is None or limit > years, case_id, f"refused (result-too-large) from year {limit}")
        # Section 12.3: rows end at boundary t: day d at d + 1, month m at b_m, year y at 365y.
        groupings = [("years", [YEAR_DAYS * year for year in range(1, years + 1)]),
                     ("months", calendar_boundaries(MONTH_STARTS, years)[1:])]
        if years == 1:
            groupings.append(("days", [day + 1 for day in range(YEAR_DAYS)]))
        results, near_half = [], []
        rows_checked = 0
        for account_index, (account, apy_source) in enumerate(zip(spec["accounts"], sources)):
            rate = Decimal(account["annual_rate"])
            n = account["n"]
            covered.add(n)
            growth = ONE + rate / n
            log_growth = growth.ln()
            ends = illustration_period_ends(n, years)
            check(len(ends) == n * years and ends[-1] == term, case_id, f"n = {n}: {len(ends)} periods")
            ks = [bisect_right(ends, t) for t in range(term + 1)]
            for t, k in enumerate(ks):
                if k != illustration_k_counted(n, t):
                    check(False, case_id, f"n = {n}: k({t}) = {k}, counted {illustration_k_counted(n, t)}")
                    break
            for year in range(1, years + 1):
                within = ks[YEAR_DAYS * (year - 1):YEAR_DAYS * year + 1]
                check(within == sorted(within) and sorted(set(within)) == list(range(n * (year - 1), n * year + 1)),
                      case_id, f"n = {n}: k over year {year} does not run from 0 to n")
            balances = {}
            apy = apy_from_nominal(rate, n)

            def balance_after(k):
                if k not in balances:
                    # Section 12.2: B_k = deposit * (1 + annual_rate / n)^k, unrounded.
                    value = deposit * growth ** k
                    separate = deposit * (log_growth * k).exp()
                    check(abs(value - separate) <= value * Decimal("1e-85"), case_id,
                          f"n = {n}: B_{k} is {value}, exp form {separate}")
                    check(value <= MAX_SAFE_INTEGER, case_id, f"n = {n}: B_{k} exceeds 2^53 - 1")
                    balances[k] = value
                return balances[k]

            for year in range(1, years + 1):
                value = balance_after(ks[YEAR_DAYS * year])
                check(ks[YEAR_DAYS * year] == n * year, case_id, f"n = {n}: k at the end of year {year}")
                expected = deposit * (ONE + apy) ** year
                check(abs(value - expected) <= expected * Decimal("1e-80"), case_id,
                      f"n = {n}: year {year} balance {value}, deposit * (1 + APY)^y = {expected}")
                if apy_source is not None:
                    stated = deposit * (ONE + Decimal(apy_source)) ** year
                    check(abs(value - stated) <= stated * Decimal("1e-22"), case_id,
                          f"n = {n}: year {year} balance {value}, deposit * (1 + {apy_source})^y = {stated}")
                if rate == 0:
                    check(value == deposit, case_id, f"n = {n}: growth at a zero rate")
            # Section 12.5: period p (index p - 1 here) runs from s_p to e_p. Its interest I_p is taken
            # as B_p - B_(p-1), exact on the oracle's balances, so that the identities below hold
            # exactly; it must be the defining B_(p-1) * annual_rate / n to a relative 1e-90.
            starts = [0] + ends[:-1]
            exact_balances = [Fraction(balance_after(k)) for k in range(n * years + 1)]
            interests = [later - earlier for earlier, later in zip(exact_balances, exact_balances[1:])]
            exact_rate = Fraction(account["annual_rate"])
            for p, interest in enumerate(interests, start=1):
                deviation = abs(interest - exact_balances[p - 1] * exact_rate / n) / exact_balances[p - 1]
                if deviation > ILLUSTRATION_INTEREST_TOLERANCE:
                    check(False, case_id, f"n = {n}: B_{p} - B_{p - 1} is not B_{p - 1} * annual_rate / n")
                    break
                ILLUSTRATION_ACCRUAL["deviation"] = max(ILLUSTRATION_ACCRUAL["deviation"], deviation)
            ILLUSTRATION_ACCRUAL["periods"] += len(interests)
            check(all(interest > 0 for interest in interests) if rate > 0 else not any(interests), case_id,
                  f"n = {n}: a period's interest is not positive (or, at a zero rate, not 0)")
            # The day walk, a cross-check of the overlap sums: day d lies in the period after the k(d)
            # periods that have ended by boundary d, and accrues I_p / L_p, with L_p from the calendar.
            day_accrued = []
            for day in range(term):
                index = ks[day]
                length = illustration_period_days(n, day)
                if not starts[index] <= day < ends[index] or length != ends[index] - starts[index]:
                    check(False, case_id, f"n = {n}: day {day} is not in period {index + 1} of {length} days")
                    break
                day_accrued.append(interests[index] / length)
            result = {}
            by_end = {}
            # Rows as (t0, t1, opening, closing, accrued) for the nesting checks of sections 12.5 and 14.
            spans = {}
            for grouping, row_ends in groupings:
                rows = []
                spans[grouping] = []
                previous = deposit
                t0 = 0
                for number, t in enumerate(row_ends, start=1):
                    k = ks[t]
                    value = balance_after(k)
                    shown = round_cents(value)
                    check(shown >= previous, case_id, f"n = {n}: {grouping} row {number}: shown value falls")
                    where = f"n = {n}: {grouping} row {number}"
                    # Section 12.5: the interest accrued from t0 (the previous row's end, 0 for the first
                    # row) to t, from the periods the row overlaps; the day walk must give the same.
                    accrued = illustration_accrued(starts, ends, interests, t0, t)
                    check(accrued == sum(day_accrued[t0:t], Fraction(0)), case_id,
                          f"{where}: accrued {as_decimal(accrued)} differs from the day walk")
                    check(accrued > 0 if rate > 0 else accrued == 0, case_id,
                          f"{where}: accrued {as_decimal(accrued)} at a rate of {rate}")
                    # Accrued minus credited (unrounded, B_(k(t)) - B_(n(y-1))) since the start of the
                    # year is the accrued part of the period still open at t: 0 at a boundary that ends a
                    # period (the end of the term among them), else I_open * (t - s) / L, in [0, I_open).
                    if t0 % YEAR_DAYS == 0:
                        year_start_k = ks[t0]
                        since_year_start = Fraction(0)
                    since_year_start += accrued
                    ahead = since_year_start - (exact_balances[k] - exact_balances[year_start_k])
                    if k > 0 and ends[k - 1] == t:
                        check(ahead == 0, case_id, f"{where}: accrued runs ahead of credited at a period end")
                    else:
                        open_start, open_end, open_interest = starts[k], ends[k], interests[k]
                        check(open_start < t < open_end, case_id, f"{where}: no period is open at {t}")
                        check(ahead == open_interest * Fraction(t - open_start, open_end - open_start), case_id,
                              f"{where}: accrued runs ahead of credited by {as_decimal(ahead)}")
                        check(0 <= ahead < open_interest if open_interest > 0 else ahead == 0, case_id,
                              f"{where}: accrued minus credited {as_decimal(ahead)} is outside [0, I_open)")
                        if grouping == "months" and ahead > 0:
                            covered_accrual.add(("a period open at a month end", n))
                    if grouping == "years":
                        check(accrued == exact_balances[n * number] - exact_balances[n * (number - 1)], case_id,
                              f"{where}: accrued is not B_(ny) - B_(n(y-1))")
                    spans[grouping].append((t0, t, previous, shown, accrued))
                    previous = shown
                    t0 = t
                    label = number - 1 if grouping == "days" else number
                    row = [label, k, sig(value), shown, sig(as_decimal(accrued))]
                    # The rows of different groupings that end together share k, balance and shown_cents
                    # (not accrued, which covers a different stretch of days).
                    if t in by_end:
                        check(by_end[t] == row[1:4], case_id, f"n = {n}: rows ending at {t} differ")
                    by_end[t] = row[1:4]
                    rows.append(row)
                    rows_checked += 1
                    ILLUSTRATION_ACCRUAL["rows"] += 1
                    # Section 2 restated for these positive values: half away from zero is floor(value + 1/2).
                    check(shown == math.floor(value + HALF), case_id, f"n = {n}: {value} shown as {shown}")
                    distance = abs(value - value.to_integral_value(rounding=ROUND_FLOOR) - HALF)
                    near = distance <= value * ILLUSTRATION_NEAR_HALF
                    # The same test restated: the interval value * (1 -+ 1e-13) contains a half cent j + 1/2.
                    low = value * (ONE - ILLUSTRATION_NEAR_HALF)
                    high = value * (ONE + ILLUSTRATION_NEAR_HALF)
                    check(near == (math.floor(high - HALF) >= math.ceil(low - HALF)), case_id,
                          f"n = {n}: {grouping} row {number}: near_half tests disagree")
                    if near:
                        near_half.append([account_index, grouping, number])
                result[grouping] = rows
            # Sections 12.5 and 14: the month rows under each year, and the day rows under each month.
            check_illustration_nesting(case_id, f"n = {n}: years", spans["years"], spans["months"])
            if "days" in spans:
                check_illustration_nesting(case_id, f"n = {n}: months", spans["months"], spans["days"])
            if rate == 0:
                covered_accrual.add(("a zero rate",))
            elif years == 1:
                # With day rows; for n = 52 these include the 8-day last week, days 357 to 364.
                covered_accrual.add(("day rows", n))
            else:
                covered_accrual.add(("several years", n))
            if apy_source is not None:
                covered_accrual.add(("entered by APY",))
            results.append(result)
        if near_half:
            ILLUSTRATION_NEAR.append((case_id, len(near_half), rows_checked))
        case = {**spec, "results": results, "near_half": near_half}
        check_illustration_fixture(case)
        cases.append(case)
    check(covered == set(ILLUSTRATION_FREQUENCIES), "illustration.json", f"n covered {sorted(covered)}")
    # Section 12.5 coverage: every n at a positive rate with day rows and over several years, a period
    # open at a month end for every n whose periods do not end at every month end, a zero rate, and an
    # account entered by its APY.
    wanted = ({("day rows", n) for n in ILLUSTRATION_FREQUENCIES}
              | {("several years", n) for n in ILLUSTRATION_FREQUENCIES}
              | {("a period open at a month end", n) for n in (1, 2, 4, 52)}
              | {("a zero rate",), ("entered by APY",)})
    check(covered_accrual == wanted, "illustration.json",
          f"12.5 coverage: missing {sorted(wanted - covered_accrual)}, unexpected {sorted(covered_accrual - wanted)}")
    ids = [case["id"] for case in cases]
    check(len(set(ids)) == len(ids), "illustration.json", "duplicate case ids")
    return fixture(cases=cases)


def check_illustration_nesting(case_id, label, outer, inner):
    """Sections 12.5 and 14: the inner rows (months, or days) under each outer row (years, or months).

    Rows are (t0, t1, opening, closing, accrued) with opening and closing the
    shown_cents at t0 and t1 (the deposit at boundary 0) and accrued exact.
    The inner rows under an outer row cover its days exactly, in order; their
    accrued interest adds up to its accrued exactly, their credited (closing
    minus opening, 12.3) to its credited; the first's opening and the last's
    closing are its own.
    """
    position = 0
    for number, (t0, t1, opening, closing, accrued) in enumerate(outer, start=1):
        under = []
        while position < len(inner) and inner[position][1] <= t1:
            under.append(inner[position])
            position += 1
        where = f"{label} row {number}"
        if not (under and under[0][0] == t0 and under[-1][1] == t1
                and all(left[1] == right[0] for left, right in zip(under, under[1:]))):
            check(False, case_id, f"{where}: the rows under it do not cover it")
            continue
        check(sum((row[4] for row in under), Fraction(0)) == accrued, case_id,
              f"{where}: accrued is not the sum of the rows under it")
        check(sum(row[3] - row[2] for row in under) == closing - opening, case_id,
              f"{where}: credited is not the sum of the rows under it")
        check(under[0][2] == opening and under[-1][3] == closing, case_id,
              f"{where}: opening or closing differs from the rows under it")
    check(position == len(inner), case_id, f"{label}: {len(inner) - position} row(s) under no row")


def check_illustration_fixture(case):
    """Sections 12.4 (v1.7 addition), 12.5 and 14 checked on the written case, as a reader of the fixture sees it.

    Every row is [number, k, balance, shown_cents, accrued] with balance and
    accrued as strings. For each account, each year's accrued is the growth of
    the written balance over the year (from the previous year's, or the
    deposit) and the sum of its months', and, where there are day rows, each
    month's is the sum of its days', all within the rounding of the strings.
    """
    case_id = case["id"]
    for index, result in enumerate(case["results"]):
        where = f"fixture: account {index}"
        for grouping, rows in result.items():
            check(all(len(row) == 5 and isinstance(row[2], str) and isinstance(row[4], str) for row in rows),
                  case_id, f"{where}: {grouping} rows are not [number, k, balance, shown_cents, accrued]")
        months = result["months"]
        previous = Decimal(case["deposit_cents"])
        for year in result["years"]:
            accrued = Decimal(year[4])
            balance = Decimal(year[2])
            check(written_sum_matches(accrued, [balance, -previous]), case_id,
                  f"{where}: year {year[0]}: accrued {year[4]} is not the growth of the balance")
            under = months[12 * (year[0] - 1):12 * year[0]]
            check(written_sum_matches(accrued, [Decimal(row[4]) for row in under]), case_id,
                  f"{where}: year {year[0]}: accrued {year[4]} is not the sum of its months'")
            previous = balance
        if "days" in result:
            days = result["days"]
            for (month, a, b), row in zip(month_ranges(case["years"]), months):
                check(written_sum_matches(Decimal(row[4]), [Decimal(day[4]) for day in days[a:b]]), case_id,
                      f"{where}: month {month}: accrued {row[4]} is not the sum of its days'")


# loan_reports.json: section 13, loan schedules, payoff comparison and payment breakdown (v1.5; 13.5 and
# 13.6 v1.6)

# Section 13.6: month rows are written only for terms of at most this many months.
LOAN_MONTH_ROWS_MAX_TERM = 120
# Sections 6 and 13.1 input ranges.
LOAN_AMOUNT_MAX = 10_000_000_000
LOAN_TERM_MAX = 600
FIRST_PAYMENT_YEARS = (1970, 2200)
# Section 13.1: the four optional housing costs (13.5 "all four optional amounts").
LOAN_HOUSING_COSTS = ("property_tax_annual_cents", "insurance_annual_cents", "mortgage_insurance_monthly_cents",
                      "hoa_monthly_cents")
# Section 13.6: the breakdown keys, in fixture order.
BREAKDOWN_KEYS = ["property_tax_cents", "insurance_cents", "escrow_cents", "mortgage_insurance_cents",
                  "mortgage_payment_cents", "hoa_cents", "total_monthly_cents"]
# The seeded loans of the section 13.4 sweep (FINANCIAL_MODEL_REQUIREMENTS 8.2); none is written.
LOAN_SWEEP_COUNT = 240
LOAN_SWEEP_SEED = 20261115
LOAN_SWEEP_SUMMARY = {}


def payment_date(first_payment, k):
    """Section 13.2: the calendar month of payment k, the first payment's month plus k - 1 months.

    Months are counted as 12 * year + (month - 1), so a count that passes
    December carries into January of the next year. Returns [year, month].
    """
    year, month = first_payment
    carried_year, month_index = divmod(12 * year + (month - 1) + (k - 1), 12)
    return [carried_year, month_index + 1]


def loan_month_rows(first_payment, rows):
    """Section 13.3: the section 6 rows with their dates (13.2) and two running totals.

    Rows are [month, year, calendar_month, payment, interest, principal,
    extra, balance, cumulative_interest, cumulative_principal], where
    cumulative_principal counts the principal and the extra of this row and
    every earlier one.
    """
    result = []
    cumulative_interest = 0
    cumulative_principal = 0
    for month, payment, interest, principal, extra, balance in rows:
        cumulative_interest += interest
        cumulative_principal += principal + extra
        year, calendar_month = payment_date(first_payment, month)
        result.append([month, year, calendar_month, payment, interest, principal, extra, balance,
                       cumulative_interest, cumulative_principal])
    return result


def loan_year_rows(month_rows):
    """Section 13.3: one row per calendar year with a payment dated in it, in order.

    Rows are [year, payments, scheduled, principal, interest, extra,
    end_balance, cumulative_interest, cumulative_principal]: the number of
    month rows dated in the year, the sums of their payment (`scheduled`),
    principal, interest and extra, then the balance and the two running
    totals at the year's last row.
    """
    years = []
    for row in month_rows:
        _, year, _, payment, interest, principal, extra, balance, cumulative_interest, cumulative_principal = row
        if not years or years[-1][0] != year:
            years.append([year, 0, 0, 0, 0, 0, 0, 0, 0])
        totals = years[-1]
        totals[1] += 1
        totals[2] += payment
        totals[3] += principal
        totals[4] += interest
        totals[5] += extra
        totals[6:] = [balance, cumulative_interest, cumulative_principal]
    return years


def monthly_share(annual_cents):
    """Section 13.5: round_cents(annual_cents / 12), the monthly part of a yearly amount."""
    return round_cents(Decimal(annual_cents) / 12)


def payment_breakdown(payment, spec):
    """Section 13.5: the scheduled payment M kept apart from the other housing costs.

    The escrow items are the monthly property tax and homeowners insurance,
    each its own annual amount / 12 rounded to the cent; the mortgage payment
    is M plus the escrow items plus mortgage insurance (what the lender or
    servicer is paid); the total adds HOA dues, which are paid separately.
    The subtotals are sums of whole cents: nothing more is rounded (v1.6).
    """
    tax = monthly_share(spec["property_tax_annual_cents"])
    insurance = monthly_share(spec["insurance_annual_cents"])
    escrow = tax + insurance
    mortgage_insurance = spec["mortgage_insurance_monthly_cents"]
    mortgage_payment = payment + escrow + mortgage_insurance
    hoa = spec["hoa_monthly_cents"]
    return {
        "property_tax_cents": tax,
        "insurance_cents": insurance,
        "escrow_cents": escrow,
        "mortgage_insurance_cents": mortgage_insurance,
        "mortgage_payment_cents": mortgage_payment,
        "hoa_cents": hoa,
        "total_monthly_cents": mortgage_payment + hoa,
    }


def one_time_entries(pairs):
    """Section 6 one-time payments as amortize takes them, from the fixture's [[month, amount_cents], ...]."""
    return [{"month": month, "amount_cents": amount} for month, amount in pairs]


def loan_report(spec):
    """Section 13 for one loan, built on the section 6 amortization (amortize).

    The accelerated plan is the loan as entered and the baseline the same
    loan with no extra and no one-time payments (13.4). Returns the payment
    M, the section 6 rows of both plans, the month and year rows of the
    accelerated plan (13.3) and the breakdown (13.5).
    """
    principal = spec["principal_cents"]
    rate = Decimal(spec["annual_rate"])
    term = spec["term_months"]
    payment, rows = amortize(principal, rate, term, spec["extra_monthly_cents"], one_time_entries(spec["one_time"]))
    # The baseline repeats the plan's rounding points up to its first extra payment, so the
    # audit does not count them twice.
    baseline_payment, baseline_rows = without_audit(amortize, principal, rate, term, 0, [])
    if baseline_payment != payment:
        raise OracleError(f"{spec['id']}: the baseline has a different payment")
    month_rows = loan_month_rows(spec["first_payment"], rows)
    return {
        "payment": payment,
        "rows": rows,
        "baseline_rows": baseline_rows,
        "month_rows": month_rows,
        "year_rows": loan_year_rows(month_rows),
        "breakdown": payment_breakdown(payment, spec),
    }


def exact_payment(principal_cents, rate, term_months):
    """Section 6's M from exact fractions, a cross-check of scheduled_payment.

    `rate` is a Fraction. M = P * i / (1 - (1 + i)^(-N)) with i = r / 12 is
    P * r * (12 + r)^N / (12 * ((12 + r)^N - 12^N)), an exact fraction, or P / N
    at a zero rate; it is positive, so half away from zero is floor(x + 1/2).
    """
    if rate == 0:
        value = Fraction(principal_cents, term_months)
    else:
        grown = (12 + rate) ** term_months
        value = principal_cents * rate * grown / (12 * (grown - 12 ** term_months))
    return math.floor(value + HALF_FRACTION)


def loan_report_restated(spec, extra_monthly_cents, one_time):
    """Sections 6, 13.2 and 13.3 restated, a cross-check of loan_report written separately from amortize.

    Exact fractions throughout: the payment from exact_payment, each month's
    interest floor(balance * r / 12 + 1/2) (half away from zero, the balance
    being nonnegative), the one-time amounts due found by scanning the list
    each month, the date advanced one calendar month per payment (to January
    of the next year after December), and the year rows accumulated during
    the walk. Returns (payment, month rows, year rows) in the layouts of
    loan_month_rows and loan_year_rows.
    """
    principal = spec["principal_cents"]
    rate = Fraction(spec["annual_rate"])
    term = spec["term_months"]
    payment = exact_payment(principal, rate, term)
    if rate > 0 and payment <= math.floor(principal * rate / 12 + HALF_FRACTION):
        raise OracleError(f"{spec['id']}: payment-does-not-cover-interest (restated)")
    year, calendar_month = spec["first_payment"]
    balance = principal
    cumulative_interest = 0
    cumulative_principal = 0
    month_rows = []
    year_rows = {}
    for month in range(1, term + 1):
        interest = math.floor(balance * rate / 12 + HALF_FRACTION)
        if month == term or balance + interest <= payment:
            paid, principal_part, extra = balance + interest, balance, 0
        else:
            paid, principal_part = payment, payment - interest
            due = extra_monthly_cents + sum(amount for due_month, amount in one_time if due_month == month)
            extra = min(due, balance - principal_part)
        balance -= principal_part + extra
        cumulative_interest += interest
        cumulative_principal += principal_part + extra
        month_rows.append([month, year, calendar_month, paid, interest, principal_part, extra, balance,
                           cumulative_interest, cumulative_principal])
        totals = year_rows.setdefault(year, [year, 0, 0, 0, 0, 0, 0, 0, 0])
        totals[1] += 1
        totals[2] += paid
        totals[3] += principal_part
        totals[4] += interest
        totals[5] += extra
        totals[6] = balance
        totals[7] = cumulative_interest
        totals[8] = cumulative_principal
        if balance == 0:
            break
        calendar_month += 1
        if calendar_month == 13:
            calendar_month = 1
            year += 1
    return payment, month_rows, list(year_rows.values())


def check_amortization(case_id, label, principal, payment, rows, term):
    """Section 6 identities for one plan, and the row arithmetic they rest on."""
    total_interest = sum(row[2] for row in rows)
    total_paid = sum(row[1] + row[4] for row in rows)
    check(sum(row[3] + row[4] for row in rows) == principal, case_id, f"{label}: principal plus extra differs from P")
    check(rows[-1][5] == 0, case_id, f"{label}: final balance is not 0")
    check(total_paid == principal + total_interest, case_id, f"{label}: total paid differs from P plus interest")
    check(1 <= len(rows) <= term, case_id, f"{label}: {len(rows)} rows for a term of {term}")
    balance = principal
    for index, (month, paid, interest, principal_part, extra, after) in enumerate(rows):
        check(month == index + 1, case_id, f"{label}: month {month} out of order")
        check(paid == interest + principal_part, case_id, f"{label} month {month}: payment is not interest plus principal")
        check(after == balance - principal_part - extra, case_id, f"{label} month {month}: balance does not carry")
        check(min(paid, interest, principal_part, extra, after) >= 0, case_id, f"{label} month {month}: negative value")
        if month < len(rows):
            check(paid == payment and after > 0, case_id, f"{label} month {month}: not a scheduled payment")
        balance = after


def check_closed_form_balance(case_id, principal, rate_text, payment, rows):
    """FINANCIAL_MODEL_REQUIREMENTS 5.1: the baseline balance against B_k = P(1 + i)^k - M((1 + i)^k - 1) / i.

    Each month's interest is rounded by at most half a cent, and each error
    then grows with the balance, so after k scheduled payments the balance is
    within ((1 + i)^k - 1) / (2i) of B_k (exactly P - kM at a zero rate). The
    final row is left out: it is not a payment of M.
    """
    rate = Decimal(rate_text)
    i = rate / 12
    growth = ONE
    for month, _, _, _, _, balance in rows[:-1]:
        if rate == 0:
            check(balance == principal - month * payment, case_id, f"month {month}: balance {balance} is not P - kM")
            continue
        growth *= ONE + i
        closed = principal * growth - payment * (growth - ONE) / i
        bound = (growth - ONE) / (2 * i)
        if abs(balance - closed) > bound + Decimal("1e-50"):
            check(False, case_id, f"month {month}: balance {balance}, closed form {closed}, bound {bound}")
            return


def check_loan_report_inputs(spec):
    """Sections 6 and 13.1 input rules, so that no case is invalid by mistake."""
    case_id = spec["id"]
    term = spec["term_months"]
    check(1 <= spec["principal_cents"] <= LOAN_AMOUNT_MAX, case_id, "principal out of range")
    check(0 <= Decimal(spec["annual_rate"]) <= 1, case_id, "rate out of range")
    check(1 <= term <= LOAN_TERM_MAX, case_id, "term out of range")
    check(0 <= spec["extra_monthly_cents"] <= LOAN_AMOUNT_MAX, case_id, "extra out of range")
    for month, amount in spec["one_time"]:
        check(1 <= month <= term and 1 <= amount <= LOAN_AMOUNT_MAX, case_id, f"one-time [{month}, {amount}]")
    year, month = spec["first_payment"]
    check(FIRST_PAYMENT_YEARS[0] <= year <= FIRST_PAYMENT_YEARS[1] and 1 <= month <= 12, case_id,
          f"first payment {spec['first_payment']}")
    for key in ("property_tax_annual_cents", "insurance_annual_cents", "mortgage_insurance_monthly_cents",
                "hoa_monthly_cents"):
        check(0 <= spec[key] <= LOAN_AMOUNT_MAX, case_id, f"{key} out of range")
    for key, value in spec.items():
        if key not in ("id", "annual_rate", "one_time", "first_payment"):
            check(isinstance(value, int) and not isinstance(value, bool), case_id, f"{key} is not an integer")


def check_loan_report(spec, report):
    """Every section 13 check for one case. Returns facts about the case for the coverage check.

    (a) Section 6 identities for both plans, and the payment against its
    exact fraction. (b) 13.2: the first row is dated first_payment, each row
    one calendar month after the last (January after December), the payoff
    date is the last row's and first_payment plus months - 1. (c) 13.3: the
    running totals, cumulative principal plus balance equal to P on every
    row, and every year identity. (d) 13.4: savings never negative, the
    plan's balance never above the baseline's, and with no extra paid the
    two plans identical. (e) The restatement in fractions gives the same
    payment, month rows and year rows for both plans. (f) 13.5: each monthly
    share restated in integers, the escrow, mortgage payment and total
    identities, the v1.5 total, HOA dues never changing the mortgage payment
    (the breakdown recomputed without them and with them alone), the
    breakdown with all four optional amounts 0 (escrow 0, mortgage payment
    and total both M), and the first month's payment equal to M. (g) The
    baseline balance against the closed form.
    """
    case_id = spec["id"]
    principal = spec["principal_cents"]
    term = spec["term_months"]
    first_payment = spec["first_payment"]
    payment = report["payment"]
    rows = report["rows"]
    baseline_rows = report["baseline_rows"]
    month_rows = report["month_rows"]
    year_rows = report["year_rows"]
    months = len(rows)
    total_interest = sum(row[2] for row in rows)
    total_paid = sum(row[1] + row[4] for row in rows)

    # (a) Section 6.
    check_amortization(case_id, "plan", principal, payment, rows, term)
    check_amortization(case_id, "baseline", principal, payment, baseline_rows, term)
    check(payment == exact_payment(principal, Fraction(spec["annual_rate"]), term), case_id,
          "the payment differs from its exact fraction")
    check(not without_audit(payment_refused, principal, Decimal(spec["annual_rate"]), term), case_id,
          "a refused loan is written")
    if (principal, spec["annual_rate"], term) == (20_000_000, "0.06", 360):
        check(payment == 119_910, case_id, f"reference payment {payment}, expected 119,910 (FMR 5.1)")

    # (b) Section 13.2 dates.
    check([row[0] for row in month_rows] == [row[0] for row in rows], case_id, "month rows are not the section 6 rows")
    check(month_rows[0][1:3] == list(first_payment), case_id, "the first row is not dated first_payment")
    for previous, row in zip(month_rows, month_rows[1:]):
        year, calendar_month = previous[1:3]
        expected = [year + 1, 1] if calendar_month == 12 else [year, calendar_month + 1]
        check(row[1:3] == expected, case_id, f"month {row[0]}: dated {row[1:3]} after {previous[1:3]}")
    for row in month_rows:
        check(1 <= row[2] <= 12, case_id, f"month {row[0]}: calendar month {row[2]}")
    payoff = month_rows[-1][1:3]
    first_count = 12 * first_payment[0] + first_payment[1] - 1
    check(12 * payoff[0] + payoff[1] - 1 == first_count + months - 1, case_id,
          f"payoff {payoff} is not first_payment plus {months} - 1 months")
    check(payoff == payment_date(first_payment, months), case_id, "payoff differs from the date of the last payment")

    # (c) Section 13.3 month rows.
    cumulative_interest = 0
    cumulative_principal = 0
    for row, source in zip(month_rows, rows):
        check(row[:1] + row[3:8] == source, case_id, f"month {row[0]}: differs from the section 6 row")
        cumulative_interest += row[4]
        cumulative_principal += row[5] + row[6]
        check(row[8:] == [cumulative_interest, cumulative_principal], case_id, f"month {row[0]}: running totals")
        check(row[9] + row[7] == principal, case_id, f"month {row[0]}: cumulative principal plus balance is not P")
    check(month_rows[-1][8] == total_interest and month_rows[-1][9] == principal, case_id, "last running totals")

    # (c) Section 13.3 year rows.
    first_year, first_month = first_payment
    check([row[0] for row in year_rows] == list(range(first_year, payoff[0] + 1)), case_id,
          "year rows are not the consecutive years from the first payment to the payoff")
    expected_counts = []
    remaining = months
    room = 13 - first_month
    while remaining > 0:
        expected_counts.append(min(room, remaining))
        remaining -= expected_counts[-1]
        room = 12
    check([row[1] for row in year_rows] == expected_counts, case_id,
          f"payments per year {[row[1] for row in year_rows]}, expected {expected_counts}")
    previous_end = principal
    running_interest = 0
    running_principal = 0
    for year, payments, scheduled, principal_part, interest, extra, end, year_interest, year_principal in year_rows:
        dated = [row for row in month_rows if row[1] == year]
        check(len(dated) == payments, case_id, f"year {year}: {payments} payments, {len(dated)} dated in it")
        check(scheduled == sum(row[3] for row in dated), case_id, f"year {year}: scheduled is not the sum of payment")
        check(scheduled == principal_part + interest, case_id, f"year {year}: scheduled is not principal plus interest")
        check(previous_end - principal_part - extra == end, case_id,
              f"year {year}: previous end balance minus principal and extra is not the end balance")
        check(end == dated[-1][7], case_id, f"year {year}: end balance is not the last row's")
        running_interest += interest
        running_principal += principal_part + extra
        check([year_interest, year_principal] == [running_interest, running_principal], case_id,
              f"year {year}: running totals")
        check(year_principal + end == principal, case_id, f"year {year}: cumulative principal plus balance is not P")
        previous_end = end
    check(sum(row[3] + row[5] for row in year_rows) == principal, case_id, "years' principal plus extra is not P")
    check(year_rows[-1][6] == 0, case_id, "the last end balance is not 0")
    check(sum(row[4] for row in year_rows) == total_interest, case_id, "years' interest is not total_interest")
    check(sum(row[1] for row in year_rows) == months, case_id, "years' payments are not the months")
    check(sum(row[2] + row[5] for row in year_rows) == total_paid, case_id, "years' payments are not total_paid")

    # (d) Section 13.4.
    baseline_months = len(baseline_rows)
    baseline_interest = sum(row[2] for row in baseline_rows)
    months_saved = baseline_months - months
    interest_saved = baseline_interest - total_interest
    check(months_saved >= 0 and interest_saved >= 0, case_id,
          f"extra payments increased months or interest: saved {months_saved} months, {interest_saved} cents")
    for row, base in zip(rows, baseline_rows):
        check(row[5] <= base[5], case_id, f"month {row[0]}: balance {row[5]} above the baseline's {base[5]}")
    extra_paid = sum(row[4] for row in rows)
    if extra_paid == 0:
        check(rows == baseline_rows, case_id, "no extra was paid but the plan differs from the baseline")
        check(months_saved == 0 and interest_saved == 0, case_id, "no extra was paid but something was saved")
    if spec["extra_monthly_cents"] == 0 and not spec["one_time"]:
        check(extra_paid == 0, case_id, "extra paid with none entered")

    # (e) The restatement, for both plans.
    restated_payment, restated_months, restated_years = without_audit(
        loan_report_restated, spec, spec["extra_monthly_cents"], spec["one_time"])
    check(restated_payment == payment, case_id, f"restated payment {restated_payment}, amortize {payment}")
    check(restated_months == month_rows, case_id,
          f"month rows differ from the restatement: {first_difference(month_rows, restated_months)}")
    check(restated_years == year_rows, case_id,
          f"year rows differ from the restatement: {first_difference(year_rows, restated_years)}")
    _, baseline_restated, _ = without_audit(loan_report_restated, spec, 0, [])
    check([row[:1] + row[3:8] for row in baseline_restated] == baseline_rows, case_id,
          "baseline rows differ from the restatement")

    # (f) Section 13.5.
    breakdown = report["breakdown"]
    for key, annual in (("property_tax_cents", spec["property_tax_annual_cents"]),
                        ("insurance_cents", spec["insurance_annual_cents"])):
        # Half away from zero of annual / 12 for a nonnegative integer: floor((annual + 6) / 12).
        check(breakdown[key] == (annual + 6) // 12, case_id, f"{key} {breakdown[key]} for {annual} a year")
        check(abs(12 * breakdown[key] - annual) <= 6, case_id, f"{key} is more than half a cent from annual / 12")
    check(breakdown["mortgage_insurance_cents"] == spec["mortgage_insurance_monthly_cents"]
          and breakdown["hoa_cents"] == spec["hoa_monthly_cents"], case_id, "monthly amounts not as entered")
    check(list(breakdown) == BREAKDOWN_KEYS, case_id, f"breakdown keys {list(breakdown)}")
    tax, insurance = breakdown["property_tax_cents"], breakdown["insurance_cents"]
    mortgage_insurance, hoa = breakdown["mortgage_insurance_cents"], breakdown["hoa_cents"]
    escrow, mortgage_payment = breakdown["escrow_cents"], breakdown["mortgage_payment_cents"]
    total = breakdown["total_monthly_cents"]
    check(escrow == tax + insurance, case_id, f"escrow {escrow} is not property tax plus insurance")
    # One rounding of the two annual amounts together, for comparison only (13.5 rounds each share): each
    # share is within half a cent of its twelfth, so the two differ by at most a cent either way.
    one_rounding = (spec["property_tax_annual_cents"] + spec["insurance_annual_cents"] + 6) // 12
    check(abs(escrow - one_rounding) <= 1, case_id, f"escrow {escrow} is over a cent from one rounding {one_rounding}")
    check(mortgage_payment == payment + escrow + mortgage_insurance, case_id,
          f"mortgage payment {mortgage_payment} is not M plus escrow plus mortgage insurance")
    check(total == mortgage_payment + hoa, case_id, f"total {total} is not the mortgage payment plus HOA dues")
    # The v1.5 total, unchanged in v1.6: M plus the four amounts, the shares restated in integers.
    restated_total = (payment + (spec["property_tax_annual_cents"] + 6) // 12
                      + (spec["insurance_annual_cents"] + 6) // 12
                      + spec["mortgage_insurance_monthly_cents"] + spec["hoa_monthly_cents"])
    check(total == restated_total, case_id, f"total {total} is not M plus the four amounts ({restated_total})")
    # HOA dues change the total and never the mortgage payment: without them the mortgage payment is
    # the same and the total lower by exactly the dues; with HOA dues alone the mortgage payment is M.
    without_hoa = without_audit(payment_breakdown, payment, {**spec, "hoa_monthly_cents": 0})
    check(without_hoa["mortgage_payment_cents"] == mortgage_payment
          and total - without_hoa["total_monthly_cents"] == hoa, case_id, "HOA dues changed the mortgage payment")
    no_costs = {**spec, **dict.fromkeys(LOAN_HOUSING_COSTS, 0)}
    hoa_alone = without_audit(payment_breakdown, payment, {**no_costs, "hoa_monthly_cents": spec["hoa_monthly_cents"]})
    check(hoa_alone["mortgage_payment_cents"] == payment and hoa_alone["total_monthly_cents"] == payment + hoa,
          case_id, "HOA dues alone: the mortgage payment is not M or the total not M plus the dues")
    # With all four optional amounts 0: escrow 0, and the mortgage payment and the total both M.
    zero = without_audit(payment_breakdown, payment, no_costs)
    check(zero["escrow_cents"] == 0 and zero["mortgage_payment_cents"] == zero["total_monthly_cents"] == payment,
          case_id, "with all four optional amounts 0 the mortgage payment and the total are not M")
    check(rows[0][1] == payment, case_id, f"the first month's payment {rows[0][1]} is not M = {payment} (13.5)")

    # (g) The closed form for the baseline balance.
    check_closed_form_balance(case_id, principal, spec["annual_rate"], payment, baseline_rows)

    # Facts for the coverage check of build_loan_reports.
    final_row = rows[-1]
    applied = {}
    for month, amount in spec["one_time"]:
        applied.setdefault(month, []).append(amount)
    # The last row is the final payment of section 6 step 2 exactly when it has no extra: after a
    # scheduled payment the balance is still positive, so only an extra can bring it to 0.
    scheduled_rows = rows if final_row[4] > 0 else rows[:-1]
    capped = any(row[4] < spec["extra_monthly_cents"] + sum(applied.get(row[0], [])) for row in scheduled_rows)
    entered = {key for key in LOAN_HOUSING_COSTS if spec[key] > 0}
    escrow_only = bool(entered) and entered <= {"property_tax_annual_cents", "insurance_annual_cents"}
    return {
        "first month": first_payment[1],
        "zero rate": Decimal(spec["annual_rate"]) == 0,
        "month rows": term <= LOAN_MONTH_ROWS_MAX_TERM,
        "term": term,
        "largest principal": principal == LOAN_AMOUNT_MAX,
        "several one-time in one month": any(len(amounts) > 1 for amounts in applied.values()),
        "one-time in month N": any(month == term for month in applied),
        "one-time in the final payment month before N": any(
            month == months < term and final_row[4] == 0 for month in applied),
        "one-time after payoff": any(month > months for month in applied),
        "paid off early by a one-time": final_row[4] > 0 and final_row[0] in applied,
        "extra capped at the balance": capped,
        "extra monthly": spec["extra_monthly_cents"] > 0,
        "months saved": months_saved > 0,
        "interest saved but no months": interest_saved > 0 and months_saved == 0,
        "extra paid, nothing saved": extra_paid > 0 and months_saved == 0 and interest_saved == 0,
        "extra entered, none paid": extra_paid == 0 and (spec["extra_monthly_cents"] > 0 or spec["one_time"]),
        "baseline ends before N": baseline_months < term,
        "final payment above M": final_row[1] > payment,
        "exact half share": any(annual % 12 == 6 for annual in (spec["property_tax_annual_cents"],
                                                                spec["insurance_annual_cents"])),
        "share rounded down": any(annual % 12 in (1, 2, 3, 4, 5) for annual in (spec["property_tax_annual_cents"],
                                                                                spec["insurance_annual_cents"])),
        "share rounded up": any(annual % 12 in (7, 8, 9, 10, 11) for annual in (spec["property_tax_annual_cents"],
                                                                               spec["insurance_annual_cents"])),
        "all four housing costs": all(spec[key] > 0 for key in (
            "property_tax_annual_cents", "insurance_annual_cents", "mortgage_insurance_monthly_cents",
            "hoa_monthly_cents")),
        # Section 13.6 (v1.6): the breakdown cases.
        "every optional amount 0": not entered,
        "HOA dues only": entered == {"hoa_monthly_cents"},
        "escrow items only": escrow_only,
        "mortgage insurance only": entered == {"mortgage_insurance_monthly_cents"},
        # The two shares rounded one at a time (13.5) against one rounding of their annual sum, in each
        # direction (13.6).
        "escrow only, a cent more than one rounding": escrow_only and escrow == one_rounding + 1,
        "escrow only, a cent less than one rounding": escrow_only and escrow == one_rounding - 1,
        "payoff after 2200": payoff[0] > FIRST_PAYMENT_YEARS[1],
        "one-time out of month order": [month for month, _ in spec["one_time"]]
        != sorted(month for month, _ in spec["one_time"]),
    }


def check_loan_report_fixture(case):
    """Section 13.6 checked on the written case alone, as a reader of the fixture sees it.

    The totals against the year rows, the payoff dates against the first
    payment, the savings against the baseline, the month rows present exactly
    for terms of at most 120 months (and then matching the year rows), and the
    breakdown: its identities (13.5), M for the mortgage payment and the total
    when all four optional amounts are 0, and its key order (13.6).
    """
    case_id = case["id"]
    yearly = case["yearly"]
    first_count = 12 * case["first_payment"][0] + case["first_payment"][1] - 1

    def date_count(date):
        return 12 * date[0] + date[1] - 1

    check(case["months"] == sum(row[1] for row in yearly), case_id, "fixture: months is not the years' payments")
    check(case["total_interest_cents"] == sum(row[4] for row in yearly), case_id, "fixture: total interest")
    check(case["total_paid_cents"] == sum(row[2] + row[5] for row in yearly)
          == case["principal_cents"] + case["total_interest_cents"], case_id, "fixture: total paid")
    check(date_count(case["payoff"]) == first_count + case["months"] - 1 and case["payoff"][0] == yearly[-1][0],
          case_id, "fixture: payoff date")
    baseline = case["baseline"]
    check(date_count(baseline["payoff"]) == first_count + baseline["months"] - 1, case_id, "fixture: baseline payoff")
    check(case["months_saved"] == baseline["months"] - case["months"]
          and case["interest_saved_cents"] == baseline["total_interest_cents"] - case["total_interest_cents"],
          case_id, "fixture: savings")
    check(case["months_saved"] >= 0 and case["interest_saved_cents"] >= 0, case_id, "fixture: negative savings")
    check(baseline["months"] <= case["term_months"], case_id, "fixture: baseline longer than the term")
    check(("monthly" in case) == (case["term_months"] <= LOAN_MONTH_ROWS_MAX_TERM), case_id,
          "fixture: month rows present or absent against 13.6")
    if "monthly" in case:
        monthly = case["monthly"]
        check(len(monthly) == case["months"] and monthly[-1][1:3] == case["payoff"], case_id, "fixture: month rows")
        check(loan_year_rows(monthly) == yearly, case_id, "fixture: month rows do not group into the year rows")
    breakdown = case["breakdown"]
    check(breakdown["total_monthly_cents"] == case["payment_cents"] + breakdown["property_tax_cents"]
          + breakdown["insurance_cents"] + breakdown["mortgage_insurance_cents"] + breakdown["hoa_cents"], case_id,
          "fixture: breakdown total")
    check(breakdown["escrow_cents"] == breakdown["property_tax_cents"] + breakdown["insurance_cents"], case_id,
          "fixture: breakdown escrow")
    check(breakdown["mortgage_payment_cents"] == case["payment_cents"] + breakdown["escrow_cents"]
          + breakdown["mortgage_insurance_cents"], case_id, "fixture: breakdown mortgage payment")
    check(breakdown["total_monthly_cents"] == breakdown["mortgage_payment_cents"] + breakdown["hoa_cents"], case_id,
          "fixture: breakdown total is not the mortgage payment plus HOA dues")
    if all(case[key] == 0 for key in LOAN_HOUSING_COSTS):
        check(breakdown["escrow_cents"] == 0
              and breakdown["mortgage_payment_cents"] == breakdown["total_monthly_cents"] == case["payment_cents"],
              case_id, "fixture: no optional amounts, but the mortgage payment or the total is not M")
    check(list(breakdown) == BREAKDOWN_KEYS, case_id, f"fixture: breakdown keys {list(breakdown)}")
    expected_keys = ["id", "principal_cents", "annual_rate", "term_months", "extra_monthly_cents", "one_time",
                     "first_payment", "property_tax_annual_cents", "insurance_annual_cents",
                     "mortgage_insurance_monthly_cents", "hoa_monthly_cents", "payment_cents", "months",
                     "total_interest_cents", "total_paid_cents", "payoff", "yearly"]
    expected_keys += ["monthly"] if "monthly" in case else []
    expected_keys += ["baseline", "months_saved", "interest_saved_cents", "breakdown"]
    check(list(case) == expected_keys, case_id, f"fixture: keys {list(case)}")
    check(list(baseline) == ["months", "total_interest_cents", "payoff"], case_id, "fixture: baseline keys")
    check(isinstance(case["annual_rate"], str), case_id, "fixture: the rate is not a decimal string")


def check_loan_year_months(case):
    """Section 14 (v1.7) on a written loan case with month rows: the months under each calendar-year row.

    Under each year row are the month rows dated in that calendar year, a run
    of consecutive rows; together the runs are every month row. Their count is
    the year's payments; their payment, principal, interest and extra add up to
    the year's scheduled, principal, interest and extra; the last one's balance
    and running totals are the year's end balance and running totals. Restated
    here without loan_year_rows.
    """
    if "monthly" not in case:
        return
    case_id = case["id"]
    monthly = case["monthly"]
    position = 0
    for year, payments, scheduled, principal, interest, extra, end, total_interest, total_principal in case["yearly"]:
        where = f"section 14: year {year}"
        under = [row for row in monthly if row[1] == year]
        if not under or under != monthly[position:position + len(under)]:
            check(False, case_id, f"{where}: its month rows are not the next run of rows")
            continue
        position += len(under)
        check(len(under) == payments, case_id, f"{where}: {len(under)} month rows for {payments} payments")
        check([sum(row[column] for row in under) for column in (3, 5, 4, 6)] == [scheduled, principal, interest, extra],
              case_id, f"{where}: payment, principal, interest or extra does not add up")
        check(under[-1][7:] == [end, total_interest, total_principal], case_id,
              f"{where}: the last month's balance or running totals are not the year's")
    check(position == len(monthly), case_id, f"section 14: {len(monthly) - position} month row(s) under no year")


def loan_report_case(case_id, principal, rate, months, first_payment, extra=0, one_time=(), tax=0, insurance=0,
                     mortgage_insurance=0, hoa=0):
    """Section 13.6 inputs, in fixture order: the section 6 inputs, then those of 13.1."""
    return {"id": case_id, "principal_cents": principal, "annual_rate": rate, "term_months": months,
            "extra_monthly_cents": extra, "one_time": [[month, amount] for month, amount in one_time],
            "first_payment": list(first_payment), "property_tax_annual_cents": tax, "insurance_annual_cents": insurance,
            "mortgage_insurance_monthly_cents": mortgage_insurance, "hoa_monthly_cents": hoa}


LOANS_SPECS = {}


def loans_spec(loans_id):
    """The inputs of a loans.json case, from loan_cases (computed once)."""
    if not LOANS_SPECS:
        LOANS_SPECS.update((spec["id"], spec) for spec in without_audit(loan_cases))
    if loans_id not in LOANS_SPECS:
        raise OracleError(f"no loans.json case {loans_id}")
    return LOANS_SPECS[loans_id]


def loans_inputs(loans_id):
    """The section 6 inputs of a loans.json case, as (principal, rate, term, extra, one_time pairs)."""
    spec = loans_spec(loans_id)
    return (spec["principal_cents"], spec["annual_rate"], spec["term_months"], spec["extra_monthly_cents"],
            [(item["month"], item["amount_cents"]) for item in spec["one_time"]])


def from_loans(case_id, loans_id, first_payment, **costs):
    """A loan report on the inputs of a loans.json case; LOAN_REPORT_SAME_AS records the pair."""
    principal, rate, term, extra, one_time = loans_inputs(loans_id)
    LOAN_REPORT_SAME_AS[case_id] = loans_id
    return loan_report_case(case_id, principal, rate, term, first_payment, extra, one_time, **costs)


# Report case -> loans.json case with the same section 6 inputs; their rows must be equal.
LOAN_REPORT_SAME_AS = {}

# Loans the section 6 check refuses (payment-does-not-cover-interest), from the examples in section
# 6: they must be refused, so no fixture is written for them.
LOAN_REPORT_REFUSED = [(1, "0.06", 3), (10_000_000, "0.30", 600), (10_000_000_000, "1", 280)]


def loan_report_cases():
    """Section 13 cases: 30- and 15-year mortgages, car loans and edge cases of dates, extras and costs."""
    reference = (20_000_000, "0.06", 360)
    # The balance left after month 120's scheduled payment: a one-time of exactly this pays the loan off.
    payoff_120 = without_audit(balance_after, *reference, 120)
    # The 15-year loan with $500 a month extra ends with a final payment (no extra) before month 180;
    # a one-time due in that month is not paid (section 6).
    fifteen = (30_000_000, "0.055", 180)
    _, fifteen_rows = without_audit(amortize, fifteen[0], Decimal(fifteen[1]), fifteen[2], 50_000, [])
    final_month = len(fifteen_rows)
    if not (final_month < fifteen[2] and fifteen_rows[-1][4] == 0):
        raise OracleError("the 15-year loan with extra does not end with a final payment before month 180")
    return [
        # FINANCIAL_MODEL_REQUIREMENTS 5.1 reference, 1,199.10 a month; the shares divide evenly.
        from_loans("30-year-200000-6-percent-first-payment-june", "reference-30-year-6-percent", (2027, 6),
                   tax=480_000, insurance=150_000),
        # 360,006 / 12 = 30,000.5 exactly (rounded up to 30,001); 180,005 / 12 = 15,000.42 (down).
        loan_report_case("30-year-6-percent-extra-200-monthly-first-payment-january", *reference, (2027, 1),
                         extra=20_000, tax=360_006, insurance=180_005, mortgage_insurance=8_750, hoa=4_500),
        # Three one-time payments in month 24 add up; 412,345 / 12 = 34,362.08 (down) and 210,011 / 12
        # = 17,500.92 (up).
        loan_report_case("30-year-6-percent-three-one-time-in-month-24-first-payment-december", *reference,
                         (2026, 12), one_time=[(24, 100_000), (24, 250_000), (24, 50_000), (60, 500_000)],
                         tax=412_345, insurance=210_011, hoa=35_000),
        # Section 6 puts no order on the one-time list.
        loan_report_case("30-year-6-percent-extra-and-one-time-listed-out-of-month-order", *reference, (2028, 4),
                         extra=10_000, one_time=[(120, 2_000_000), (12, 1_000_000), (120, 500_000)]),
        # Paid off in month 120 by a one-time of exactly the balance; the month-200 one is never paid.
        loan_report_case("30-year-6-percent-one-time-pays-off-month-120-then-one-after-payoff", *reference,
                         (2026, 9), one_time=[(120, payoff_120), (200, 1_000_000)]),
        loan_report_case("30-year-6-percent-one-time-larger-than-balance-month-60", *reference, (2026, 2),
                         one_time=[(60, 50_000_000)]),
        # Month N is always the final payment, which carries no extra: the plan is the baseline.
        loan_report_case("30-year-6-percent-one-time-in-final-scheduled-month-not-paid", *reference, (2026, 7),
                         one_time=[(360, 1_000_000)]),
        loan_report_case("30-year-6-percent-extra-1-cent-monthly", *reference, (2026, 5), extra=1),
        # 198,006 / 12 = 16,500.5 exactly.
        loan_report_case("15-year-5.5-percent-first-payment-march", *fifteen, (2026, 3), tax=540_000,
                         insurance=198_006, mortgage_insurance=12_500),
        loan_report_case("15-year-5.5-percent-extra-500-monthly", *fifteen, (2026, 3), extra=50_000, tax=540_000,
                         insurance=198_006, mortgage_insurance=12_500),
        loan_report_case("15-year-5.5-percent-extra-500-monthly-one-time-in-final-payment-month-not-paid", *fifteen,
                         (2026, 3), extra=50_000, one_time=[(final_month, 5_000_000)]),
        # The longest term at the largest principal, first paid in the last accepted month, with every
        # housing cost at its maximum: 9,999,999,990 / 12 = 833,333,332.5 exactly. Payoff November 2250.
        from_loans("max-principal-6-percent-600-months-first-payment-december-2200-max-housing-costs",
                   "max-principal-6-percent-600-months", (2200, 12), tax=10_000_000_000, insurance=9_999_999_990,
                   mortgage_insurance=10_000_000_000, hoa=10_000_000_000),
        loan_report_case("600-months-7-percent-extra-and-one-time-first-payment-january-1970", 50_000_000, "0.07",
                         600, (1970, 1), extra=25_000, one_time=[(1, 1_000_000), (300, 5_000_000)],
                         tax=600_001, insurance=240_007, mortgage_insurance=1, hoa=99_999),
        # M is rounded up by almost half a cent, so the baseline ends in month 262 of 279.
        loan_report_case("max-principal-rate-1-279-months-baseline-ends-before-term-one-time", 10_000_000_000, "1",
                         279, (2100, 7), one_time=[(100, 2_000_000_000)]),
        from_loans("max-principal-rate-1-279-months-no-extra", "max-principal-rate-1-279-months-longest-accepted",
                   (2099, 12)),
        # M is rounded down, so the forced final payment in month 360 is above M.
        from_loans("payment-rounded-down-final-payment-larger", "payment-rounded-down-final-payment-larger",
                   (2026, 10), tax=300_000, insurance=96_000),
        # One month over the limit of 13.6: no month rows.
        loan_report_case("121-month-term-no-month-rows", 2_000_000, "0.05", 121, (2026, 6)),
        # Car loans and short terms: month rows.
        from_loans("car-loan-60-months-7.9-percent-first-payment-january", "5-year-7.9-percent", (2027, 1)),
        loan_report_case("car-loan-72-months-8.49-percent-extra-and-one-time", 4_250_000, "0.0849", 72, (2026, 9),
                         extra=15_000, one_time=[(13, 200_000)]),
        # The two one-time payments of month 30 add up to more than the balance.
        loan_report_case("car-loan-48-months-two-one-time-in-month-30-exceed-balance", 2_000_000, "0.06", 48,
                         (2026, 11), one_time=[(30, 400_000), (30, 900_000)]),
        from_loans("zero-rate-120-months", "zero-rate-120-months", (2026, 1)),
        loan_report_case("zero-rate-48-months-extra-saves-months-not-interest", 2_400_000, "0", 48, (2026, 8),
                         extra=10_000),
        # A 1-cent one-time in month 1 is paid, but the last payment simply absorbs it.
        loan_report_case("zero-rate-one-cent-one-time-saves-nothing", 1_200_000, "0", 120, (2026, 4),
                         one_time=[(1, 1)]),
        # 6 / 12 = 0.5 exactly (rounded up to 1) and 5 / 12 = 0.42 (down to 0).
        from_loans("1-month-term-first-payment-december", "1-month-term", (2026, 12), tax=6, insurance=5,
                   mortgage_insurance=1),
        from_loans("1-month-term-half-cent-first-payment-january", "1-month-term-half-cent", (2027, 1)),
        # The month-row boundary of 13.6: a 120-month term carries month rows.
        from_loans("120-month-term-month-rows-one-time-month-1-and-extra", "one-time-month-1-and-extra", (2030, 1),
                   tax=150_006, insurance=89_999),
        from_loans("extra-ends-loan-in-month-2-across-december", "extra-ends-loan-in-month-2", (2026, 12)),
        loan_report_case("max-principal-rate-1-extra-larger-than-balance-pays-off-month-1", 10_000_000_000, "1", 120,
                         (2026, 6), extra=10_000_000_000),
        from_loans("balance-plus-interest-equals-payment", "balance-plus-interest-equals-payment", (2026, 3)),
        # January 2026 to January 2027: the last calendar year has one payment.
        loan_report_case("13-months-12-percent-last-year-one-payment", 1_000_000, "0.12", 13, (2026, 1)),
        # M = 0: a December payment of 0, then eleven more rows in the next year.
        from_loans("one-cent-zero-rate-12-months-first-payment-december", "one-cent-zero-rate-12-months", (2026, 12)),
        from_loans("half-cent-interest-month-1", "half-cent-interest-month-1", (2026, 6)),
        # Section 13.6 (v1.6): HOA dues only, the reference loan and date of the escrow-only first case.
        # The mortgage payment stays M = 119,910; the total is M plus the dues.
        from_loans("30-year-200000-6-percent-hoa-dues-only", "reference-30-year-6-percent", (2027, 6), hoa=42_500),
        # Section 13.6 (v1.6): mortgage insurance only, the 15-year loan without its escrow items.
        loan_report_case("15-year-5.5-percent-mortgage-insurance-only", *fifteen, (2026, 3), mortgage_insurance=12_500),
        # Section 13.6 (v1.6): escrow items only, each 5 more than a multiple of 12, on the same loan and
        # date. The shares round down to 35,000 and 12,000, so escrow is 47,000: a cent less than one
        # rounding of 564,010 / 12 = 47,000.83 (the 120-month case above has a cent more).
        from_loans("30-year-200000-6-percent-escrow-a-cent-less-than-one-rounding", "reference-30-year-6-percent",
                   (2027, 6), tax=420_005, insurance=144_005),
    ]


def build_loan_reports():
    """Section 13 for every case, with check_loan_report applied, the refused loans and a coverage check."""
    for principal, rate, term in LOAN_REPORT_REFUSED:
        where = f"refused loan {principal} at {rate} over {term} months"
        check(without_audit(payment_refused, principal, Decimal(rate), term), where, "not refused by section 6")
        restated = loan_report_case("refused", principal, rate, term, (2026, 1))
        try:
            without_audit(loan_report_restated, restated, 0, [])
            check(False, where, "not refused by the restatement")
        except OracleError:
            pass
    AUDIT.case = "loan_reports case setup"
    specs = loan_report_cases()
    cases = []
    facts = []
    for spec in specs:
        case_id = spec["id"]
        AUDIT.case = f"loan_reports {case_id}"
        check_loan_report_inputs(spec)
        report = loan_report(spec)
        facts.append(check_loan_report(spec, report))
        if case_id in LOAN_REPORT_SAME_AS:
            twin = loans_spec(LOAN_REPORT_SAME_AS[case_id])
            _, twin_rows = without_audit(amortize, twin["principal_cents"], Decimal(twin["annual_rate"]),
                                         twin["term_months"], twin["extra_monthly_cents"], twin["one_time"])
            check(report["rows"] == twin_rows, case_id, f"rows differ from loans.json {twin['id']}")
        rows = report["rows"]
        baseline_rows = report["baseline_rows"]
        total_interest = sum(row[2] for row in rows)
        baseline_interest = sum(row[2] for row in baseline_rows)
        first_payment = spec["first_payment"]
        case = {
            **spec,
            "payment_cents": report["payment"],
            "months": len(rows),
            "total_interest_cents": total_interest,
            "total_paid_cents": sum(row[1] + row[4] for row in rows),
            "payoff": payment_date(first_payment, len(rows)),
            "yearly": report["year_rows"],
        }
        if spec["term_months"] <= LOAN_MONTH_ROWS_MAX_TERM:
            case["monthly"] = report["month_rows"]
        case.update({
            "baseline": {
                "months": len(baseline_rows),
                "total_interest_cents": baseline_interest,
                "payoff": payment_date(first_payment, len(baseline_rows)),
            },
            "months_saved": len(baseline_rows) - len(rows),
            "interest_saved_cents": baseline_interest - total_interest,
            "breakdown": report["breakdown"],
        })
        check_loan_report_fixture(case)
        check_loan_year_months(case)
        cases.append(case)
    # A one-time due in the month that becomes the final payment is not paid (section 6): the plan
    # with it equals the plan without it.
    by_id = {case["id"]: case for case in cases}
    with_one = by_id["15-year-5.5-percent-extra-500-monthly-one-time-in-final-payment-month-not-paid"]
    without_one = by_id["15-year-5.5-percent-extra-500-monthly"]
    outputs = ("payment_cents", "months", "total_interest_cents", "total_paid_cents", "payoff", "yearly", "baseline")
    check(all(with_one[key] == without_one[key] for key in outputs), with_one["id"],
          "the one-time in the final payment month changed the plan")

    # Coverage: every situation the case grid is meant to reach is reached by some case.
    wanted = [
        ("first payment in January", lambda fact: fact["first month"] == 1),
        ("first payment in December", lambda fact: fact["first month"] == 12),
        ("first payment mid-year", lambda fact: 2 <= fact["first month"] <= 11),
        ("a zero rate", lambda fact: fact["zero rate"]),
        ("month rows", lambda fact: fact["month rows"]),
        ("no month rows", lambda fact: not fact["month rows"]),
        ("a 120-month term", lambda fact: fact["term"] == LOAN_MONTH_ROWS_MAX_TERM),
        ("a 121-month term", lambda fact: fact["term"] == LOAN_MONTH_ROWS_MAX_TERM + 1),
        ("a 1-month term", lambda fact: fact["term"] == 1),
        ("a 600-month term", lambda fact: fact["term"] == LOAN_TERM_MAX),
        ("a 360-month term", lambda fact: fact["term"] == 360),
        ("a 180-month term", lambda fact: fact["term"] == 180),
        ("a 60- or 72-month term", lambda fact: fact["term"] in (60, 72)),
    ] + [(key, lambda fact, key=key: fact[key]) for key in (
        "largest principal", "several one-time in one month", "one-time in month N",
        "one-time in the final payment month before N", "one-time after payoff", "paid off early by a one-time",
        "extra capped at the balance", "extra monthly", "months saved", "interest saved but no months",
        "extra paid, nothing saved", "extra entered, none paid", "baseline ends before N", "final payment above M",
        "exact half share", "share rounded down", "share rounded up", "all four housing costs", "payoff after 2200",
        "one-time out of month order", "every optional amount 0", "HOA dues only", "escrow items only",
        "mortgage insurance only", "escrow only, a cent more than one rounding",
        "escrow only, a cent less than one rounding")]
    for label, test in wanted:
        check(any(test(fact) for fact in facts), "loan_reports.json", f"no case has {label}")
    ids = [case["id"] for case in cases]
    check(len(set(ids)) == len(ids), "loan_reports.json", "duplicate case ids")
    check_loan_sweep()
    return fixture(cases=cases)


def check_loan_sweep():
    """Section 13.4 on loans from a seeded generator (FINANCIAL_MODEL_REQUIREMENTS 8.2); nothing is written.

    Each loan has a random principal, rate, term, first payment, monthly
    extra and up to four one-time payments, drawn with integer arithmetic
    only. Checks: the plan never takes more months or more interest than the
    baseline, and its balance is never above the baseline's; a larger monthly
    extra with the same one-time payments never takes more months or
    interest either; with no extra paid the plan is the baseline; the
    restatement in fractions gives the same month and year rows as
    loan_report for the plan and for the baseline. Refused loans are counted
    and skipped.
    """
    generator = random.Random(LOAN_SWEEP_SEED)
    summary = {"loans": 0, "refused": 0, "extra paid": 0, "months saved": 0, "zero rate": 0}
    while summary["loans"] < LOAN_SWEEP_COUNT:
        digits = generator.randrange(1, 11)
        principal = min(generator.randrange(10 ** (digits - 1), 10 ** digits + 1), LOAN_AMOUNT_MAX)
        kind = generator.randrange(10)
        if kind == 0:
            rate = "0"
        elif kind == 1:
            rate = format(Decimal(generator.randrange(1, 10_001)) / 10_000, "f")
        else:
            rate = format(Decimal(generator.randrange(1, 2_501)) / 100_000, "f")
        term = generator.randrange(1, LOAN_TERM_MAX + 1)
        extra = 0 if generator.randrange(3) == 0 else generator.randrange(1, 10 ** generator.randrange(1, 10))
        one_time = [(generator.randrange(1, term + 1), generator.randrange(1, 10 ** generator.randrange(1, 11)))
                    for _ in range(generator.randrange(5))]
        first_payment = (generator.randrange(FIRST_PAYMENT_YEARS[0], FIRST_PAYMENT_YEARS[1] + 1),
                         generator.randrange(1, 13))
        if without_audit(payment_refused, principal, Decimal(rate), term):
            summary["refused"] += 1
            continue
        case_id = f"sweep loan {summary['loans']}: {principal} at {rate} over {term} months"
        spec = loan_report_case(case_id, principal, rate, term, first_payment, extra, one_time)
        report = without_audit(loan_report, spec)
        rows = report["rows"]
        baseline_rows = report["baseline_rows"]
        interest = sum(row[2] for row in rows)
        baseline_interest = sum(row[2] for row in baseline_rows)
        check(len(rows) <= len(baseline_rows) and interest <= baseline_interest, case_id,
              "extra payments increased months or interest")
        for row, base in zip(rows, baseline_rows):
            if row[5] > base[5]:
                check(False, case_id, f"month {row[0]}: balance above the baseline's")
                break
        _, more_rows = without_audit(amortize, principal, Decimal(rate), term, extra + generator.randrange(1, 100_000),
                                     one_time_entries(spec["one_time"]))
        check(len(more_rows) <= len(rows) and sum(row[2] for row in more_rows) <= interest, case_id,
              "a larger monthly extra increased months or interest")
        if sum(row[4] for row in rows) == 0:
            check(rows == baseline_rows, case_id, "no extra was paid but the plan differs from the baseline")
        else:
            summary["extra paid"] += 1
        restated_payment, restated_months, restated_years = without_audit(loan_report_restated, spec, extra,
                                                                          spec["one_time"])
        check(restated_payment == report["payment"] and restated_months == report["month_rows"]
              and restated_years == report["year_rows"], case_id, "differs from the restatement")
        _, baseline_restated, _ = without_audit(loan_report_restated, spec, 0, [])
        check([row[:1] + row[3:8] for row in baseline_restated] == baseline_rows, case_id,
              "baseline differs from the restatement")
        summary["months saved"] += len(rows) < len(baseline_rows)
        summary["zero rate"] += rate == "0"
        summary["loans"] += 1
    LOAN_SWEEP_SUMMARY.update(summary)


def main():
    builders = [
        ("regdd.json", build_regdd),
        ("conversions.json", build_conversions),
        ("loans.json", build_loans),
        ("compound.json", build_compound),
        ("hysa.json", build_hysa),
        ("schedules.json", build_schedules),
        ("illustration.json", build_illustration),
        ("loan_reports.json", build_loan_reports),
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
    # Points of HYSA_NEAR_HALF_ALWAYS cents or more are always inside the window, so they are
    # counted per case rather than listed.
    large = {}
    for case_id, month, value in HYSA_NEAR:
        if abs(value) >= HYSA_NEAR_HALF_ALWAYS:
            large[case_id] = large.get(case_id, 0) + 1
    print(f"hysa audit: {len(HYSA_NEAR)} rounding point(s) whose distance from a half is below 1e-9 of the value")
    for case_id, month, value in HYSA_NEAR:
        if abs(value) < HYSA_NEAR_HALF_ALWAYS:
            print(f"  {case_id}: month {month}: {sig(value)}")
    for case_id, count in large.items():
        print(f"  {case_id}: {count} point(s) of 5e8 cents or more, where every value is that close to a half")
    if HYSA_CLOSEST:
        ratio, case_id, month, value = HYSA_CLOSEST[0]
        print(f"hysa audit: closest to a half relative to its value: {case_id}: month {month}: {sig(value)} "
              f"(distance {float(ratio):.2e} of the value)")
    print(f"schedules audit: {len(SCHEDULE_NEAR)} savings credit(s) whose distance from a half is below 1e-9 "
          "of the value")
    large = {}
    for case_id, month, value in SCHEDULE_NEAR:
        if abs(value) >= HYSA_NEAR_HALF_ALWAYS:
            large[case_id] = large.get(case_id, 0) + 1
        else:
            print(f"  {case_id}: month {month}: {sig(value)}")
    for case_id, count in large.items():
        print(f"  {case_id}: {count} point(s) of 5e8 cents or more, where every value is that close to a half")
    near_total = sum(count for _, count, _ in ILLUSTRATION_NEAR)
    print(f"illustration audit: {near_total} near_half entr(ies) (within 1e-13 of the value of a half cent) "
          f"in {len(ILLUSTRATION_NEAR)} case(s)")
    for case_id, count, rows in ILLUSTRATION_NEAR:
        print(f"  {case_id}: {count} of {rows} rows")
    accrual = ILLUSTRATION_ACCRUAL
    print(f"illustration accrual (12.5): {accrual['rows']} row(s) with accrued, over {accrual['periods']} compounding "
          f"period(s); each B_p - B_(p-1) within {float(accrual['deviation']):.1e} of B_(p-1) * r / n, relative to "
          "B_(p-1)")
    sweep = LOAN_SWEEP_SUMMARY
    print(f"loan reports sweep: {sweep['loans']} seeded loan(s) checked against 13.4 and the restatement "
          f"({sweep['extra paid']} with extra paid, {sweep['months saved']} saving months, {sweep['zero rate']} at a "
          f"zero rate; {sweep['refused']} refused and skipped)")
    return 0


def run_econ_oracles():
    """The dashboard oracles (brief Q): each tests/oracle/econ_*.py writes its own fixture file
    under tests/oracle/fixtures/ when run as a script, from the decimal rules written for it."""
    import runpy
    for script in sorted(Path(__file__).resolve().parent.glob("econ_*.py")):
        runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    status = main()
    if status == 0:
        run_econ_oracles()
    sys.exit(status)
