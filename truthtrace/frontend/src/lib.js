export async function api(path, opts) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Request failed (${r.status})`);
  return body;
}

export const STATUS = {
  OUTDATED: { label: "Outdated", text: "text-rose", dot: "bg-rose", hex: "#f2707f" },
  NEEDS_REVIEW: { label: "Needs review", text: "text-amber", dot: "bg-amber", hex: "#e6b45a" },
  UNAFFECTED: { label: "Unaffected", text: "text-mint", dot: "bg-mint", hex: "#6fd6a8" },
};
export const CHANGE = {
  modified: { label: "Modified", text: "text-rose", hex: "#f2707f" },
  added: { label: "Added", text: "text-cyan", hex: "#5ccfe6" },
  removed: { label: "Removed", text: "text-rose", hex: "#f2707f" },
  uncertain: { label: "Ambiguous", text: "text-amber", hex: "#e6b45a" },
  unchanged: { label: "Unchanged", text: "text-dim", hex: "#626575" },
};
export const EDGE = { stable: "#2f3140", old: "#f2707f", new: "#5ccfe6", review: "#e6b45a" };
export const cut = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s || "");

/* word-level LCS diff: returns tokens for each side with ch=true where the word differs */
export function wordDiff(a = "", b = "") {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const wa = A.map((t, i) => [t, i]).filter(([t]) => t.trim());
  const wb = B.map((t, i) => [t, i]).filter(([t]) => t.trim());
  const n = wa.length, m = wb.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = wa[i][0] === wb[j][0] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const sa = new Set(), sb = new Set();
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (wa[i][0] === wb[j][0]) { sa.add(wa[i][1]); sb.add(wb[j][1]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const mark = (arr, same) => arr.map((t, k) => ({ t, ch: !!t.trim() && !same.has(k) }));
  return { a: mark(A, sa), b: mark(B, sb) };
}

/* highlight spans derived from real evidence offsets of extracted facts */
export function buildSpans(facts, diff, side) {
  const out = [];
  for (const f of Object.values(facts)) {
    const d = diff[f.key];
    const other = side === "old" ? d.new : d.old;
    f.evidence.forEach((e, i) => {
      let kind = "stable", tokens = null;
      if (f.status === "ambiguous" || d.change === "uncertain") kind = "review";
      else if (d.change === "modified") {
        kind = "changed";
        const oe = other && other.evidence[i];
        if (oe) tokens = side === "old" ? wordDiff(e.text, oe.text).a : wordDiff(oe.text, e.text).b;
      } else if (d.change === "added") kind = "added";
      else if (d.change === "removed") kind = "removed";
      out.push({ start: e.start, end: e.end, key: f.key, kind, tokens, ev: e, label: f.label, display: f.display });
    });
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  const res = []; let last = -1;
  for (const s of out) if (s.start >= last) { res.push(s); last = s.end; }
  return res;
}

/* the dependency graph is derived entirely from the analysis result */
export const GW = { W: 300, H: 96, GAP: 28, X: [44, 488, 932], TOP: 86 };
export function buildGraph(result, titles) {
  const { W, H, GAP, X, TOP } = GW;
  const srcs = [
    { id: "src:old", kind: "src", label: "Version 1", sub: titles.old },
    { id: "src:new", kind: "src", label: "Version 2", sub: titles.new },
  ];
  const diffs = Object.values(result.diff);
  const facts = diffs.map((d) => ({ id: "fact:" + d.key, kind: "fact", key: d.key, label: d.label,
    sub: `${d.old ? d.old.display : "—"} → ${d.new ? d.new.display : "—"}`, change: d.change }));
  const answers = result.answers.map((a) => ({ id: "ans:" + a.id, kind: "ans", aid: a.id, label: a.question, sub: STATUS[a.status].label, status: a.status }));
  const cols = [srcs, facts, answers];
  const rows = Math.max(...cols.map((c) => c.length));
  const height = TOP + rows * H + (rows - 1) * GAP + 34;
  cols.forEach((c, ci) => {
    const ch = c.length * H + (c.length - 1) * GAP;
    const y0 = TOP + (rows * H + (rows - 1) * GAP - ch) / 2;
    c.forEach((n, i) => { n.x = X[ci]; n.y = y0 + i * (H + GAP); });
  });
  const nodes = [...srcs, ...facts, ...answers];
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const d of diffs) {
    const unc = d.change === "uncertain";
    if (d.old) edges.push({ id: `src:old>${d.key}`, from: "src:old", to: "fact:" + d.key,
      tone: unc ? "review" : d.change === "modified" || d.change === "removed" ? "old" : "stable" });
    if (d.new) edges.push({ id: `src:new>${d.key}`, from: "src:new", to: "fact:" + d.key,
      tone: unc ? "review" : d.change === "modified" || d.change === "added" ? "new" : "stable" });
  }
  for (const a of result.answers)
    for (const dep of a.dependencies) {
      if (!byId["fact:" + dep.fact_key]) continue;
      edges.push({ id: `${dep.fact_key}>${a.id}`, from: "fact:" + dep.fact_key, to: "ans:" + a.id,
        tone: dep.verdict === "changed" ? "old" : dep.verdict === "review" ? "review" : "stable" });
    }
  return { nodes, edges, byId, height, width: X[2] + W + 44 };
}

/* ancestors + descendants of a node (so siblings don't light up) */
export function reach(g, focus) {
  const nodes = new Set(), edges = new Set();
  if (!focus) return { nodes, edges, active: false };
  nodes.add(focus);
  for (const dir of ["up", "down"]) {
    const q = [focus], seen = new Set([focus]);
    while (q.length) {
      const id = q.shift();
      for (const e of g.edges) {
        const [a, b] = dir === "up" ? [e.to, e.from] : [e.from, e.to];
        if (a !== id) continue;
        edges.add(e.id);
        if (!seen.has(b)) { seen.add(b); nodes.add(b); q.push(b); }
      }
    }
  }
  return { nodes, edges, active: true };
}
