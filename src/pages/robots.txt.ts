import type { APIRoute } from "astro";

import { siteConfig } from "../lib/site";

export const GET: APIRoute = () => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /hidden/",
    `Sitemap: ${new URL("/sitemap.xml", siteConfig.url).toString()}`,
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
};
