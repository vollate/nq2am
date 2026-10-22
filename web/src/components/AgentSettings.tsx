import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { AgentSettingsView } from "../types";

export default function AgentSettings() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useState<AgentSettingsView | null>(null);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api.getAgentSettings().then((next) => {
      if (!active) return;
      setSettings(next); setBaseUrl(next.baseUrl); setModel(next.model);
    }).catch((error: Error) => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, []);
  async function act(action: "save" | "clear" | "test") {
    setBusy(true); setMessage("");
    const form = { baseUrl, model, ...(apiKey ? { apiKey } : {}) };
    try {
      if (action === "test") {
        const result = await api.testAgentSettings(form);
        setMessage(result.supported ? t("agent.testOk", { ms: result.durationMs }) : t("agent.testFailed", { error: result.error }));
      } else {
        const next = await api.putAgentSettings(action === "clear" ? { apiKey: null } : form);
        setSettings(next); setApiKey(""); setMessage(t(action === "clear" ? "agent.cleared" : "agent.saved"));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const inputClass = "w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100";
  return <section className="space-y-4 rounded-lg border border-slate-700 bg-slate-800 p-4">
    <h2 className="text-lg font-semibold text-white">{t("agent.title")}</h2>
    <p className="text-sm text-slate-400">{t("agent.warning")}</p>
    <fieldset disabled={busy || !settings} className="space-y-3 disabled:opacity-60">
      <label className="block text-sm text-slate-300">{t("agent.baseUrl")}<input className={inputClass} type="url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></label>
      <label className="block text-sm text-slate-300">{t("agent.model")}<input className={inputClass} value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" /></label>
      <label className="block text-sm text-slate-300">{t("agent.apiKey")}<input className={inputClass} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" placeholder={t(settings?.hasApiKey ? "agent.keySaved" : "agent.keyOptional")} /></label>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded bg-indigo-500 px-3 py-2 text-white" onClick={() => void act("save")}>{t("agent.save")}</button>
        <button type="button" className="rounded bg-slate-700 px-3 py-2 text-white" onClick={() => void act("clear")}>{t("agent.clear")}</button>
        <button type="button" disabled={!model.trim()} className="rounded bg-slate-700 px-3 py-2 text-white disabled:opacity-50" onClick={() => void act("test")}>{t("agent.test")}</button>
      </div>
    </fieldset>
    <p className="text-xs text-amber-200">{t("agent.billing")}</p>
    {message && <p role="status" className="break-words text-sm text-slate-200">{message}</p>}
  </section>;
}
