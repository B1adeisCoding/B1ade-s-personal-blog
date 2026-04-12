const fallbackSiteUrl = "https://blog.local";
const siteUrl = (import.meta.env.PUBLIC_SITE_URL || fallbackSiteUrl).replace(/\/+$/, "");

export const siteConfig = {
  title: "Paper Trail",
  description:
    "A personal knowledge garden for long-form articles, working notes, and quiet side paths.",
  url: siteUrl,
  author: "b1ade",
};
