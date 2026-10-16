#!/usr/bin/env python3
"""Independent oracle for the Price Book promotion engine (SPEC 5.4-5.7, D13, D14, D16, D30-D34).

Written from the SPEC text with Python's exact Fraction type, NOT from src/engine/*.ts, so the Jest
fixtures it emits are a second implementation checking the first. It writes
test/fixtures/engine/deals.json and test/fixtures/engine/compare.json.

* "examples" sections carry the SPEC 5.7 numbers typed by hand from the SPEC table; this script asserts
  that the oracle reproduces every one of them before writing anything (so a SPEC typo or an oracle bug
  stops generation).
* every other section is generated: expected values are the oracle's.

Run:  python3 test/oracle/gen_engine_fixtures.py   (no packages needed)
"""
import json
import os
import re
from fractions import Fraction as F
from math import floor

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "test", "fixtures", "engine")

# ---------- SPEC 5.2 (only the factors the fixtures use) ----------
FACTOR = {
    "mg": F(1, 1000), "g": F(1), "kg": F(1000), "oz": F("28.349523125"), "lb": F("453.59237"),
    "ml": F(1), "cl": F(10), "l": F(1000), "floz_us": F("29.5735295625"), "gal_us": F("3785.411784"),
    "floz_uk": F("28.4130625"), "pcs": F(1), "dozen": F(12), "m": F(1), "cm": F(1, 100), "ft": F("0.3048"),
}
DIM = {"mg": "mass", "g": "mass", "kg": "mass", "oz": "mass", "lb": "mass",
       "ml": "volume", "cl": "volume", "l": "volume", "floz_us": "volume", "gal_us": "volume", "floz_uk": "volume",
       "pcs": "count", "dozen": "count", "m": "length", "cm": "length", "ft": "length"}
SYSTEM = {"mg": "metric", "g": "metric", "kg": "metric", "oz": "us", "lb": "us", "ml": "metric", "cl": "metric",
          "l": "metric", "floz_us": "us", "gal_us": "us", "floz_uk": "uk", "pcs": None, "dozen": None,
          "m": "metric", "cm": "metric", "ft": "us"}
BASIS = {"kg": F(1000), "100g": F(100), "lb": F("453.59237"), "oz": F("28.349523125"),
         "l": F(1000), "100ml": F(100), "floz_us": F("29.5735295625"), "qt_us": F("946.352946"), "gal_us": F("3785.411784"),
         "1": F(1), "10": F(10), "100": F(100), "m": F(1), "ft": F("0.3048"), "100ft": F("30.48")}
BASIS_SYSTEM = {"kg": "metric", "100g": "metric", "lb": "us", "oz": "us", "l": "metric", "100ml": "metric",
                "floz_us": "us", "qt_us": "us", "gal_us": "us", "1": None, "10": None, "100": None,
                "m": "metric", "ft": "us", "100ft": "us"}
DEFAULT_BASIS = {"metric": {"mass": "kg", "volume": "l", "count": "1", "length": "m"},
                 "uk": {"mass": "kg", "volume": "l", "count": "1", "length": "m"},
                 "us": {"mass": "oz", "volume": "floz_us", "count": "1", "length": "ft"}}
EXPONENT = {"EUR": 2, "USD": 2, "GBP": 2, "JPY": 0, "KWD": 3}


def hu(x):
    """Round half up; negatives half away from zero (D27)."""
    x = F(x)
    return floor(x + F(1, 2)) if x >= 0 else -floor(-x + F(1, 2))


def dec(x, places):
    """Exact Fraction -> decimal text rounded half up to `places`."""
    k = hu(F(x) * 10 ** places)
    s = str(abs(k)).rjust(places + 1, "0")
    body = s if places == 0 else s[:-places] + "." + s[-places:]
    return ("-" if k < 0 else "") + body


def pct(text):
    return F(text) / 100


def basis_for(dim, st):
    return (st.get("bases") or {}).get(dim) or DEFAULT_BASIS[st.get("measurementSystem", "metric")][dim]


def keypad_size(text):
    """SPEC 5.3 / D44 (P4, oracle review M2): an item size as the keypad stores it — canonical decimal text,
    0 < s <= 1,000,000, at most 3 decimals. Anything else (stale or hand-edited draft) makes the card incomplete."""
    if not isinstance(text, str) or not re.fullmatch(r"(0|[1-9][0-9]*)(\.[0-9]{0,2}[1-9])?", text):
        return False
    v = F(text)
    return 0 < v <= 1000000


# ---------- SPEC 5.4: one card ----------
def evaluate(card, st):
    if card.get("priceMinor") is None:
        return {"missing": "price"}
    if card.get("size") is None or not keypad_size(card["size"]["itemSize"]):
        return {"missing": "size"}
    deals = card.get("deals") or {}
    qd = deals.get("quantity")
    q = card.get("quantity")
    if q is None:
        q = (qd["x"] + qd["y"] if qd["kind"] == "buyXGetY" else qd["n"]) if qd else 1
    if q < 1:
        return {"missing": "quantity"}
    P = card["priceMinor"]
    steps, hints, warns = [], [], []
    S = S0 = q * P
    steps.append(["base", S0])
    if qd and qd["kind"] == "buyXGetY":
        X, Y, z = qd["x"], qd["y"], pct(qd["pct"])
        G = q // (X + Y)
        d = hu(Y * P * z)
        S -= G * d
        steps.append(["buyXGetY", -G * d])
        if d <= 0:
            warns.append("W5:noDiscount")
        r = q % (X + Y)
        if G == 0 and r < X:
            hints.append({"kind": "dealNeedsMore", "need": X + Y, "more": X + Y - q})
        elif r >= X:
            hints.append({"kind": "takeMore", "more": X + Y - r, "pct": qd["pct"]})
    elif qd:
        N, M = qd["n"], qd["priceMinor"]
        before = S
        if qd.get("perItem"):
            S = hu(F(q * M, N))
        else:
            G = q // N
            S = G * M + (q - G * N) * P
            if G == 0:
                hints.append({"kind": "dealNeedsMore", "need": N, "more": N - q})
            elif q % N:
                hints.append({"kind": "outsideDeal", "count": q % N})
        steps.append(["multiBuy", S - before])
        if M >= N * P:
            warns.append("W5:multiBuy")
    for i, p in enumerate(deals.get("percents") or []):
        m = p.get("minQty")
        if m is not None and q < m:
            steps.append(["percent", 0])
            hints.append({"kind": "minimumNotReached", "index": i, "minQty": m, "more": m - q})
            continue
        off = hu(S * pct(p["pct"]))
        S -= off
        steps.append(["percent", -off])
    MC = 0
    for c in deals.get("coupons") or []:
        a = c["amountMinor"] * (q if c.get("perPack") else 1)
        applied = min(a, S)
        if a > 0 and a >= S:
            warns.append("W5:coupon")
        S -= applied
        if c.get("manufacturer"):
            MC += applied
        steps.append(["coupon", -applied])
    ss = deals.get("spendSave")
    if ss:
        off = 0
        if S >= ss["thresholdMinor"]:
            off = hu(S * pct(ss["savePct"])) if ss.get("savePct") is not None else min(ss["saveMinor"], S)
        S -= off
        steps.append(["spendSave", -off])
    rate = st.get("taxRate")
    paid, tax = S, 0
    if rate is not None:
        r = pct(rate)
        if st["taxMode"] == "add":
            tax = hu((S + MC) * r)
            paid = S + tax
            steps.append(["taxAdded", tax])
        else:
            net = hu(F(S) / (1 + r))
            tax = S - net
            steps.append(["taxIncluded", 0])
    cb = 0
    cbd = deals.get("cashback")
    if cbd:
        CB = hu(S * pct(cbd["pct"])) if cbd.get("pct") is not None else cbd["amountMinor"]
        cb = min(CB, paid)
        steps.append(["cashback", -cb])
    E = paid - cb
    D = q * (card.get("depositMinor") or 0)
    if D:
        steps.append(["deposit", D])
    unit = card["unit"]
    dim = DIM[unit]
    basis = basis_for(dim, st)
    n, s = card["size"]["packCount"], F(card["size"]["itemSize"])
    Q = n * s * FACTOR[unit]
    U = F(E) / (q * Q) * BASIS[basis]
    if SYSTEM[unit] and BASIS_SYSTEM[basis] and SYSTEM[unit] != BASIS_SYSTEM[basis]:
        warns.append("W3")
    if E == 0:
        warns.append("W8")
    # D40 price-memory basis: shelf total after deals/coupons, before added tax and cashback, per basis; and the
    # per-pack price saved from Compare = S / q half up (None when no deal changed the total).
    M = F(S) / (q * Q) * BASIS[basis]
    saved = None if S == S0 else hu(F(S, q))
    return {"M": M, "saved": saved, "q": q, "S0": S0, "S": S, "paid": paid, "tax": tax, "net": paid - tax, "cashback": cb, "E": E, "D": D,
            "till": paid + D, "U": U, "Q": Q, "dim": dim, "basis": basis, "steps": steps, "hints": hints, "warns": warns,
            "permille": hu(F(S0 - S) * 1000 / S0) if S0 else 0}


def deal_expected(r, st, unit_places=2):
    exp = EXPONENT[st["currency"]]
    if "missing" in r:
        return {"missing": r["missing"]}
    places = exp if r["U"] >= 10 ** exp else exp + 1
    return {"quantity": r["q"], "s0": r["S0"], "s": r["S"], "paid": r["paid"], "tax": r["tax"], "cashback": r["cashback"],
            "effective": r["E"], "deposit": r["D"], "unitMinor": dec(r["U"], unit_places),
            "memoryUnitMinor": dec(r["M"], unit_places), "memoryPaid": r["saved"],
            "unitDisplay": dec(r["U"] / 10 ** exp, places), "steps": r["steps"], "hints": r["hints"], "warnings": r["warns"]}


# ---------- SPEC 5.5-5.6: ranking ----------
def compare(cards, st):
    exp = EXPONENT[st["currency"]]
    res = [(c, evaluate(c, st)) for c in cards]
    warns = []
    done = []
    for c, r in res:
        if "missing" in r:
            warns.append(f"W7:{r['missing']}:{c['id']}")
        else:
            done.append((c, r))
    dims = []
    for c, r in done:
        if r["dim"] not in dims:
            dims.append(r["dim"])
    if len(dims) > 1:
        warns.append("W1")
    groups = []
    for dim in dims:
        items = [(c, r) for c, r in done if r["dim"] == dim]
        srt = sorted(items, key=lambda cr: cr[1]["U"])  # stable: card order for equal U
        g = {"dimension": dim, "ranking": [c["id"] for c, _ in srt], "winners": [], "tie": False, "savings": None, "lowestToPay": None}
        if len(items) >= 2:
            best = srt[0][1]["U"]
            tie = lambda u: (u == 0) or (F(u - best) / u < F(1, 1000))
            win = [(c, r) for c, r in srt if tie(r["U"])]
            g["winners"] = [c["id"] for c, _ in win]
            g["tie"] = len(win) > 1
            rest = [(c, r) for c, r in srt if (c, r) not in win]
            if not g["tie"] and rest:
                (wc, wr), (rc, rr) = win[0], rest[0]
                frac = F(rr["U"] - wr["U"]) / rr["U"]
                money = hu((rr["U"] - wr["U"]) / BASIS[wr["basis"]] * wr["q"] * wr["Q"])
                g["savings"] = {"winnerId": wc["id"], "runnerUpId": rc["id"], "permille": hu(frac * 1000), "moneyMinor": money}
            low = min(r["E"] + r["D"] for _, r in items)
            ids = [c["id"] for c, r in items if r["E"] + r["D"] == low]
            if not any(i in g["winners"] for i in ids):
                g["lowestToPay"] = {"cardIds": ids, "amountMinor": low}
            lo, hi = srt[0][1]["U"], srt[-1][1]["U"]
            if lo > 0 and hi / lo >= 10:
                warns.append(f"W4:{hu(hi / lo)}")
            if dim == "count":
                labels = []
                for c, _ in items:
                    lab = (c.get("label") or "").strip().lower()
                    if lab and lab not in labels:
                        labels.append(lab)
                if len(labels) > 1:
                    warns.append("W2")
        groups.append(g)
    for c, r in done:
        for w in r["warns"]:
            warns.append(f"{w}:{c['id']}")
        for h in r["hints"]:
            warns.append(f"W6:{h['kind']}:{c['id']}")
    us = [r["U"] for _, r in done]
    places = exp if all(u >= 10 ** exp for u in us) else exp + 1
    return {"decimals": places, "groups": groups, "warnings": sorted(warns),
            "unitDisplay": {c["id"]: dec(r["U"] / 10 ** exp, places) for c, r in done}}


# ---------- helpers to write cases ----------
EUR = {"currency": "EUR", "taxMode": "include", "measurementSystem": "metric"}
USD = {"currency": "USD", "taxMode": "add", "measurementSystem": "us"}


def card(id_, price, size, unit, q=None, deals=None, deposit=None, label=None):
    c = {"id": id_, "priceMinor": price, "size": None if size is None else {"packCount": size[0], "itemSize": size[1]}, "unit": unit}
    if q is not None:
        c["quantity"] = q
    if deals:
        c["deals"] = deals
    if deposit is not None:
        c["depositMinor"] = deposit
    if label is not None:
        c["label"] = label
    return c


def sz(text):
    if "x" in text:
        n, s = text.split("x")
        return (int(n), s)
    return (1, text)


def check(actual, expected, where):
    """Every key of `expected` (typed from the SPEC) must match the oracle."""
    for k, v in expected.items():
        if actual.get(k) != v:
            raise SystemExit(f"oracle disagrees with SPEC at {where}.{k}: oracle {actual.get(k)!r}, SPEC {v!r}")


deals_examples, compare_examples = [], []


def deal_example(id_, note, c, st, spec, unit_places=2):
    r = evaluate(c, st)
    exp = deal_expected(r, st, unit_places)
    check(exp, spec, id_)
    exp.update(spec)
    deals_examples.append({"id": id_, "input": {"card": c, "settings": st}, "expected": exp, "note": note})


def compare_example(id_, note, cards, st, spec):
    out = compare(cards, st)
    flat = dict(out)
    check(flat, {k: v for k, v in spec.items() if k != "groups"}, id_)
    for i, gspec in enumerate(spec.get("groups", [])):
        check(out["groups"][i], gspec, f"{id_}.groups[{i}]")
    compare_examples.append({"id": id_, "input": {"cards": cards, "settings": st}, "expected": out, "note": note})


BOGO = {"kind": "buyXGetY", "x": 1, "y": 1, "pct": "100"}
THREE_FOR_TWO = {"kind": "buyXGetY", "x": 2, "y": 1, "pct": "100"}
HALF = {"kind": "buyXGetY", "x": 1, "y": 1, "pct": "50"}
USD0 = dict(USD)  # add-tax mode with no rate entered yet: no tax line (D31)

# ----- SPEC 5.7 worked examples, expected values typed from the SPEC table -----
deal_example("E3-float-trap", "SPEC E3: 400 g EUR 1.89 = 4.725 -> EUR 4.73 per kg (float gives 4.72)",
             card("A", 189, sz("400"), "g"), EUR, {"unitMinor": "472.5", "unitDisplay": "4.73", "effective": 189}, 1)
deal_example("E4-stacked-25-15", "SPEC E4: 9.99, -25 % then -15 %: -2.50 -> 7.49, -1.12 (112.35) -> 6.37; total -36.2 %",
             card("A", 999, sz("500"), "g", deals={"percents": [{"pct": "25"}, {"pct": "15"}]}), EUR,
             {"steps": [["base", 999], ["percent", -250], ["percent", -112]], "s": 637, "effective": 637})
deal_example("E5-stacked-20-10", "SPEC E5: 10.00, -20 % then -10 % = 7.20 (28 %, not 30 %)",
             card("A", 1000, sz("1"), "kg", deals={"percents": [{"pct": "20"}, {"pct": "10"}]}), EUR,
             {"steps": [["base", 1000], ["percent", -200], ["percent", -80]], "s": 720})
for q, s, hint in [(1, 349, True), (2, 349, False), (3, 698, True), (4, 698, False)]:
    spec = {"quantity": q, "s": s, "hints": [{"kind": "takeMore", "more": 1, "pct": "100"}] if hint else []}
    if q == 2:
        spec["unitDisplay"] = "0.145"
    deal_example(f"E6-bogo-q{q}", f"SPEC E6: $3.49 BOGO free, 12 oz, q{q}" + (" + hint 'Take 1 more — free'" if hint else ""),
                 card("A", 349, sz("12"), "oz", q=q, deals={"quantity": BOGO}), USD0, spec)
deal_example("E7-second-half-price", "SPEC E7: $3.49, X1 Y1 z50, q2: d = round(174.5) = 175 -> $5.23",
             card("A", 349, sz("12"), "oz", q=2, deals={"quantity": HALF}), USD0, {"steps": [["base", 698], ["buyXGetY", -175]], "s": 523})
deal_example("E8-three-for-two-card", "SPEC E8 card A: 500 g EUR 2.29, 3 for 2 (default q3) -> 4.58 for 1.5 kg = 305.33 c/kg",
             card("A", 229, sz("500"), "g", deals={"quantity": THREE_FOR_TWO}), EUR,
             {"quantity": 3, "s": 458, "unitMinor": "305.33", "unitDisplay": "3.05"})
deal_example("E9-buy2get1-q5", "SPEC E9: buy 2 get 1, P 1.00, q5: G = 1 -> 4.00 + 'Take 1 more — free'",
             card("A", 100, sz("1"), "pcs", q=5, deals={"quantity": THREE_FOR_TWO}), EUR,
             {"s": 400, "hints": [{"kind": "takeMore", "more": 1, "pct": "100"}]})
for q, s, hints in [(3, 500, []), (4, 699, [{"kind": "outsideDeal", "count": 1}]), (5, 898, [{"kind": "outsideDeal", "count": 2}]), (6, 1000, [])]:
    deal_example(f"E10-multibuy-q{q}", f"SPEC E10: 3 for EUR 5, P 1.99, q{q}" + (" + 'items outside the deal pay the normal price'" if hints else ""),
                 card("A", 199, sz("400"), "g", q=q, deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 500}}), EUR,
                 {"s": s, "hints": hints, "warnings": []})
deal_example("E11-fake-multibuy", "SPEC E11: 3 for EUR 6, P 1.99: 'Not a saving: 3 at the normal price cost EUR 5.97' (W5)",
             card("A", 199, sz("400"), "g", deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 600}}), EUR,
             {"quantity": 3, "s": 600, "warnings": ["W5:multiBuy"]})
TEN = {"kind": "multiBuy", "n": 10, "priceMinor": 1000}
deal_example("E12-per-item-q1", "SPEC E12: 10 for $10, P 1.29, per-item switch on, q1 -> $1.00",
             card("A", 129, sz("1"), "pcs", q=1, deals={"quantity": dict(TEN, perItem=True)}), USD0, {"s": 100, "hints": []})
deal_example("E12-per-item-q3", "SPEC E12: per-item on, q3 -> $3.00",
             card("A", 129, sz("1"), "pcs", q=3, deals={"quantity": dict(TEN, perItem=True)}), USD0, {"s": 300})
deal_example("E12-must-buy-q3", "SPEC E12: must buy (switch off), q3 -> $3.87 + 'Deal needs 10 — 7 more'",
             card("A", 129, sz("1"), "pcs", q=3, deals={"quantity": TEN}), USD0, {"s": 387, "hints": [{"kind": "dealNeedsMore", "need": 10, "more": 7}]})
MIN2 = {"percents": [{"pct": "20", "minQty": 2}]}
deal_example("E13-min-q1", "SPEC E13: 20 % off when you buy 2+, EUR 3.00, q1 -> 3.00 (greyed, hint)",
             card("A", 300, sz("1"), "kg", q=1, deals=MIN2), EUR, {"s": 300, "hints": [{"kind": "minimumNotReached", "index": 0, "minQty": 2, "more": 1}]})
deal_example("E13-min-q2", "SPEC E13: q2 -> 4.80", card("A", 300, sz("1"), "kg", q=2, deals=MIN2), EUR, {"s": 480, "hints": []})
US_TAX = dict(USD, taxRate="8.875")
deal_example("E14-store-coupon", "SPEC E14: $4.99 q2, -20 %, $1 coupon once, tax 8.875 %: 9.98 -> 7.98 -> 6.98, tax round(61.9475) = 0.62 -> $7.60",
             card("A", 499, sz("12"), "oz", q=2, deals={"percents": [{"pct": "20"}], "coupons": [{"amountMinor": 100}]}), US_TAX,
             {"steps": [["base", 998], ["percent", -200], ["coupon", -100], ["taxAdded", 62]], "s": 698, "tax": 62, "paid": 760})
deal_example("E14-manufacturer-coupon", "SPEC E14: same coupon marked manufacturer: tax base 7.98, tax 0.71 -> $7.69",
             card("A", 499, sz("12"), "oz", q=2, deals={"percents": [{"pct": "20"}], "coupons": [{"amountMinor": 100, "manufacturer": True}]}), US_TAX,
             {"s": 698, "tax": 71, "paid": 769})
SPEND = {"spendSave": {"thresholdMinor": 3000, "saveMinor": 500}}
deal_example("E15-spend-q2", "SPEC E15: spend EUR 30 save EUR 5, P 12.99, q2 = 25.98 (not reached)",
             card("A", 1299, sz("1"), "pcs", q=2, deals=SPEND), EUR, {"s": 2598, "steps": [["base", 2598], ["spendSave", 0]]})
deal_example("E15-spend-q3", "SPEC E15: q3 = 38.97 -> 33.97 (11.32 each)",
             card("A", 1299, sz("1"), "pcs", q=3, deals=SPEND), EUR, {"s": 3397, "unitMinor": "1132.33", "unitDisplay": "11.32"})
deal_example("E16-cashback", "SPEC E16: $19.99 for 12 ct, add tax 6 %, 10 % cashback: tax 120 (119.94), paid 21.19, CB 200 -> E 19.19, $1.60 per ct (159.92 c)",
             card("A", 1999, sz("12"), "pcs", deals={"cashback": {"pct": "10"}}), dict(USD, taxRate="6"),
             {"tax": 120, "paid": 2119, "cashback": 200, "effective": 1919, "unitMinor": "159.92", "unitDisplay": "1.60"})
deal_example("E17-vat-remove", "SPEC E17: prices incl. 7 %: EUR 2.99 -> net 2.79, VAT 0.20",
             card("A", 299, sz("1"), "kg"), dict(EUR, taxRate="7"), {"paid": 299, "tax": 20, "effective": 299})
deal_example("E17-vat-add", "SPEC E17: add 19 %: EUR 10.00 -> tax 1.90 -> 11.90",
             card("A", 1000, sz("1"), "kg"), dict(EUR, taxMode="add", taxRate="19"), {"tax": 190, "paid": 1190})
deal_example("E18-multipack-deposit", "SPEC E18 A: 6x330 ml EUR 4.49 + EUR 1.50 deposit -> 226.77 c/L, deposit outside the unit price",
             card("A", 449, sz("6x0.33"), "l", deposit=150), EUR, {"effective": 449, "deposit": 150, "unitMinor": "226.77", "unitDisplay": "2.27"})
deal_example("E18-bottle-deposit", "SPEC E18 B: 1.5 L EUR 1.19 + EUR 0.25 deposit -> 79.33 c/L (EUR 0.79; 3 decimals under 1 unit: 0.793)",
             card("B", 119, sz("1.5"), "l", deposit=25), EUR, {"deposit": 25, "unitMinor": "79.33", "unitDisplay": "0.793"})

# ----- D40 price-memory basis (P3.5, review #2): values typed by hand -----
deal_example("P35-memory-us-tax", "D40: $4.99 for 12 oz, add tax 8.875 %: tax round(44.286) = 44, Compare U 543/12 = 45.25 c/oz; "
             "memory basis = shelf 499/12 = 41.58 c/oz; nothing to save as paid (no deal)",
             card("A", 499, sz("12"), "oz"), dict(USD, taxRate="8.875", bases={"mass": "oz"}),
             {"tax": 44, "paid": 543, "unitMinor": "45.25", "memoryUnitMinor": "41.58", "memoryPaid": None})
deal_example("P35-memory-3for2", "D40 / review #2 (c): 3 for 2 at EUR 2.29, 500 g: S 458; saved paid per pack 458/3 = 152.67 -> 153; memory 458 c / 1.5 kg = 305.33 c/kg",
             card("A", 229, sz("500"), "g", deals={"quantity": THREE_FOR_TWO}), EUR,
             {"s": 458, "memoryUnitMinor": "305.33", "memoryPaid": 153})
deal_example("P35-memory-cashback", "D40: E16 card ($19.99, 12 ct, add 6 %, 10 % cashback): memory = shelf 1999/12 = 166.58 c per ct, not 159.92",
             card("A", 1999, sz("12"), "pcs", deals={"cashback": {"pct": "10"}}), dict(USD, taxRate="6"),
             {"unitMinor": "159.92", "memoryUnitMinor": "166.58", "memoryPaid": None})

E1 = [card("A", 249, sz("500"), "g"), card("B", 549, sz("1.2"), "kg"), card("C", 239, sz("16"), "oz")]
compare_example("E1-conversion-metric", "SPEC E1: A 4.98 · B 4.58 (4.575) · C 5.27 (526.905 c) per kg; B best, 8.1 % cheaper, saves 0.49 on 1.2 kg (48.6 c)",
                E1, EUR, {"unitDisplay": {"A": "4.98", "B": "4.58", "C": "5.27"}, "decimals": 2,
                          "groups": [{"ranking": ["B", "A", "C"], "winners": ["B"], "savings": {"winnerId": "B", "runnerUpId": "A", "permille": 81, "moneyMinor": 49}}],
                          "warnings": ["W3:C"]})
compare_example("E2-conversion-us", "SPEC E2: same cards per oz: A $0.141 · B $0.130 · C $0.149 (3 decimals: all < 1)",
                E1, dict(EUR, currency="USD", measurementSystem="us"),
                {"unitDisplay": {"A": "0.141", "B": "0.130", "C": "0.149"}, "decimals": 3,
                 "groups": [{"winners": ["B"], "savings": {"winnerId": "B", "runnerUpId": "A", "permille": 81, "moneyMinor": 49}}],
                 "warnings": ["W3:A", "W3:B"]})
compare_example("E8-three-for-two-wins", "SPEC E8: A 500 g 2.29 '3 for 2' (q3) 3.05/kg vs B 1.2 kg 5.49 4.58/kg; A best, 33.3 % cheaper, saves 2.28 on 1.5 kg (228.25 c)",
                [card("A", 229, sz("500"), "g", deals={"quantity": THREE_FOR_TWO}), card("B", 549, sz("1.2"), "kg")], EUR,
                {"unitDisplay": {"A": "3.05", "B": "4.58"}, "groups": [{"winners": ["A"], "savings": {"winnerId": "A", "runnerUpId": "B", "permille": 333, "moneyMinor": 228}, "lowestToPay": None}]})
compare_example("E18-deposit-excluded", "SPEC E18: 6x330 ml 4.49 + 1.50 deposit (226.77 c/L) vs 1.5 L 1.19 + 0.25 (79.33 c/L): B best; mixed values -> 3 decimals (D32)",
                [card("A", 449, sz("6x330"), "ml", deposit=150), card("B", 119, sz("1.5"), "l", deposit=25)], EUR,
                {"decimals": 3, "unitDisplay": {"A": "2.268", "B": "0.793"}, "groups": [{"winners": ["B"]}]})
compare_example("E19-dimension-mismatch", "SPEC E19: 1 L 1.19 vs 1 kg 1.29: two groups, W1, no winner across them",
                [card("A", 119, sz("1"), "l"), card("B", 129, sz("1"), "kg")], EUR,
                {"warnings": ["W1"], "groups": [{"dimension": "volume", "winners": []}, {"dimension": "mass", "winners": []}]})
compare_example("E20-typo", "SPEC E20: A 500 g 2.49 vs B 500 kg 2.59: W4 '961x'",
                [card("A", 249, sz("500"), "g"), card("B", 259, sz("500"), "kg")], EUR, {"warnings": ["W4:961"], "groups": [{"winners": ["B"]}]})
compare_example("E21-tie-equal", "SPEC E21: A 500 g 2.00 vs B 1 kg 4.00: Same unit price (4.00 = 4.00)",
                [card("A", 200, sz("500"), "g"), card("B", 400, sz("1"), "kg")], EUR, {"groups": [{"tie": True, "winners": ["A", "B"], "savings": None}]})
compare_example("E21-tie-within-0.1pct", "SPEC E21: A 1 kg 4.00 vs B 3 kg 11.99: 399.67 c vs 400 c differ by 0.08 % (< 0.1 %) -> tie",
                [card("A", 400, sz("1"), "kg"), card("B", 1199, sz("3"), "kg")], EUR,
                {"groups": [{"tie": True, "ranking": ["B", "A"], "winners": ["B", "A"], "savings": None}]})

# ----- generated: each quantity deal x q = 1 .. 2(X+Y)+1 -----
gen_deals = []


def gen(id_, note, c, st=EUR):
    gen_deals.append({"id": id_, "input": {"card": c, "settings": st}, "expected": deal_expected(evaluate(c, st), st), "note": note})


QUANTITY_DEALS = [
    ("bogo", BOGO, 349, "BOGO free (X1 Y1 z100)"),
    ("3for2", THREE_FOR_TWO, 229, "'3 for 2' (X2 Y1 z100)"),
    ("half", HALF, 349, "2nd half price (X1 Y1 z50), d rounded per group"),
    ("b2g1-50", {"kind": "buyXGetY", "x": 2, "y": 1, "pct": "50"}, 199, "buy 2 get 1 at 50 % (d = round(99.5) = 100)"),
    ("b3g2", {"kind": "buyXGetY", "x": 3, "y": 2, "pct": "100"}, 125, "buy 3 get 2 free"),
    ("b1g1-25", {"kind": "buyXGetY", "x": 1, "y": 1, "pct": "25"}, 333, "buy 1 get 1 at 25 % (round(83.25) = 83)"),
    ("b1g2-33", {"kind": "buyXGetY", "x": 1, "y": 2, "pct": "33.3"}, 299, "buy 1 get 2 at 33.3 % (round(199.134) = 199)"),
    ("mb3for5", {"kind": "multiBuy", "n": 3, "priceMinor": 500}, 199, "multi-buy 3 for 5.00 must-buy"),
    ("mb2for3", {"kind": "multiBuy", "n": 2, "priceMinor": 300}, 175, "multi-buy 2 for 3.00 must-buy"),
    ("mb3for5-item", {"kind": "multiBuy", "n": 3, "priceMinor": 500, "perItem": True}, 199, "multi-buy 3 for 5.00 per item: round(q x 500 / 3)"),
    ("mb4for10-item", {"kind": "multiBuy", "n": 4, "priceMinor": 1000, "perItem": True}, 299, "multi-buy 4 for 10.00 per item"),
]
for key, deal, price, label in QUANTITY_DEALS:
    bundle = deal["x"] + deal["y"] if deal["kind"] == "buyXGetY" else deal["n"]
    for q in range(1, 2 * bundle + 2):
        gen(f"q-{key}-q{q}", f"{label}, q{q} of 1..2(X+Y)+1 (D13 complete groups, remainders at the normal price)",
            card("A", price, sz("500"), "g", q=q, deals={"quantity": deal}))
for q in (1, 5, 10, 11, 20, 21):
    gen(f"q-10for10-must-q{q}", f"10 for $10 must-buy, P 1.29, q{q} (SPEC E12 convention)", card("A", 129, sz("1"), "pcs", q=q, deals={"quantity": TEN}), USD0)
    gen(f"q-10for10-item-q{q}", f"10 for $10 per item, P 1.29, q{q}", card("A", 129, sz("1"), "pcs", q=q, deals={"quantity": dict(TEN, perItem=True)}), USD0)
gen("q-default-bogo", "no q typed: BOGO defaults to its bundle size 2 (D30)", card("A", 349, sz("500"), "g", deals={"quantity": BOGO}))
gen("q-default-multibuy", "no q typed: 3 for 5 defaults to 3 (D30)", card("A", 199, sz("500"), "g", deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 500}}))
gen("q-default-percent-min", "no q typed and no quantity deal: q = 1 even with a % minimum (D30)", card("A", 300, sz("500"), "g", deals=MIN2))
gen("q-bogo-zero-pct", "buy 1 get 1 at 0 %: d = 0 -> W5 not a saving", card("A", 349, sz("500"), "g", q=2, deals={"quantity": {"kind": "buyXGetY", "x": 1, "y": 1, "pct": "0"}}))
gen("q-fake-equal", "multi-buy M = N x P exactly: W5 (M >= N x P)", card("A", 200, sz("500"), "g", q=3, deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 600}}))
gen("q-fake-per-item", "fake multi-buy in per-item mode raises S: W5, literal SPEC (D33)", card("A", 199, sz("500"), "g", q=2, deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 600, "perItem": True}}))
gen("q-free-price", "price 0 = Free (W8), any deal", card("A", 0, sz("500"), "g", q=2, deals={"quantity": BOGO}))

# ----- percent discounts -----
for q in (1, 2, 3, 4):
    gen(f"pct-min3-q{q}", f"15 % off when you buy 3+, P 2.49, q{q}", card("A", 249, sz("1"), "kg", q=q, deals={"percents": [{"pct": "15", "minQty": 3}]}))
gen("pct-order-a", "10 % then 25 % on 3.33: rounding at each step", card("A", 333, sz("1"), "kg", deals={"percents": [{"pct": "10"}, {"pct": "25"}]}))
gen("pct-order-b", "25 % then 10 % on 3.33: same result here, steps differ", card("A", 333, sz("1"), "kg", deals={"percents": [{"pct": "25"}, {"pct": "10"}]}))
gen("pct-three", "50 % then 50 % then 50 % on 0.99 (49.5 -> 50, 24.5 -> 25, 12 -> 12)", card("A", 99, sz("1"), "kg", deals={"percents": [{"pct": "50"}] * 3}))
gen("pct-100", "100 % off -> free (W8)", card("A", 499, sz("1"), "kg", deals={"percents": [{"pct": "100"}]}))
gen("pct-decimal", "12.5 % off 7.99 = round(99.875) = 100", card("A", 799, sz("1"), "kg", deals={"percents": [{"pct": "12.5"}]}))
gen("pct-after-bogo", "BOGO q2 then 10 %: percent applies to the deal total", card("A", 349, sz("1"), "kg", q=2, deals={"quantity": BOGO, "percents": [{"pct": "10"}]}))
gen("pct-half-cent", "5 % of 0.10 = 0.5 c -> 1 (half up)", card("A", 10, sz("1"), "kg", deals={"percents": [{"pct": "5"}]}))
gen("pct-min-mixed", "20 % (from 2) and 5 % (any), q1: first skipped, second applied", card("A", 1000, sz("1"), "kg", q=1, deals={"percents": [{"pct": "20", "minQty": 2}, {"pct": "5"}]}))

# ----- coupons -----
for q in (1, 2, 3):
    gen(f"coupon-once-q{q}", f"0.50 coupon once, P 1.99, q{q}", card("A", 199, sz("1"), "pcs", q=q, deals={"coupons": [{"amountMinor": 50}]}))
    gen(f"coupon-perpack-q{q}", f"0.50 coupon per pack, P 1.99, q{q}", card("A", 199, sz("1"), "pcs", q=q, deals={"coupons": [{"amountMinor": 50, "perPack": True}]}))
gen("coupon-clamp", "coupon 5.00 on 3.49: clamps to 0, W5 + W8", card("A", 349, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 500}]}))
gen("coupon-equal", "coupon = price: 0, W5 (coupon >= price) + W8", card("A", 349, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 349}]}))
gen("coupon-two", "two coupons in order: 1.00 then 0.75 per pack, q2 of 2.49", card("A", 249, sz("1"), "pcs", q=2, deals={"coupons": [{"amountMinor": 100}, {"amountMinor": 75, "perPack": True}]}))
gen("coupon-second-clamps", "second coupon clamps after the first", card("A", 300, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 200}, {"amountMinor": 200}]}))
gen("coupon-after-pct", "coupons come after percents: 20 % then 1.00 on 4.99", card("A", 499, sz("1"), "pcs", deals={"percents": [{"pct": "20"}], "coupons": [{"amountMinor": 100}]}))
gen("coupon-zero-on-free", "0 c coupon on a 0 total: W8 only, never W5 (D30, oracle review M1)", card("A", 0, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 0}]}))
gen("coupon-zero-after-clamp", "0 c coupon after an earlier coupon took S to 0: one W5 (the first), W8", card("A", 300, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 300}, {"amountMinor": 0}]}))
gen("size-4-decimals", "item size 0.0001 kg: more than 3 decimals -> incomplete, W7 size (SPEC 5.3, oracle review M2)", card("A", 249, (1, "0.0001"), "kg"))
gen("size-over-max", "item size 1000000.001 kg: above 1,000,000 -> incomplete (SPEC 5.3, oracle review M2)", card("A", 249, (1, "1000000.001"), "kg"))
gen("size-at-max", "item size 1000000 kg: the largest the keypad accepts -> complete", card("A", 249, (1, "1000000"), "kg"))
gen("size-not-canonical", "item size '1.50' (not as the keypad stores it) -> incomplete (draft or hand-edited input)", card("A", 249, (1, "1.50"), "kg"))
gen("size-zero", "item size 0 -> incomplete (SPEC 7 'Size 0 refused')", card("A", 249, (1, "0"), "kg"))
gen("coupon-zero", "coupon 0.00: no change, no warning", card("A", 499, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 0}]}))
gen("coupon-mfr-add-tax", "manufacturer coupon, add tax 10 %: base = S + MC", card("A", 1000, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 250, "manufacturer": True}]}), dict(USD, taxRate="10"))
gen("coupon-mfr-include", "manufacturer coupon in include mode: no tax effect", card("A", 1000, sz("1"), "pcs", deals={"coupons": [{"amountMinor": 250, "manufacturer": True}]}), dict(EUR, taxRate="19"))
gen("coupon-mfr-perpack-tax", "manufacturer coupon per pack q3, add tax 8.875 %", card("A", 499, sz("12"), "oz", q=3, deals={"coupons": [{"amountMinor": 100, "perPack": True, "manufacturer": True}]}), dict(USD, taxRate="8.875"))

# ----- spend and save -----
for q in (2, 3, 4):
    gen(f"spend-amount-q{q}", f"spend 30 save 5, P 10.00, q{q} (below / at / above the threshold)", card("A", 1000, sz("1"), "pcs", q=q, deals=SPEND))
    gen(f"spend-pct-q{q}", f"spend 30 save 10 %, P 10.00, q{q}", card("A", 1000, sz("1"), "pcs", q=q, deals={"spendSave": {"thresholdMinor": 3000, "savePct": "10"}}))
gen("spend-after-coupon", "threshold checked after coupons: 3 x 10.00 - 1.00 = 29.00 < 30", card("A", 1000, sz("1"), "pcs", q=3, deals={"coupons": [{"amountMinor": 100}], **SPEND}))
gen("spend-save-exceeds", "save 50 on a 40 threshold: clamps to 0", card("A", 4000, sz("1"), "pcs", deals={"spendSave": {"thresholdMinor": 4000, "saveMinor": 5000}}))
gen("spend-pct-rounding", "spend 20 save 7.5 % on 21.99: round(164.925) = 165", card("A", 2199, sz("1"), "pcs", deals={"spendSave": {"thresholdMinor": 2000, "savePct": "7.5"}}))

# ----- tax modes -----
for mode, rate in (("include", "0"), ("include", "19"), ("include", "7.7"), ("add", "0"), ("add", "8.875"), ("add", "7.25"), ("include", None), ("add", None)):
    st = dict(EUR, taxMode=mode)
    if rate is not None:
        st["taxRate"] = rate
    gen(f"tax-{mode}-{rate}", f"tax mode {mode}, rate {rate}: SPEC 5.4 step 6", card("A", 1234, sz("1"), "kg", q=2), st)
gen("tax-add-after-deals", "add 6 % after 3 for 2 and a coupon", card("A", 249, sz("1"), "kg", q=3, deals={"quantity": THREE_FOR_TWO, "coupons": [{"amountMinor": 50}]}), dict(USD, taxRate="6"))
gen("tax-include-half", "incl. 25 %: 0.10 / 1.25 = 8 exactly", card("A", 10, sz("1"), "kg"), dict(EUR, taxRate="25"))

# ----- cashback -----
gen("cashback-amount", "cashback 2.00 on 9.99", card("A", 999, sz("1"), "pcs", deals={"cashback": {"amountMinor": 200}}))
gen("cashback-pct-rounding", "cashback 3 % of 4.99 = round(14.97) = 15", card("A", 499, sz("1"), "pcs", deals={"cashback": {"pct": "3"}}))
gen("cashback-exceeds", "cashback 10.00 on 4.99: E clamps to 0 (W8)", card("A", 499, sz("1"), "pcs", deals={"cashback": {"amountMinor": 1000}}))
gen("cashback-pct-of-s-not-paid", "cashback % of S (before tax), add 10 %", card("A", 1000, sz("1"), "pcs", deals={"cashback": {"pct": "10"}}), dict(USD, taxRate="10"))
gen("cashback-after-all", "everything: BOGO q2, 10 %, coupon, spend 5 save 1, add 5 %, 1.00 cashback",
    card("A", 349, sz("1"), "pcs", q=2, deals={"quantity": BOGO, "percents": [{"pct": "10"}], "coupons": [{"amountMinor": 25}], "spendSave": {"thresholdMinor": 250, "saveMinor": 100}, "cashback": {"amountMinor": 100}}), dict(USD, taxRate="5"))

# ----- deposit and multipack -----
for q in (1, 2, 3):
    gen(f"deposit-q{q}", f"deposit 0.25 per pack, q{q}: Dtot = q x D, not in U", card("A", 119, sz("1.5"), "l", q=q, deposit=25))
gen("multipack-6x330", "6x330 ml 4.49 per L", card("A", 449, sz("6x330"), "ml"))
gen("multipack-4x125g-bogo", "4x125 g 2.99 BOGO q2", card("A", 299, sz("4x125"), "g", q=2, deals={"quantity": BOGO}))
gen("multipack-24x0.5", "24 x 0.5 L 8.99 + 24 x 0.25 deposit", card("A", 899, sz("24x0.5"), "l", deposit=600))
gen("multipack-dozen", "2 dozen eggs 5.49, per 1", card("A", 549, sz("2"), "dozen"))

# ----- currencies -----
JPY = {"currency": "JPY", "taxMode": "include", "measurementSystem": "metric"}
KWD = {"currency": "KWD", "taxMode": "include", "measurementSystem": "metric"}
gen("jpy-plain", "JPY (exponent 0): 298 yen 400 g -> 745 per kg", card("A", 298, sz("400"), "g"), JPY)
gen("jpy-pct", "JPY 15 % off 298 = round(44.7) = 45", card("A", 298, sz("400"), "g", deals={"percents": [{"pct": "15"}]}), JPY)
gen("jpy-half", "JPY 2nd half price 199: round(99.5) = 100", card("A", 199, sz("100"), "g", q=2, deals={"quantity": HALF}), JPY)
gen("jpy-tax-include", "JPY incl. 10 %: 1080 -> net 982 (981.8)", card("A", 1080, sz("1"), "kg"), dict(JPY, taxRate="10"))
gen("jpy-under-one", "JPY 98 yen per 500 kg -> < 1 yen per kg: 1 decimal", card("A", 98, sz("500"), "kg"), JPY)
gen("kwd-plain", "KWD (exponent 3): 1.250 for 500 g -> 2.500 per kg", card("A", 1250, sz("500"), "g"), KWD)
gen("kwd-pct", "KWD 7.5 % off 1.255 = round(94.125) = 94 fils", card("A", 1255, sz("500"), "g", deals={"percents": [{"pct": "7.5"}]}), KWD)
gen("kwd-multibuy", "KWD 3 for 2.000, P 0.750, q4", card("A", 750, sz("200"), "g", q=4, deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 2000}}), KWD)
gen("kwd-under-one", "KWD 0.450 per 2 kg -> 0.225 per kg: 4 decimals", card("A", 450, sz("2"), "kg"), KWD)

# ----- bases and incomplete cards -----
for basis in ("kg", "100g", "lb", "oz"):
    gen(f"basis-mass-{basis}", f"E8 card A per {basis}", card("A", 229, sz("500"), "g", deals={"quantity": THREE_FOR_TWO}), dict(EUR, bases={"mass": basis}))
for basis in ("l", "100ml", "floz_us", "qt_us", "gal_us"):
    gen(f"basis-volume-{basis}", f"6x330 ml 4.49 per {basis}", card("A", 449, sz("6x330"), "ml"), dict(EUR, bases={"volume": basis}))
for basis in ("1", "10", "100"):
    gen(f"basis-count-{basis}", f"12 rolls 5.99 per {basis}", card("A", 599, sz("12"), "pcs", label="rolls"), dict(EUR, bases={"count": basis}))
for basis in ("m", "ft", "100ft"):
    gen(f"basis-length-{basis}", f"30 m foil 2.49 per {basis}", card("A", 249, sz("30"), "m"), dict(EUR, bases={"length": basis}))
gen("incomplete-price", "no price: W7 'Enter a price'", card("A", None, sz("500"), "g"))
gen("incomplete-size", "no size: W7 'Enter a size'", card("A", 249, None, "g"))

# ----- compare: warnings, ties, lowest to pay, structures, currencies -----
gen_compare = []


def gcomp(id_, note, cards, st=EUR):
    gen_compare.append({"id": id_, "input": {"cards": cards, "settings": st}, "expected": compare(cards, st), "note": note})


gcomp("w2-labels", "W2: rolls vs sheets", [card("A", 599, sz("12"), "pcs", label="rolls"), card("B", 499, sz("200"), "pcs", label="sheets")])
gcomp("w2-same-label", "no W2 when labels match (case and spaces ignored)", [card("A", 599, sz("12"), "pcs", label="Rolls "), card("B", 499, sz("9"), "pcs", label="rolls")])
gcomp("w5-in-compare", "W5 from a card is reported with its card id", [card("A", 199, sz("400"), "g", deals={"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 600}}), card("B", 249, sz("500"), "g")])
gcomp("w6-in-compare", "W6 hint (E9) reported with its card id", [card("A", 100, sz("1"), "pcs", q=5, deals={"quantity": THREE_FOR_TWO}), card("B", 90, sz("1"), "pcs")])
gcomp("w7-incomplete", "W7: incomplete cards ignored; one complete card -> no winner", [card("A", 249, sz("500"), "g"), card("B", None, sz("1"), "kg"), card("C", 249, None, "g")])
gcomp("w8-free-ranked-first", "W8: free card ranked first, 100 % cheaper", [card("A", 249, sz("500"), "g"), card("B", 0, sz("500"), "g")])
gcomp("w8-both-free", "two free cards tie", [card("A", 0, sz("500"), "g"), card("B", 0, sz("1"), "kg")])
gcomp("w4-just-below", "ratio 9.99 -> no W4", [card("A", 100, sz("1"), "kg"), card("B", 999, sz("1"), "kg")])
gcomp("w4-at-ten", "ratio exactly 10 -> W4 '10x'", [card("A", 100, sz("1"), "kg"), card("B", 1000, sz("1"), "kg")])
gcomp("w1-three-dims", "W1 with three dimensions, each ranked separately", [card("A", 119, sz("1"), "l"), card("B", 129, sz("1"), "kg"), card("C", 99, sz("1.5"), "l"), card("D", 300, sz("10"), "pcs")])
gcomp("tie-exact-threshold", "1.000 vs 0.999 per kg: difference exactly 0.1 % -> NOT a tie", [card("A", 1000, sz("1"), "kg"), card("B", 999, sz("1"), "kg")])
gcomp("tie-just-inside", "999.5 vs 1000 c/kg: 0.05 % -> tie", [card("A", 1999, sz("2"), "kg"), card("B", 1000, sz("1"), "kg")])
gcomp("tie-three-cards", "A and B tie, C dearer: both best value, no savings line", [card("A", 200, sz("500"), "g"), card("B", 400, sz("1"), "kg"), card("C", 500, sz("1"), "kg")])
gcomp("lowest-to-pay", "winner B (big pack), A is lowest to pay", [card("A", 249, sz("500"), "g"), card("B", 549, sz("1.2"), "kg")])
gcomp("lowest-to-pay-deposit", "deposit counts for lowest to pay (E + Dtot), not for U", [card("A", 100, sz("1"), "l", deposit=25), card("B", 110, sz("1.5"), "l", deposit=25), card("C", 105, sz("0.5"), "l")])
gcomp("lowest-is-winner", "winner is also lowest to pay -> no badge", [card("A", 199, sz("1"), "kg"), card("B", 249, sz("500"), "g")])
for basis in ("kg", "100g", "lb", "oz"):
    gcomp(f"basis-invariant-{basis}", f"E1 cards per {basis}: same winner, same 8.1 %, same 0.49", E1, dict(EUR, bases={"mass": basis}))
STRUCT = [
    ("3for2-vs-25pct", "same 500 g 2.29: '3 for 2' (q3) vs 25 % off (q1)", 229, {"quantity": THREE_FOR_TWO}, None, {"percents": [{"pct": "25"}]}, None),
    ("bogo-vs-40pct", "same 3.49: BOGO (q2) vs 40 % off (q1)", 349, {"quantity": BOGO}, None, {"percents": [{"pct": "40"}]}, None),
    ("half-vs-25pct", "2nd half price vs 25 % off (equal in theory; rounding decides)", 349, {"quantity": HALF}, None, {"percents": [{"pct": "25"}]}, None),
    ("2for5-vs-10pct", "2 for 5.00 vs 10 % off, P 2.79", 279, {"quantity": {"kind": "multiBuy", "n": 2, "priceMinor": 500}}, None, {"percents": [{"pct": "10"}]}, None),
    ("b3g2-vs-3for2", "buy 3 get 2 free (q5) vs 3 for 2 (q3)", 125, {"quantity": {"kind": "buyXGetY", "x": 3, "y": 2, "pct": "100"}}, None, {"quantity": THREE_FOR_TWO}, None),
    ("coupon-vs-cashback", "1.00 coupon vs 1.00 cashback: same E -> tie", 499, {"coupons": [{"amountMinor": 100}]}, None, {"cashback": {"amountMinor": 100}}, None),
    ("spend-vs-pct", "spend 10 save 2 (q4 of 2.69) vs 15 % off (q1)", 269, {"spendSave": {"thresholdMinor": 1000, "saveMinor": 200}}, 4, {"percents": [{"pct": "15"}]}, None),
    ("multibuy-remainder", "3 for 5 bought 4 vs 3 for 5 bought 3", 199, {"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 500}}, 4, {"quantity": {"kind": "multiBuy", "n": 3, "priceMinor": 500}}, 3),
    ("bogo-odd-vs-even", "BOGO bought 3 vs BOGO bought 2", 349, {"quantity": BOGO}, 3, {"quantity": BOGO}, 2),
    ("stacked-vs-single", "20 % + 10 % vs 30 % (stacking is less)", 1000, {"percents": [{"pct": "20"}, {"pct": "10"}]}, None, {"percents": [{"pct": "30"}]}, None),
]
for key, note, price, d1, q1, d2, q2 in STRUCT:
    gcomp(f"struct-{key}", f"Duplicate card, two deal structures on one product: {note}",
          [card("A", price, sz("500"), "g", q=q1, deals=d1), card("B", price, sz("500"), "g", q=q2, deals=d2)])
gcomp("jpy-compare", "JPY: 0 decimals when all >= 1 yen", [card("A", 298, sz("400"), "g"), card("B", 698, sz("1"), "kg")], JPY)
gcomp("kwd-compare", "KWD: 3 decimals, 4 when one is < 1 dinar", [card("A", 1250, sz("500"), "g"), card("B", 450, sz("2"), "kg")], KWD)
gcomp("us-tax-compare", "US add tax 8.875 % on both: ranking unchanged by a common rate", [card("A", 349, sz("12"), "oz", q=2, deals={"quantity": BOGO}), card("B", 599, sz("32"), "oz")], dict(USD, taxRate="8.875"))
gcomp("one-card", "one complete card: its unit price, no winner", [card("A", 249, sz("500"), "g")])
gcomp("no-cards-complete", "nothing complete: only W7", [card("A", None, None, "g"), card("B", None, sz("1"), "kg")])


def write(name, data):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


write("deals.json", {"examples": deals_examples, "generated": gen_deals})
write("compare.json", {"examples": compare_examples, "generated": gen_compare})
total = len(deals_examples) + len(gen_deals) + len(compare_examples) + len(gen_compare)
print(f"deals: {len(deals_examples)} examples + {len(gen_deals)} generated; compare: {len(compare_examples)} examples + {len(gen_compare)} generated; total {total}")
