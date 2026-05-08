# SiteLens Chaos Harness

Automated resilience verification harness for continuous regression protection.

## What It Validates

- Resumable uploads (session/chunk resume behavior)
- Dependency outages (Cloudinary and LLM) with fallback behavior
- Export job recovery (including backend restart mid-job)
- Export fault handling (`failed` state integrity)
- Scale smoke (batched observation creation + report generation)
- Artifact validation:
  - PPTX opens and zip structure is readable
  - XLSX opens with sheet introspection
  - PDF signature validation when present
- Breaker/ops visibility via `/api/ops/*`

## Run

From repo root:

```bash
python chaos/run_chaos.py --base-url http://127.0.0.1:8080
```

With backend restart automation enabled:

```bash
python chaos/run_chaos.py \
  --base-url http://127.0.0.1:8080 \
  --backend-cmd "uvicorn app.main:app --host 127.0.0.1 --port 8080"
```

## Outputs

Generated under `chaos/results/`:

- `chaos-report-<timestamp>.json` (machine-readable)
- `chaos-report-<timestamp>.md` (human-readable summary)

## CI Usage

Use exit code:

- `0` all scenarios passed
- `2` one or more scenario failures

Gate production deploys on zero failures.
