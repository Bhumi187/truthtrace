function Doc({ side, docs, selected, onSelect, text, setText, onUpload }) {
  return (
    <section className="min-w-0 border border-line rounded-md bg-panel">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-line">
        <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${side === "old" ? "bg-rose/12 text-rose" : "bg-cyan/12 text-cyan"}`}>{side === "old" ? "v1" : "v2"}</span>
        <select value={selected} onChange={(e) => onSelect(e.target.value)}
          className="bg-raise border border-line rounded px-2 py-1 text-[13px] max-w-[60%] truncate">
          {docs.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
          {selected === "custom" && <option value="custom">custom / uploaded</option>}
        </select>
        <label className="ml-auto text-[12px] text-mute hover:text-text cursor-pointer transition-colors">
          Upload PDF or text
          <input type="file" accept=".pdf,.txt" className="sr-only" onChange={(e) => { if (e.target.files[0]) onUpload(e.target.files[0]); e.target.value = ""; }} />
        </label>
      </header>
      <textarea value={text} onChange={(e) => { setText(e.target.value); onSelect("custom"); }} spellCheck={false}
        className="w-full h-64 bg-transparent p-3 font-mono text-[12px] leading-5 text-mute resize-y focus:text-text outline-none" />
    </section>
  );
}

export default function Sources({ demo, old, neu, answers }) {
  return (
    <div className="p-5 space-y-5">
      <div className="grid gap-4 2xl:grid-cols-2">
        <Doc side="old" docs={demo.documents} {...old} />
        <Doc side="new" docs={demo.documents} {...neu} />
      </div>
      <section className="border border-line rounded-md bg-panel">
        <h3 className="px-3 py-2 text-[13px] border-b border-line">Stored answers and their evidence dependencies</h3>
        {answers.map((a) => (
          <div key={a.id} className="px-3 py-3 border-b border-line last:border-0 text-[13px]">
            <p className="font-medium">{a.question}</p>
            <p className="text-mute">{a.answer}</p>
            {a.depends_on.map((d) => (
              <p key={d.fact_key} className="mt-1 text-[12px] text-dim">
                <span className="font-mono text-violet">{d.fact_key}</span> ← line {d.evidence.line} of {d.evidence.doc}: “{d.evidence.text}”
              </p>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
