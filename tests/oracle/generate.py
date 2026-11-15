"""Independent reference oracle for the RadMage Finance calculation engines.

Writes JSON fixtures to tests/oracle/fixtures/ from the rules in
docs/ENGINE_CONVENTIONS.md (v1.1), sections 2 to 6 and 9. It uses only the
Python standard library and exact decimal arithmetic, and it is written from
that specification alone, not from the TypeScript engines, so that a mistake
shared by both is unlikely.

Run from the repository root:

    python -I tests/oracle/generate.py

Every published Regulation DD figure (12 CFR part 1030, Appendix A) and every
identity in sections 5 and 6 is checked. If any check fails, the generator
prints the failing cases, writes nothing and exits with status 1.
"""

import json
import sys
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Context, Decimal, setcontext
from pathlib import Path

GENERATOR = "tests/oracle/generate.py"
CONVENTIONS = "v1.1"
FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"

# Section 2 asks for at least 60 digits; 100 leaves a wide margin everywhere.
PRECISION = 100
setcontext(Context(prec=PRECISION, rounding=ROUND_HALF_UP, Emax=999_999, Emin=-999_999))

ONE = Decimal(1)
HALF = Decimal("0.5")
# A value this close to a half, but not on it, means the arithmetic was not
# precise enough to decide the rounding. That is an error, never a guess.
TIE_GUARD = Decimal("1e-50")
# Section 2: the TypeScript engines normalize to 15 significant digits before
# rounding. The audit below reports any rounding point where that step would
# change the result, or where the value sits within one unit of the 15th digit
# of a half, so float error could matter.
TYPESCRIPT_DIGITS = 15
# Largest integer a JavaScript number holds exactly (2^53 - 1).
MAX_SAFE_INTEGER = 2**53 - 1
SIGNIFICANT_DIGITS = 25


class OracleError(Exception):
    """A rule or a check could not be applied."""


class RoundingAudit:
    """Counts exact half ties, and rounding points a 15-digit normalization could get wrong."""

    def __init__(self):
        self.case = ""
        self.ties = {}
        self.mismatch = []
        self.fragile = {}

    def record(self, scaled, distance):
        if distance == 0:
            self.ties[self.case] = self.ties.get(self.case, 0) + 1
        if scaled == 0:
            return
        unit = ONE.scaleb(scaled.adjusted() - (TYPESCRIPT_DIGITS - 1))
        normalized = scaled.quantize(unit, rounding=ROUND_HALF_UP)
        if normalized.quantize(ONE, rounding=ROUND_HALF_UP) != scaled.quantize(ONE, rounding=ROUND_HALF_UP):
            self.mismatch.append((self.case, scaled))
        elif 0 < distance <= unit:
            self.fragile[self.case] = self.fragile.get(self.case, 0) + 1


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
    """Section 4 (v1.1): split rate segments at each 365-day year end and at maturity.

    Returns a list of (end_day, stretch) where stretch is the (rate, days)
    pieces inside that crediting period. A rate change inside a year is not a
    crediting point.
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
    """Section 4 (v1.1): daily compounding, credited at each year end and at maturity.

    Each credit is round_cents(balance * growth - balance) on the balance that
    includes earlier credits. Returns the list of credits as
    (end_day, unrounded_cents, credited_cents).
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


# Section 5: compound interest calculator engine


def compound_schedule(principal_cents, annual_rate, n, years, contribution_cents, timing):
    """Section 5: period-by-period savings ledger.

    For each period: a start-timing contribution, then interest rounded to the
    cent on the balance, then an end-timing contribution. Returns the yearly
    table as [year, start_balance, contributions, interest, end_balance].
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


def compound_closed_form(principal_cents, annual_rate, n, years, contribution_cents, timing):
    """Section 5: unrounded closed form, for explanation only.

    P(1+i)^N + C((1+i)^N - 1)/i, with the contribution term times (1+i) for
    start timing, and P + C*N when i = 0.
    """
    periods = n * years
    if annual_rate == 0:
        return Decimal(principal_cents + contribution_cents * periods)
    i = annual_rate / n
    growth = power(ONE + i, periods)
    contributions = contribution_cents * (growth - ONE) / i
    if timing == "start":
        contributions *= ONE + i
    return principal_cents * growth + contributions


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
    """Reproduces every Appendix A figure in parts I.A to I.D and II.A (section 4)."""
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


def compound_case(case_id, principal, rate, n, years, contribution, timing):
    return {"id": case_id, "principal_cents": principal, "annual_rate": rate, "periods_per_year": n,
            "years": years, "contribution_cents": contribution, "timing": timing}


def compound_cases():
    """Section 5 cases: every frequency with both timings, then edge cases."""
    grid = [
        (1, "0.07", 30, 500_000),
        (2, "0.045", 20, 250_000),
        (4, "0.0425", 25, 100_000),
        (12, "0.06", 30, 50_000),
        (365, "0.0525", 10, 1_000),
    ]
    cases = []
    for n, rate, years, contribution in grid:
        for timing in ("start", "end"):
            cases.append(compound_case(f"n{n}-{timing}", 1_000_000, rate, n, years, contribution, timing))
    cases += [
        compound_case("zero-rate-monthly-start", 500_000, "0", 12, 20, 10_000, "start"),
        compound_case("zero-rate-annual-100-years-end", 100_000, "0", 1, 100, 1_000, "end"),
        compound_case("zero-principal-monthly-contributions-end", 0, "0.05", 12, 30, 50_000, "end"),
        compound_case("zero-principal-daily-contributions-start", 0, "0.04", 365, 5, 500, "start"),
        compound_case("principal-only-quarterly", 2_500_000, "0.035", 4, 30, 0, "end"),
        compound_case("principal-only-semiannual-start", 2_500_000, "0.035", 2, 30, 0, "start"),
        compound_case("max-principal-monthly-30-years", 10_000_000_000, "0.05", 12, 30, 0, "end"),
        compound_case("max-principal-daily-1-year", 10_000_000_000, "0.0525", 365, 1, 0, "end"),
        compound_case("max-principal-max-contribution-annual-start", 10_000_000_000, "0.05", 1, 30,
                      10_000_000_000, "start"),
        # 10,000,000,000 * 2^19 is just below 2^53 - 1, the largest exact JSON integer for JavaScript.
        compound_case("rate-1-annual-19-years-max-principal", 10_000_000_000, "1", 1, 19, 0, "end"),
        compound_case("rate-1-monthly-30-years", 100, "1", 12, 30, 0, "end"),
        compound_case("rate-1-daily-1-year-start", 100_000, "1", 365, 1, 1_000, "start"),
        compound_case("one-year-monthly-start", 100_000, "0.045", 12, 1, 10_000, "start"),
        compound_case("one-year-daily-end", 100_000, "0.045", 365, 1, 100, "end"),
        compound_case("hundred-years-annual-end", 100_000, "0.05", 1, 100, 120_000, "end"),
        compound_case("hundred-years-annual-start", 1_000_000, "0.08", 1, 100, 0, "start"),
        compound_case("daily-5.25-percent-30-years-contribution-1000-end", 1_000_000, "0.0525", 365, 30,
                      1_000, "end"),
        compound_case("daily-5.25-percent-30-years-contribution-1000-start", 1_000_000, "0.0525", 365, 30,
                      1_000, "start"),
        # 10 * 0.05 = 0.5 exactly: the first year's interest rounds up to 1 cent.
        compound_case("exact-half-annual-10-cents", 10, "0.05", 1, 5, 0, "end"),
        # 3,650 * 0.05 / 365 = 0.5 exactly; rounding it down would stop all growth.
        compound_case("exact-half-daily-3650-cents", 3_650, "0.05", 365, 1, 0, "end"),
        compound_case("exact-half-daily-start-contribution", 0, "0.05", 365, 1, 3_650, "start"),
        # 100 * 0.06 / 12 = 0.5 exactly in the first month.
        compound_case("exact-half-monthly-100-cents", 100, "0.06", 12, 2, 0, "end"),
        # 99 * 0.05 / 12 = 0.4125: interest rounds to 0 every month and the balance never grows.
        compound_case("sub-cent-interest-never-credited", 99, "0.05", 12, 30, 0, "end"),
    ]
    return cases


def build_compound():
    """Section 5 ledgers, with every identity checked for every case and year."""
    cases = []
    for spec in compound_cases():
        case_id = spec["id"]
        AUDIT.case = case_id
        rate = Decimal(spec["annual_rate"])
        args = (spec["principal_cents"], rate, spec["periods_per_year"], spec["years"],
                spec["contribution_cents"], spec["timing"])
        yearly = compound_schedule(*args)
        closed_form = compound_closed_form(*args)
        periods = spec["periods_per_year"] * spec["years"]
        final = yearly[-1][4]
        total_contributions = spec["contribution_cents"] * periods
        total_interest = sum(row[3] for row in yearly)

        # Section 5 identities.
        check(final == spec["principal_cents"] + total_contributions + total_interest, case_id,
              "final differs from principal plus contributions plus interest")
        check(sum(row[2] for row in yearly) == total_contributions, case_id, "contributions do not add up")
        check(yearly[0][1] == spec["principal_cents"], case_id, "year 1 does not start at the principal")
        for index, (year, start, contributions, interest, end) in enumerate(yearly):
            check(year == index + 1, case_id, f"year {year} out of order")
            check(end == start + contributions + interest, case_id, f"year {year}: end differs from the sum")
            check(contributions == spec["contribution_cents"] * spec["periods_per_year"], case_id,
                  f"year {year}: wrong contributions")
            if index > 0:
                check(start == yearly[index - 1][4], case_id, f"year {year}: start differs from last year's end")

        cases.append({
            **spec,
            "final_balance_cents": final,
            "total_contributions_cents": total_contributions,
            "total_interest_cents": total_interest,
            "closed_form_cents": sig(closed_form),
            "yearly": yearly,
        })
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
    print(f"rounding audit: {len(AUDIT.mismatch)} point(s) where 15-digit normalization changes the result")
    for case_id, scaled in AUDIT.mismatch:
        print(f"  {case_id}: {scaled}")
    for case_id, count in AUDIT.fragile.items():
        print(f"rounding audit: {case_id}: {count} point(s) within one 15th-digit unit of a half")
    return 0


if __name__ == "__main__":
    sys.exit(main())
