#!/usr/bin/env bash
# A15: run the large-text Maestro flow with the system text size at its largest, then put it back.
# Usage: scripts/large-text.sh <ios|android> [development|preview|production]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: large-text.sh <ios|android> [variant]}
variant=${2:-development}
device=$(scripts/boot.sh "$platform")

if [[ $platform == ios ]]; then
  previous=$(xcrun simctl ui "$device" content_size | tr -d '\r')
  restore() { xcrun simctl ui "$device" content_size "${previous:-large}" >/dev/null 2>&1 || true; }
  trap restore EXIT
  xcrun simctl ui "$device" content_size accessibility-extra-extra-extra-large
else
  previous=$(adb -s "$device" shell settings get system font_scale | tr -d '\r')
  restore() {
    if [[ -z $previous || $previous == null ]]; then
      adb -s "$device" shell settings put system font_scale 1.0 >/dev/null 2>&1 || true
    else
      adb -s "$device" shell settings put system font_scale "$previous" >/dev/null 2>&1 || true
    fi
  }
  trap restore EXIT
  adb -s "$device" shell settings put system font_scale 2.0
fi
export E2E_OUT="artifacts/maestro/$platform-$variant-large-text-$(date +%Y%m%d-%H%M%S)"
status=0
scripts/e2e.sh "$platform" "$variant" .maestro/large-text/large-text.yaml || status=$?
# REVIEW_V1 S5: Maestro matches an element's whole text however it wraps, so the flow also takes screenshots and the Mac's
# own text recogniser must find each unit price (and the header's "Edit") whole on one line.
# Maestro 2.x files a takeScreenshot under <output>/<run>/<flow>/takeScreenshot/.
ocr() {
  local name=$1 shot
  shot=$(find "$E2E_OUT" -name "$name.png" | head -1)
  shift
  [[ -n $shot ]] || { echo "OCR MISS: no screenshot $name"; status=1; return; }
  swift scripts/ocr-check.swift "$shot" "$@" || status=1
}
if [[ $status -eq 0 ]]; then
  ocr lt-compare "4.98"
  ocr lt-product-top "Edit" "4.98"
  ocr lt-product-usual "4.98"
  ocr lt-add-price "4.98"
fi
exit "$status"
