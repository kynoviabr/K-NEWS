import { XMLParser } from "fast-xml-parser";
import type { FetchResult } from "@/services/rss";

// Parser RSS 2.0 / Atom. Nao executa entidades externas (fast-xml-parser nao resolve DTD).
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

const MAX_ITEMS = 100;

function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number") return String(value).trim() || null;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) return text((value as Record<string, unknown>)["#text"]);
  return null;
}

export function stripHtml(html: string | null): string | null {
  if (!html) return null;
  const out = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return out || null;
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

type Node = Record<string, unknown>;

function atomLink(entry: Node): string | null {
  const links = asArray(entry.link as Node | Node[] | undefined);
  const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return alt ? text(alt["@_href"]) : null;
}

export function parseFeed(xml: string): FetchResult[] {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("Feed com DOCTYPE recusado");
  const doc = parser.parse(xml) as Node;
  const out: FetchResult[] = [];

  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined;
  if (channel) {
    for (const item of asArray(channel.item as Node | Node[] | undefined).slice(0, MAX_ITEMS)) {
      const url = httpUrl(text(item.link)) ?? httpUrl(text(item.guid));
      const title = stripHtml(text(item.title));
      if (!url || !title) continue;
      out.push({
        url,
        title,
        canonical: httpUrl(text(item["atom:link"] && (item["atom:link"] as Node)["@_href"])) ?? null,
        publishedAt: toIso(text(item.pubDate) ?? text(item["dc:date"])),
        summary: stripHtml(text(item.description) ?? text(item["content:encoded"])),
      });
    }
    return out;
  }

  const feed = doc.feed as Node | undefined;
  if (feed) {
    for (const entry of asArray(feed.entry as Node | Node[] | undefined).slice(0, MAX_ITEMS)) {
      const url = httpUrl(atomLink(entry));
      const title = stripHtml(text(entry.title));
      if (!url || !title) continue;
      out.push({
        url,
        title,
        canonical: null,
        publishedAt: toIso(text(entry.published) ?? text(entry.updated)),
        summary: stripHtml(text(entry.summary) ?? text(entry.content)),
      });
    }
    return out;
  }

  throw new Error("Formato de feed nao reconhecido (esperado RSS 2.0 ou Atom)");
}
