import { recordingTextSimilarity } from "./recordingMetadata.js";

const DASH_CHARACTER_CLASS = "[-‐‑‒–—]";
const FEATURED_ARTIST_LABEL_PATTERN = String.raw`(?:feat(?:uring)?|ft)\.?\s+.+`;
const PERFORMANCE_CREDIT_ABBREVIATION_PATTERN = "(?:vo|cho|gt|ba|dr|key|pf|syn|sax|vn|vla|vc|cb|tp|tb|fl|harp|perc)";
const PERFORMANCE_CREDIT_LABEL_PATTERN = String.raw`${PERFORMANCE_CREDIT_ABBREVIATION_PATTERN}\.?\s*[：:]\s*.+`;
const TITLE_VERSION_LABEL_PATTERN = [
  String.raw`(?:\d{4}\s+)?remaster(?:ed|d)?(?:\s+(?:\d{4}|version))?`,
  String.raw`remixed\s+by\s+.+`,
  String.raw`(?:[^-‐‑‒–—]{1,40}\s+)?(?:remix|mix|bootleg)`,
  String.raw`from\s+the\s+first\s+take`,
  String.raw`(?:radio|single|album|original|acoustic|instrumental|karaoke|movie|tv|extended|club|mono|stereo|clean|explicit)\s+(?:edit|mix|version|size)`,
  String.raw`live(?:\s+(?:at|from)\s+.+)?`,
  String.raw`(?:acoustic|instrumental|inst\.?|karaoke|off\s+vocal|cover|demo|edit|mix|version|sped\s+up|slowed(?:\s*(?:&|and)\s*reverb)?|nightcore)`,
  `(?:リマスター(?:版)?|リミックス(?:版)?|インスト(?:ゥルメンタル)?(?:版)?|オフボーカル|カラオケ(?:版)?|ライブ(?:版)?|アコースティック(?:版)?|カバー(?:版)?|デモ(?:版)?|tvサイズ)`,
  `(?:重制版|重製版|混音版|伴奏(?:版)?|纯音乐(?:版)?|純音樂(?:版)?|现场版|現場版|不插电版|不插電版|翻唱版|试听版|試聽版|电视版|電視版|电影版|電影版)`
].join("|");
const ALBUM_RELEASE_TYPE_LABEL_PATTERN = String.raw`(?:single|maxi\s+single|e\.?\s*p\.?)`;
const ALBUM_EDITION_LABEL_PATTERN = [
  String.raw`(?:super\s+)?deluxe(?:\s+(?:edition|version))?`,
  String.raw`(?:the\s+)?(?:special|expanded|extended|complete|selected|limited|standard|digital|international|japanese|bonus(?:\s+track)?|encore|tour)\s+(?:edition|version)`,
  String.raw`(?:(?:\d+(?:st|nd|rd|th)|first|second|third|fourth|fifth|tenth)\s+)?anniversary(?:\s+(?:edition|version))?`,
  String.raw`(?:definitive\s+)?(?:expanded\s+)?(?:\d{4}\s+)?remaster(?:ed|d)?(?:\s+(?:\d{4}|edition|version))?`,
  `(?:repackage|remixes?)`,
  `(?:初回限定盤|初回盤|通常盤|期間生産限定盤|完全生産限定盤|限定盤|特別盤|豪華盤|リマスター盤|再発盤|デラックス(?:・?エディション)?|スペシャル(?:・?エディション)?)`,
  `(?:豪华版|豪華版|特别版|特別版|纪念版|紀念版|重制版|重製版|完整版|加长版|加長版|精选版|精選版|限定版|普通版|数字版|數位版)`
].join("|");

const TITLE_FEATURE_CREDIT_SUFFIX_RE = new RegExp(
  String.raw`(?:\s+|\s*${DASH_CHARACTER_CLASS}\s*)${FEATURED_ARTIST_LABEL_PATTERN}\s*$`,
  "iu"
);
const TITLE_PERFORMANCE_CREDIT_SUFFIX_RE = new RegExp(
  String.raw`(?:\s+|\s*${DASH_CHARACTER_CLASS}\s*)${PERFORMANCE_CREDIT_LABEL_PATTERN}\s*$`,
  "iu"
);
const TITLE_VERSION_SUFFIX_RE = new RegExp(
  String.raw`\s*${DASH_CHARACTER_CLASS}\s*(?:${TITLE_VERSION_LABEL_PATTERN})\s*$`,
  "iu"
);
const ALBUM_DASH_RELEASE_TYPE_SUFFIX_RE = new RegExp(
  String.raw`\s*${DASH_CHARACTER_CLASS}\s*(?:${ALBUM_RELEASE_TYPE_LABEL_PATTERN})\s*$`,
  "iu"
);
const ALBUM_DASH_EDITION_SUFFIX_RE = new RegExp(
  String.raw`\s*${DASH_CHARACTER_CLASS}\s*(?:${ALBUM_EDITION_LABEL_PATTERN})\s*$`,
  "iu"
);
const ALBUM_BRACKETED_DOMAIN_SUFFIX_RE = new RegExp(
  String.raw`\s*[（(［[【]\s*(?:${ALBUM_RELEASE_TYPE_LABEL_PATTERN}|${ALBUM_EDITION_LABEL_PATTERN})\s*[）)］\]】]\s*$`,
  "iu"
);
const ALBUM_BRACKETED_FEATURE_CREDIT_SUFFIX_RE = new RegExp(
  String.raw`\s*(?:${DASH_CHARACTER_CLASS}\s*)?[（(［[【]\s*${FEATURED_ARTIST_LABEL_PATTERN}\s*[）)］\]】]\s*$`,
  "iu"
);

const TITLE_BRACKET_PAIRS = new Map<string, string>([
  ["(", ")"],
  ["（", "）"],
  ["[", "]"],
  ["［", "］"]
]);

type TitleBracketRange = {
  start: number;
  end: number;
};

function normalizeDomainWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function removeTrailingDomainParts(value: string, suffixPatterns: readonly RegExp[]): string {
  let normalized = normalizeDomainWhitespace(value);

  while (normalized) {
    let changed = false;
    for (const suffixPattern of suffixPatterns) {
      const stripped = normalizeDomainWhitespace(normalized.replace(suffixPattern, ""));
      if (stripped && stripped !== normalized) {
        normalized = stripped;
        changed = true;
      }
    }
    if (!changed) return normalized;
  }

  return normalized;
}

function removeBracketedTitleParts(title: string): string {
  const stack: Array<{ start: number; closingBracket: string }> = [];
  const ranges: TitleBracketRange[] = [];

  for (let index = 0; index < title.length; index += 1) {
    const character = title[index];
    const closingBracket = TITLE_BRACKET_PAIRS.get(character);
    if (closingBracket) {
      stack.push({ start: index, closingBracket });
      continue;
    }

    const openBracket = stack.at(-1);
    if (openBracket && character === openBracket.closingBracket) {
      stack.pop();
      ranges.push({ start: openBracket.start, end: index });
    }
  }

  if (ranges.length === 0) {
    return title;
  }

  const mergedRanges: TitleBracketRange[] = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const previous = mergedRanges.at(-1);
    if (!previous || range.start > previous.end) {
      mergedRanges.push({ ...range });
    } else {
      previous.end = Math.max(previous.end, range.end);
    }
  }

  const titleParts: string[] = [];
  let cursor = 0;
  for (const range of mergedRanges) {
    titleParts.push(title.slice(cursor, range.start));
    cursor = range.end + 1;
  }
  titleParts.push(title.slice(cursor));

  return titleParts.join(" ").replace(/\s+/gu, " ").trim();
}

/**
 * Remove every round/square-bracketed part and trailing feat., performer-credit,
 * and version suffixes so title comparison sees only the core title. Version
 * semantics are judged separately, so they are not lost here.
 */
export function stripTitleAnnotations(title: string): string {
  const stripped = removeTrailingDomainParts(removeBracketedTitleParts(title), [
    TITLE_FEATURE_CREDIT_SUFFIX_RE,
    TITLE_PERFORMANCE_CREDIT_SUFFIX_RE,
    TITLE_VERSION_SUFFIX_RE
  ]);
  return stripped || normalizeDomainWhitespace(title);
}

/** Remove trailing release-type, edition, and featured-artist suffixes from an album name. */
export function stripAlbumAnnotations(album: string): string {
  const stripped = removeTrailingDomainParts(album, [
    ALBUM_BRACKETED_FEATURE_CREDIT_SUFFIX_RE,
    ALBUM_DASH_RELEASE_TYPE_SUFFIX_RE,
    ALBUM_DASH_EDITION_SUFFIX_RE,
    ALBUM_BRACKETED_DOMAIN_SUFFIX_RE
  ]);
  return stripped || normalizeDomainWhitespace(album);
}

/** Levenshtein-based similarity of two titles after their annotations are stripped. */
export function titleTextSimilarity(left: string, right: string): number {
  return recordingTextSimilarity(stripTitleAnnotations(left), stripTitleAnnotations(right));
}
