import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib";
import Compare from "./Compare";
import Graph from "./Graph";
import Inspector from "./Inspector";
import Sources from "./Sources";

const VIEWS = [["graph", "Evidence map"], ["compare", "Document diff"], ["sources", "Sources"]];

function BrandMark() {
  return (
    <svg viewBox="0 0 36 36" width="32" height="32" aria-hidden="true">
      <path d="M7 25 15 16l6 5 9-12" fill="none" stroke="#a99aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="25" r="2.5" fill="#a99aff" />
      <circle cx="21" cy="21" r="2.5" fill="#5ccfe6" />
      <circle cx="30" cy="9" r="2.5" fill="#5ccfe6" />
    </svg>
  );
}

export default function App() {
  const [demo, setDemo] = useState(null);
  const [health, setHealth] = useState(null);
  const [scenarioId, setScenarioId] = useState("");
  const [oldSel, setOldSel] = useState(""), [newSel, setNewSel] = useState("");
  const [oldText, setOldText] = useState(""), [newText, setNewText] = useState("");
  const [result, setResult] = useState(null);
  const [analyzed, setAnalyzed] = useState(null);
  const [sel, setSel] = useState({ answerId: null, factKey: null });
  const [view, setView] = useState("graph");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const runSequence = useRef(0);

  const run = useCallback(async (o, n, answers, scenario = "") => {
    const sequence = ++runSequence.current;
    setBusy(true); setError("");
    try {
      const r = await api("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_text: o, new_text: n, answers }) });
      if (sequence !== runSequence.current) return;
      setResult(r); setAnalyzed({ old: o, new: n, scenario });
      const first = r.answers.find((a) => a.status === "OUTDATED") || r.answers.find((a) => a.status === "NEEDS_REVIEW") || r.answers[0];
      setSel({ answerId: first ? first.id : null, factKey: null });
    } catch (e) {
      if (sequence === runSequence.current) { setError(e.message); setResult(null); }
    } finally {
      if (sequence === runSequence.current) setBusy(false);
    }
  }, []);

  const load = async () => {
    setError("");
    try {
      const d = await api("/api/demo");
      setDemo(d);
      const scenario = d.scenarios?.find((x) => x.id === d.default_scenario) || {
        id: "scholarship", answers: d.answers, old_document: d.default_old, new_document: d.default_new,
      };
      setScenarioId(scenario.id);
      const o = d.documents.find((x) => x.id === scenario.old_document), n = d.documents.find((x) => x.id === scenario.new_document);
      if (!o || !n) throw new Error("The selected demo scenario is missing one of its documents.");
      setOldSel(o.id); setOldText(o.text); setNewSel(n.id); setNewText(n.text);
      run(o.text, n.text, scenario.answers, scenario.id);
    } catch (e) { setError("Cannot reach the backend on :8000. Start it with: uvicorn app.main:app --port 8000 (" + e.message + ")"); }
  };
  useEffect(() => { load(); api("/api/health").then(setHealth).catch(() => setHealth(false)); }, []);

  const activeScenario = demo?.scenarios?.find((x) => x.id === scenarioId);
  const answerSet = activeScenario?.answers || demo?.answers || [];
  const analyze = useCallback(() => demo && !busy && run(oldText, newText, answerSet, scenarioId),
    [demo, busy, oldText, newText, answerSet, scenarioId, run]);
  useEffect(() => {
    const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); analyze(); } };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [analyze]);

  const pick = (setSelId, setText) => (id) => {
    setSelId(id);
    const d = demo.documents.find((x) => x.id === id);
    if (d) setText(d.text);
  };
  const selectScenario = (id) => {
    const scenario = demo?.scenarios?.find((x) => x.id === id);
    const old = demo?.documents.find((x) => x.id === scenario?.old_document);
    const neu = demo?.documents.find((x) => x.id === scenario?.new_document);
    if (!scenario || !old || !neu) { setError("That scenario is missing its configured documents or answers."); return; }
    setScenarioId(scenario.id);
    setOldSel(old.id); setOldText(old.text);
    setNewSel(neu.id); setNewText(neu.text);
    setResult(null); setAnalyzed(null);
    setSel({ answerId: null, factKey: null });
    run(old.text, neu.text, scenario.answers, scenario.id);
  };
  const upload = (setSelId, setText) => async (file) => {
    setError("");
    const fd = new FormData(); fd.append("file", file);
    try { const r = await api("/api/extract-text", { method: "POST", body: fd }); setText(r.text); setSelId("custom"); }
    catch (e) { setError(e.message); }
  };

  const pickAnswer = (id) => setSel({ answerId: id, factKey: null });
  const pickFact = (key) => {
    const deps = result.answers.filter((a) => a.dependencies.some((d) => d.fact_key === key));
    const cur = deps.find((a) => a.id === sel.answerId) || deps[0];
    setSel({ answerId: cur ? cur.id : sel.answerId, factKey: key });
  };
  const metrics = useMemo(() => {
    if (!result) return null;
    const facts = Object.values(result.diff);
    return {
      changed: facts.filter((d) => d.change !== "unchanged").length,
      totalFacts: facts.length,
      outdated: result.summary.OUTDATED,
      review: result.summary.NEEDS_REVIEW,
      unaffected: result.summary.UNAFFECTED,
    };
  }, [result]);
  const stale = result && analyzed && (analyzed.old !== oldText || analyzed.new !== newText || analyzed.scenario !== scenarioId);
  const titles = analyzed ? { old: analyzed.old.split("\n")[0], new: analyzed.new.split("\n")[0] } : { old: "", new: "" };

  return (
    <div className="console-shell">
      <header className="console-header">
        <div className="brand-lockup">
          <BrandMark />
          <div><h1>TruthTrace</h1><p>Evidence intelligence</p></div>
        </div>
        <div className="console-controls">
          {demo && activeScenario && (
            <label className="scenario-control">
              <span>Investigation</span>
              <select value={scenarioId} onChange={(e) => selectScenario(e.target.value)} aria-label="Demo scenario">
                {(demo.scenarios || []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
              </select>
            </label>
          )}
          {demo && (
            <div className="version-controls" aria-label="Source document versions">
              <label><span>Previous</span><select value={oldSel} onChange={(e) => pick(setOldSel, setOldText)(e.target.value)}>
                {demo.documents.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
                {oldSel === "custom" && <option value="custom">Custom source</option>}
              </select></label>
              <span className="version-arrow">→</span>
              <label><span>Current</span><select value={newSel} onChange={(e) => pick(setNewSel, setNewText)(e.target.value)}>
                {demo.documents.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
                {newSel === "custom" && <option value="custom">Custom source</option>}
              </select></label>
            </div>
          )}
          <button onClick={analyze} disabled={!demo || busy} className="analyze-button">
            {busy ? <span className="analyze-pulse" /> : <span className="analyze-icon">↗</span>}
            {busy ? "Analyzing" : "Run analysis"}
            <kbd>Ctrl/⌘ ↵</kbd>
          </button>
        </div>
      </header>

      <div className="console-subheader">
        <nav className="workspace-nav" aria-label="Investigation views">
          {VIEWS.map(([id, label], index) => (
            <button key={id} onClick={() => setView(id)} aria-current={view === id}
              className={view === id ? "workspace-nav-active" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>{label}
            </button>
          ))}
        </nav>
        <div className="connection-state" title={health ? `Backend connected · ${health.llm_configured ? "AI rephrasing enabled" : "deterministic analysis"}` : "Backend unreachable"}>
          <i className={health ? "connection-online" : health === false ? "connection-offline" : ""} />
          {health ? "Engine connected" : health === false ? "Engine offline" : "Connecting"}
        </div>
      </div>

      <main className="console-content">
        {activeScenario && (
          <div className="scenario-heading">
            <div><span className="scenario-kicker">ACTIVE INVESTIGATION</span><h2>{activeScenario.name}</h2></div>
            <p>{activeScenario.description}</p>
            {stale && <span className="stale-indicator">Sources changed · analysis required</span>}
          </div>
        )}

        {error && <div className="console-error" role="alert">{error}</div>}
        {!demo && !error && <div className="console-loading"><span className="analyze-pulse" />Loading investigation data…</div>}

        {metrics && (
          <div className="signal-strip">
            <span className="signal-intro">Analysis signals</span>
            <span><b className="signal-outdated">{metrics.outdated}</b> answers outdated</span>
            <span><b className="signal-review">{metrics.review}</b> need review</span>
            <span><b className="signal-stable">{metrics.unaffected}</b> unaffected</span>
            <span className="signal-last">{metrics.changed} of {metrics.totalFacts} facts changed</span>
          </div>
        )}

        {result && view === "graph" && (
          <>
            <Graph result={result} titles={titles} sel={sel} onPickFact={pickFact} onPickAnswer={pickAnswer} />
            <Inspector result={result} stored={answerSet} selId={sel.answerId} selFact={sel.factKey} onPickAnswer={pickAnswer} />
          </>
        )}
        {demo && view === "compare" && (
          <div className="secondary-view">
            {result ? <Compare result={result} texts={analyzed} titles={titles} selKey={sel.factKey} onPick={pickFact} />
              : <p className="view-placeholder">Run the analysis to inspect the document diff.</p>}
            {result && <Inspector result={result} stored={answerSet} selId={sel.answerId} selFact={sel.factKey} onPickAnswer={pickAnswer} />}
          </div>
        )}
        {demo && view === "sources" && (
          <div className="secondary-view">
            <Sources demo={demo} answers={answerSet}
              old={{ selected: oldSel, onSelect: pick(setOldSel, setOldText), text: oldText, setText: setOldText, onUpload: upload(setOldSel, setOldText) }}
              neu={{ selected: newSel, onSelect: pick(setNewSel, setNewText), text: newText, setText: setNewText, onUpload: upload(setNewSel, setNewText) }} />
            {result && <Inspector result={result} stored={answerSet} selId={sel.answerId} selFact={sel.factKey} onPickAnswer={pickAnswer} />}
          </div>
        )}
      </main>
      <footer className="console-footer"><span>TRUTHTRACE <i /> EVIDENCE INTELLIGENCE CONSOLE</span><span>Hover a connection to trace its evidence path</span></footer>
    </div>
  );
}
