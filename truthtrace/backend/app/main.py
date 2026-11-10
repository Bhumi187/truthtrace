import json
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from . import llm
from .diff import diff_facts
from .facts import extract_facts, extract_text_from_bytes
from .impact import assess_answers

DATA = Path(__file__).resolve().parent.parent / "data"
ANSWERS = DATA / "answers.json"
DOCS = DATA / "documents"

app = FastAPI(title="TruthTrace API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])


class AnalyzeRequest(BaseModel):
    old_text: str
    new_text: str
    answers: Optional[list[dict]] = None
    use_llm: bool = False


class ExtractRequest(BaseModel):
    text: str


def load_answers():
    return json.loads(ANSWERS.read_text())


def load_scenarios():
    scenarios = json.loads((DATA / "scenarios.json").read_text())
    for scenario in scenarios:
        scenario["answers"] = json.loads((DATA / scenario.pop("answers_file")).read_text())
    return scenarios


def run(old_text, new_text, answers, use_llm=False):
    old, new = extract_facts(old_text), extract_facts(new_text)
    diff = diff_facts(old, new)
    results = assess_answers(answers, old, new, diff)
    if use_llm and llm.enabled():
        for r in results:
            if r["suggested_answer"]:
                r["suggested_answer_llm"] = llm.polish(r["question"], r["original_answer"], r["suggested_answer"], r["reasons"])
    summary = {s: sum(r["status"] == s for r in results) for s in ("OUTDATED", "UNAFFECTED", "NEEDS_REVIEW")}
    return {"old_facts": old, "new_facts": new, "diff": diff, "answers": results, "summary": summary}


@app.get("/api/health")
def health():
    return {"ok": True, "llm_configured": llm.enabled()}


@app.get("/api/demo")
def demo():
    docs = []
    for p in sorted(DOCS.glob("*.txt")):
        t = p.read_text()
        docs.append({"id": p.stem, "title": t.splitlines()[0], "text": t})
    scenarios = load_scenarios()
    return {"documents": docs, "answers": load_answers(), "scenarios": scenarios,
            "default_scenario": "scholarship",
            "default_old": "scholarship_policy_v1", "default_new": "scholarship_policy_v2"}


@app.get("/api/answers")
def get_answers():
    return load_answers()


@app.put("/api/answers")
def put_answers(answers: list[dict]):
    ANSWERS.write_text(json.dumps(answers, indent=2))
    return {"saved": len(answers)}


@app.post("/api/extract-text")
async def extract_text(file: UploadFile = File(...)):
    try:
        return {"filename": file.filename, "text": extract_text_from_bytes(await file.read(), file.filename or "")}
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(400, f"Could not read file: {e}")


@app.post("/api/extract")
def extract(req: ExtractRequest):
    return extract_facts(req.text)


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    return run(req.old_text, req.new_text, req.answers if req.answers is not None else load_answers(), req.use_llm)


@app.post("/api/analyze-upload")
async def analyze_upload(new_file: UploadFile = File(...), old_file: Optional[UploadFile] = File(None)):
    try:
        new_text = extract_text_from_bytes(await new_file.read(), new_file.filename or "")
        old_text = (extract_text_from_bytes(await old_file.read(), old_file.filename or "")
                    if old_file else (DOCS / "scholarship_policy_v1.txt").read_text())
    except ValueError as e:
        raise HTTPException(422, str(e))
    return run(old_text, new_text, load_answers())
