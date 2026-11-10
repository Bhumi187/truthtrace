"""Optional LLM polish. Never affects detection/classification; skipped unless ANTHROPIC_API_KEY is set."""
import json, os, urllib.request


def enabled():
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def polish(question, original, suggested, reasons):
    if not enabled():
        return None
    body = {"model": os.environ.get("TRUTHTRACE_LLM_MODEL", "claude-sonnet-4-5"), "max_tokens": 300,
            "messages": [{"role": "user", "content":
                f"Question: {question}\nOutdated answer: {original}\nVerified corrected answer: {suggested}\n"
                f"Why it changed: {'; '.join(reasons)}\nRewrite the corrected answer in one friendly sentence. "
                "Do not add facts that are not in the corrected answer."}]}
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-api-key": os.environ["ANTHROPIC_API_KEY"],
                 "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)["content"][0]["text"]
    except Exception:
        return None
