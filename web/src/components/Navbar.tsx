import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { useAuth } from "../auth";
import { useTasks } from "../tasks";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const { tasks, activeKey } = useTasks();

  const activeTask = activeKey
    ? tasks.find((t) => t.key === activeKey)
    : undefined;
  const resumeHref =
    activeTask &&
    (activeTask.status === "fetched"
      ? `/playlist/${encodeURIComponent(activeTask.key)}`
      : `/match/${encodeURIComponent(activeTask.key)}`);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      isActive
        ? "bg-slate-700 text-white"
        : "text-slate-300 hover:text-white hover:bg-slate-700/60"
    }`;

  return (
    <header className="sticky top-0 z-10 border-b border-slate-700 bg-slate-800/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <NavLink to="/" className="text-lg font-bold tracking-tight text-white">
          nq2am
        </NavLink>

        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkClass}>
            {t("nav.fetch")}
          </NavLink>
          <NavLink to="/tasks" className={linkClass}>
            {t("nav.tasks")}
            {tasks.length > 0 && (
              <span className="ml-1.5 rounded-full bg-slate-600 px-1.5 py-0.5 text-[10px] text-slate-200">
                {tasks.length}
              </span>
            )}
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            {t("nav.settings")}
          </NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {activeTask && resumeHref && (
            <NavLink
              to={resumeHref}
              className="hidden max-w-[180px] items-center gap-1.5 truncate rounded-md bg-slate-700/60 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 sm:flex"
              title={`Resume: ${activeTask.name ?? "playlist"}`}
            >
              <span className="text-slate-400">{t("nav.resume")}</span>
              <span className="truncate">{activeTask.name ?? "playlist"}</span>
            </NavLink>
          )}
          <LanguageSwitcher />
          <StatusDot label="QQ" connected={status?.qq === true} />
          <StatusDot label="NetEase" connected={status?.netease === true} />
          <StatusDot label="Apple" connected={status?.apple === true} />
        </div>
      </div>
    </header>
  );
}

function StatusDot({ label, connected }: { label: string; connected: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-300">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          connected ? "bg-green-400" : "bg-slate-500"
        }`}
        aria-label={connected ? t("status.connected") : t("status.disconnected")}
      />
      <span>{label}</span>
    </div>
  );
}
