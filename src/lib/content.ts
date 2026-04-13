import { getCollection } from "astro:content";

import {
  filterHidden,
  groupByCategory,
  groupByTag,
  sortByUpdatedDesc,
  filterPublic,
  toSearchDocuments,
  type CategoryGroup,
  type EntryType,
  type NormalizedEntry,
  type TagGroup,
} from "./content-model";
import { slugify, stripMarkdown } from "./utils";

function normalizeTextList(values: string[]): { labels: string[]; slugs: string[] } {
  const labels = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  const slugs = labels.map((value) => {
    const slug = slugify(value);
    if (!slug) {
      throw new Error(`Invalid tag value: "${value}"`);
    }
    return slug;
  });

  return { labels, slugs };
}

function assertCategory(category: string): string {
  const slug = slugify(category);
  if (!slug) {
    throw new Error(`Invalid category value: "${category}"`);
  }
  return slug;
}

function toEntryUrl(collection: "articles" | "notes", slug: string): string {
  return collection === "articles" ? `/articles/${slug}/` : `/notes/${slug}/`;
}

async function loadCollectionEntries(
  collection: "articles" | "notes",
): Promise<NormalizedEntry[]> {
  const entries = await getCollection(collection);

  return entries.map((entry) => {
    const categorySlug = assertCategory(entry.data.category);
    const normalizedTags = normalizeTextList(entry.data.tags);

    return {
      slug: entry.id,
      collection,
      title: entry.data.title,
      summary: stripMarkdown(entry.data.summary),
      type: entry.data.type,
      category: entry.data.category.trim(),
      categorySlug,
      tags: normalizedTags.labels,
      tagSlugs: normalizedTags.slugs,
      date: entry.data.date,
      updated: entry.data.updated,
      hidden: entry.data.hidden,
      url: toEntryUrl(collection, entry.id),
    };
  });
}

export async function getAllEntries(): Promise<NormalizedEntry[]> {
  const [articles, notes] = await Promise.all([
    loadCollectionEntries("articles"),
    loadCollectionEntries("notes"),
  ]);

  return sortByUpdatedDesc([...articles, ...notes]);
}

export async function getPublicEntries(): Promise<NormalizedEntry[]> {
  return filterPublic(await getAllEntries());
}

export async function getHiddenEntries(): Promise<NormalizedEntry[]> {
  return sortByUpdatedDesc(filterHidden(await getAllEntries()));
}

export async function getPublicCategories(): Promise<CategoryGroup[]> {
  return groupByCategory(await getPublicEntries());
}

export async function getHiddenCategories(): Promise<CategoryGroup[]> {
  return groupByCategory(await getHiddenEntries());
}

export async function getPublicTags(): Promise<TagGroup[]> {
  return groupByTag(await getPublicEntries());
}

export async function getRecentPublicEntries(limit = 6): Promise<NormalizedEntry[]> {
  return (await getPublicEntries()).slice(0, limit);
}

export async function getEntriesByCategorySlug(
  categorySlug: string,
  options?: { hidden?: boolean },
): Promise<NormalizedEntry[]> {
  const entries = options?.hidden ? await getHiddenEntries() : await getPublicEntries();
  return entries.filter((entry) => entry.categorySlug === categorySlug);
}

export async function getEntriesByTagSlug(tagSlug: string): Promise<NormalizedEntry[]> {
  const entries = await getPublicEntries();
  return entries.filter((entry) => entry.tagSlugs.includes(tagSlug));
}

function sortByDateAsc(entries: NormalizedEntry[]): NormalizedEntry[] {
  return [...entries].sort(
    (a, b) => a.updated.getTime() - b.updated.getTime() || a.title.localeCompare(b.title),
  );
}

export async function getAdjacentEntries(
  slug: string,
  type: EntryType,
  options?: { hidden?: boolean },
): Promise<{ previous?: NormalizedEntry; next?: NormalizedEntry }> {
  const entries = options?.hidden ? await getHiddenEntries() : await getPublicEntries();
  const sameTypeEntries = sortByDateAsc(entries.filter((entry) => entry.type === type));
  const currentIndex = sameTypeEntries.findIndex((entry) => entry.slug === slug);

  if (currentIndex === -1) {
    return {};
  }

  return {
    previous: sameTypeEntries[currentIndex - 1],
    next: sameTypeEntries[currentIndex + 1],
  };
}

export async function getRelatedEntries(
  slug: string,
  options?: { hidden?: boolean; limit?: number },
): Promise<NormalizedEntry[]> {
  const entries = options?.hidden ? await getHiddenEntries() : await getPublicEntries();
  const currentEntry = entries.find((entry) => entry.slug === slug);

  if (!currentEntry) {
    return [];
  }

  const limit = options?.limit ?? 3;

  return entries
    .filter((entry) => entry.slug !== slug)
    .map((entry) => {
      const sharedTagCount = entry.tagSlugs.filter((tag) => currentEntry.tagSlugs.includes(tag)).length;
      const sameCategory = entry.categorySlug === currentEntry.categorySlug;
      const score = (sameCategory ? 100 : 0) + sharedTagCount * 10;

      return { entry, score, sharedTagCount, sameCategory };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.entry.updated.getTime() - a.entry.updated.getTime() ||
        a.entry.title.localeCompare(b.entry.title),
    )
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export async function getSearchIndex() {
  return toSearchDocuments(await getAllEntries());
}
