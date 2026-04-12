import { describe, expect, it } from "vitest";

import {
  filterHidden,
  filterPublic,
  groupByCategory,
  groupByTag,
  sortByUpdatedDesc,
  toSearchDocuments,
  type NormalizedEntry,
} from "./content-model";

const fixtures: NormalizedEntry[] = [
  {
    slug: "welcome",
    collection: "articles",
    title: "Welcome",
    summary: "intro",
    type: "article",
    category: "Essays",
    categorySlug: "essays",
    tags: ["writing", "process"],
    tagSlugs: ["writing", "process"],
    date: new Date("2026-04-01"),
    updated: new Date("2026-04-11"),
    hidden: false,
    url: "/articles/welcome/",
  },
  {
    slug: "astro",
    collection: "notes",
    title: "Astro",
    summary: "routing",
    type: "note",
    category: "Web Notes",
    categorySlug: "web-notes",
    tags: ["astro"],
    tagSlugs: ["astro"],
    date: new Date("2026-04-04"),
    updated: new Date("2026-04-12"),
    hidden: false,
    url: "/notes/astro/",
  },
  {
    slug: "quiet",
    collection: "notes",
    title: "Quiet",
    summary: "hidden",
    type: "note",
    category: "Backstage",
    categorySlug: "backstage",
    tags: ["hidden"],
    tagSlugs: ["hidden"],
    date: new Date("2026-04-06"),
    updated: new Date("2026-04-10"),
    hidden: true,
    url: "/notes/quiet/",
  },
];

describe("content-model", () => {
  it("sorts by updated desc", () => {
    expect(sortByUpdatedDesc(fixtures).map((entry) => entry.slug)).toEqual(["astro", "welcome", "quiet"]);
  });

  it("filters public and hidden entries separately", () => {
    expect(filterPublic(fixtures)).toHaveLength(2);
    expect(filterHidden(fixtures)).toHaveLength(1);
  });

  it("groups public categories with counts", () => {
    const groups = groupByCategory(filterPublic(fixtures));
    expect(groups.map((group) => group.slug)).toEqual(["web-notes", "essays"]);
    expect(groups[0]?.count).toBe(1);
    expect(groups[0]?.noteCount).toBe(1);
    expect(groups[1]?.articleCount).toBe(1);
  });

  it("groups tags without hidden entries leaking into public data", () => {
    const tags = groupByTag(filterPublic(fixtures));
    expect(tags.map((tag) => tag.slug)).toEqual(["astro", "process", "writing"]);
  });

  it("builds search documents from public entries only", () => {
    const docs = toSearchDocuments(fixtures);
    expect(docs).toHaveLength(2);
    expect(docs.map((doc) => doc.url)).toEqual(["/articles/welcome/", "/notes/astro/"]);
  });
});
