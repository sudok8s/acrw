// Small shared building blocks that follow the ACRW component styles.
import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { SEV_LABEL, SEV_RANK, type Severity } from "./types";

export function SevBadge({ sev }: { sev: Severity }) {
  const bars = 4 - SEV_RANK[sev];
  return (
    <span className={`cw-sev cw-sev-${sev}`} title="Severity (scanner or rule estimate)">
      <span className="cw-sev-bars" aria-hidden>
        {[0, 1, 2, 3].map((i) => <i key={i} className={i < bars ? "on" : ""} />)}
      </span>
      {SEV_LABEL[sev]}
    </span>
  );
}

const STATUS_CLS: Record<string, string> = {
  "New": "cw-status-new", "Needs investigation": "cw-status-investigating", "Confirmed": "cw-status-confirmed",
  "False positive": "cw-status-false-positive", "Accepted risk": "cw-status-accepted-risk", "Fixed": "cw-status-fixed",
  "Reviewed — no issue": "cw-status-fixed",
};
export function StatusTag({ status }: { status: string }) {
  return <span className={`cw-status ${STATUS_CLS[status] ?? ""}`} title="Workflow status"><span className="st-dot" />{status}</span>;
}

export function Provenance({ scanner, rule }: { scanner: string; rule?: string }) {
  return (
    <span className="cw-signal" title={rule ? `${scanner} · ${rule}` : scanner}>
      <span className="cw-signal-src">{scanner.toLowerCase()}</span>scanner lead
    </span>
  );
}

const SCAN_ST: Record<string, [string, string]> = {
  running: ["Running", "ss-running"], queued: ["Queued", "ss-queued"], completed: ["Completed", "ss-completed"],
  failed: ["Failed", "ss-failed"], cancelled: ["Cancelled", "ss-cancelled"],
};
export function ScanState({ status }: { status: string }) {
  const [label, cls] = SCAN_ST[status] ?? [status, ""];
  return (
    <span className={`scan-state ${cls}`}>
      {(status === "running" || status === "queued") && <Icon name="spinner" size={12} spin />}
      {label}
    </span>
  );
}

export function Banner({ kind = "info", icon, title, children, actions }: { kind?: "info" | "warning" | "danger" | "success"; icon?: IconName; title?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className={`cw-banner cw-banner-${kind}`} role={kind === "danger" ? "alert" : undefined}>
      <Icon name={icon ?? (kind === "success" ? "check" : kind === "info" ? "info" : "alert")} />
      <div>{title && <span className="cw-banner-title">{title} </span>}<span className="cw-banner-body">{children}</span></div>
      {actions && <div className="cw-banner-actions">{actions}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; icon?: IconName; count?: number; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="cw-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={o.value === value} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={12} />}{o.label}{o.count != null && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="cw-switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function IconBtn({ icon, label, onClick, pressed, disabled, small = true }: { icon: IconName; label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; small?: boolean }) {
  return (
    <button className={"cw-iconbtn" + (small ? " cw-iconbtn-sm" : "")} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function SearchField({ value, onChange, placeholder, label, width }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; width?: number }) {
  return (
    <label className="cw-field" style={width ? { width } : undefined}>
      <Icon name="search" />
      <span className="sr">{label}</span>
      <input type="search" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cw-empty">
      <h2 className="cw-empty-title">{title}</h2>
      {children && <p className="cw-empty-body">{children}</p>}
      {action}
    </div>
  );
}

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  const today = new Date();
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today ${hm}`;
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${hm}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + hm;
}

export function fmtDuration(a: number, b: number | null): string {
  if (!b) return "—";
  const s = Math.max(0, b - a);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Heuristic only — paths that usually deserve a security reviewer's attention. */
const SEC_RE = /(auth|login|logout|token|jwt|oauth|session|secret|crypt|password|passwd|perm|role|acl|policy|sql|query|queries|db\/|repositor|payment|refund|billing|upload|download|admin|config|settings|deps|middleware|security|requirements[^/]*\.txt$|package(-lock)?\.json$|pyproject\.toml$|\.csproj$|packages\.lock\.json$|go\.mod$|cargo\.toml$|dockerfile|\.ya?ml$)/i;
export const isSecurityRelevant = (path: string) => SEC_RE.test(path);
