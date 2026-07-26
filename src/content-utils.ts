import type { EvidenceDocument } from "./types";

export const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

export const shortTitle = (title: string, max = 18): string => {
  const chars = Array.from(title.trim());
  if (chars.length <= max) return chars.join("");
  return `${chars.slice(0, max).join("")}…`;
};

export const byNewest = (items: EvidenceDocument[]): EvidenceDocument[] =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.meta.date).getTime();
    const rightTime = new Date(right.meta.date).getTime();
    return rightTime - leftTime;
  });

export const byUpdated = (items: EvidenceDocument[]): EvidenceDocument[] =>
  [...items].sort((left, right) => {
    const leftTime = new Date(left.meta.updated || left.meta.date).getTime();
    const rightTime = new Date(right.meta.updated || right.meta.date).getTime();
    return rightTime - leftTime;
  });

export const normalizeClueSlug = (value: string): string =>
  encodeURIComponent(value.trim().toLowerCase().replace(/\s+/g, "-"));

export const decodeClueSlug = (value: string): string => decodeURIComponent(value);

export const estimateReadLabel = (minutes: number): string =>
  `${Math.max(1, Math.round(minutes))} 分钟`;
