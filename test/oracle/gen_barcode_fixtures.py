#!/usr/bin/env python3
"""Oracle for the Price Book barcode normaliser (V1.5 phase 1, R2/R9, D63).

Written from the GS1 rules BEFORE src/engine/barcode.ts existed (same agent, so "blind" only in that order:
it was not written by a separate agent, WORKFLOW L23/L27). The anchors below are typed by hand from published
examples and checked first, so they test both this script and the TypeScript engine:

* GS1 mod-10 check digit: weights 3,1,3,1... from the rightmost data digit; check = (10 - sum % 10) % 10.
* UPC-E (8 digits: number system 0/1, six digits d1..d6, check) expands to UPC-A by d6:
  0-2 -> NS d1 d2 d6 0000 d3 d4 d5; 3 -> NS d1 d2 d3 00000 d4 d5; 4 -> NS d1 d2 d3 d4 00000 d5;
  5-9 -> NS d1 d2 d3 d4 d5 0000 d6; the UPC-E check digit is the UPC-A check digit.
* UPC-A (12) is EAN-13 with a leading 0; a GTIN-14 with a leading 0 is the same GTIN-13.
* Canonical stored form: 13 digits (EAN-13, UPC-A, UPC-E expanded) or 8 digits (EAN-8).
* GS1 prefixes (https://en.wikipedia.org/wiki/List_of_GS1_country_codes, GS1 General Specifications 2.1.11-12):
  restricted circulation (a shop's own label: weighed or in-store items) = 13-digit prefixes 020-029, 040-049,
  200-299 and EAN-8 starting with 0 or 2; refund receipts / coupons = 980-983, 990-999 (refused: not a product).

Run:  python3 test/oracle/gen_barcode_fixtures.py   (no packages needed)
"""
import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "test", "fixtures", "engine", "barcode.json")


def check_digit(data):
    total = 0
    for i, ch in enumerate(reversed(data)):
        total += int(ch) * (3 if i % 2 == 0 else 1)
    return str((10 - total % 10) % 10)


def valid(code):
    return check_digit(code[:-1]) == code[-1]


def expand_upce(code8):
    ns, d, chk = code8[0], code8[1:7], code8[7]
    d1, d2, d3, d4, d5, d6 = d
    if d6 in "012":
        body = d1 + d2 + d6 + "0000" + d3 + d4 + d5
    elif d6 == "3":
        body = d1 + d2 + d3 + "00000" + d4 + d5
    elif d6 == "4":
        body = d1 + d2 + d3 + d4 + "00000" + d5
    else:
        body = d1 + d2 + d3 + d4 + d5 + "0000" + d6
    return ns + body + chk


def hint_kind(hint):
    if hint is None or hint == "":
        return None, True
    h = "".join(c for c in hint.lower() if c.isalnum())
    for k in ("ean13", "ean8", "upca", "upce"):
        if k in h:
            return k, True
    return None, False


def label_of(code):
    if len(code) == 8:
        return "storeLabel" if code[0] in "02" else "product"
    p3 = int(code[:3])
    if 20 <= p3 <= 29 or 40 <= p3 <= 49 or 200 <= p3 <= 299:
        return "storeLabel"
    return "product"


def is_coupon(code):
    if len(code) != 13:
        return False
    p3 = int(code[:3])
    return 980 <= p3 <= 983 or 990 <= p3 <= 999


def display(code):
    return code[1:] if len(code) == 13 and code[0] == "0" else code


def parse(raw, hint=None):
    kind_hint, known = hint_kind(hint)
    if not known:
        return {"ok": False, "error": "format"}
    text = raw.strip()
    for ch in (" ", "-", "\u00a0", "\u202f", "\u2009"):
        text = text.replace(ch, "")
    if text == "":
        return {"ok": False, "error": "empty"}
    if any(c not in "0123456789" for c in text):
        return {"ok": False, "error": "chars"}
    if len(text) == 14 and text[0] == "0":
        text = text[1:]
    if len(text) not in (8, 12, 13):
        return {"ok": False, "error": "length"}
    found = []  # (kind, canonical) in default preference order
    if len(text) == 13 and valid(text):
        found.append(("ean13", text))
    if len(text) == 12 and valid(text):
        found.append(("upca", "0" + text))
    if len(text) == 8:
        if valid(text):
            found.append(("ean8", text))
        if text[0] in "01":
            upca = expand_upce(text)
            if valid(upca):
                found.append(("upce", "0" + upca))
    if not found:
        return {"ok": False, "error": "checkDigit"}
    primary = found[0]
    if kind_hint is not None:
        same = {"ean13": ("ean13", "upca"), "upca": ("upca", "ean13"), "ean8": ("ean8",), "upce": ("upce",)}[kind_hint]
        for k in same:
            hit = [f for f in found if f[0] == k]
            if hit:
                primary = hit[0]
                break
    if is_coupon(primary[1]):
        return {"ok": False, "error": "coupon"}
    candidates = [primary[1]] + [f[1] for f in found if f[1] != primary[1]]
    return {
        "ok": True, "code": primary[1], "kind": primary[0], "candidates": candidates,
        "label": label_of(primary[1]), "display": display(primary[1]),
    }


# ---------- hand-typed anchors (published examples) ----------
ANCHORS = [
    # (raw, hint, expected code or error, note)
    ("4006381333931", None, "4006381333931", "Wikipedia EAN-13 example"),
    ("73513537", None, "73513537", "Wikipedia EAN-8 example"),
    ("036000291452", None, "0036000291452", "Wikipedia UPC-A example"),
    ("04252614", "upc_e", "0042100005264", "Wikipedia UPC-E example 04252614 = UPC-A 042100005264"),
    ("042100005264", None, "0042100005264", "the UPC-A form of the UPC-E example"),
    ("9780306406157", None, "9780306406157", "Wikipedia ISBN-13 example (books are products)"),
    ("4006381333932", None, "checkDigit", "EAN-13 example with the last digit changed"),
]
assert check_digit("400638133393") == "1"
assert check_digit("7351353") == "7"
assert check_digit("03600029145") == "2"
assert expand_upce("04252614") == "042100005264"
for raw, hint, want, note in ANCHORS:
    got = parse(raw, hint)
    assert (got.get("code") if got["ok"] else got["error"]) == want, (raw, got)


def case(cases, cid, raw, hint, note):
    cases.append({"id": cid, "input": {"raw": raw, "hint": hint}, "expected": parse(raw, hint), "note": note})


def with_check(data):
    return data + check_digit(data)


def main():
    rnd = random.Random(20261014)
    digits = lambda n: "".join(rnd.choice("0123456789") for _ in range(n))
    cases = []
    for i, (raw, hint, _want, note) in enumerate(ANCHORS):
        case(cases, f"anchor-{i + 1}", raw, hint, note)

    # valid codes of each kind, and each with every wrong check digit once
    for i in range(40):
        e13 = with_check(rnd.choice("3456789") + digits(11))
        case(cases, f"ean13-{i + 1}", e13, rnd.choice([None, "ean13", "org.gs1.EAN-13"]), "random EAN-13")
        wrong = e13[:-1] + str((int(e13[-1]) + 1 + i % 9) % 10)
        case(cases, f"ean13-bad-{i + 1}", wrong, None, "EAN-13 with a wrong check digit")
        upca = with_check(digits(11))
        case(cases, f"upca-{i + 1}", upca, rnd.choice([None, "upc_a"]), "random UPC-A (12 digits)")
        case(cases, f"upca-as13-{i + 1}", "0" + upca, rnd.choice([None, "ean13"]), "the same UPC-A read as EAN-13 (iOS reports UPC-A that way)")
        case(cases, f"upca-as14-{i + 1}", "00" + upca, None, "the same UPC-A as GTIN-14")
        e8 = with_check(digits(7))
        case(cases, f"ean8-{i + 1}", e8, rnd.choice([None, "ean8"]), "random EAN-8 (may also read as UPC-E)")
        case(cases, f"ean8-hint-upce-{i + 1}", e8, "upc_e", "8 digits with the UPC-E hint: UPC-E if valid as one")
        upce_body = rnd.choice("01") + digits(6)
        upce = upce_body + check_digit(expand_upce(upce_body + "0")[:-1])
        case(cases, f"upce-{i + 1}", upce, "upc_e", "random UPC-E with the scanner's hint")
        case(cases, f"upce-nohint-{i + 1}", upce, None, "the same UPC-E typed by hand (EAN-8 wins if it is valid as both)")
        case(cases, f"upce-expanded-{i + 1}", expand_upce(upce), None, "the UPC-A form of that UPC-E")
    for d in "0123456789":
        body = "0" + digits(5) + d
        upce = body + check_digit(expand_upce(body + "0")[:-1])
        case(cases, f"upce-last-{d}", upce, "upc_e", f"UPC-E expansion rule for last digit {d}")
    for d in range(10):
        code = with_check("4006381" + digits(4) + "3")
        case(cases, f"wrong-{d}", code[:-1] + str(d), None, "every possible last digit (one is right)")

    # prefixes: shop labels, coupons, books
    for p in ["020", "025", "029", "040", "049", "200", "234", "299", "300", "400", "440", "977", "978", "979",
              "980", "983", "984", "989", "990", "999", "050", "019", "030"]:
        case(cases, f"prefix-{p}", with_check(p + digits(9)), None, f"GS1 prefix {p}")
    for first in "0123456789":
        case(cases, f"ean8-prefix-{first}", with_check(first + digits(6)), "ean8", f"EAN-8 starting with {first}")
    case(cases, "weighed-upca", with_check("2" + digits(10)), "upc_a", "UPC-A number system 2 (random weight)")

    # typing variants and errors
    case(cases, "spaces", "4 006381 333931", None, "printed groups with spaces")
    case(cases, "hyphens", "978-0-306-40615-7", None, "ISBN with hyphens")
    case(cases, "nbsp", "\u00a04006381\u202f333931 ", None, "no-break and narrow spaces")
    case(cases, "empty", "", None, "nothing typed")
    case(cases, "blank", "   ", None, "spaces only")
    case(cases, "letters", "40063813339a1", None, "a letter")
    case(cases, "dot", "4006381.333931", None, "a dot")
    case(cases, "fullwidth", "\uff14006381333931", None, "a full-width digit is not an ASCII digit")
    for n in [1, 5, 6, 7, 9, 10, 11, 15, 20]:
        case(cases, f"length-{n}", digits(n), None, f"{n} digits")
    case(cases, "gtin14-case", with_check("1" + digits(12)), None, "GTIN-14 of a case (indicator 1): not a shelf item")
    case(cases, "qr-hint", "4006381333931", "qr", "a QR code that happens to hold digits")
    case(cases, "code128-hint", "4006381333931", "code128", "Code 128 is not a retail product code")
    case(cases, "hint-mismatch", "4006381333931", "ean8", "the hint names another length: the digits decide")
    case(cases, "upce-ns2", "21234565", "upc_e", "UPC-E needs number system 0 or 1")
    case(cases, "zeros13", "0000000000000", None, "all zeros: the check digit is valid and prefix 000 is UPC-compatible")
    case(cases, "zeros8", "00000000", None, "eight zeros")

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(cases, f, indent=1, ensure_ascii=False)
        f.write("\n")
    print(f"{len(cases)} cases -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
