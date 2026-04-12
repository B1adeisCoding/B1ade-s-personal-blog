import type { APIRoute } from "astro";

import { getSearchIndex } from "../lib/content";

export const prerender = true;

export const GET: APIRoute = async () => {
  const payload = await getSearchIndex();

  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
};
