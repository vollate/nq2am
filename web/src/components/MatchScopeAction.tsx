import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MATCH_SCOPES, type MatchRetryScope } from "../../../src/matchFilters";

type Props = {
  scope: MatchRetryScope;
  counts: Record<MatchRetryScope, number>;
  onScopeChange: (scope: MatchRetryScope) => void;
  onAction: () => void;
  scopeLabel: string;
  actionLabel: string;
  title: string;
  disabled: boolean;
  actionDisabled?: boolean;
  tone?: "agent" | "retry";
};

/** Shared scope picker keeps Agent and ordinary Retry groups and behavior identical. */
export default function MatchScopeAction({
  scope, counts, onScopeChange, onAction, scopeLabel, actionLabel, title,
  disabled, actionDisabled = false, tone = "retry",
}: Props) {
  const { t } = useTranslation("match");
  const [open, setOpen] = useState(false);
  const optionsId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (open) options.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [open]);

  return (
    <div className="flex rounded-md border border-slate-600 bg-slate-900 shadow-sm shadow-slate-950/30">
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            trigger.current?.focus();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            if (!open) { setOpen(true); return; }
            const buttons = Array.from(options.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }
        }}
      >
        <button
          ref={trigger}
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
          className="flex min-w-36 items-center justify-between gap-2 rounded-l-md bg-slate-900 px-3 py-2 text-sm font-medium text-slate-100 outline-none transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={scopeLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={optionsId}
        >
          <span className="truncate">{t(`retry.scopes.${scope}`, { count: counts[scope] })}</span>
          <span className={`text-xs text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true">▾</span>
        </button>
        {open && (
          <div
            ref={options}
            id={optionsId}
            role="listbox"
            aria-label={scopeLabel}
            className="absolute left-0 z-30 mt-1 w-52 overflow-hidden rounded-md border border-slate-600 bg-slate-900 py-1 shadow-xl shadow-slate-950/50"
          >
            {MATCH_SCOPES.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={scope === option}
                onClick={() => { onScopeChange(option); setOpen(false); trigger.current?.focus(); }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${scope === option ? "bg-indigo-500/15 text-indigo-100" : "text-slate-200 hover:bg-slate-800 hover:text-white"}`}
              >
                <span className="truncate">{t(`retry.scopes.${option}`, { count: counts[option] })}</span>
                {scope === option && <span className="text-indigo-300" aria-hidden="true">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => { setOpen(false); onAction(); }}
        disabled={disabled || actionDisabled || counts[scope] === 0}
        className={`rounded-r-md border-l border-slate-600 px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone === "agent" ? "bg-violet-600 text-white hover:bg-violet-500" : "bg-slate-700 text-slate-100 hover:bg-slate-600"}`}
        title={title}
      >
        {actionLabel}
      </button>
    </div>
  );
}
