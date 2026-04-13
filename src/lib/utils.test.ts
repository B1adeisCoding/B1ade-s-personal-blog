import { describe, expect, it } from "vitest";

import { stripMarkdown } from "./utils";

describe("stripMarkdown", () => {
  it("removes common markdown markers from preview text", () => {
    expect(
      stripMarkdown("**强调** `代码` [链接](https://example.com) ![图片](image.png)"),
    ).toBe("强调 代码 链接 图片");
  });

  it("normalizes block markdown into plain text", () => {
    expect(stripMarkdown("# 标题\n> 引用\n- 列表项")).toBe("标题 引用 列表项");
  });
});
