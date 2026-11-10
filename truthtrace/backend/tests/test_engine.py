import pymupdf as fitz
from fastapi.testclient import TestClient
from app.main import app, DOCS, load_answers, run
from app.facts import extract_facts, extract_text_from_bytes

client = TestClient(app)
doc = lambda n: (DOCS / f"{n}.txt").read_text()
status = lambda r: {a["id"]: a["status"] for a in r["answers"]}


def test_demo_expected_result():
    r = run(doc("scholarship_policy_v1"), doc("scholarship_policy_v2"), load_answers())
    assert status(r) == {"a1": "OUTDATED", "a2": "UNAFFECTED", "a3": "UNAFFECTED"}
    assert {k: v["change"] for k, v in r["diff"].items()} == {"deadline": "modified", "min_cgpa": "unchanged", "required_documents": "unchanged"}
    a1 = r["answers"][0]
    assert a1["suggested_answer"] == "The deadline to apply for the scholarship is 15 November."
    assert a1["dependencies"][0]["old_evidence"][0]["text"] == "The scholarship application deadline is 20 November."
    assert a1["dependencies"][0]["new_evidence"][0]["text"] == "The scholarship application deadline is 15 November."


def test_evidence_is_traceable_to_source_offsets():
    t = doc("scholarship_policy_v2")
    for f in extract_facts(t).values():
        for e in f["evidence"]:
            assert t[e["start"]:e["end"]].strip() == e["text"]


def test_stored_evidence_exists_in_v1():
    t = doc("scholarship_policy_v1")
    for a in load_answers():
        e = a["depends_on"][0]["evidence"]
        assert e["text"] in t and t.split("\n")[e["line"] - 1].strip().startswith(e["text"][:20])


def test_only_dependents_invalidated():
    r = run(doc("scholarship_policy_v1"), doc("scholarship_policy_v3_cgpa_docs_change"), load_answers())
    assert status(r) == {"a1": "UNAFFECTED", "a2": "OUTDATED", "a3": "OUTDATED"}


def test_ambiguous_and_missing_need_review():
    r = run(doc("scholarship_policy_v1"), doc("scholarship_policy_v4_ambiguous"), load_answers())
    assert status(r) == {"a1": "NEEDS_REVIEW", "a2": "UNAFFECTED", "a3": "UNAFFECTED"}
    r = run(doc("scholarship_policy_v1"), doc("scholarship_policy_v5_missing_docs"), load_answers())
    assert status(r) == {"a1": "UNAFFECTED", "a2": "UNAFFECTED", "a3": "NEEDS_REVIEW"}


def test_formatting_variants_are_not_false_changes():
    new = doc("scholarship_policy_v1").replace("20 November", "November 20th").replace(
        "Required documents: marksheets and admission proof.", "Required documents:\n- Admission proof\n- Mark sheets")
    assert status(run(doc("scholarship_policy_v1"), new, load_answers())) == {"a1": "UNAFFECTED", "a2": "UNAFFECTED", "a3": "UNAFFECTED"}


def test_contradictory_baseline_needs_review():
    a = load_answers(); a[1]["depends_on"][0]["value"] = 6.5
    assert status(run(doc("scholarship_policy_v1"), doc("scholarship_policy_v2"), a))["a2"] == "NEEDS_REVIEW"


def test_answer_without_dependencies_needs_review():
    a = load_answers(); a[0]["depends_on"] = []
    assert status(run(doc("scholarship_policy_v1"), doc("scholarship_policy_v2"), a))["a1"] == "NEEDS_REVIEW"


def _pdf(text):
    d = fitz.open(); p = d.new_page(); y = 72
    for line in text.split("\n"):
        p.insert_text((72, y), line, fontsize=10); y += 14
    return d.tobytes()


def test_pdf_extraction_and_api():
    txt = extract_text_from_bytes(_pdf(doc("scholarship_policy_v2")), "x.pdf")
    assert extract_facts(txt)["deadline"]["display"] == "15 November"
    r = client.post("/api/analyze-upload", files={"new_file": ("v2.pdf", _pdf(doc("scholarship_policy_v2")), "application/pdf")})
    assert r.status_code == 200 and status(r.json())["a1"] == "OUTDATED"


def test_blank_pdf_rejected():
    d = fitz.open(); d.new_page()
    r = client.post("/api/extract-text", files={"file": ("blank.pdf", d.tobytes(), "application/pdf")})
    assert r.status_code == 422


def test_api_demo_and_analyze():
    d = client.get("/api/demo").json()
    assert len(d["documents"]) >= 5 and len(d["answers"]) == 3
    r = client.post("/api/analyze", json={"old_text": doc("scholarship_policy_v1"), "new_text": doc("scholarship_policy_v2")}).json()
    assert r["summary"] == {"OUTDATED": 1, "UNAFFECTED": 2, "NEEDS_REVIEW": 0}


def test_each_demo_scenario_has_distinct_evidence_and_updates_its_answer():
    demo = client.get("/api/demo").json()
    documents = {item["id"]: item["text"] for item in demo["documents"]}
    fact_keys = {
        "scholarship": "deadline",
        "hr": "annual_leave_days",
        "ecommerce": "return_window_days",
        "reimbursement": "allowance_amount",
    }

    assert {item["id"] for item in demo["scenarios"]} == set(fact_keys)
    for scenario in demo["scenarios"]:
        old_text = documents[scenario["old_document"]]
        new_text = documents[scenario["new_document"]]
        assert old_text != new_text

        result = run(old_text, new_text, scenario["answers"])
        key = fact_keys[scenario["id"]]
        fact = result["diff"][key]
        answer = next(a for a in result["answers"] if any(d["fact_key"] == key for d in a["dependencies"]))
        dependency = next(d for d in answer["dependencies"] if d["fact_key"] == key)

        assert fact["change"] == "modified"
        assert answer["status"] == "OUTDATED"
        assert answer["suggested_answer"]
        assert dependency["verdict"] == "changed"
        assert dependency["old_evidence"] and dependency["new_evidence"]
        assert scenario["old_document"] in dependency["stored_evidence"]["doc"]
