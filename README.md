# Quality Walkthrough Report Generation System

Production-oriented stack for capturing construction QA walkthrough data, drafting formal wording with your own vLLM deployment, rendering multi-slide editable PowerPoint deliverables (`python-pptx`), and optionally exporting companion PDFs through LibreOffice in headless mode.

## Architecture (intentionally small)

| Layer             | Responsibility |
| ----------------- | ----------------------------------- |
| React + Vite UI   | Uploads, intake form, previews, orchestration UX |
| FastAPI modules   | Deterministic workflows; REST surface |
| JSON file store | `backend/data/app_store.json` — observations & reports metadata (no database server) |
| Filesystem       | Raw imagery under `backend/uploads/`; artefacts under `backend/reports/` |
| LLM integration  | Stateless HTTP POSTs (`httpx`) — text only |

The LLM never decides storage, sequencing, formatting coordinates, or API branching. Prompting is scoped to QA language only.

Refer to **`backend/.env.example`** for tunables (`LLM_BASE_URL`, storage paths, `PPT_LAYOUT_PATH`, LibreOffice executable, compression knobs).

Interactive API descriptions ship with FastAPI (`/docs`, `/redoc`, OpenAPI `/openapi.json`).

## Prerequisites

1. **Python 3.11+** recommended.
2. **Node.js 20+** for the Vite client.
3. **LibreOffice** with the `soffice`/`soffice.exe` binary reachable for PDF exports (configure `LIBREOFFICE_SOFFICE` on Windows/macOS/Linux as needed).
4. **Reachable vLLM OpenAI-compatible endpoint** (`/v1/chat/completions`). Set `LLM_MODEL` to the served model slug.

Sample endpoint from spec: `http://172.20.7.22:8000/v1/chat/completions` ⇒ use `LLM_BASE_URL=http://172.20.7.22:8000/v1`.

## Backend setup

```powershell
cd "c:\ReportGen Agent\backend"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # customize LLM / LibreOffice paths / DATA_DIR if needed
```

Run the API (default avoids clashing with a vLLM service on `:8000`):

```powershell
cd "c:\ReportGen Agent\backend"
.\.venv\Scripts\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

On boot the API initializes the JSON datastore (creates **`data/app_store.json`** once you save your first observation or report), ensures `uploads/`, `reports/`, `data/`, and reads `ppt_layout.json` for slide geometry.

To reset all records, stop the API and delete **`backend/data/app_store.json`**.

## Frontend setup

```powershell
cd "c:\ReportGen Agent\frontend"
npm install
npm run dev
```

Vite proxies `/api/*`, `/healthz`, `/docs`, `/static/*` → `127.0.0.1:8080`. REST paths use the **`/api`** prefix so the SPA can own clean routes like **`/upload`** and **`/reports`** (full page GET delivers `index.html`, not JSON).

For standalone hosting, build and set `VITE_API_BASE` to your API origin, including **`/api`** when the backend is mounted that way (e.g. `https://api.example.com/api`).

## REST endpoints (quick reference)

| Method | Path | Notes |
| ------ | ---- | ----- |
| `POST` | `/api/upload` | Multipart (`file`). Validates & compresses imagery. Returns relative POSIX path usable as `image_path`. |
| `POST` | `/api/observations` | Creates structured observation (+ optional synchronous LLM generation). |
| `GET`  | `/api/observations` | Filters with `project_id` query optional. |
| `GET`  | `/api/observations/{id}` | Detail view. |
| `PUT`  | `/api/observations/{id}` | Partial update; supports `regenerate_text`. |
| `POST` | `/api/reports/generate` | Body: `{ observation_ids: number[], title?: string, include_pdf: boolean }` — observations must share the same project **name**. |
| `GET`  | `/api/reports` | Summary list incl. booleans `has_pptx`/`has_pdf`. |
| `GET`  | `/api/reports/{id}` | Metadata plus `observation_ids` in deck generation order. |
| `GET`  | `/api/reports/{id}/download?format=pptx\|pdf` | Streams artefact binaries. |

## PowerPoint customization

`tuning` geometry lives in **`backend/data/ppt_layout.json`**. Boxes are measured in inches; adjust without touching Python.

Optional `PPT_TEMPLATE_PATH` loads an existing `.pptx` deck as the backing presentation so theme fonts propagate; programmatic slides appended after imported masters still honor the measured boxes.

Rendered `.pptx` files remain editable in Microsoft PowerPoint or LibreOffice Impress — nothing is flattened to images except the embedded photo thumbnails.

## PDF export pitfalls

Failures are logged and surfaced on the report record (`error_message`) while keeping a successful PPTX when possible. Confirm:

* `soffice` is on `PATH` or `LIBREOFFICE_SOFFICE` points to the real binary.
* The service account can write to `reports/`.
* Antivirus / enterprise policy allows headless conversion.

## Engineering notes

* No PostgreSQL/SQLAlchemy in this codebase path — persisted state is **`data/app_store.json`** plus files on disk.
* No LangChain / CrewAI / AutoGen / vector DB / RAG / microservices.
* Observation ordering in generated decks respects the IDs list passed to `/api/reports/generate` (duplicate ids are collapsed while preserving order).

## License / compliance

Operational teams remain accountable for factual accuracy — always review AI-generated wording before contractual submission.


uvicorn app.main:app --reload --host 0.0.0.0 --port 8080