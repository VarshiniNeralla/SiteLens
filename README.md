# Quality Walkthrough Report Engine

Deterministic construction QA capture and deck generation — from field photos to presentation-ready PowerPoint.

Built for teams that need **structured walkthrough reporting**, not generic AI document generation.

---

## Why This Exists

Most QA walkthrough tooling breaks in one of two ways:

- too manual (slow, inconsistent, hard to scale)
- too autonomous (unreliable, uneditable, hard to trust)

This project sits in the middle:

- **human-controlled inputs**
- **strict metadata model**
- **LLM constrained to wording only**
- **deterministic slide rendering**

You get speed without giving up control.

---

## What You Get

- Premium single-workspace web UX for image + metadata capture
- Controlled vocabulary observation intake (no freeform chaos)
- AI-assisted observation/recommendation wording (optional)
- Deterministic PowerPoint rendering with engineering-grade layout consistency
- Optional PDF companion export (if LibreOffice is available)
- Lightweight local persistence (JSON + filesystem), no database required

---

## Core Workflow

`Upload image`  
→ `Capture structured metadata`  
→ `Generate wording (optional)`  
→ `Build PPTX deck`  
→ `Export PDF (optional)`

Each stage is explicit. Nothing hidden. No autonomous pipeline steps.

---

## Stack Philosophy

This codebase is intentionally small.

No orchestration frameworks.  
No vector database.  
No RAG subsystem.  
No agent loops.

That is a deliberate engineering choice:

- lower operational surface area
- easier debugging
- deterministic outputs
- clearer ownership boundaries

---

## Architecture

### Frontend

React + Vite + Tailwind + Framer Motion  
Single workspace UX for upload, observation capture, and report actions.

### Backend

FastAPI  
Typed request/response schemas and deterministic rendering services.

### Persistence

- `backend/data/app_store.json` for observations/reports metadata
- `backend/uploads/` for source images
- `backend/reports/` for generated decks and PDFs

### Rendering Engine

- `python-pptx` for editable PPTX output
- Optional LibreOffice conversion for PDF output

### LLM Integration

OpenAI-compatible vLLM endpoint (`/v1/chat/completions`) used only for text drafting.

---

## Project Structure

```text
backend/
  app/
    api/routes/          # upload, observations, reports
    services/            # ppt, pdf, llm, observation/report orchestration
    schemas/             # typed API contracts
    store.py             # JSON datastore
  data/
    app_store.json       # persisted records
    ppt_layout.json      # layout tuning values
  uploads/               # source images
  reports/               # generated artifacts

frontend/
  src/
    pages/               # workspace + reports UX
    components/          # UI primitives and layout shell
    api.js               # API client
    constants/           # controlled form options
```

---

## Local Setup

### Prerequisites

- Python 3.11+
- Node.js 20+
- A reachable OpenAI-compatible LLM endpoint (vLLM recommended)
- LibreOffice **only if** PDF export is required

### 1) Backend

```powershell
cd "c:\ReportGen Agent\backend"
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

### 2) Frontend

```powershell
cd "c:\ReportGen Agent\frontend"
npm install
npm run dev
```

Vite serves the app on `http://localhost:5173` and proxies `/api/*` to `http://127.0.0.1:8080`.

---

## Environment Variables

Key configuration lives in `backend/.env`:

- `LLM_BASE_URL` — root OpenAI-compatible endpoint (e.g. `http://host:8000/v1`)
- `LLM_CHAT_URL` — optional full chat URL override
- `LLM_MODEL` — served model id
- `LLM_TIMEOUT_SECONDS` — timeout for generation calls

- `UPLOAD_DIR` — image storage directory
- `REPORTS_DIR` — generated artifact directory
- `DATA_DIR` — JSON datastore directory

- `PPT_LAYOUT_PATH` — PPT geometry configuration file
- `PPT_TEMPLATE_PATH` — optional `.pptx` base template

- `LIBREOFFICE_SOFFICE` — LibreOffice executable path (optional unless PDF needed)

- `CORS_ORIGINS` — allowed web origins

Frontend:

- `VITE_API_BASE` — optional API base URL (include `/api` if backend is mounted there)

---

## API Overview

### Upload

- `POST /api/upload`  
  Upload and validate image. Returns relative `image_path`.

### Observations

- `POST /api/observations`  
  Create observation from controlled metadata + image path.
- `GET /api/observations`  
  List observations.
- `GET /api/observations/{id}`  
  Fetch one observation.
- `PUT /api/observations/{id}`  
  Update observation fields and optionally regenerate wording.

### Reports

- `POST /api/reports/generate`  
  Build deck from observation ids (same project required).
- `GET /api/reports`  
  List report summaries.
- `GET /api/reports/{id}`  
  Report metadata.
- `GET /api/reports/{id}/download?format=pptx|pdf`  
  Download generated artifacts.

---

## PowerPoint Rendering Engine

The rendering system is deterministic by design:

- fixed widescreen canvas
- reusable geometry constants
- strict observation grouping and pagination
- consistent image/table alignment

Current layout model:

- **3 observations per slide**
- image-first blocks
- compact metadata tables
- consultant-style density and hierarchy

Outputs are editable `.pptx` files suitable for Microsoft PowerPoint workflows.

---

## Design Principles

- **Deterministic rendering over autonomous agents**  
  Layout and sequencing are explicit and testable.
- **Structured metadata over freeform prompts**  
  Input quality drives output consistency.
- **Editable deliverables over flattened exports**  
  Teams can refine decks after generation.
- **Workflow clarity over AI hype**  
  AI assists language, not control flow.

---

## Screenshots / Preview

> Add project visuals here:

- Workspace (capture UX)
- Image upload + thumbnail rail
- Metadata + AI draft panel
- Generated PowerPoint slides

```md
![Workspace](./docs/screenshots/workspace.png)
![Observation Capture](./docs/screenshots/observation.png)
![Reports Library](./docs/screenshots/reports.png)
![Generated Deck](./docs/screenshots/deck.png)
```

---

## Future Extensions

Planned directions (not current dependencies):

- PostgreSQL persistence layer
- multi-user auth + role separation
- cloud blob storage for images/reports
- template packs for multiple client formats
- reporting analytics and trend dashboards
- image-assisted defect classification

---

## Engineering Posture

This is a production-oriented reporting engine with a deliberately constrained architecture:

- predictable behavior
- editable outputs
- low operational overhead
- clear extension points

If you are building construction QA workflows that must be both fast and auditable, this is the intended baseline.

Operational teams remain accountable for factual accuracy — always review AI-generated wording before contractual submission.


