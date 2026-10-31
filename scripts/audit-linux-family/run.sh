set -eux
out="$PWD/artifacts/linux-family"
mkdir -p "$out"
sudo bpftrace --version > "$out/bpftrace-version.txt"
python3 scripts/audit-linux-family/trace.py prepare
sudo env BPFTRACE_MAX_STRLEN=128 bpftrace -B line -e 'BEGIN { printf("CAPABILITY\n"); exit(); }' > "$out/capability.stdout" 2> "$out/capability.stderr"
sudo env BPFTRACE_MAX_STRLEN=128 BPFTRACE_PERF_RB_PAGES=1024 timeout --signal=TERM --kill-after=5s 150s bpftrace -B line "$out/trace.bt" > "$out/trace.tsv" 2> "$out/trace.stderr" &
trace_sudo=$!
cleanup() {
  sudo pkill -TERM -x bpftrace || true
  wait "$trace_sudo" || true
}
trap cleanup EXIT
for attempt in $(seq 1 30); do
  if grep -q '^READY' "$out/trace.tsv"; then break; fi
  if ! sudo kill -0 "$trace_sudo" 2>/dev/null; then
    cat "$out/trace.stderr"
    status=0
    wait "$trace_sudo" || status=$?
    printf "Tracer exited with status %s\n" "$status"
    exit 1
  fi
  sleep 1
done
grep -q '^READY' "$out/trace.tsv"
BROWSER2D_FAMILY_EVIDENCE="$out" pnpm --filter @browser-2d/worker-runtime exec vitest run --config vitest.config.ts tests/chrome-family.test.ts --reporter=verbose > "$out/family-test.log" 2>&1 || { cat "$out/family-test.log"; exit 1; }
cleanup
trap - EXIT
python3 scripts/audit-linux-family/trace.py analyze > "$out/summary.json"
cat "$out/summary.json"
