#!/usr/bin/env bash
set -euo pipefail
if [[ ${GITHUB_ACTIONS:-} != true || $(uname -s) != Darwin ]]; then
  echo 'Namespace capture is restricted to the disposable macOS GitHub runner.' >&2
  exit 2
fi
trace_dir="$PWD/artifacts/profile-probes"
mkdir -p "$trace_dir"
export BROWSER2D_PROFILE_TRACE_DIR="$trace_dir"
export NODE_OPTIONS="--require=$PWD/scripts/profile-creation-fingerprint.cjs"
trace_pid=''
finish_trace() {
  if [[ -f "$trace_dir/dtrace.pid" ]]; then
    sudo -n kill -INT "$(cat "$trace_dir/dtrace.pid")" 2>/dev/null || true
  fi
  if [[ -n "$trace_pid" ]]; then
    if wait "$trace_pid"; then
      echo 'dtrace exited successfully' >> "$trace_dir/dtrace-status.txt"
    else
      echo "dtrace exit status $?" >> "$trace_dir/dtrace-status.txt"
    fi
  fi
}
trap finish_trace EXIT
if sudo -n /usr/sbin/dtrace -l -n 'syscall::mkdir:entry' > "$trace_dir/dtrace-availability.txt" 2>&1; then
  sudo -n /bin/sh -c 'echo $$ > "$1"; exec /usr/sbin/dtrace -Z -q -s "$2"' sh "$trace_dir/dtrace.pid" "$PWD/scripts/profile-namespace.d" > "$trace_dir/namespace.tsv" 2> "$trace_dir/dtrace-stderr.log" &
  trace_pid=$!
  echo 'dtrace launched; waiting for READY before starting Chrome' > "$trace_dir/dtrace-status.txt"
  for readiness in $(seq 1 30); do
    if grep -q '^READY' "$trace_dir/namespace.tsv"; then break; fi
    if ! kill -0 "$trace_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if grep -q '^READY' "$trace_dir/namespace.tsv"; then
    echo 'dtrace READY observed' >> "$trace_dir/dtrace-status.txt"
  else
    echo 'dtrace READY absent; inspect availability and stderr; no namespace absence claims' >> "$trace_dir/dtrace-status.txt"
  fi
else
  echo 'syscall provider unavailable; no SIP changes attempted' > "$trace_dir/dtrace-status.txt"
fi
for attempt in $(seq 1 80); do
  log="$trace_dir/attempt-$attempt.log"
  if pnpm --filter @browser-2d/worker-runtime exec vitest run tests/chrome.test.ts -t 'recovers a verified owned browser that exited before its release was journaled' > "$log" 2>&1; then
    echo "Cold-recovery probe $attempt passed"
  else
    cat "$log"
    exit 1
  fi
done
