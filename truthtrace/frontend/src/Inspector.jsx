import { useState } from "react";
import { wordDiff, STATUS, CHANGE } from "./lib";

function Tokens({ tokens, tone }) {
  const cls = tone === "rose" ? "evidence-token-old" : "evidence-token-new";
  return tokens.map((t, i) => <span key={i} className={t.ch ? cls : ""}>{t.t}</span>);
}

function Evidence({ items, other, side, diffOn, empty }) {
  if (!items || !items.length) return <p className="evidence-empty">{empty}</p>;
  return items.map((e, i) => {
    const oe = other && other[i];
    const tk = diffOn && oe ? (side === "old" ? wordDiff(e.text, oe.text).a : wordDiff(oe.text, e.text).b) : null;
    return (
      <div key={i} className="evidence-quote">
        <p>{tk ? <Tokens tokens={tk} tone={side === "old" ? "rose" : "cyan"} /> : e.text}</p>
        <span>Line {e.line} <i /> Page {e.page}</span>
      </div>
    );
  });
}

export default function Inspector({ result, stored, selId, selFact, onPickAnswer }) {
  const [copied, setCopied] = useState(false);
  const a = result.answers.find((x) => x.id === selId) || result.answers[0];
  if (!a) return <p className="investigation-empty">No stored answers to investigate.</p>;
  const st = STATUS[a.status];
  const meta = (stored || []).find((s) => s.id === a.id);
  const wd = a.suggested_answer ? wordDiff(a.original_answer, a.suggested_answer) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(a.suggested_answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <section className="investigation">
      <header className="investigation-header">
        <div>
          <div className="eyebrow">Answer investigation <span className="eyebrow-rule" /></div>
          <h2>Stored knowledge, examined</h2>
        </div>
        <div className="answer-switcher" aria-label="Select stored answer">
          {result.answers.map((x, i) => (
            <button key={x.id} onClick={() => onPickAnswer(x.id)} title={x.question}
              aria-pressed={x.id === a.id} className={x.id === a.id ? "answer-switch-active" : ""}>
              <i style={{ backgroundColor: STATUS[x.status].hex }} />
              <span>{String(i + 1).padStart(2, "0")}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="investigation-body">
        <div className="answer-summary">
          <div className={`answer-status answer-status-${a.status.toLowerCase()}`}>
            <i style={{ backgroundColor: st.hex }} />{st.label}
          </div>
          <h3>{a.question}</h3>
          {meta && <p className="answer-meta">Stored {meta.generated_at} <i /> {a.dependencies.length} evidence {a.dependencies.length === 1 ? "dependency" : "dependencies"}</p>}
        </div>

        <div className="investigation-columns">
          <div className="answer-record">
            <div className="investigation-label"><span>01</span> Answer on record</div>
            <p className="answer-copy">{wd ? <Tokens tokens={wd.a} tone="rose" /> : a.original_answer}</p>

            {a.reasons.length > 0 && (
              <div className="finding">
                <div className="investigation-label"><span>02</span> Finding</div>
                {a.reasons.map((r, i) => <p key={i}>{r}</p>)}
              </div>
            )}

            {a.status === "OUTDATED" && (
              <div className="correction">
                <div className="correction-heading">
                  <div className="investigation-label"><span>03</span> Evidence-led update</div>
                  {a.suggested_answer && <button onClick={copy} className="copy-answer">{copied ? "Copied" : "Copy answer"}</button>}
                </div>
                <p>{wd ? <Tokens tokens={wd.b} tone="cyan" /> : "No safe correction could be generated. Regenerate this answer manually."}</p>
                {a.suggested_answer_llm && <div className="reworded-answer">Reworded suggestion <p>{a.suggested_answer_llm}</p></div>}
              </div>
            )}
          </div>

          <div className="dependency-record">
            <div className="investigation-label"><span>03</span> Evidence trail</div>
            {a.dependencies.length === 0 && <p className="evidence-empty">No evidence dependencies are linked to this answer.</p>}
            {a.dependencies.map((d) => {
              const c = CHANGE[d.change] || { label: d.change, text: "text-mute" };
              const selected = selFact === d.fact_key;
              return (
                <article key={d.fact_key} className={`dependency-detail ${selected ? "dependency-detail-selected" : ""}`}>
                  <header className="dependency-heading">
                    <div><h4>{d.label}</h4><span className={`dependency-change ${c.text}`}>{c.label}</span></div>
                    <span className={`dependency-verdict dependency-verdict-${d.verdict}`}>
                      {d.verdict === "changed" ? "Changed" : d.verdict === "review" ? "Unverified" : "Stable"}
                    </span>
                  </header>
                  <div className="fact-values">
                    <div><span>Previous</span><strong>{d.old_display || "Not found"}</strong></div>
                    <div><span>Current</span><strong>{d.new_display || "Not found"}</strong></div>
                  </div>
                  {d.stored_evidence && (
                    <p className="stored-citation">Original citation <b>{d.stored_evidence.doc}</b>, line {d.stored_evidence.line}</p>
                  )}
                  <div className="evidence-pair">
                    <div className="evidence-side evidence-side-old">
                      <div className="evidence-side-title"><i /> Previous source</div>
                      <Evidence items={d.old_evidence} other={d.new_evidence} side="old" diffOn={d.change === "modified"} empty="No matching evidence in previous version." />
                    </div>
                    <div className="evidence-side evidence-side-new">
                      <div className="evidence-side-title"><i /> Current source</div>
                      <Evidence items={d.new_evidence} other={d.old_evidence} side="new" diffOn={d.change === "modified"} empty="No matching evidence in current version." />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
