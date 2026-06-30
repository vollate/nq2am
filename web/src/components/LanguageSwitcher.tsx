import { useTranslation } from "react-i18next";
import { type Language, SUPPORTED_LANGUAGES } from "../i18n";

/** Compact language toggle for the navbar. */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = (
    SUPPORTED_LANGUAGES.includes(i18n.resolvedLanguage as Language)
      ? i18n.resolvedLanguage
      : "en"
  ) as Language;

  return (
    <select
      value={current}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      aria-label={t("language.label")}
      className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
    >
      {SUPPORTED_LANGUAGES.map((lng) => (
        <option key={lng} value={lng}>
          {t(`language.${lng}`)}
        </option>
      ))}
    </select>
  );
}
