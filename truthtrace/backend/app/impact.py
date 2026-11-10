"""Map fact changes to stored answers through explicit evidence dependencies."""
import re
from .facts import values_equal


def render(template, new_facts):
    if not template:
        return None
    vals = {}
    for k in re.findall(r"\{(\w+)\}", template):
        f = new_facts.get(k)
        if not f or f["status"] != "found":
            return None
        vals[k] = f["display"]
    return template.format(**vals)


def _dep(dep, old, new, diff):
    key = dep["fact_key"]
    d = diff.get(key)
    o, n = old.get(key), new.get(key)
    item = {"fact_key": key, "label": d["label"] if d else key, "change": d["change"] if d else "absent",
            "old_display": o and o["display"], "new_display": n and n["display"],
            "stored_evidence": dep.get("evidence"),
            "old_evidence": o["evidence"] if o else [], "new_evidence": n["evidence"] if n else [],
            "verdict": "review", "note": ""}
    lab = item["label"]
    if d is None:
        item["note"] = f"{lab}: not found in either version; cannot verify."
    elif d["change"] == "removed":
        item["note"] = f"{lab}: present in old version but missing in the new one."
    elif d["change"] == "added":
        item["note"] = f"{lab}: not reliably found in the old version, so the stored answer's baseline cannot be verified."
    elif d["change"] == "uncertain":
        item["note"] = f"{lab}: ambiguous or contradictory evidence ({(n or o)['display']})."
    elif d["change"] == "modified":
        item["verdict"] = "changed"
        item["note"] = f"{lab} changed from {o['display']} to {n['display']}."
        if dep.get("value") is not None and not values_equal(key, dep["value"], o["value"]):
            item["note"] += " (Note: stored answer's baseline also differed from the old document.)"
    else:  # unchanged
        if dep.get("value") is not None and not values_equal(key, dep["value"], o["value"]):
            item["note"] = f"{lab}: unchanged between versions, but the stored answer was built on a different value than the old document states."
        else:
            item["verdict"] = "unchanged"
            item["note"] = f"{lab} unchanged ({o['display']})."
    return item


def assess_answer(ans, old, new, diff):
    deps = [_dep(d, old, new, diff) for d in ans.get("depends_on") or []]
    verdicts = {d["verdict"] for d in deps}
    reasons = [d["note"] for d in deps if d["verdict"] != "unchanged"]
    if "changed" in verdicts:
        status = "OUTDATED"
    elif "review" in verdicts or not deps:
        status = "NEEDS_REVIEW"
        if not deps:
            reasons = ["No evidence dependencies are linked to this answer."]
    else:
        status, reasons = "UNAFFECTED", ["All supporting facts are unchanged."]
    suggested = render(ans.get("corrected_template"), new) if status == "OUTDATED" else None
    if status == "OUTDATED" and suggested is None:
        reasons.append("No safe corrected answer could be generated; regenerate manually.")
    return {"id": ans["id"], "question": ans["question"], "original_answer": ans["answer"],
            "status": status, "reasons": reasons, "dependencies": deps, "suggested_answer": suggested}


def assess_answers(answers, old, new, diff):
    return [assess_answer(a, old, new, diff) for a in answers]
