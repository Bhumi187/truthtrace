import { useMemo, useState } from "react";
import { buildGraph, reach, cut, EDGE, CHANGE, STATUS, GW } from "./lib";

const STAGE = ["Source documents", "Extracted facts", "Stored answers"];

function nodeTone(node) {
  if (node.kind === "src") return "#9b8cff";
  if (node.kind === "fact") return CHANGE[node.change]?.hex || "#9396a6";
  return STATUS[node.status]?.hex || "#9396a6";
}

function nodeDetail(node) {
  if (node.kind === "src") return "Source document";
  if (node.kind === "fact") return CHANGE[node.change]?.label || "Extracted fact";
  return STATUS[node.status]?.label || "Stored answer";
}

export default function Graph({ result, titles, sel, onPickFact, onPickAnswer }) {
  const g = useMemo(() => buildGraph(result, titles), [result, titles.old, titles.new]);
  const [hover, setHover] = useState(null);
  const selId = sel.factKey ? "fact:" + sel.factKey : sel.answerId ? "ans:" + sel.answerId : null;
  const focus = hover || selId;
  const lit = useMemo(() => reach(g, focus), [g, focus]);
  const { W, H, X } = GW;
  const tally = g.edges.reduce((m, e) => ((m[e.tone] = (m[e.tone] || 0) + 1), m), {});

  return (
    <section className="graph-workspace">
      <div className="graph-heading">
        <div>
          <div className="eyebrow">Evidence map <span className="eyebrow-rule" /></div>
          <h2>Trace the answer to its sources</h2>
          <p>Every connection is derived from the current document analysis and stored answer dependencies.</p>
        </div>
        <div className="graph-count"><span>{g.nodes.length}</span> entities <i /> <span>{g.edges.length}</span> evidence links</div>
      </div>

      <div className="graph-canvas">
        <svg viewBox={`0 0 ${g.width} ${g.height}`} className="dependency-svg"
          role="img" aria-label="Interactive dependency graph linking source documents, extracted facts, and stored answers">
          <defs>
            <linearGradient id="graph-glow" x1="0" x2="1">
              <stop offset="0" stopColor="#9b8cff" stopOpacity=".16" />
              <stop offset=".5" stopColor="#9b8cff" stopOpacity=".04" />
              <stop offset="1" stopColor="#5ccfe6" stopOpacity=".12" />
            </linearGradient>
            {Object.entries(EDGE).map(([key, color]) => (
              <marker key={key} id={`arrow-${key}`} viewBox="0 0 8 8" refX="7" refY="4"
                markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0L8 4L0 8z" fill={color} />
              </marker>
            ))}
          </defs>
          <rect x="14" y="12" width={g.width - 28} height={g.height - 22} rx="18" fill="url(#graph-glow)" opacity=".34" />
          {STAGE.map((title, i) => (
            <g key={title} className="graph-stage">
              <text x={X[i]} y="34" className="graph-stage-index">{`0${i + 1}`}</text>
              <text x={X[i] + 34} y="34" className="graph-stage-title">{title}</text>
              <line x1={X[i]} y1="52" x2={X[i] + W} y2="52" className="graph-stage-line" />
            </g>
          ))}
          {g.edges.map((e) => {
            const a = g.byId[e.from], b = g.byId[e.to];
            const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, dx = (x2 - x1) / 2;
            const on = lit.active ? lit.edges.has(e.id) : true;
            return (
              <path key={e.id} d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`}
                fill="none" stroke={EDGE[e.tone]} strokeWidth={on && e.tone !== "stable" ? 2.6 : 1.5}
                opacity={lit.active ? (on ? 1 : 0.1) : e.tone === "stable" ? 0.36 : 0.92}
                markerEnd={`url(#arrow-${e.tone})`}
                className={e.tone !== "stable" && on ? "graph-edge graph-edge-active" : "graph-edge"} />
            );
          })}
          {g.nodes.map((n) => {
            const on = lit.active ? lit.nodes.has(n.id) : true;
            const isSel = n.id === selId;
            const accent = nodeTone(n);
            const click = n.kind === "fact" ? () => onPickFact(n.key) : n.kind === "ans" ? () => onPickAnswer(n.aid) : undefined;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={on ? 1 : 0.22}
                onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} onClick={click}
                className={`graph-node ${click ? "graph-node-clickable" : ""}`}
                tabIndex={click ? 0 : undefined} role={click ? "button" : undefined}
                aria-label={click ? `${nodeDetail(n)}: ${n.label}. ${n.sub}` : undefined}
                onKeyDown={(ev) => click && (ev.key === "Enter" || ev.key === " ") && click()}>
                <title>{`${n.label}${n.sub ? " — " + n.sub : ""}`}</title>
                <rect width={W} height={H} rx="13" className={`graph-card ${isSel ? "graph-card-selected" : ""}`} />
                <rect width="3" height={H - 28} x="1" y="14" rx="1.5" fill={accent} />
                <circle cx="23" cy="24" r="3.5" fill={accent} />
                <text x="35" y="28" className="graph-node-kind">{nodeDetail(n)}</text>
                <text x="20" y="57" className="graph-node-label">{cut(n.label, n.kind === "ans" ? 34 : 34)}</text>
                <text x="20" y="78" className="graph-node-sub">{cut(n.sub, 38)}</text>
                {n.kind === "ans" && (
                  <text x={W - 19} y="28" textAnchor="end" className="graph-node-index">
                    {String(result.answers.findIndex((a) => a.id === n.aid) + 1).padStart(2, "0")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="graph-legend">
        <span><i className="legend-line legend-old" />Superseded evidence <b>{tally.old || 0}</b></span>
        <span><i className="legend-line legend-new" />Updated evidence <b>{tally.new || 0}</b></span>
        <span><i className="legend-line legend-review" />Needs review <b>{tally.review || 0}</b></span>
        <span><i className="legend-line legend-stable" />Unchanged <b>{tally.stable || 0}</b></span>
        <span className="graph-hint">Hover to isolate a path · Select a fact or answer to investigate</span>
      </div>
    </section>
  );
}
