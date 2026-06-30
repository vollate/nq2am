import { useTranslation } from "react-i18next";
import type { MusicProvider } from "../types";

type Props = {
  provider: MusicProvider;
  className?: string;
};

const BADGE_STYLES: Record<MusicProvider, string> = {
  qq: "bg-green-600/20 text-green-300 ring-green-500/40",
  netease: "bg-red-600/20 text-red-300 ring-red-500/40",
  apple: "bg-pink-600/20 text-pink-300 ring-pink-500/40",
};

export default function ProviderBadge({ provider, className = "" }: Props) {
  const { t } = useTranslation();
  const styles = BADGE_STYLES[provider];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles} ${className}`}
    >
      {t(`provider.${provider}`)}
    </span>
  );
}
