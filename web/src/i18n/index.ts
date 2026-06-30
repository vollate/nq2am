import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enFetch from "./locales/en/fetch.json";
import enMatch from "./locales/en/match.json";
import enPlaylist from "./locales/en/playlist.json";
import enSettings from "./locales/en/settings.json";
import enTasks from "./locales/en/tasks.json";
import zhCommon from "./locales/zh/common.json";
import zhFetch from "./locales/zh/fetch.json";
import zhMatch from "./locales/zh/match.json";
import zhPlaylist from "./locales/zh/playlist.json";
import zhSettings from "./locales/zh/settings.json";
import zhTasks from "./locales/zh/tasks.json";

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const STORAGE_KEY = "nq2am.lang";

export const resources = {
  en: {
    common: enCommon,
    fetch: enFetch,
    tasks: enTasks,
    match: enMatch,
    settings: enSettings,
    playlist: enPlaylist,
  },
  zh: {
    common: zhCommon,
    fetch: zhFetch,
    tasks: zhTasks,
    match: zhMatch,
    settings: zhSettings,
    playlist: zhPlaylist,
  },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // navigator → zh-CN maps to "zh"; everything else falls back to "en".
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    load: "languageOnly",
    ns: ["common", "fetch", "tasks", "match", "settings", "playlist"],
    defaultNS: "common",
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: STORAGE_KEY,
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
