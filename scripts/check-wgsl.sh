#!/usr/bin/env bash
# Validate every project WGSL file with vgpu's device-backed check.
# Bundlers never validate WGSL, so this is the only gate — run it before commits and in CI.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
while IFS= read -r file; do
  echo "── vgpu check $file"
  if [[ "${1:-}" == "--gpu" ]]; then
    pnpm exec vgpu check --require-validation "$file" || status=1
  else
    pnpm exec vgpu check "$file" || status=1
  fi
done < <(find src test -name '*.wgsl' -not -path '*/node_modules/*' | sort)
exit $status
