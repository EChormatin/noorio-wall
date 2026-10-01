#!/usr/bin/env bash
# Runs every wall test against content.js. Usage: ./tests/run.command
cd "$(dirname "$0")/.."
fail=0
for t in tests/nw_*_test.js; do
  printf "%-24s " "$(basename "$t")"
  out=$(node "$t" content.js 2>&1)
  echo "$out" | grep -qE "all passing" && echo "ok" || { echo "FAILED"; echo "$out" | grep -E "^FAIL"; fail=1; }
done
exit $fail
