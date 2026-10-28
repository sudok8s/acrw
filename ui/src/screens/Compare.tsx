import { useEffect, useState } from "react";
import { Icon } from "../icons";
import { useStore } from "../store";

/** base...target picker in the context bar. */
export function CompareControl() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [base, setBase] = useState(s.review?.base ?? "");
  const [target, setTarget] = useState(s.review?.target ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !s.review) return;
    setBase(s.review.base);
    setTarget(s.review.target);
    s.api.listBranches(s.review.project_id).then((b) => setBranches(b.branches)).catch(() => setBranches([]));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!s.review) return null;
  const apply = async () => {
    if (!s.review) return;
    setBusy(true);
    const ok = await s.openReview(s.review.project_id, base, target);
    setBusy(false);
    if (ok) setOpen(false);
  };
  return (
    <div className="pop-anchor">
      <button className="cw-rev" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`Change comparison, currently ${s.review.base}...${s.review.target}`}>
        <Icon name="branch" />{s.review.base}...{s.review.target}<Icon name="chevronDown" />
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Compare revisions" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <span className="cw-panel-title">Compare revisions</span>
          <label className="fld"><span className="caption">Base</span>
            <select className="input" value={base} onChange={(e) => setBase(e.target.value)}>
              {[...new Set([base, ...branches])].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="fld"><span className="caption">Target</span>
            <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
              {[...new Set([target, ...branches])].map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <span className="caption">Three-dot comparison: changes on the target since its merge base with the base. Any commit-ish works.</span>
          <div className="pop-actions">
            <button className="cw-btn cw-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="cw-btn cw-btn-sm cw-btn-primary" onClick={apply} disabled={busy || !base || !target || base === target}>{busy ? "Opening…" : "Compare"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
