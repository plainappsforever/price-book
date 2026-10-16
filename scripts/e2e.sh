#!/usr/bin/env bash
# Run Maestro flows against the build already installed on the simulator/emulator.
# Usage: scripts/e2e.sh <ios|android> [development|preview|production] [flow.yaml ...]
# With no flows, runs every top-level flow in .maestro/.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

platform=${1:?Usage: e2e.sh <ios|android> [variant] [flows...]}
variant=${2:-development}
shift $(($# >= 2 ? 2 : 1))
flows=("$@")
all=0
[[ ${#flows[@]} -gt 0 ]] || { flows=(.maestro); all=1; }

config=$(APP_VARIANT=$variant npx expo config --json --type public)
app_id=$(echo "$config" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).ios.bundleIdentifier)')
# URL scheme of this variant (pricebook-dev / -preview / pricebook), for the debug seed deep link.
app_scheme=$(echo "$config" | node -e 'console.log(JSON.parse(require("fs").readFileSync(0, "utf8")).scheme)')

# curl is blocked on this Mac: check Metro with node's fetch.
if [[ $variant == development ]] && ! node -e 'fetch("http://localhost:"+process.argv[1]+"/status").then((r) => r.text()).then((t) => process.exit(t.includes("running") ? 0 : 1)).catch(() => process.exit(1))' "$METRO_PORT"; then
  echo "Metro is not running. Start it with: npm run dev (port $METRO_PORT)" >&2
  exit 1
fi

device=$(scripts/boot.sh "$platform")
# E2E_OUT: the caller chooses the output folder (large-text.sh reads the screenshots from it).
out="${E2E_OUT:-artifacts/maestro/$platform-$variant-$(date +%Y%m%d-%H%M%S)}"
mkdir -p "$out"
echo "Maestro: $app_id on $platform ($device) -> $out"
# Flows tagged <other platform>-only are skipped.
other=$([[ $platform == ios ]] && echo android || echo ios)
status=0
maestro --device "$device" test --exclude-tags "$other-only" -e APP_ID="$app_id" -e APP_SCHEME="$app_scheme" -e OUT_DIR="$out" --test-output-dir "$out" "${flows[@]}" || status=$?
# The full set also runs the large-text flow (A15): it needs the system text size changed first, which only a script can do.
if [[ $all -eq 1 && $variant == development ]]; then
  scripts/large-text.sh "$platform" "$variant" || status=$?
fi
exit "$status"
