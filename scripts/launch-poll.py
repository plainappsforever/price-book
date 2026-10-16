#!/usr/bin/env python3
"""A14 cross-check: cold start to a visible keypad, by polling screenshots (iOS simulator or Android emulator).
Usage: scripts/launch-poll.py <ios|android> <device> <app id> <px-tool> <out dir> [runs]
Each run: stop the app, start it, take screenshots back to back (iOS ~120 ms each, Android ~400 ms each) and report the time of the
first frame where the keypad area is no longer the blue splash / blank screen. The screenshot latency makes it an upper bound by about one
frame interval. Needs the small `px` helper (prints the RGB of a pixel, built from the swift snippet in docs/V1_LOG P6)."""
import subprocess, sys, time, os, statistics

plat, dev, app, px, out = sys.argv[1:6]
runs = int(sys.argv[6]) if len(sys.argv) > 6 else 5
os.makedirs(out, exist_ok=True)

def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, **kw)

def classify(path):
    # iOS: three points over the keypad rows, no longer the blue splash. Android: the launcher is visible before the app, so ask for the
    # app's own light-grey keypad colour (240, 240, 243) at two key positions.
    if plat == 'android':
        cols = [tuple(int(v) for v in sh([px, path, str(x), str(y)]).stdout.split() or [0, 0, 0]) for x, y in [(37, 77), (62, 77)]]
        return all(all(abs(a - b) <= 2 for a, b in zip(c, (240, 240, 243))) for c in cols)
    pts = [(50, 88), (25, 80), (75, 80)]
    cols = [tuple(int(v) for v in sh([px, path, str(x), str(y)]).stdout.split()) for x, y in pts]
    blue = [c[2] > 180 and c[0] < 90 for c in cols]
    return all(not b for b in blue) and any(c[0] > 150 for c in cols)

res = []
for i in range(1, runs + 1):
    if plat == 'ios':
        sh(['xcrun', 'simctl', 'terminate', dev, app])
    else:
        sh(['adb', '-s', dev, 'shell', 'am', 'force-stop', app])
        sh(['adb', '-s', dev, 'shell', 'input', 'keyevent', '3'])  # home, so another build of the app cannot be on screen
    time.sleep(3)
    frames = []
    t0 = time.time()
    if plat == 'ios':
        subprocess.Popen(['xcrun', 'simctl', 'launch', dev, app], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        subprocess.Popen(['adb', '-s', dev, 'shell', 'am', 'start', '-n', app + '/.MainActivity'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    n = 0
    while time.time() - t0 < 8:
        path = f'{out}/r{i}-{n:02d}.png'
        if plat == 'ios':
            sh(['xcrun', 'simctl', 'io', dev, 'screenshot', path])
        else:
            with open(path, 'wb') as f:
                f.write(sh(['adb', '-s', dev, 'exec-out', 'screencap', '-p']).stdout)
        t = time.time() - t0
        frames.append((t, path))
        n += 1
        if n > 2 and classify(path):
            break
    hit = None
    for t, p in frames:
        if classify(p):
            hit = t
            break
    res.append(hit)
    print(f'run {i}: keypad visible at {hit:.2f} s ({len(frames)} frames)' if hit else f'run {i}: not seen')
ok = [r for r in res if r]
if ok:
    print(f'median {statistics.median(ok):.2f} s, min {min(ok):.2f}, max {max(ok):.2f} (n={len(ok)})')
