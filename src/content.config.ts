import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

const baseSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["article", "note"]),
  category: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  date: z.coerce.date(),
  updated: z.coerce.date(),
  hidden: z.boolean(),
  summary: z.string().min(1),
});

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: baseSchema.extend({
    type: z.literal("article"),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/notes" }),
  schema: baseSchema.extend({
    type: z.literal("note"),
  }),
});

export const collections = {
  articles,
  notes,
};
