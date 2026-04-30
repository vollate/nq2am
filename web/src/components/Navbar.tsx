import { useEffect, useState } from "react";
import { NavLink } from "react-router";
import { api } from "../api";
import type { AuthStatus } from "../types";

export default function Navbar() {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuthStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        // ignore; settings page will surface errors
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            Fetch
          </NavLink>
          <NavLink to="/settings" className={linkClass}>
            Settings
          </NavLink>
        </nav>

        <div className="flex items-center gap-3">
          <StatusDot
            label="QQ"
            connected={status?.qq === true}
          />
          <StatusDot
            label="NetEase"
            connected={status?.netease === true}
          />
          <StatusDot
            label="Apple"
            connected={status?.apple === true}
          />
        </div>
      </div>
    </header>
  );
}

function StatusDot({ label, connected }: { label: string; connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-300">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          connected ? "bg-green-400" : "bg-slate-500"
        }`}
        aria-label={connected ? "connected" : "disconnected"}
      />
      <span>{label}</span>
    </div>
  );
}
