from .facts import values_equal


def diff_facts(old, new):
    """Compare two fact dicts -> {key: {change: added|removed|modified|unchanged|uncertain}}."""
    out = {}
    for k in dict.fromkeys(list(old) + list(new)):
        o, n = old.get(k), new.get(k)
        if o and n:
            if o["status"] != "found" or n["status"] != "found":
                change = "uncertain"
            elif values_equal(k, o["value"], n["value"]):
                change = "unchanged"
            else:
                change = "modified"
        elif n:
            change = "added"
        else:
            change = "removed"
        out[k] = {"key": k, "label": (o or n)["label"], "change": change, "old": o, "new": n}
    return out
