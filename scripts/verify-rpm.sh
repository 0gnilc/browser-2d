#!/usr/bin/env bash
set -euo pipefail

dnf -y install xorg-x11-server-Xvfb gtk3 nss alsa-lib mesa-libgbm libXScrnSaver python3 shadow-utils /artifacts/*.rpm
useradd -m p1
Xvfb :99 -screen 0 1280x900x24 -ac -nolisten tcp &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if [ -S /tmp/.X11-unix/X99 ]; then break; fi
  sleep 0.1
done
test -S /tmp/.X11-unix/X99
set -- /opt/*/browser-2d-foundation
test "$#" -eq 1
executable=$1
test -x "$executable"
test "$(sha256sum "$executable" | cut -d ' ' -f 1)" = "$(cat /artifacts/executable.sha256)"
data_dir=$(mktemp -d /tmp/browser-2d-release-XXXXXX)
chown p1:p1 "$data_dir"
for pass in 1 2; do
  runuser -u p1 -- env DISPLAY=:99 BROWSER2D_DATA_DIR="$data_dir" "$executable" "--verify-p1=$data_dir/report.json"
  python3 - "$data_dir/report.json" "$pass" <<'PY'
import json,sys
report=json.load(open(sys.argv[1]))
assert report['packaged'] is True
assert report['exitCode'] == 0 and report['workerExited'] is True
assert report['result']['nodeIsolation'] is True
assert report['result']['initialCount'] == (0 if sys.argv[2] == '1' else 4)
assert report['result']['business'] == {'initialDeviceCount': (int(sys.argv[2])-1)*3, 'initialMaterialCount': int(sys.argv[2])-1, 'settingsRevision': int(sys.argv[2])}
assert all(row['state'] in ['completed','cancelled','failed','interrupted'] for row in report['finalSnapshot']['runs'])
assert report['finalSnapshot']['resources'] == []
assert report['result']['capacity'] == {'devices': 2, 'pages': 4, 'queuedObserved': True}
print('Installed Fedora RPM verified, pass', sys.argv[2])
PY
  cp "$data_dir/report.json" "/evidence/rpm-pass-$pass.json"
done
