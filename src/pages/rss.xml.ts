import rss from "@astrojs/rss";
import type { APIRoute } from "astro";

import { getPublicEntries } from "../lib/content";
import { siteConfig } from "../lib/site";

export const GET: APIRoute = async (context) => {
  const entries = await getPublicEntries();

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: context.site ?? siteConfig.url,
    items: entries.map((entry) => ({
      title: entry.title,
      description: entry.summary,
      pubDate: entry.date,
      link: entry.url,
    })),
  });
};
