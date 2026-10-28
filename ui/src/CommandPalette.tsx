import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { useStore, type Screen } from "./store";

interface Item { group: string; label: string; hint?: string; icon: IconName; run: () => void }

export function CommandPalette() {
  const s = useStore();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const go = (id: Screen, label: string, icon: IconName): Item => ({ group: "Go to", label, icon, run: () => s.go(id) });
    const out: Item[] = [
      go("overview", "Overview", "overview"), go("projects", "Projects", "projects"), go("review", "Review workspace", "review"),
      { group: "Go to", label: "Source → sink explorer", icon: "flow", run: () => s.openFlow(s.flowFindingId) },
      go("findings", "Findings", "findings"), go("scans", "Scans", "scans"), go("settings", "Settings", "settings"),
    ];
    (s.files ?? []).forEach((f) => out.push({ group: "Files in this review", label: f.path.slice(f.path.lastIndexOf("/") + 1), hint: f.path, icon: "file", run: () => s.openFile(f.path) }));
    s.findings.forEach((f) => out.push({
      group: "Findings", label: `#${f.id} ${f.title}`, hint: `${f.file}:${f.line}`, icon: "findings",
      run: () => (s.reviewFindings.some((x) => x.id === f.id) ? (s.go("review"), s.selectFinding(f.id, true)) : s.showFindings({ selId: f.id, status: "all", scope: "all", scanner: "all" })),
    }));
    out.push(
      { group: "Actions", label: "Start scan…", icon: "play", run: () => s.showScan(null, true) },
      { group: "Actions", label: "Toggle diff mode", hint: s.settings?.default_diff_mode === "split" ? "to unified" : "to side-by-side", icon: "split",
        run: () => { s.updateSettings({ default_diff_mode: s.settings?.default_diff_mode === "split" ? "unified" : "split" }); s.setPaletteOpen(false); } },
    );
    return out;
  }, [s]);

  const ql = q.trim().toLowerCase();
  const hits = items.filter((i) => !ql || `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(ql)).slice(0, 60);
  const groups = [...new Set(hits.map((h) => h.group))];
  const ordered = groups.flatMap((g) => hits.filter((h) => h.group === g).slice(0, ql ? 12 : 6));
  useEffect(() => setIdx(0), [q]);
  const run = (i: Item | undefined) => { if (!i) return; i.run(); s.setPaletteOpen(false); };

  return (
    <div className="scrim" onMouseDown={() => s.setPaletteOpen(false)}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pal-in">
          <Icon name="search" style={{ color: "#92949D" }} />
          <label className="sr" htmlFor="pal-input">Search commands, files and findings</label>
          <input id="pal-input" ref={input} placeholder="Go to, open file, finding, action…" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") s.setPaletteOpen(false);
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx(Math.min(ordered.length - 1, idx + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx(Math.max(0, idx - 1)); }
              if (e.key === "Enter") { e.preventDefault(); run(ordered[idx]); }
            }} />
          <kbd className="cw-kbd">Esc</kbd>
        </div>
        <div className="pal-list" role="listbox">
          {groups.map((g) => (
            <div key={g}>
              <div className="label pal-group">{g}</div>
              {ordered.filter((h) => h.group === g).map((h) => {
                const i = ordered.indexOf(h);
                return (
                  <button key={g + h.label + (h.hint ?? "")} role="option" aria-selected={i === idx} className={"pal-item" + (i === idx ? " first" : "")} onMouseEnter={() => setIdx(i)} onClick={() => run(h)}>
                    <Icon name={h.icon} /><span>{h.label}</span>{h.hint && <span className="pal-hint">{h.hint}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!ordered.length && <div className="caption" style={{ padding: 12 }}>Nothing matches “{q}”.</div>}
        </div>
        <div className="pal-foot"><span><kbd className="cw-kbd">↑↓</kbd> move</span><span><kbd className="cw-kbd">↵</kbd> run</span><span className="spacer" /><span>In review: J / K signals · [ / ] files · R mark file reviewed</span></div>
      </div>
    </div>
  );
}
