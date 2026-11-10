"""Rule-based structured fact extraction with traceable evidence (no LLM needed)."""
import calendar
import re

LABELS = {
    "deadline": "Scholarship deadline",
    "min_cgpa": "Minimum CGPA",
    "required_documents": "Required documents",
    "annual_leave_days": "Annual leave entitlement",
    "return_window_days": "Return window",
    "allowance_amount": "Monthly allowance",
}

MONTHS = {}
for _i in range(1, 13):
    _n = calendar.month_name[_i].lower()
    MONTHS[_n] = _i
    MONTHS[_n[:3]] = _i
MONTHS["sept"] = 9


# ---------- text extraction ----------
def extract_text_from_bytes(data: bytes, filename: str = "") -> str:
    if filename.lower().endswith(".pdf") or data[:5] == b"%PDF-":
        import pymupdf as fitz  # PyMuPDF
        doc = fitz.open(stream=data, filetype="pdf")
        text = "\f".join(p.get_text() for p in doc)  # form feed marks page breaks
        if not text.replace("\f", "").strip():
            raise ValueError("No extractable text in PDF (scanned/image PDF? OCR is not supported).")
        return text
    return data.decode("utf-8", errors="replace")


# ---------- line / sentence indexing (for evidence offsets) ----------
def _lines(text):
    pos = 0
    for no, line in enumerate(text.split("\n"), start=1):
        yield {"text": line.strip(), "start": pos, "end": pos + len(line), "line": no,
               "page": text.count("\f", 0, pos) + 1}
        pos += len(line) + 1


_SENT = re.compile(r"\S.*?(?:(?<=[.!?])(?=\s|$)|$)")


def _sentences(text):
    for ln in _lines(text):
        raw = text[ln["start"]:ln["end"]]
        for m in _SENT.finditer(raw):
            s = m.group().strip()
            if s:
                yield {"text": s, "start": ln["start"] + m.start(), "end": ln["start"] + m.end(),
                       "line": ln["line"], "page": text.count("\f", 0, ln["start"] + m.start()) + 1}


def _ev(x):
    return {k: x[k] for k in ("text", "start", "end", "line", "page")}


# ---------- value helpers ----------
def values_equal(key, a, b):
    if a is None or b is None:
        return False
    if key == "deadline":
        return (a["day"], a["month"]) == (b["day"], b["month"]) and \
            (a["year"] is None or b["year"] is None or a["year"] == b["year"])
    if key == "min_cgpa":
        return abs(a - b) < 1e-9
    if key == "required_documents":
        return sorted(a) == sorted(b)
    return a == b


def display(key, v):
    if key == "deadline":
        s = f"{v['day']} {calendar.month_name[v['month']]}"
        return s + (f" {v['year']}" if v["year"] else "")
    if key == "min_cgpa":
        return f"{v:.1f}"
    if key == "required_documents":
        return ", ".join(sorted(v))
    if key in ("annual_leave_days", "return_window_days"):
        return f"{v} days"
    if key == "allowance_amount":
        return f"{v['currency']} {v['amount']:,.0f}"
    return str(v)


# ---------- extractors: each returns [(value, [evidence...])] ----------
_DA = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?\b")
_DB = re.compile(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?")
_DN = re.compile(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b")
_DEADLINE_CUE = re.compile(r"deadline|last date|due (?:date|by|on)|apply by|submit(?:ted)? by|clos(?:es|ing)", re.I)


def _mk_date(d, m, y):
    try:
        d, m = int(d), int(m)
        y = int(y) if y else None
        if not (1 <= m <= 12) or not (1 <= d <= calendar.monthrange(y or 2000, m)[1]):
            return None
        return {"day": d, "month": m, "year": y}
    except (ValueError, TypeError):
        return None


def _dates(sentence):
    found = []
    for rx, order in ((_DA, "dm"), (_DB, "md"), (_DN, "n")):
        for m in rx.finditer(sentence):
            if order == "dm":
                mon = MONTHS.get(m.group(2).lower())
                v = _mk_date(m.group(1), mon, m.group(3)) if mon else None
            elif order == "md":
                mon = MONTHS.get(m.group(1).lower())
                v = _mk_date(m.group(2), mon, m.group(3)) if mon else None
            else:
                v = _mk_date(m.group(1), m.group(2), m.group(3))  # day-first
            if v:
                found.append((m.start(), m.end(), v))
    found.sort(key=lambda t: t[0])
    out, last_end = [], -1
    for s, e, v in found:  # drop overlapping matches
        if s >= last_end:
            out.append(v)
            last_end = e
    return out


def _x_deadline(text):
    res = []
    for s in _sentences(text):
        if _DEADLINE_CUE.search(s["text"]):
            for v in _dates(s["text"]):
                res.append((v, [_ev(s)]))
    return res


_CG_CUE = re.compile(r"minimum|\bmin\b|at least|not less than|no less than|≥|>=|or above|and above|required", re.I)


def _x_cgpa(text):
    res = []
    for s in _sentences(text):
        t = s["text"]
        if re.search(r"\b(?:CGPA|GPA)\b", t, re.I) and _CG_CUE.search(t):
            t2 = re.sub(r"(?:/|out of)\s*10(?:\.0+)?\b", "", t)
            for n in re.findall(r"(?<![\d.])(\d{1,2}(?:\.\d+)?)(?![\d.]*\w)", t2):
                if 0 <= float(n) <= 10:
                    res.append((float(n), [_ev(s)]))
    return res


_DOC_HDR = re.compile(r"(?:required|mandatory|necessary|supporting)\s+documents?|documents?\s+(?:required|needed|to be (?:submitted|uploaded))|following documents?", re.I)
_BULLET = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


def norm_doc(x):
    x = x.lower().strip(" .;:\t")
    x = re.sub(r"^(?:and|&)\s+", "", x)
    x = re.sub(r"^(?:scanned |attested |self-attested )?(?:copy|copies) of (?:the |your )?", "", x)
    x = re.sub(r"^(?:the|a|an|your)\s+", "", x)
    x = x.replace("mark sheet", "marksheet").replace("mark-sheet", "marksheet")
    x = re.sub(r"\s+", " ", x)
    if x.endswith("s") and not x.endswith("ss") and len(x) > 3:
        x = x[:-1]
    return x


def _split_docs(body):
    return sorted({norm_doc(p) for p in re.split(r",|;|\band\b|&", body) if norm_doc(p)})


def _x_docs(text):
    res, ls = [], list(_lines(text))
    for i, ln in enumerate(ls):
        if not _DOC_HDR.search(ln["text"]):
            continue
        if ":" in ln["text"]:
            body = ln["text"].split(":", 1)[1]
        else:
            m = re.search(r"\b(?:are|include|includes)\b\s+(.*)", ln["text"], re.I)
            body = m.group(1) if m else ""
        evs, items = [_ev(ln)], []
        if body.strip():
            items = _split_docs(body)
        else:  # bullet list on following lines
            j = i + 1
            while j < len(ls) and _BULLET.match(ls[j]["text"]):
                items += _split_docs(_BULLET.sub("", ls[j]["text"]))
                evs.append(_ev(ls[j]))
                j += 1
            items = sorted(set(items))
        if items:
            res.append((items, evs))
    return res


def _x_days(text, cue):
    res = []
    for s in _sentences(text):
        if not cue.search(s["text"]):
            continue
        for m in re.finditer(r"\b(\d+)\s+days?\b", s["text"], re.I):
            res.append((int(m.group(1)), [_ev(s)]))
    return res


_ANNUAL_LEAVE_CUE = re.compile(r"\bannual leave\b|\bleave entitlement\b", re.I)
_RETURN_WINDOW_CUE = re.compile(r"\breturn(?:ed|s| window| period)?\b", re.I)


def _x_annual_leave(text):
    return _x_days(text, _ANNUAL_LEAVE_CUE)


def _x_return_window(text):
    return _x_days(text, _RETURN_WINDOW_CUE)


_ALLOWANCE_CUE = re.compile(r"\ballowance\b", re.I)
_MONEY = re.compile(r"(?P<currency>INR|USD|EUR|GBP|₹|\$|€|£)\s*(?P<amount>\d[\d,]*(?:\.\d{1,2})?)", re.I)
_CURRENCY = {"₹": "INR", "$": "USD", "€": "EUR", "£": "GBP"}


def _x_allowance(text):
    res = []
    for s in _sentences(text):
        if not _ALLOWANCE_CUE.search(s["text"]):
            continue
        for m in _MONEY.finditer(s["text"]):
            currency = m.group("currency").upper()
            value = {"currency": _CURRENCY.get(currency, currency),
                     "amount": float(m.group("amount").replace(",", ""))}
            res.append((value, [_ev(s)]))
    return res


EXTRACTORS = {
    "deadline": _x_deadline,
    "min_cgpa": _x_cgpa,
    "required_documents": _x_docs,
    "annual_leave_days": _x_annual_leave,
    "return_window_days": _x_return_window,
    "allowance_amount": _x_allowance,
}


def _build(key, cands):
    if not cands:
        return None  # missing: no fact is invented
    groups = []  # distinct values
    for v, ev in cands:
        for g in groups:
            if values_equal(key, g["value"], v):
                g["evidence"] += [e for e in ev if e not in g["evidence"]]
                break
        else:
            groups.append({"value": v, "display": display(key, v), "evidence": list(ev)})
    base = {"key": key, "label": LABELS[key]}
    if len(groups) == 1:
        return {**base, "status": "found", **groups[0]}
    return {**base, "status": "ambiguous", "value": None,
            "display": "AMBIGUOUS: " + " | ".join(g["display"] for g in groups),
            "evidence": [e for g in groups for e in g["evidence"]], "candidates": groups}


def extract_facts(text):
    out = {}
    for key, fn in EXTRACTORS.items():
        f = _build(key, fn(text))
        if f:
            out[key] = f
    return out
