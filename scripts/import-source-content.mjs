import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const workspaceRoot = path.resolve(projectRoot, "..");

const sources = [
  {
    name: "八股合集",
    dir: path.join(workspaceRoot, "八股合集"),
    baseTags: ["八股", "面试"],
  },
  {
    name: "AI相关",
    dir: path.join(workspaceRoot, "AI相关"),
    baseTags: ["AI"],
  },
];

const destinationRoot = path.join(projectRoot, "src", "content");

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value) {
  return value.trim().toLowerCase().replace(/\.md$/i, "");
}

function toRoute(collection, slug) {
  return collection === "articles" ? `/articles/${slug}/` : `/notes/${slug}/`;
}

function replaceWikiLinks(content, index) {
  return content
    .replace(/!\[\[([^\]]+)\]\]/g, (_match, target) => `_Embedded asset omitted: ${target.trim()}_`)
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_match, target, alias) => {
      const resolved = index.get(normalizeKey(target));
      const label = alias.trim();
      return resolved ? `[${label}](${resolved.url})` : label;
    })
    .replace(/\[\[([^\]]+)\]\]/g, (_match, target) => {
      const resolved = index.get(normalizeKey(target));
      const label = target.trim();
      return resolved ? `[${label}](${resolved.url})` : label;
    });
}

function extractTitle(content, fallbackName) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallbackName.replace(/\.md$/i, "");
}

function extractCategoryLine(content) {
  const match = content.match(/\*\*类别\*\*[:：]\s*(.+)/);
  if (!match) return null;
  return match[1]
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function inferCategory(sourceName, fileName, categoryParts) {
  if (categoryParts?.length) {
    return categoryParts[0];
  }

  if (sourceName === "八股合集") {
    return "面试八股";
  }

  if (/claude\s*code/i.test(fileName)) {
    return "Claude Code";
  }

  if (/skill/i.test(fileName)) {
    return "Agent Skills";
  }

  if (/ai使用心得/i.test(fileName)) {
    return "AI Practice";
  }

  return "AI相关";
}

function inferType(sourceName, fileName) {
  if (sourceName === "八股合集") {
    return "note";
  }

  if (/初稿/i.test(fileName)) {
    return "note";
  }

  return "article";
}

function inferHidden(fileName) {
  return /初稿/i.test(fileName);
}

function inferTags(source, fileName, categoryParts) {
  const tags = new Set(source.baseTags);

  categoryParts?.forEach((part) => tags.add(part));

  const baseName = fileName.replace(/\.md$/i, "");
  if (/agent/i.test(baseName)) tags.add("Agent");
  if (/mysql/i.test(baseName)) tags.add("MySQL");
  if (/redis/i.test(baseName)) tags.add("Redis");
  if (/jvm/i.test(baseName)) tags.add("JVM");
  if (/golang/i.test(baseName)) tags.add("Golang");
  if (/mq/i.test(baseName)) tags.add("MQ");
  if (/sql/i.test(baseName)) tags.add("SQL");
  if (/skill/i.test(baseName)) tags.add("Skill");
  if (/claude\s*code/i.test(baseName)) tags.add("Claude Code");
  if (/记忆系统/i.test(baseName)) tags.add("记忆系统");
  if (/源码解读/i.test(baseName)) tags.add("源码解读");
  if (/面试/i.test(baseName)) tags.add("面试");
  if (/初稿/i.test(baseName)) tags.add("初稿");

  return [...tags];
}

function extractSummary(content, title) {
  const lines = content.split("\n");
  const candidates = [];
  let inCodeFence = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) continue;
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    if (line.startsWith("---")) continue;
    if (/^\*\*类别\*\*/.test(line)) continue;
    if (line.startsWith("|")) continue;
    if (/^[-*]\s+/.test(line)) continue;
    if (/^\d+[.)、]\s+/.test(line)) continue;
    if (/^[A-Z0-9_(),.*\s]+$/.test(line)) continue;
    if (line.endsWith(":") || line.endsWith("：")) continue;

    candidates.push(line);
  }

  const summary =
    candidates.find(
      (line) =>
        /[\u4e00-\u9fa5a-zA-Z]/.test(line)
        && line.length >= 14
        && !line.includes("：")
        && !line.includes(":"),
    ) ?? `${title}的整理与归档内容。`;
  return summary.slice(0, 140);
}

function toFrontmatter(data) {
  const tagsBlock = data.tags.map((tag) => `  - ${tag}`).join("\n");

  return `---\n`
    + `title: ${JSON.stringify(data.title)}\n`
    + `type: ${data.type}\n`
    + `category: ${JSON.stringify(data.category)}\n`
    + `tags:\n${tagsBlock}\n`
    + `date: ${data.date}\n`
    + `updated: ${data.updated}\n`
    + `hidden: ${data.hidden}\n`
    + `summary: ${JSON.stringify(data.summary)}\n`
    + `---\n\n`;
}

async function ensureCleanDir(dir) {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

async function buildSourceIndex() {
  const index = new Map();

  for (const source of sources) {
    const entries = await fs.readdir(source.dir);

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;

      const filePath = path.join(source.dir, entry);
      const raw = await fs.readFile(filePath, "utf8");
      const title = extractTitle(raw, entry);
      const type = inferType(source.name, entry);
      const collection = type === "article" ? "articles" : "notes";
      const slug = slugify(entry);
      const url = toRoute(collection, slug);

      const record = { title, slug, collection, url };
      index.set(normalizeKey(entry), record);
      index.set(normalizeKey(title), record);
    }
  }

  return index;
}

async function importSource(source) {
  const entries = await fs.readdir(source.dir);

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;

    const sourcePath = path.join(source.dir, entry);
    const stat = await fs.stat(sourcePath);
    const raw = await fs.readFile(sourcePath, "utf8");
    const content = replaceWikiLinks(raw, sourceIndex).trim();
    const title = extractTitle(content, entry);
    const categoryParts = extractCategoryLine(content);
    const type = inferType(source.name, entry);
    const collection = type === "article" ? "articles" : "notes";
    const hidden = inferHidden(entry);
    const date = new Date(stat.birthtimeMs || stat.mtimeMs);
    const updated = new Date(stat.mtimeMs);
    const slug = slugify(entry);
    const targetDir = path.join(destinationRoot, collection);
    const frontmatter = toFrontmatter({
      title,
      type,
      category: inferCategory(source.name, entry, categoryParts),
      tags: inferTags(source, entry, categoryParts),
      date: date.toISOString().slice(0, 10),
      updated: updated.toISOString().slice(0, 10),
      hidden,
      summary: extractSummary(content, title),
    });

    const body = content.replace(/^#\s+.+\n?/, "").trimStart();
    await fs.writeFile(path.join(targetDir, `${slug}.md`), `${frontmatter}${body}\n`, "utf8");
  }
}

await ensureCleanDir(path.join(destinationRoot, "articles"));
await ensureCleanDir(path.join(destinationRoot, "notes"));

const sourceIndex = await buildSourceIndex();

for (const source of sources) {
  await importSource(source);
}

console.log("Imported source content into blog collections.");
