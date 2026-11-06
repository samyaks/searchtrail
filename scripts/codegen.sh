#!/usr/bin/env bash
# Regenerate everything derived from contracts/openapi.yaml:
#   backend/app/schemas/contract.py     Pydantic models (datamodel-code-generator)
#   frontend/src/api/schema.d.ts        TypeScript types (openapi-typescript)
#   frontend/src/mocks/examples.json    the contract's examples, for MSW mocks
# CI runs this and fails if anything changes (the contract drift check). Never edit those files by hand.
#
# Usage: scripts/codegen.sh [backend|frontend]   (default: both)
# Needs: the backend venv active (pip install -e "backend[dev]") and `npm ci` in frontend/.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-all}"

if [[ "$target" == all || "$target" == backend ]]; then
  (cd "$root/backend" && datamodel-codegen \
    --input ../contracts/openapi.yaml --input-file-type openapi \
    --output app/schemas/contract.py \
    --output-model-type pydantic_v2.BaseModel --target-python-version 3.12 \
    --use-annotated --field-constraints --use-standard-collections --use-union-operator \
    --enum-field-as-literal one --use-title-as-name --capitalise-enum-members \
    --disable-timestamp --formatters builtin \
    --custom-file-header "# GENERATED from contracts/openapi.yaml by scripts/codegen.sh. Do not edit.")
fi

if [[ "$target" == all || "$target" == frontend ]]; then
  (cd "$root/frontend" && npm run --silent gen:api)
fi
