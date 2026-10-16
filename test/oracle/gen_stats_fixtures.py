#!/usr/bin/env python3
"""Independent oracle for the Price Book price-memory statistics (SPEC 5.8, D17, D35).

Written from the SPEC text with Python's exact Fraction type and datetime.date, NOT from
src/engine/stats.ts, so test/fixtures/engine/stats.json is a second implementation checking the first.

* SPEC examples S1 and S2: the numbers printed in SPEC 5.8 are typed by hand below (SPEC_S1 / SPEC_S2)
  and asserted against the oracle before anything is written.
* every other case is generated: expected values are the oracle's.

Run:  python3 test/oracle/gen_stats_fixtures.py   (no packages needed)
"""
import json
import os
from datetime import date
from fractions import Fraction as F
from math import floor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "test", "fixtures", "engine", "stats.json")

FACTOR = {"g": F(1), "kg": F(1000), "oz": F("28.349523125"), "lb": F("453.59237"),
          "ml": F(1), "l": F(1000), "floz_us": F("29.5735295625"), "pcs": F(1), "dozen": F(12), "m": F(1)}
DIM = {"g": "mass", "kg": "mass", "oz": "mass", "lb": "mass", "ml": "volume", "l": "volume",
       "floz_us": "volume", "pcs": "count", "dozen": "count", "m": "length"}
BASIS = {"kg": F(1000), "100g": F(100), "oz": F("28.349523125"), "lb": F("453.59237"), "l": F(1000),
         "floz_us": F("29.5735295625"), "1": F(1), "10": F(10), "m": F(1)}
DEFAULT_BASIS = {"metric": {"mass": "kg", "volume": "l", "count": "1", "length": "m"},
                 "us": {"mass": "oz", "volume": "floz_us", "count": "1", "length": "ft"}}
EXPONENT = {"EUR": 2, "USD": 2, "GBP": 2, "JPY": 0, "KWD": 3}
REWE, ALDI, EDEKA, LIDL = 1, 2, 3, 4


def hu(x):
    x = F(x)
    return floor(x + F(1, 2)) if x >= 0 else -floor(-x + F(1, 2))


def dec(x, places):
    k = hu(F(x) * 10 ** places)
    s = str(abs(k)).rjust(places + 1, "0")
    body = s if places == 0 else s[:-places] + "." + s[-places:]
    return ("-" if k < 0 else "") + body


def day(text):
    y, m, d = (int(p) for p in text.split("-"))
    return date(y, m, d).toordinal()


def fr(x):
    return str(F(x))


# ---------- the oracle (SPEC 5.8) ----------

def stats(inp):
    st = inp["settings"]
    cur = st["currency"]
    exp = EXPONENT[cur]
    dim = st["dimension"]
    basis_id = (st.get("bases") or {}).get(dim) or DEFAULT_BASIS[st.get("measurementSystem", "metric")][dim]
    bq = BASIS[basis_id]
    today = day(inp["today"])
    other = invalid = 0
    pts = []
    for o in inp["observations"]:
        if o["currency"] != cur:
            other += 1
            continue
        if DIM.get(o["unit"]) != dim or F(o["itemSize"]) <= 0:
            invalid += 1
            continue
        q = o["packCount"] * F(o["itemSize"]) * FACTOR[o["unit"]]
        eff = o["paidPriceMinor"] if o["paidPriceMinor"] is not None else o["packPriceMinor"]
        pts.append(dict(o, q=q, u=F(eff) / q * bq, day=day(o["observedOn"])))
    pts.sort(key=lambda p: (p["observedOn"], p["createdAt"], p["id"]))

    def pick(ps, better):  # ties -> most recent (later in date order)
        best = None
        for p in ps:
            if best is None or not better(best["u"], p["u"]):
                best = p
        return best

    lowest = pick(pts, lambda a, b: a < b)
    highest = pick(pts, lambda a, b: a > b)
    latest = pts[-1] if pts else None

    def med(vals):
        v = sorted(vals)
        n = len(v)
        return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2

    window = [p for p in pts if p["day"] >= today - 365]
    regular = [p for p in window if not p["isPromo"]]
    if len(regular) >= 3:
        usual = (med([p["u"] for p in regular]), len(regular), "regular")
    elif window:
        usual = (med([p["u"] for p in window]), len(window), "all")
    elif pts:
        last5 = pts[-5:]
        usual = (med([p["u"] for p in last5]), len(last5), "older")
    else:
        usual = None

    # store table
    rows = []
    for sid in dict.fromkeys(p["storeId"] for p in pts):
        own = [p for p in pts if p["storeId"] == sid]
        days = today - own[-1]["day"]
        rows.append(dict(store=sid, latest=own[-1], lowest=pick(own, lambda a, b: a < b), count=len(own),
                         days=days, stale=days > 90, cheapest=False))
    live = [r for r in rows if not r["stale"] and r["store"] is not None]
    if live:
        m = min(r["latest"]["u"] for r in live)
        for r in live:
            r["cheapest"] = r["latest"]["u"] == m
    rows.sort(key=lambda r: (r["stale"], r["latest"]["u"], -r["latest"]["day"], [-ord(c) for c in r["latest"]["createdAt"]], -r["latest"]["id"]))

    # shrinkflation
    shrink = []
    reg = [p for p in pts if not p["isPromo"]]
    for i in range(1, len(reg)):
        prev, curp = reg[i - 1], reg[i]
        if not curp["q"] <= prev["q"] * F(99, 100):
            continue
        # D42 (review #6): a pack size already seen at an earlier regular price is a switch between known sizes
        if any(p["q"] == curp["q"] for p in reg[:i]):
            continue
        ref = None
        if curp["storeId"] is not None:
            same = [p for p in reg[:i] if p["storeId"] == curp["storeId"]]
            ref = same[-1] if same else None
        base = ref or prev
        if curp["q"] < prev["q"] * F(70, 100):
            kind = "differentPackSize"  # D42: more than 30 % smaller is reported neutrally, never as shrinkflation
        elif ref is None:
            kind = "packSmaller"
        elif curp["packPriceMinor"] == ref["packPriceMinor"]:
            kind = "samePrice"
        elif curp["packPriceMinor"] > ref["packPriceMinor"]:
            kind = "priceUp"
        elif curp["u"] > ref["u"]:
            kind = "cheaperPackDearerUnit"
        else:
            kind = "smallerNotDearer"
        shrink.append({"kind": kind, "shrink": kind not in ("smallerNotDearer", "differentPackSize"), "prev": prev["id"], "cur": curp["id"],
                       "ref": base["id"], "same": ref is not None,
                       "size": hu((curp["q"] - prev["q"]) / prev["q"] * 1000),
                       "unit": hu((curp["u"] - base["u"]) / base["u"] * 1000) if base["u"] else 0})

    shown = [p["u"] for p in (latest, lowest, highest) if p] + ([usual[0]] if usual else [])
    for r in rows:
        shown += [r["latest"]["u"], r["lowest"]["u"]]
    places = exp if all(v >= 10 ** exp for v in shown) else exp + 1

    def disp(v):
        return dec(v / 10 ** exp, places)

    def pos(v, lo, hi):
        if hi <= lo:
            return 500
        return max(0, min(1000, hu((v - lo) / (hi - lo) * 1000)))

    def gauge(count, lo, hi, us, x):
        if count < 3 or us is None:
            return {"building": count}
        u = us[0]
        if x <= lo["u"]:
            verdict = "lowest"
        elif x >= hi["u"] and x > u * F(105, 100):
            verdict = "highest"
        elif x <= u * F(95, 100):
            verdict = "good"
        elif x <= u * F(105, 100):
            verdict = "usual"
        else:
            verdict = "above"
        return {"verdict": verdict, "pct": hu((x - u) / u * 100) if u else None,
                "usualAt": pos(u, lo["u"], hi["u"]), "at": pos(x, lo["u"], hi["u"])}

    gauges = {c: gauge(len(pts), lowest, highest, usual, F(c) * 10 ** exp) for c in inp.get("candidates", [])}

    latest_gauge = None
    if latest:
        rest = dict(inp, observations=[o for o in inp["observations"] if o["id"] != latest["id"]], candidates=[])
        b = stats_raw(rest)
        latest_gauge = gauge(b["count"], b["lowest"], b["highest"], b["usual"], latest["u"])

    chart = []
    if pts:
        d0, d1 = pts[0]["day"], pts[-1]["day"]
        for sid in dict.fromkeys(p["storeId"] for p in pts):
            chart.append([sid, [[p["id"], pos(F(p["day"]), F(d0), F(d1)), pos(p["u"], lowest["u"], highest["u"])]
                                for p in pts if p["storeId"] == sid]])

    raw = {"count": len(pts), "lowest": lowest, "highest": highest, "usual": usual}
    return raw, {
        "count": len(pts), "otherCurrency": other, "invalid": invalid, "basis": basis_id, "decimals": places,
        "latest": latest["id"] if latest else None,
        "lowest": [lowest["id"], lowest["isPromo"]] if lowest else None,
        "highest": [highest["id"], highest["isPromo"]] if highest else None,
        "usual": {"value": fr(usual[0]), "basedOn": usual[1], "source": usual[2]} if usual else None,
        "display": {"latest": disp(latest["u"]), "lowest": disp(lowest["u"]), "highest": disp(highest["u"]),
                    "usual": disp(usual[0])} if pts else None,
        "stores": [{"store": r["store"], "latest": r["latest"]["id"], "lowest": r["lowest"]["id"], "count": r["count"],
                    "days": r["days"], "stale": r["stale"], "cheapest": r["cheapest"],
                    "display": disp(r["latest"]["u"])} for r in rows],
        "shrink": shrink,
        "gauge": gauges,
        "latestGauge": latest_gauge,
        "chart": chart,
    }


def stats_raw(inp):
    return stats(inp)[0]


def summary(inp):
    return stats(inp)[1]


# ---------- builders ----------

_seq = [0]


def ob(id_, on, store, price, size, unit="g", count=1, paid=None, promo=False, currency="EUR", created=None, deposit=0):
    return {"id": id_, "storeId": store, "observedOn": on, "createdAt": created or on + "T12:00:00.000Z",
            "currency": currency, "packPriceMinor": price, "paidPriceMinor": paid, "packCount": count,
            "itemSize": size, "unit": unit, "depositMinor": deposit, "isPromo": promo}


EUR_MASS = {"currency": "EUR", "dimension": "mass", "measurementSystem": "metric"}
TODAY = "2026-09-30"


def case(id_, note, observations, settings=EUR_MASS, today=TODAY, candidates=()):
    inp = {"today": today, "settings": settings, "observations": observations, "candidates": list(candidates)}
    return {"id": id_, "input": inp, "expected": summary(inp), "note": note}


S1_OBS = [
    ob(1, "2026-01-10", REWE, 249, "500"),
    ob(2, "2026-02-14", ALDI, 229, "500"),
    ob(3, "2026-03-20", REWE, 399, "1", "kg", promo=True),
    ob(4, "2026-07-20", EDEKA, 259, "500"),
    ob(5, "2026-08-28", REWE, 249, "500"),
]
S2_OBS = [ob(11, "2026-03-01", REWE, 199, "200"), ob(12, "2026-09-01", REWE, 199, "175")]


def check(actual, expected, where):
    if actual != expected:
        raise SystemExit(f"ORACLE DISAGREES WITH SPEC at {where}: oracle {actual!r}, SPEC {expected!r}")


def assert_spec():
    s = summary({"today": TODAY, "settings": EUR_MASS, "observations": S1_OBS,
                 "candidates": ["4.49", "3.95", "5.10", "5.20", "5.30"]})
    # SPEC 5.8 example S1, typed from the SPEC text
    check(s["display"], {"latest": "4.98", "lowest": "3.99", "highest": "5.18", "usual": "4.98"}, "S1 tiles")
    check(s["latest"], 5, "S1 latest is Rewe Aug")
    check(s["lowest"], [3, True], "S1 lowest is the promo")
    check(s["usual"]["basedOn"], 4, "S1 usual = median of 4 regular prices")
    check({c: (g["verdict"], g["pct"]) for c, g in s["gauge"].items()},
          {"4.49": ("good", -10), "3.95": ("lowest", -21), "5.10": ("usual", 2), "5.20": ("usual", 4),
           "5.30": ("highest", 6)}, "S1 gauge")
    check([(r["store"], r["display"], r["stale"], r["cheapest"]) for r in s["stores"]],
          [(REWE, "4.98", False, True), (EDEKA, "5.18", False, False), (ALDI, "4.58", True, False)], "S1 store table")
    rewe = s["stores"][0]
    check((rewe["count"], rewe["lowest"]), (3, 3), "S1 Rewe lowest 3.99, 3 prices")
    s2 = summary({"today": TODAY, "settings": EUR_MASS, "observations": S2_OBS, "candidates": []})
    check(s2["display"]["lowest"], "9.95", "S2 old unit price")
    check(s2["display"]["latest"], "11.37", "S2 new unit price")
    check([(e["kind"], e["size"], e["unit"]) for e in s2["shrink"]], [("samePrice", -125, 143)], "S2 event")
    # D42 (P3.5, review #6), expected events typed by hand
    for id_, want in [
        ("shrink-two-pack-sizes", [("differentPackSize", False, -500, 110)]),  # 9.98 vs 8.99 per kg = +11.0 %
        ("shrink-two-pack-counts", [("differentPackSize", False, -333, 99)]),  # 2.4924 vs 2.2677 per L = +9.9 %
        ("shrink-known-then-new", [("cheaperPackDearerUnit", True, -250, 266), ("samePrice", True, -100, 111)]),
        ("shrink-30-percent-edge", [("samePrice", True, -300, 429), ("differentPackSize", False, -301, 431)]),
    ]:
        c = next(x for x in cases() if x["id"] == id_)
        got = summary(c["input"])["shrink"]
        check([(e["kind"], e["shrink"], e["size"], e["unit"]) for e in got], want, id_)


def cases():
    out = [
        case("S1", "SPEC 5.8 example S1: tiles, five gauge candidates, store table, staleness", S1_OBS,
             candidates=["4.49", "3.95", "5.10", "5.20", "5.30"]),
        case("S1-boundaries", "S1 book at the exact band edges: = lowest, = usual x 0.95, = usual x 1.05, just above",
             S1_OBS, candidates=["3.99", "3.9899", "4.731", "4.7311", "5.229", "5.2291", "5.18", "6"]),
        case("S1-other-currency", "S1 plus two USD prices: excluded and counted (SPEC 4)",
             S1_OBS + [ob(6, "2026-09-01", ALDI, 100, "500", currency="USD"), ob(7, "2026-09-02", REWE, 900, "500", currency="USD")],
             candidates=["4.49"]),
        case("S1-per-100g", "S1 shown per 100 g: same verdicts, 3 decimals", S1_OBS,
             settings=dict(EUR_MASS, bases={"mass": "100g"}), candidates=["0.449", "0.53"]),
        case("S2", "SPEC 5.8 example S2: same price, 12.5 % less, +14.3 % per kg", S2_OBS),
        case("shrink-price-up", "smaller pack and a higher pack price at the same store",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-09-01", REWE, 209, "175")]),
        case("shrink-cheaper-pack-dearer-unit", "pack price down, unit price up",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-09-01", REWE, 189, "175")]),
        case("shrink-smaller-not-dearer", "pack price down at least in proportion: reported, not shrinkflation (D35)",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-09-01", REWE, 159, "175")]),
        case("shrink-other-store", "different store, no earlier price there: pack got smaller",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-09-01", ALDI, 179, "175")]),
        case("shrink-promo-ignored", "a smaller promo pack in between is ignored",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-04-01", REWE, 99, "150", promo=True), ob(3, "2026-05-01", REWE, 199, "200")]),
        case("shrink-promo-between", "promo skipped: the event compares the two regular prices",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-04-01", REWE, 99, "175", promo=True), ob(3, "2026-05-01", REWE, 199, "175")]),
        case("shrink-promo-new-size", "a smaller pack seen only on promo is no event",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-04-01", REWE, 149, "175", promo=True)]),
        case("shrink-threshold-exact", "Q_new = Q_prev x 0.99 counts (<=)",
             [ob(1, "2026-03-01", REWE, 499, "1000"), ob(2, "2026-04-01", REWE, 499, "990")]),
        case("shrink-threshold-under", "Q_new = Q_prev x 0.991: no event",
             [ob(1, "2026-03-01", REWE, 499, "1000"), ob(2, "2026-04-01", REWE, 499, "991")]),
        case("shrink-same-store-not-adjacent", "previous price is Aldi; classified against Rewe's earlier price",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-04-01", ALDI, 179, "200"), ob(3, "2026-05-01", REWE, 199, "175")]),
        case("shrink-chain", "two shrinks in a row: two events",
             [ob(1, "2026-01-01", REWE, 199, "200"), ob(2, "2026-04-01", REWE, 199, "175"), ob(3, "2026-08-01", REWE, 199, "150")]),
        case("shrink-multipack", "4 x 100 g -> 3 x 100 g at the same price",
             [ob(1, "2026-03-01", REWE, 299, "100", count=4), ob(2, "2026-06-01", REWE, 299, "100", count=3)]),
        case("shrink-unit-change", "1 lb -> 400 g, US book per oz",
             [ob(1, "2026-03-01", REWE, 399, "1", "lb", currency="USD"), ob(2, "2026-06-01", REWE, 399, "400", currency="USD")],
             settings={"currency": "USD", "dimension": "mass", "measurementSystem": "us"}),
        case("shrink-bigger", "pack got bigger: no event",
             [ob(1, "2026-03-01", REWE, 199, "175"), ob(2, "2026-06-01", REWE, 219, "200")]),
        case("shrink-no-store", "prices without a store have no same-store reference",
             [ob(1, "2026-03-01", None, 199, "200"), ob(2, "2026-06-01", None, 199, "175")]),
        case("shrink-paid-price", "same shelf price, coupon paid price: kind uses the shelf price, unit uses paid",
             [ob(1, "2026-03-01", REWE, 199, "200"), ob(2, "2026-06-01", REWE, 199, "175", paid=149)]),
        case("shrink-two-pack-sizes", "D42 / review #6: 1 kg 8.99 -> 500 g 4.99 -> 1 kg -> 500 g at one store: only the first switch is "
             "reported, and as a different pack size (50 % smaller), never shrinkflation",
             [ob(1, "2026-03-01", REWE, 899, "1000"), ob(2, "2026-04-01", REWE, 499, "500"), ob(3, "2026-05-01", REWE, 899, "1000"),
              ob(4, "2026-06-01", REWE, 499, "500")]),
        case("shrink-two-pack-counts", "D42: 6 x 330 ml and 4 x 330 ml bought alternately: no repeated events",
             [ob(1, "2026-03-01", REWE, 449, "330", "ml", count=6), ob(2, "2026-04-01", REWE, 329, "330", "ml", count=4),
              ob(3, "2026-05-01", REWE, 449, "330", "ml", count=6), ob(4, "2026-06-01", REWE, 329, "330", "ml", count=4)],
             settings=dict(EUR_MASS, dimension="volume")),
        case("shrink-known-then-new", "D42: switching back to a known size is no event; a NEW smaller size of the same pack still is",
             [ob(1, "2026-01-01", REWE, 199, "200"), ob(2, "2026-02-01", REWE, 189, "150"), ob(3, "2026-03-01", REWE, 199, "200"),
              ob(4, "2026-04-01", REWE, 189, "150"), ob(5, "2026-05-01", REWE, 199, "200"), ob(6, "2026-06-01", REWE, 199, "180")]),
        case("shrink-30-percent-edge", "D42: exactly 30 % smaller is still classified (samePrice); 30.1 % is a different pack size",
             [ob(1, "2026-01-01", REWE, 199, "1000"), ob(2, "2026-02-01", REWE, 199, "700"), ob(3, "2026-03-01", ALDI, 199, "1000"),
              ob(4, "2026-04-01", ALDI, 199, "699")]),
        case("usual-few-regular", "2 regular + 2 promo in the window: median of all 4",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", REWE, 300, "1000", promo=True),
              ob(3, "2026-07-01", REWE, 520, "1000"), ob(4, "2026-08-01", REWE, 320, "1000", promo=True)], candidates=["4.10"]),
        case("usual-exactly-3-regular", "3 regular prices: promo excluded from the median",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", REWE, 300, "1000", promo=True),
              ob(3, "2026-07-01", REWE, 520, "1000"), ob(4, "2026-08-01", REWE, 480, "1000")], candidates=["4.10"]),
        case("usual-older", "empty 365-day window: median of the last 5 prices (older data)",
             [ob(i, f"2024-0{i}-15", REWE, 400 + 10 * i, "1000") for i in range(1, 8)], candidates=["4.50"]),
        case("usual-window-boundary", "today - 365 days counts, today - 366 does not",
             [ob(1, "2025-09-29", REWE, 900, "1000"), ob(2, "2025-09-30", REWE, 500, "1000"),
              ob(3, "2026-01-01", REWE, 520, "1000"), ob(4, "2026-02-01", REWE, 540, "1000")]),
        case("usual-odd-median", "odd count: the middle value",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", ALDI, 450, "1000"), ob(3, "2026-07-01", REWE, 999, "1000")]),
        case("usual-even-median-exact", "even count, middle two 1.00/300 g and 1.01/300 g: exact mean (no rounding)",
             [ob(1, "2026-05-01", REWE, 100, "300"), ob(2, "2026-06-01", REWE, 101, "300"),
              ob(3, "2026-07-01", REWE, 90, "300"), ob(4, "2026-08-01", REWE, 120, "300")], candidates=["3.35"]),
        case("gauge-two-prices", "fewer than 3 prices: building your history",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", REWE, 450, "1000")], candidates=["4.00", "6.00"]),
        case("gauge-three-prices", "exactly 3 prices: verdicts shown",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", REWE, 450, "1000"), ob(3, "2026-07-01", REWE, 550, "1000")],
             candidates=["4.00", "4.75", "5.00", "5.50", "6.00"]),
        case("gauge-above", "highest far above usual: the 'above usual' band exists",
             [ob(1, "2026-04-01", REWE, 400, "1000"), ob(2, "2026-05-01", REWE, 500, "1000"), ob(3, "2026-06-01", REWE, 500, "1000"),
              ob(4, "2026-07-01", REWE, 500, "1000"), ob(5, "2026-08-01", REWE, 600, "1000")],
             candidates=["3.00", "4.00", "4.75", "4.7501", "5.00", "5.25", "5.26", "5.99", "6.00", "7.00"]),
        case("gauge-percent-half", "% vs usual half up away from zero: +2.5 -> +3, -2.5 -> -3",
             [ob(1, "2026-05-01", REWE, 380, "1000"), ob(2, "2026-06-01", REWE, 400, "1000"), ob(3, "2026-07-01", REWE, 420, "1000")],
             candidates=["4.10", "3.90", "4.02", "3.98"]),
        case("gauge-free", "every price free: usual 0, % not defined",
             [ob(1, "2026-05-01", REWE, 0, "1000"), ob(2, "2026-06-01", REWE, 0, "1000"), ob(3, "2026-07-01", REWE, 0, "1000")],
             candidates=["0", "1"]),
        case("store-stale-boundary", "latest exactly 90 days ago is fresh, 91 days is stale",
             [ob(1, "2026-07-02", REWE, 500, "1000"), ob(2, "2026-07-01", ALDI, 400, "1000"), ob(3, "2026-09-01", EDEKA, 550, "1000")]),
        case("store-all-stale", "no store seen in 90 days: no 'last seen cheapest'",
             [ob(1, "2026-01-02", REWE, 500, "1000"), ob(2, "2026-02-01", ALDI, 400, "1000")]),
        case("store-tie", "two stores with the same latest unit price share the badge",
             [ob(1, "2026-08-02", REWE, 250, "500"), ob(2, "2026-08-01", ALDI, 500, "1", "kg"), ob(3, "2026-09-01", EDEKA, 550, "1000")]),
        case("store-no-store", "prices without a store get a row but never the badge",
             [ob(1, "2026-08-02", None, 100, "1000"), ob(2, "2026-08-01", ALDI, 500, "1000"), ob(3, "2026-09-01", ALDI, 450, "1000")]),
        case("store-latest-promo", "a store whose latest price is a promo: the promo counts for that store",
             [ob(1, "2026-08-01", REWE, 500, "1000"), ob(2, "2026-09-01", REWE, 300, "1000", promo=True), ob(3, "2026-09-02", ALDI, 400, "1000")]),
        case("latest-same-day", "same date: created_at decides the latest",
             [ob(1, "2026-09-01", REWE, 500, "1000", created="2026-09-01T18:00:00.000Z"),
              ob(2, "2026-09-01", ALDI, 450, "1000", created="2026-09-01T09:00:00.000Z")]),
        case("lowest-tie-most-recent", "equal lowest prices: the most recent one is shown",
             [ob(1, "2026-03-01", REWE, 400, "1000"), ob(2, "2026-05-01", ALDI, 400, "1000"), ob(3, "2026-07-01", REWE, 500, "1000"),
              ob(4, "2026-08-01", REWE, 500, "1000"), ob(5, "2026-09-01", ALDI, 500, "1000")]),
        case("invalid-unit", "a price in a volume unit on a mass product is not used",
             [ob(1, "2026-05-01", REWE, 500, "1000"), ob(2, "2026-06-01", REWE, 100, "500", "ml")]),
        case("paid-price", "paid price after a deal drives the unit price; deposit never does",
             [ob(1, "2026-05-01", REWE, 249, "500", paid=166, promo=True, deposit=25), ob(2, "2026-06-01", REWE, 249, "500", deposit=25),
              ob(3, "2026-07-01", REWE, 249, "500")]),
        case("jpy", "JPY book: 0 decimals when every value >= 1 yen",
             [ob(1, "2026-05-01", REWE, 398, "500", currency="JPY"), ob(2, "2026-06-01", REWE, 428, "500", currency="JPY"),
              ob(3, "2026-07-01", REWE, 358, "500", currency="JPY")],
             settings={"currency": "JPY", "dimension": "mass", "measurementSystem": "metric"}, candidates=["700", "860"]),
        case("count-rolls", "count product per roll: 3 decimals under 1 euro",
             [ob(1, "2026-05-01", REWE, 399, "8", "pcs"), ob(2, "2026-06-01", ALDI, 549, "12", "pcs"),
              ob(3, "2026-07-01", REWE, 449, "1", "dozen")],
             settings={"currency": "EUR", "dimension": "count", "measurementSystem": "metric"}, candidates=["0.45"]),
        case("volume-us", "US book per fl oz, liters and fl oz mixed",
             [ob(1, "2026-05-01", REWE, 349, "64", "floz_us", currency="USD"), ob(2, "2026-06-01", ALDI, 299, "2", "l", currency="USD"),
              ob(3, "2026-07-01", REWE, 379, "64", "floz_us", currency="USD")],
             settings={"currency": "USD", "dimension": "volume", "measurementSystem": "us"}, candidates=["0.05"]),
        case("empty", "no prices at all", [], candidates=["1"]),
        case("single", "one price: tiles, no gauge",
             [ob(1, "2026-09-01", REWE, 199, "200")], candidates=["9"]),
    ]
    return out


if __name__ == "__main__":
    assert_spec()
    data = cases()
    ids = [c["id"] for c in data]
    assert len(ids) == len(set(ids))
    with open(OUT, "w") as f:
        json.dump({"cases": data}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {len(data)} cases to {os.path.relpath(OUT, ROOT)}")
