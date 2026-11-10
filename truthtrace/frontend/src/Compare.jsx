import { useMemo } from "react";
import { buildSpans, CHANGE } from "./lib";

const MARK = {
  changed: "bg-rose/12 border-b border-rose/70",
  removed: "bg-rose/12 border-b border-rose/70",
  added: "bg-cyan/12 border-b border-cyan/70",
  review: "bg-amber/12 border-b border-amber/70",
  stable: "bg-violet/8 border-b border-violet/40",
};
const WORD = { old: "bg-rose/30 text-rose rounded-[3px] px-0.5", new: "bg-cyan/25 text-cyan rounded-[3px] px-0.5" };
const clean = (s) => s.replace(/\f/g, "");

function Pane({ side, title, text, spans, selKey, onPick }) {
  const lines = useMemo(() => {
    let pos = 0;
    return text.split("\n").map((t, i) => { const s = pos; pos += t.length + 1; return { n: i + 1, s, e: s + t.length }; });
  }, [text]);
  return (
    <section className="min-w-0 border border-line rounded-md bg-panel">
      <header className="flex items-baseline gap-2 px-3 py-2 border-b border-line">
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${side === "old" ? "bg-rose/12 text-rose" : "bg-cyan/12 text-cyan"}`}>{side === "old" ? "v1" : "v2"}</span>
        <span className="truncate text-[13px] text-mute">{title}</span>
        <span className="ml-auto font-mono text-[11px] text-dim">{text.length.toLocaleString()} chars</span>
      </header>
      <div className="py-2 text-[13.5px] leading-[1.7]">
        {lines.map((l) => {
          const sp = spans.filter((x) => x.start >= l.s && x.start <= l.e);
          const parts = []; let cur = l.s;
          sp.forEach((s, k) => {
            if (s.start > cur) parts.push(<span key={"p" + k}>{clean(text.slice(cur, s.start))}</span>);
            const sel = selKey === s.key;
            parts.push(
              <mark key={"m" + k} onClick={() => onPick(s.key)} title={`${s.label}: ${s.display}`}
                className={`cursor-pointer text-text rounded-[3px] px-0.5 transition-colors hover:bg-violet/25 ${MARK[s.kind]} ${sel ? "ring-1 ring-violet !bg-violet/25" : ""}`}>
                {s.tokens ? s.tokens.map((t, i) => <span key={i} className={t.ch ? WORD[side] : ""}>{clean(t.t)}</span>) : clean(text.slice(s.start, Math.min(s.end, l.e)))}
              </mark>
            );
            cur = Math.min(s.end, l.e);
          });
          if (cur < l.e) parts.push(<span key="t">{clean(text.slice(cur, l.e))}</span>);
          return (
            <div key={l.n} className="flex gap-3 px-3">
              <span className="w-5 shrink-0 text-right font-mono text-[11px] leading-[1.9] text-dim select-none">{l.n}</span>
              <p className="min-w-0 whitespace-pre-wrap break-words text-mute">{parts.length ? parts : "\u00a0"}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function Compare({ result, texts, titles, selKey, onPick }) {
  const oldSpans = useMemo(() => buildSpans(result.old_facts, result.diff, "old"), [result]);
  const newSpans = useMemo(() => buildSpans(result.new_facts, result.diff, "new"), [result]);
  const rows = Object.values(result.diff);
  return (
    <div className="p-5 space-y-5">
      <div className="border border-line rounded-md bg-panel overflow-hidden">
        <div className="grid grid-cols-[1.2fr_1fr_1fr_auto] gap-x-4 px-3 py-2 text-[12px] text-dim border-b border-line">
          <span>Fact</span><span>Version 1</span><span>Version 2</span><span className="w-20 text-right">Change</span>
        </div>
        {rows.map((d) => {
          const c = CHANGE[d.change];
          return (
            <button key={d.key} onClick={() => onPick(d.key)}
              className={`w-full grid grid-cols-[1.2fr_1fr_1fr_auto] gap-x-4 px-3 py-2 text-left text-[13px] border-b border-line last:border-0 transition-colors hover:bg-raise ${selKey === d.key ? "bg-raise" : ""}`}>
              <span className="flex items-center gap-2"><i className="w-0.5 h-4 rounded" style={{ background: c.hex }} />{d.label}</span>
              <span className={`truncate ${d.change === "modified" || d.change === "removed" ? "text-rose" : "text-mute"}`}>{d.old ? d.old.display : "—"}</span>
              <span className={`truncate ${d.change === "modified" || d.change === "added" ? "text-cyan" : "text-mute"}`}>{d.new ? d.new.display : "—"}</span>
              <span className={`w-20 text-right text-[12px] ${c.text}`}>{c.label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-mute">
        <span><i className="inline-block w-2.5 h-2.5 mr-1.5 rounded-sm bg-rose/40 align-[-1px]" />changed or removed</span>
        <span><i className="inline-block w-2.5 h-2.5 mr-1.5 rounded-sm bg-cyan/40 align-[-1px]" />added</span>
        <span><i className="inline-block w-2.5 h-2.5 mr-1.5 rounded-sm bg-amber/40 align-[-1px]" />ambiguous</span>
        <span><i className="inline-block w-2.5 h-2.5 mr-1.5 rounded-sm bg-violet/30 align-[-1px]" />unchanged evidence</span>
        <span className="text-dim">Click any highlight to trace it.</span>
      </div>
      <div className="grid gap-4 2xl:grid-cols-2">
        <Pane side="old" title={titles.old} text={texts.old} spans={oldSpans} selKey={selKey} onPick={onPick} />
        <Pane side="new" title={titles.new} text={texts.new} spans={newSpans} selKey={selKey} onPick={onPick} />
      </div>
    </div>
  );
}
