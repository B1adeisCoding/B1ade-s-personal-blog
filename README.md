# Personal Blog

一个基于 Astro 的静态个人博客原型，定位是公开可访问的知识库博客，而不是传统个人主页。第一版同时承载 `article` 和 `note` 两类内容，以分类为主入口，标签和搜索作为辅助发现路径。

## 当前特性

- Markdown 驱动的两类内容模型：`article` / `note`
- 首页优先展示分类地图和最近更新
- 分类页、标签页、搜索页、关于页、隐藏分类页
- 半隐藏内容不会进入首页、主导航、标签和搜索的默认发现路径
- 构建期 frontmatter 校验
- 纯静态搜索索引 `search-index.json`
- 部署就绪的 `robots.txt`、`sitemap.xml` 和 `rss.xml`

## 项目结构

```text
personal-blog/
├── public/
├── src/
│   ├── components/
│   ├── content/
│   │   ├── articles/
│   │   └── notes/
│   ├── layouts/
│   ├── lib/
│   └── pages/
├── astro.config.mjs
└── package.json
```

## 内容字段

每篇内容必须包含：

- `title`
- `type`
- `category`
- `tags`
- `date`
- `updated`
- `hidden`
- `summary`

其中：

- `type` 只能是 `article` 或 `note`
- `hidden: true` 表示该内容属于半隐藏路径
- 搜索索引和公开聚合默认只消费 `hidden: false` 的内容

## 本地运行

```bash
cd /Users/b1ade/cursorProjects/GeneralUses/简历/personal-blog
npm install
npm run dev
```

默认开发地址通常是 `http://localhost:4321/`。

## 站点 URL 配置

项目默认使用占位站点地址 `https://blog.local`，避免继续把 `example.com` 写进构建产物。

部署到 Vercel 前，请在项目环境变量里设置：

```bash
PUBLIC_SITE_URL=https://你的正式域名
```

这个值会用于：

- Astro `site`
- canonical URL
- `robots.txt`
- `sitemap.xml`
- `rss.xml`

## 验收路径

建议至少检查以下页面：

- `/`
- `/categories/`
- `/categories/essays/`
- `/articles/welcome-to-the-garden/`
- `/notes/astro-routing-patterns/`
- `/tags/`
- `/search/`
- `/hidden/backstage/`
- `/about/`

重点验收点：

- 首页首屏是分类地图，不是个人介绍
- 分类列表能区分文章和笔记
- 搜索可检索公开内容
- 隐藏内容不出现在首页、标签页和搜索结果中
- 隐藏内容仍可通过直链访问

## 验证命令

```bash
npm run build
npm test
```

当前项目已通过上述两项验证。

## GitHub + Vercel 部署

这个项目适合保持“Markdown 内容文件 + 静态构建”的发布模式：

1. 把 `personal-blog` 仓库推到 GitHub
2. 在 Vercel 中导入该 GitHub 仓库
3. 保持默认 Framework Preset 为 Astro
4. Build Command 使用 `npm run build`
5. Output Directory 使用 `dist`
6. 在 Vercel 项目环境变量中添加 `PUBLIC_SITE_URL`
7. 之后每次 `git push` 都会触发自动构建和发布

如果你暂时还没有正式域名，也可以先部署到 Vercel 分配的 `*.vercel.app` 域名，再把这个地址填到 `PUBLIC_SITE_URL`。

## 部署后建议检查

- `/robots.txt`
- `/sitemap.xml`
- `/rss.xml`
- 首页和任意一篇文章详情页的 canonical
- 搜索页是否能正常请求 `/search-index.json`
