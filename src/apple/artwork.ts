import { chromium } from "playwright";
import type { AppleCandidate, NormalizedTrack } from "../types.js";

type ArtworkFeature = {
  hash: number[];
  avg: [number, number, number];
};

type CandidateSimilarity = {
  candidate: AppleCandidate;
  similarity: number;
};

const FEATURE_SIZE = 16;
const FETCH_TIMEOUT_MS = 8_000;
const MIN_SIMILARITY = 0.74;
const MIN_SIMILARITY_MARGIN = 0.08;

/**
 * Pick a candidate by album-cover similarity, but only when the cover result is
 * decisive. This is a best-effort tie-breaker: any image/network failure
 * returns undefined so the caller can keep its existing ambiguous result.
 */
export async function chooseByCoverSimilarity(
  track: NormalizedTrack,
  candidates: AppleCandidate[]
): Promise<CandidateSimilarity | undefined> {
  if (!track.albumCoverUrl || candidates.length < 2) {
    return undefined;
  }

  const comparable = candidates.filter((c) => c.artworkUrl);
  if (comparable.length < 2) {
    return undefined;
  }

  try {
    const urls = [track.albumCoverUrl, ...comparable.map((c) => c.artworkUrl as string)];
    const dataUrls = await Promise.all(urls.map(loadImageDataUrl));
    if (dataUrls.some((url) => !url)) {
      return undefined;
    }

    const features = await extractFeatures(dataUrls as string[]);
    const source = features[0];
    if (!source) {
      return undefined;
    }

    const scored = comparable
      .map((candidate, index) => {
        const feature = features[index + 1];
        return feature
          ? {
              candidate,
              similarity: compareFeatures(source, feature)
            }
          : undefined;
      })
      .filter((item): item is CandidateSimilarity => item !== undefined)
      .sort((a, b) => b.similarity - a.similarity);

    const best = scored[0];
    const second = scored[1];
    if (!best || !second) {
      return undefined;
    }
    if (best.similarity < MIN_SIMILARITY) {
      return undefined;
    }
    if (best.similarity - second.similarity < MIN_SIMILARITY_MARGIN) {
      return undefined;
    }

    return best;
  } catch {
    return undefined;
  }
}

async function loadImageDataUrl(url: string): Promise<string | undefined> {
  if (url.startsWith("data:")) {
    return url;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "nq2am/0.1"
      }
    });
    if (!res.ok) {
      return undefined;
    }

    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    if (!contentType.startsWith("image/")) {
      return undefined;
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function extractFeatures(dataUrls: string[]): Promise<(ArtworkFeature | undefined)[]> {
  const svgFeatures = dataUrls.map(featureFromSvgDataUrl);
  if (svgFeatures.every((feature) => feature !== undefined)) {
    return svgFeatures;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    return await page.evaluate(
      async ({ urls, size }) => {
        function loadImage(src: string): Promise<HTMLImageElement> {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("image decode failed"));
            img.src = src;
          });
        }

        async function featureFor(src: string) {
          try {
            const img = await loadImage(src);
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (!ctx) return undefined;

            ctx.drawImage(img, 0, 0, size, size);
            const pixels = ctx.getImageData(0, 0, size, size).data;
            const luminance: number[] = [];
            let r = 0;
            let g = 0;
            let b = 0;
            const pixelCount = size * size;

            for (let i = 0; i < pixels.length; i += 4) {
              const pr = pixels[i];
              const pg = pixels[i + 1];
              const pb = pixels[i + 2];
              r += pr;
              g += pg;
              b += pb;
              luminance.push(0.299 * pr + 0.587 * pg + 0.114 * pb);
            }

            const avgLum = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
            return {
              hash: luminance.map((value) => (value >= avgLum ? 1 : 0)),
              avg: [r / pixelCount, g / pixelCount, b / pixelCount] as [number, number, number]
            };
          } catch {
            return undefined;
          }
        }

        return Promise.all(urls.map(featureFor));
      },
      { urls: dataUrls, size: FEATURE_SIZE }
    );
  } finally {
    await page.close();
    await browser.close();
  }
}

function featureFromSvgDataUrl(dataUrl: string): ArtworkFeature | undefined {
  if (!dataUrl.startsWith("data:image/svg+xml")) {
    return undefined;
  }

  const comma = dataUrl.indexOf(",");
  if (comma === -1) {
    return undefined;
  }

  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const svg = meta.includes(";base64") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body);
  const fill = svg.match(/\bfill=["']([^"']+)["']/i)?.[1];
  const rgb = fill ? parseColor(fill) : undefined;
  if (!rgb) {
    return undefined;
  }

  return {
    hash: Array.from({ length: FEATURE_SIZE * FEATURE_SIZE }, () => 1),
    avg: rgb
  };
}

function parseColor(color: string): [number, number, number] | undefined {
  const normalized = color.trim().toLowerCase();
  const named: Record<string, [number, number, number]> = {
    black: [0, 0, 0],
    blue: [0, 0, 255],
    green: [0, 128, 0],
    red: [255, 0, 0],
    white: [255, 255, 255],
    yellow: [255, 255, 0]
  };
  if (named[normalized]) {
    return named[normalized];
  }

  const hex = normalized.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    return [
      Number.parseInt(value.slice(0, 2), 16),
      Number.parseInt(value.slice(2, 4), 16),
      Number.parseInt(value.slice(4, 6), 16)
    ];
  }

  const rgb = normalized.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (rgb) {
    const values = rgb.slice(1).map((v) => Number.parseInt(v, 10));
    if (values.every((v) => v >= 0 && v <= 255)) {
      return [values[0], values[1], values[2]];
    }
  }

  return undefined;
}

function compareFeatures(a: ArtworkFeature, b: ArtworkFeature): number {
  const hashSimilarity =
    a.hash.reduce((matches, bit, index) => matches + (bit === b.hash[index] ? 1 : 0), 0) / a.hash.length;

  const colorDistance = Math.sqrt((a.avg[0] - b.avg[0]) ** 2 + (a.avg[1] - b.avg[1]) ** 2 + (a.avg[2] - b.avg[2]) ** 2);
  const colorSimilarity = Math.max(0, 1 - colorDistance / (Math.sqrt(3) * 255));

  return hashSimilarity * 0.6 + colorSimilarity * 0.4;
}
