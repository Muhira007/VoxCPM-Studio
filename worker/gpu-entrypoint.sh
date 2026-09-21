#!/usr/bin/env bash
set -euo pipefail

paths=(
  "${WORKER_DATA_DIR}"
  "${WORKER_MODEL_DIR}"
  "${WORKER_CACHE_DIR}"
  "${WORKER_REFERENCES_DIR}"
  "${WORKER_OUTPUTS_DIR}"
)

for path in "${paths[@]}"; do
  mkdir -p "${path}"
  chown worker:worker "${path}"
done

exec gosu worker "$@"
