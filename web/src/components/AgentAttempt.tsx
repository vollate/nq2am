import { useTranslation } from "react-i18next";
import type { AppleMatchResult } from "../types";

export default function AgentAttempt({ result }: { result: AppleMatchResult }) {
  const { t } = useTranslation("match");
  const attempt = result.agentAttempt;
  if (!attempt && result.selectionSource !== "agent") return null;
  return <div className="mt-1 max-w-xl break-words text-xs text-violet-200">
    {result.selectionSource === "agent" && <span className="mr-2 rounded bg-violet-500/20 px-1">{t("agent.source")}</span>}
    {attempt && <><span>{t(`agent.states.${attempt.outcome ?? attempt.status}`)}</span>
      {(attempt.reason || attempt.error) && <span> · {attempt.reason ?? attempt.error}</span>}
      {!!attempt.evidence?.length && <div className="text-slate-500">{t("agent.evidence")}: {attempt.evidence.join(", ")}</div>}
    </>}
  </div>;
}
