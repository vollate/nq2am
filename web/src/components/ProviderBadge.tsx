import type { MusicProvider } from "../types";

type Props = {
  provider: MusicProvider;
  className?: string;
};

const BADGE_STYLES: Record<MusicProvider, { styles: string; label: string }> = {
  qq: { styles: "bg-green-600/20 text-green-300 ring-green-500/40", label: "QQ Music" },
  netease: { styles: "bg-red-600/20 text-red-300 ring-red-500/40", label: "NetEase" },
  apple: { styles: "bg-pink-600/20 text-pink-300 ring-pink-500/40", label: "Apple Music" },
};

export default function ProviderBadge({ provider, className = "" }: Props) {
  const { styles, label } = BADGE_STYLES[provider];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${styles} ${className}`}
    >
      {label}
    </span>
  );
}
