export type EntryType = "article" | "note";

export type NormalizedEntry = {
  slug: string;
  collection: "articles" | "notes";
  title: string;
  summary: string;
  type: EntryType;
  category: string;
  categorySlug: string;
  tags: string[];
  tagSlugs: string[];
  date: Date;
  updated: Date;
  hidden: boolean;
  url: string;
};

export type CategoryGroup = {
  name: string;
  slug: string;
  count: number;
  articleCount: number;
  noteCount: number;
  latestUpdated: Date;
};

export type TagGroup = {
  name: string;
  slug: string;
  count: number;
};

export type SearchDocument = {
  title: string;
  summary: string;
  type: EntryType;
  category: string;
  categorySlug: string;
  tags: string[];
  updated: string;
  url: string;
};

export function sortByUpdatedDesc(entries: NormalizedEntry[]): NormalizedEntry[] {
  return [...entries].sort(
    (a, b) => b.updated.getTime() - a.updated.getTime() || a.title.localeCompare(b.title),
  );
}

export function filterPublic(entries: NormalizedEntry[]): NormalizedEntry[] {
  return entries.filter((entry) => !entry.hidden);
}

export function filterHidden(entries: NormalizedEntry[]): NormalizedEntry[] {
  return entries.filter((entry) => entry.hidden);
}

export function groupByCategory(entries: NormalizedEntry[]): CategoryGroup[] {
  const map = new Map<string, CategoryGroup>();

  for (const entry of entries) {
    const current = map.get(entry.categorySlug);
    if (!current) {
      map.set(entry.categorySlug, {
        name: entry.category,
        slug: entry.categorySlug,
        count: 1,
        articleCount: entry.type === "article" ? 1 : 0,
        noteCount: entry.type === "note" ? 1 : 0,
        latestUpdated: entry.updated,
      });
      continue;
    }

    current.count += 1;
    if (entry.type === "article") {
      current.articleCount += 1;
    } else {
      current.noteCount += 1;
    }
    if (entry.updated > current.latestUpdated) {
      current.latestUpdated = entry.updated;
    }
  }

  return [...map.values()].sort(
    (a, b) => b.latestUpdated.getTime() - a.latestUpdated.getTime() || a.name.localeCompare(b.name),
  );
}

export function groupByTag(entries: NormalizedEntry[]): TagGroup[] {
  const map = new Map<string, TagGroup>();

  for (const entry of entries) {
    entry.tags.forEach((tag, index) => {
      const slug = entry.tagSlugs[index];
      const current = map.get(slug);

      if (!current) {
        map.set(slug, {
          name: tag,
          slug,
          count: 1,
        });
        return;
      }

      current.count += 1;
    });
  }

  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function toSearchDocuments(entries: NormalizedEntry[]): SearchDocument[] {
  return filterPublic(entries).map((entry) => ({
    title: entry.title,
    summary: entry.summary,
    type: entry.type,
    category: entry.category,
    categorySlug: entry.categorySlug,
    tags: entry.tags,
    updated: entry.updated.toISOString(),
    url: entry.url,
  }));
}
