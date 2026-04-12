import type { APIRoute } from "astro";

import {
  getPublicCategories,
  getPublicEntries,
  getPublicTags,
} from "../lib/content";
import { siteConfig } from "../lib/site";

function toUrl(pathname: string): string {
  return new URL(pathname, siteConfig.url).toString();
}

function toSitemapEntry(url: string, lastmod?: Date): string {
  const lastmodNode = lastmod ? `<lastmod>${lastmod.toISOString()}</lastmod>` : "";
  return `<url><loc>${url}</loc>${lastmodNode}</url>`;
}

export const GET: APIRoute = async () => {
  const [entries, categories, tags] = await Promise.all([
    getPublicEntries(),
    getPublicCategories(),
    getPublicTags(),
  ]);

  const staticPages = [
    toSitemapEntry(toUrl("/")),
    toSitemapEntry(toUrl("/about/")),
    toSitemapEntry(toUrl("/categories/")),
    toSitemapEntry(toUrl("/tags/")),
    toSitemapEntry(toUrl("/search/")),
  ];

  const categoryPages = categories.map((category) =>
    toSitemapEntry(toUrl(`/categories/${category.slug}/`), category.latestUpdated),
  );

  const tagPages = tags.map((tag) => toSitemapEntry(toUrl(`/tags/${tag.slug}/`)));
  const entryPages = entries.map((entry) => toSitemapEntry(toUrl(entry.url), entry.updated));

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    [...staticPages, ...categoryPages, ...tagPages, ...entryPages].join("") +
    "</urlset>";

  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
};
