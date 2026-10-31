#!/usr/bin/env bash
set -euo pipefail
if [[ ${GITHUB_ACTIONS:-} != true || $(uname -s) != Darwin ]]; then
  echo 'This syscall capture is restricted to the disposable macOS GitHub runner.' >&2
  exit 2
fi
trace_dir="$PWD/artifacts/profile-probes"
mkdir -p "$trace_dir"
export BROWSER2D_PROFILE_TRACE_DIR="$trace_dir"
if [[ ${BROWSER2D_PROFILE_NATIVE_ONLY:-0} == 1 ]]; then
  unset NODE_OPTIONS
  echo 'native-only' > "$trace_dir/observation-mode.txt"
else
  export NODE_OPTIONS="--require=$PWD/scripts/profile-cleanup-diagnostic.cjs"
  echo 'native-and-javascript' > "$trace_dir/observation-mode.txt"
fi
trace_pid=''
filter_pid=''
finish_trace() {
  if [[ -f "$trace_dir/fs-usage.pid" ]]; then
    sudo -n kill -INT "$(cat "$trace_dir/fs-usage.pid")" 2>/dev/null || true
  fi
  if [[ -n "$trace_pid" ]]; then
    if wait "$trace_pid"; then
      echo 'fs_usage exited successfully' >> "$trace_dir/fs-usage-status.txt"
    else
      echo "fs_usage exit status $?" >> "$trace_dir/fs-usage-status.txt"
    fi
  fi
  if [[ -n "$filter_pid" ]]; then wait "$filter_pid" || true; fi
  rm -f "$trace_dir/fs-usage.pipe"
}
trap finish_trace EXIT
if sudo -n true; then
  mkfifo "$trace_dir/fs-usage.pipe"
  awk 'index($0, "browser-2d-closed-recovery-") { print; fflush(); }' < "$trace_dir/fs-usage.pipe" > "$trace_dir/fs-usage-paths.log" &
  filter_pid=$!
  sudo -n /bin/sh -c 'echo $$ > "$1"; exec /usr/bin/fs_usage -w -f filesys -t 240' sh "$trace_dir/fs-usage.pid" > "$trace_dir/fs-usage.pipe" 2> "$trace_dir/fs-usage-stderr.log" &
  trace_pid=$!
  printf 'Capture launched at %s; sudo PID %s; timeout 240 seconds\n' "$(date -u)" "$trace_pid" > "$trace_dir/fs-usage-status.txt"
else
  echo 'fs_usage unavailable because noninteractive sudo failed' > "$trace_dir/fs-usage-status.txt"
fi
pnpm test:storage
for attempt in $(seq 1 40); do
  log="$trace_dir/attempt-$attempt.log"
  if pnpm --filter @browser-2d/worker-runtime exec vitest run tests/chrome.test.ts -t 'recovers a verified owned browser that exited before its release was journaled' > "$log" 2>&1; then
    echo "Cold-recovery probe $attempt passed"
  else
    cat "$log"
    exit 1
  fi
done
