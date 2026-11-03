#!/usr/bin/env bash
set -euo pipefail

dnf -y install xorg-x11-server-Xvfb gtk3 nss alsa-lib mesa-libgbm libXScrnSaver python3 util-linux /artifacts/*.rpm
Xvfb :99 -screen 0 1280x900x24 -ac -nolisten tcp &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 100); do
  if [ -S /tmp/.X11-unix/X99 ]; then break; fi
  sleep 0.1
done
test -S /tmp/.X11-unix/X99
executable_name=$(python3 -c 'import json; print(json.load(open("/artifacts/product-identity.json"))["executableName"])')
set -- /opt/*/"$executable_name"
test "$#" -eq 1
executable=$1
test -x "$executable"
test "$(sha256sum "$executable" | cut -d ' ' -f 1)" = "$(cat /artifacts/executable.sha256)"
data_dir=$(mktemp -d /tmp/browser-2d-release-XXXXXX)
chown nobody:nobody "$data_dir"
for pass in 1 2; do
  runuser -u nobody -- env DISPLAY=:99 BROWSER2D_DATA_DIR="$data_dir" "$executable" "--verify-workbench=$data_dir/report.json"
  python3 - "$data_dir/report.json" "$pass" <<'PY'
import json,sys
report=json.load(open(sys.argv[1]))
assert report['result'] == 'VERIFIED'
assert report['packaged'] is True
assert report['exitCode'] == 0 and report['workerExited'] is True
assert report['checks']['nodeIsolation'] is True
assert report['checks']['initialBrowsers'] == (int(sys.argv[2])-1)*2
assert report['checks']['initialCards'] == (0 if sys.argv[2] == '1' else 1)
assert report['checks']['taskPath'] and report['checks']['queued'] and report['checks']['inputLocked']
print('Installed Fedora RPM verified, pass', sys.argv[2])
PY
  cp "$data_dir/report.json" "/evidence/rpm-pass-$pass.json"
done
