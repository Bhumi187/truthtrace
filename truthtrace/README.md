# TruthTrace — AI Knowledge Drift Monitor

Detects when previously generated AI answers become **outdated** because their source document changed.
The core engine is deterministic (rule-based extraction + explicit evidence dependencies). **No API key is needed.**

## Demo scenarios
Use the scenario selector to switch between four end-to-end examples: scholarship application deadline, HR annual leave, e-commerce return window, and reimbursement allowance. Each scenario loads its own old/new policy text and stored answers with evidence dependencies; the analysis is recalculated from those documents.

## How it works
1. Facts (`deadline`, `min_cgpa`, `required_documents`, `annual_leave_days`, `return_window_days`, `allowance_amount`) are extracted from policy text/PDF, each with traceable evidence (sentence, line, page, char offsets).
2. Old vs new facts are diffed → `added / removed / modified / unchanged / uncertain`.
3. Each stored answer (`backend/data/answers.json`) lists `depends_on` facts (+ the value and evidence it was generated from).
4. Classification, per answer:
   - **OUTDATED** – a fact it depends on is `modified` (suggested answer rendered from a template using the *new* extracted value).
   - **UNAFFECTED** – every dependency is unchanged.
   - **NEEDS_REVIEW** – a dependency is missing, ambiguous/contradictory in either doc, or the stored answer's baseline doesn't match the old document (or the answer has no dependencies).
   A changed fact never touches answers that don't depend on it.

Optional: if `ANTHROPIC_API_KEY` is set and the request has `use_llm: true`, an extra `suggested_answer_llm` is added (rewording only; it never changes statuses). This path is untested without a key.

## Setup & run (two terminals)
Backend (Python 3.10+):
```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Frontend (Node 18+):
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173  (proxies /api -> 127.0.0.1:8000)
```
Tests: `cd backend && python -m pytest -q`

## Demo
Open http://localhost:5173 → the scholarship scenario loads by default → **Analyze drift**. The preloaded scholarship edge-case documents (`v3`, `v4`, `v5`) remain available from the document selectors.
You can also upload your own `.pdf`/`.txt` (scanned PDFs without text are rejected, no OCR).

## UI
Sidebar views: **Compare** (side-by-side documents with evidence highlighted from real extraction offsets, word-level diffs for modified facts), **Dependency graph** (sources → facts → answers, built from the analysis result; hover traces a path, click selects), **Sources** (pick/upload/edit documents, stored answers). The right-hand **Inspector** shows old vs new evidence and why each answer got its status. Metrics are computed from the analysis response. Shortcut: Ctrl/Cmd+Enter runs the analysis.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | status, whether LLM is configured |
| GET | `/api/demo` | sample documents + stored answers |
| GET/PUT | `/api/answers` | read/replace stored answers |
| POST | `/api/extract-text` | multipart `file` (pdf/txt) → text |
| POST | `/api/extract` | `{text}` → facts with evidence |
| POST | `/api/analyze` | `{old_text, new_text, answers?}` → facts, diff, per-answer impact |
| POST | `/api/analyze-upload` | multipart `new_file` (+ optional `old_file`) → same result |

## Layout
```
backend/app/{facts,diff,impact,llm,main}.py   backend/data/{answers.json,documents/}   backend/tests/
frontend/src/App.jsx
```
## Known limits
Extraction is regex-based and covers these three fact types and common phrasings; to add a fact type, add an extractor in `facts.py` and reference its key from an answer's `depends_on`.
