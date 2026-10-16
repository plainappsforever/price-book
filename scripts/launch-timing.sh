#!/usr/bin/env bash
# A14: cold start to a usable keypad on the Release (preview) build, N times (default 5); prints each run and the median.
# Usage: scripts/launch-timing.sh <ios|android> [runs]
# Time = launchApp + "keypad key visible" command durations from Maestro (upper bound: includes the driver's polling).
# On Android also `am start -W` TotalTime (activity launch to first frame) as a second view.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: launch-timing.sh <ios|android> [runs]}
runs=${2:-5}
device=$(scripts/boot.sh "$platform")
app_id=com.tim.pricebook.preview
out="artifacts/maestro/launch-$platform-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
echo "load: $(uptime | sed 's/.*load averages*: //')"
for i in $(seq 1 "$runs"); do
  if [[ $platform == android ]]; then
    adb -s "$device" shell am force-stop "$app_id"
    adb -s "$device" shell am start -W -n "$app_id/.MainActivity" | grep -E "TotalTime|WaitTime" | tr '\n' ' ' | sed 's/^/  am start -W: /'
    echo
    adb -s "$device" shell am force-stop "$app_id"
  else
    xcrun simctl terminate "$device" "$app_id" >/dev/null 2>&1 || true
  fi
  sleep 3
  maestro --device "$device" test -e APP_ID="$app_id" --test-output-dir "$out/run$i" .maestro/release/cold-start.yaml >/dev/null 2>&1 || echo "  run $i: maestro failed"
done
python3 - "$out" <<'PY'
import glob, json, statistics, sys
vals = []
for f in sorted(glob.glob(sys.argv[1] + "/run*/**/commands*.json", recursive=True)):
    d = json.load(open(f))
    t = {}
    for c in d:
        m = c.get("metadata", {})
        cmd = c.get("command", {})
        if "launchAppCommand" in cmd: t["launch"] = m.get("duration", 0)
        if "assertConditionCommand" in cmd and "key-5" in json.dumps(cmd): t["wait"] = m.get("duration", 0)
    if len(t) == 2:
        vals.append(t["launch"] + t["wait"])
        print(f"  {f.split('/')[-3] if '/run' in f else f}: launchApp {t['launch']} ms + wait {t['wait']} ms = {t['launch'] + t['wait']} ms")
if vals:
    print(f"median {statistics.median(vals):.0f} ms, min {min(vals)}, max {max(vals)} (n={len(vals)})")
PY
