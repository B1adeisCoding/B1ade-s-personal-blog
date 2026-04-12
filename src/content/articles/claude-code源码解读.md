---
title: "claude code源码解读"
type: article
category: "Claude Code"
tags:
  - AI
  - Claude Code
  - 源码解读
date: 2026-04-04
updated: 2026-04-12
hidden: false
summary: "Claude Code 的源码分析文章已经很多了，\"工具怎么注册\"、\"消息怎么传给 API\"、\"AgentTool 怎么启动子 Agent\"——流程层面的东西已经讲透了。"
---

> 相关笔记：[Claude Code记忆系统](/articles/claude-code记忆系统/) | [claude code源码解读-面试口述稿](/articles/claude-code源码解读-面试口述稿/) | [如何写好skill](/articles/如何写好skill/) | [agent八股](/notes/agent八股/) | s01-the-agent-loop | s06-context-compact

市面上 Claude Code 源码解读已经不少了，但大多数停在工具调用和消息流程那一层。这篇专门看三块硬核内容：上下文窗口管理（对话太长怎么处理）、KV Cache 复用（怎么省钱省时间）、权限隔离（怎么防止 Claude 干坏事）。

名词速查 — 文中反复出现的专有词解释一下：

token：AI 处理文字的基本单位，大约 1 个汉字 = 1.5 个 token，1 个英文单词 ≈ 1 个 token
KV Cache / Prompt Cache：服务端缓存，把"已经算过的内容"存起来，下次请求直接读，不用重新算，省钱又快
BigQuery（BQ）：Google 的大数据分析平台，Anthropic 内部用它来跑数据查询、分析用户行为。文中"BQ 数据显示"就是"Anthropic 内部的数据分析结果"
ant：Anthropic 员工的内部代称，代码里 USER_TYPE === 'ant' 就是"仅限 Anthropic 内部员工"
compact：把很长的对话历史"压缩"成摘要，腾出空间继续对话
背景：为什么要单独看这三块
Claude Code 的源码分析文章已经很多了，"工具怎么注册"、"消息怎么传给 API"、"AgentTool 怎么启动子 Agent"——流程层面的东西已经讲透了。

但真正影响产品体验和使用成本的，是更底层的东西：

对话跑到几十万 token 会发生什么？继续还是截断？
Cache 失效一次，账单飙多少？
执行 Shell 命令的安全边界在哪里？Claude 能不能删系统文件？
第一部分：上下文管理
1.1 先理解"上下文"是什么
类比一下：你和 Claude 的每一轮对话，Claude 都需要"记得"之前说了什么。这些历史对话加起来就是"上下文"，用 token 来计量。

问题是，AI 模型有上下文窗口限制——就像人的短期记忆有上限。Claude Code 默认上限是 20 万 token（约 15 万汉字）。对话一长，就会撑满。

撑满怎么办？Claude Code 设计了一套多层压缩策略，从轻到重：

图片
多层压缩策略总览
1.2 各阈值是多少
src/utils/context.ts 里的数字：

上下文窗口           200,000 token  （约 15 万汉字）
减去 summary 预留     20,000 token  （compact 时 Claude 写摘要用）
= 有效窗口           180,000 token
减去安全 buffer        13,000 token
= auto-compact 触发   167,000 token  （约 83% 满了就触发）
还有一个反直觉的设计：默认 max_output_tokens 是 8,000，不是 32,000。

为什么？Anthropic 内部的 BigQuery 数据显示，99% 的实际回复只有约 4,911 token。把上限设到 32,000，服务端要提前预留那么多"槽位"，整体服务吞吐量会下降。设成 8,000 能覆盖 99% 的情况，碰到真正需要长输出的那 1%，再自动升到 64,000 重试一次。

1.3 压缩触发的完整流程
图片
Auto-Compact 完整触发流程
为什么有"递归死锁"的问题？

Claude Code 在做 compact 时，会启动一个专门的"压缩子 Agent"来写摘要。如果这个子 Agent 自己的上下文也满了，又触发 auto-compact……就无限套娃了。所以代码里强制：querySource === 'compact' 的请求直接跳过 auto-compact。

熔断是什么？

BigQuery 数据显示，某些 session 会陷入"上下文已经溢出、compact 也救不了"的死循环，每次都发起注定失败的压缩请求。全局加起来一天浪费约 25 万次 API 调用。于是设了个熔断：连续失败 3 次就停，不再重试。

1.4 三种压缩方式对比
图片
三种压缩方式对比
Micro-Compact 的具体逻辑：

工具调用（Tool Use）是对话里占 token 最多的部分。比如 Claude 读了一个 2000 行的文件，这 2000 行都要留在上下文里——但 Claude 其实已经"看过"了，不需要一直保留原文。

Micro-Compact 把这类"已消费"的工具结果内容清掉，只留一个 [Old tool result content cleared] 占位符。清掉的工具类型：

FileRead（读文件）
Bash/Shell（执行命令）
Grep / Glob（搜索）
WebSearch / WebFetch（网页搜索）
FileEdit / FileWrite（文件编辑）
Time-Based Micro-Compact：如果你离开去喝了杯咖啡，回来继续聊，服务端的 Cache 已经过期了（后面会解释）。这时候没必要保留旧工具结果——因为这些内容就算清掉，反正 Cache 已经失效，重新发送也不会多省什么。索性主动清掉，减少下次请求的数据量。

Cached Micro-Compact（最精妙）：

普通 Micro-Compact 修改了消息内容，服务端就得重新缓存——Cache 失效了。

Cached Micro-Compact 用了 Anthropic 的 cache_edits API，可以不改本地消息，只告诉服务端"把那几个工具结果的缓存版本删了"。Claude 看到的历史对话一字不变，但服务端腾出了空间，System Prompt 的缓存也完好无损。

图片
Cached Micro-Compact：不改本地消息、只删服务端工具结果缓存
目前这个功能只对 Anthropic 内部开放（外部用户暂时用不到）。

第二部分：KV Cache 复用与 Cache Break 检测
2.1 先理解 Prompt Cache 是什么
想象一道数学题：

每次你向 Claude 发消息，Claude 都需要先"读完"所有上下文再回答。System Prompt（包含工具描述、项目信息等）每次都要重新处理，这很费时间也费钱。

Prompt Cache 的作用：把"固定不变的前缀"缓存起来，下次直接读，不重新计算。

图片
Prompt Cache：有无缓存的成本对比
Cache 有效期分两档：5 分钟（短期）和 1 小时（长期，需要资格）。

2.2 什么是 Cache Break？
Cache Break = 缓存失效，俗称"缓存被打断了"。

触发原因很多，比如：

System Prompt 内容变了（加了新的 CLAUDE.md）
工具描述变了（MCP 服务器更新了）
切换了模型
开启了某些 beta 功能
一旦 Cache Break，之前缓存的 5-10 万 token 全部需要重新计算——费用可能瞬间增加几倍。

2.3 Cache Break 检测系统
promptCacheBreakDetection.ts 是专门的诊断模块，分两个阶段工作：

图片
Cache Break 两阶段检测流程
为什么要追踪每个工具单独的 hash？

BigQuery 数据显示：77% 的 Cache Break 是某个工具描述悄悄变了，不是工具数量变化。

比如你加了一个 MCP 服务器，它的工具描述格式稍有不同，这就会让整个工具列表的 hash 变掉，导致 Cache Break。有了 per-tool hash，就能精确定位是哪个工具出了问题。

诊断出来的原因长这样：

[PROMPT CACHE BREAK]
原因: tools changed (AgentTool schema changed)
数据: cache read: 47,823 → 312  (-47,511 tokens)
来源: repl_main_thread, 第 8 次调用
客户端什么都没变的情况下，会根据时间间隔判断：

图片
Cache Break 原因诊断分类
这个"约占 90%"是 BigQuery 的分析结果——大部分"说不清原因"的 Cache Break，其实是服务端的路由调度或缓存淘汰导致的，和客户端代码没关系。

2.4 Sticky-On：防止 Cache Break 的一个巧妙设计
某些功能开关（beta header）一旦在 session 里激活，就永远不关掉，直到 session 结束。

为什么？以 AFK Mode 为例：

图片
Sticky-On 设计：防止 Beta Header 切换触发 Cache Break
代码里叫做 "latched"（锁定），一旦锁定就不解锁，避免来回切换触发 Cache Break。

2.5 缓存范围：Session 级 vs Org 级
图片
缓存范围：Session 级 vs Org 级
第三部分：权限隔离
3.1 为什么权限管理这么重要
Claude Code 能执行 Shell 命令、读写文件——这意味着它理论上可以：

删除你的代码
修改系统配置文件
向外发送数据
安装恶意软件
所以权限隔离不是锦上添花，是必须的安全机制。

3.2 六种权限模式
图片
六种权限模式
bypassPermissions 和 dontAsk 在 UI 上显示红色，是代码里写死的 color: 'error'，不是随意的样式选择。

auto 模式（基于 AI 分类器自动判断危险程度）是 Anthropic 内部的实验功能，外部用户看不到这个选项。

3.3 危险命令拦截
进入某些自动模式时，Claude Code 会主动剥离过于宽泛的权限规则。

什么叫"过于宽泛"？ 比如用户之前设置了 Bash(python:*) 这条规则，意思是"Claude 执行任何 python 开头的命令都自动批准"。但这等于允许运行任意 Python 代码——AI 分类器完全没用武之地。

所以这类规则在进入 Auto 模式时会被自动删除。危险命令黑名单：

图片
危险命令拦截：进入 Auto 模式时自动剥离的规则
为什么 curl/wget/git 只在内部拦截？代码注释说得很清楚：这是基于 Anthropic 内部的沙箱使用数据发现的风险——这些命令被员工"过度宽泛地放行"，比如 Bash(curl:*) 允许向任何地址发送请求，存在数据外泄风险。但对外部用户来说，这些本身不是危险命令，加进去反而影响正常使用。

3.4 危险文件保护
哪些文件不能被 Claude 随便改：

图片
受保护的危险文件与目录
还有一个容易被忽视的安全细节：路径比较统一转小写。

macOS 和 Windows 的文件系统大小写不敏感，.cLauDe/Settings.locaL.json 和 .claude/settings.local.json 是同一个文件。如果不统一转小写，攻击者可以用混合大小写路径绕过安全检查。

3.5 权限决策对象的冻结
每次工具调用，系统会创建一个 PermissionContext 对象（权限上下文），用来决定这个操作能不能做。

创建结束后，调用 Object.freeze(ctx)——对象被冻结，任何属性都不能再修改。

为什么要冻结？防御一种攻击：如果 Claude 执行了含有恶意代码的用户脚本（比如 eval(malicious_code)），这个脚本可能尝试找到权限决策对象并修改它（比如把 handleUserAllow 替换成一个永远返回"允许"的函数）。冻结之后，这类运行时篡改直接失败。

3.6 子 Agent 的权限边界
Claude Code 可以启动子 Agent（子任务），子 Agent 被拒绝时，不会直接中止整个对话。

逻辑是：子 Agent 只是一个工具，它的失败应该由父 Agent（主对话）来决定怎么处理——是重试、换个方式，还是告知用户。子 Agent 没资格自己"掀桌子"，中断用户正在进行的整个工作流。

图片
子 Agent 权限边界：拒绝时不中止整个对话
3.7 Bypass Permissions 的远程开关
有一个设计让我印象深刻：Anthropic 可以不发布新版本，直接远程关闭某个组织的 bypassPermissions 功能。

实现方式是 Statsig（特性开关平台）的 gate 检查。Session 开始时查一次，如果 gate 返回"禁用"，就把 bypassPermissions 权限从上下文里去掉。

用户 /login 切换账号后，这个检查会重置，让新账号重新走一遍——不同账号可能有不同的权限策略。

第四部分：三者怎么配合
这三套机制之间有几个必须协调的点，少了任何一个都会出问题：

4.1 Compact 后的 Cache Break 误报问题
Compact 会把历史消息替换成摘要，下一次请求的 cache_read_tokens 自然大幅下降——但这不是 Cache Break，是正常现象。

如果没有专门处理，Cache Break 检测器会把每次 compact 后的正常下降都误报为"Cache Break"。BigQuery 历史数据显示，20% 的 Cache Break 告警都是这类误报。

解决方案：compact 完成后立即通知检测器"下次下降是正常的，别报警"。

图片
Compact 完成后防止 Cache Break 误报
4.2 Auto-Compact 和 Context Collapse 的互斥
Context Collapse 是一套更激进的上下文管理策略（目前仅 Anthropic 内部实验）：90% 满时提交关键状态，95% 满时阻止新任务。

Auto-Compact 在约 93% 时触发，正好夹在两者之间。如果两个都在跑：

Context Collapse 赢了，接管了上下文
Auto-Compact 同时也在压缩，会把 Collapse 精心保存的状态一起销毁
所以检测到 Collapse 启用时，Auto-Compact 直接退出，把控制权交出去：

if (isContextCollapseEnabled()) return false  // 退出，不竞争
4.3 多个子 Agent 并发时的缓存状态隔离
Cache Break 检测器用一个 Map 存储每个对话来源的状态，key 是 agentId。

图片
多子 Agent 并发：缓存状态隔离
Map 大小上限是 10，超出后淘汰最旧的。为什么要限制？因为每条记录大约占 300KB+（序列化后的 System Prompt + 工具描述），不限制大小的话，跑多个子 Agent 的 session 会内存泄漏。

几点感想
读完这块源码，有几个地方让我印象深刻：

注释里的数据来源。很多常量旁边都写了 BigQuery 查询日期，比如 // BQ 2026-03-22: 77% of tool breaks are schema changes。这说明这些参数是从真实使用数据里算出来的，不是拍脑袋。改这个数字的人，必须拿出新的 BQ 数据来支撑。

ant-only 的清晰边界。大量 process.env.USER_TYPE === 'ant' 判断，把内部实验和外部发布隔开。外部用户拿到的是稳定版本，内部可以快速迭代各种激进策略——出了问题不影响用户。

降级链的设计。Context Collapse → Auto-Compact → Cached Micro-Compact → Time-Based Micro-Compact，层层兜底。任何一层出问题，还有下一层。这种设计让系统在边界条件下依然能用，而不是直接崩掉。

可观测性优先。Cache Break 检测不只是记日志，是生成 diff 文件、发结构化事件到 BigQuery，精确到哪个工具的 schema 变了。出了问题，工程师能直接查数据定位原因，不需要靠猜。


留言
写留言
