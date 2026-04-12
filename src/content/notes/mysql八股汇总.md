---
title: "MySQL 八股汇总"
type: note
category: "MySQL"
tags:
  - 八股
  - 面试
  - MySQL
  - SQL 查询优化
  - SQL
date: 2026-03-07
updated: 2026-04-12
hidden: false
summary: "**但最大的区别不是性能，而是 NULL 的处理——空值陷阱。**"
---

> 相关笔记：[redis八股汇总](/notes/redis八股汇总/) | [sql语法教程](/notes/sql语法教程/) | [并发八股汇总](/notes/并发八股汇总/) | [jvm八股汇总](/notes/jvm八股汇总/) | [mq八股汇总](/notes/mq八股汇总/)

## IN 与 EXISTS 的区别及 NULL 空值陷阱

**类别**：MySQL / SQL 查询优化

### 一、IN 和 EXISTS 分别做了什么

#### IN：先执行子查询，再匹配外层

```sql
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE age > 25);
```

执行逻辑（概念上）：
```
1. 先执行子查询：SELECT id FROM users WHERE age > 25
   → 得到一个结果集，如 (1, 3, 7, 12)
2. 外层查询变成：SELECT * FROM orders WHERE user_id IN (1, 3, 7, 12)
   → 逐行检查 orders 的 user_id 是否在这个集合里
```

#### EXISTS：逐行检查子查询是否有结果

```sql
SELECT * FROM orders o
WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id AND u.age > 25);
```

执行逻辑（概念上）：
```
1. 遍历外层表 orders 的每一行
2. 对每一行，执行子查询：SELECT 1 FROM users u WHERE u.id = 当前行的user_id AND u.age > 25
3. 如果子查询返回至少一行 → EXISTS 为 true → 保留这一行
4. 如果子查询返回空 → EXISTS 为 false → 丢弃这一行
```

### 二、核心区别

| 维度 | IN | EXISTS |
|------|-----|--------|
| **驱动方式** | 子查询驱动（先执行子查询得到集合） | 外层驱动（逐行代入子查询检查） |
| **子查询结果** | 需要物化为一个结果集存在内存中 | 不需要物化，找到一行就返回 true |
| **适用场景** | **子查询结果集小** + 外层表大 | **外层表小** + 子查询涉及的表大 |
| **NULL 处理** | 有空值陷阱（见下文） | 无空值陷阱 |

### 三、性能选择口诀

**"小表驱动大表"**：

```
外层表大，子查询结果小 → 用 IN
  IN 的结果集小，外层每行去小集合里匹配，快

外层表小，子查询涉及的表大 → 用 EXISTS
  外层遍历次数少，每次子查询可以走索引快速判断，快
```

举例：

```sql
-- users 表 100 行，orders 表 1000 万行

-- 场景 1：查有订单的用户（外层小，子查询大） → EXISTS 更优
SELECT * FROM users u
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);

-- 场景 2：查属于活跃用户的订单（外层大，子查询结果小） → IN 更优
SELECT * FROM orders
WHERE user_id IN (SELECT id FROM users WHERE is_active = 1);
```

**但现代 MySQL（5.6+）的优化器会自动改写**：
- MySQL 5.6+ 会把 IN 子查询优化为 semi-join（半连接），实际执行计划可能和 EXISTS 一样
- MySQL 8.0 的优化器更智能，很多情况下 IN 和 EXISTS 的执行计划完全相同
- 所以**面试时讲清楚原理和适用场景**，实际写 SQL 时用 EXPLAIN 看执行计划确认

### 四、NOT IN 与 NOT EXISTS 的区别（更重要）

```sql
-- 查没有下过单的用户

-- 方式 1：NOT IN
SELECT * FROM users
WHERE id NOT IN (SELECT user_id FROM orders);

-- 方式 2：NOT EXISTS
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

**性能差异更大**：
- NOT IN 无法使用索引优化（Anti-join 优化有限）
- NOT EXISTS 可以利用子查询中的索引
- **一般优先用 NOT EXISTS**

**但最大的区别不是性能，而是 NULL 的处理——空值陷阱。**

### 五、空值陷阱（NULL Trap）

这是 IN / NOT IN 最容易踩的坑，也是面试高频考点。

#### NOT IN 遇到 NULL 会怎样？

```sql
-- orders 表的 user_id 列有 NULL 值
-- 假设 orders.user_id 的值为：(1, 2, NULL)

SELECT * FROM users
WHERE id NOT IN (SELECT user_id FROM orders);
```

**你以为**：返回 id 不是 1、不是 2 的用户
**实际**：返回**空结果集**——一行都没有！

#### 为什么？

SQL 的三值逻辑：`TRUE / FALSE / UNKNOWN`

```
NOT IN (1, 2, NULL) 等价于：
  id != 1 AND id != 2 AND id != NULL

其中 id != NULL 的结果永远是 UNKNOWN（不是 TRUE 也不是 FALSE）

TRUE AND TRUE AND UNKNOWN = UNKNOWN

WHERE 子句只保留结果为 TRUE 的行
UNKNOWN 不是 TRUE → 所有行都被丢弃 → 空结果集
```

用具体值走一遍：

```
检查 id = 3：
  3 NOT IN (1, 2, NULL)
  = (3 != 1) AND (3 != 2) AND (3 != NULL)
  = TRUE AND TRUE AND UNKNOWN
  = UNKNOWN
  → 不保留

检查 id = 5：
  5 NOT IN (1, 2, NULL)
  = TRUE AND TRUE AND UNKNOWN
  = UNKNOWN
  → 不保留

所有行都是 UNKNOWN → 结果为空！
```

#### IN 遇到 NULL

```sql
SELECT * FROM users
WHERE id IN (1, 2, NULL);
```

```
检查 id = 1：
  1 IN (1, 2, NULL) = (1=1) OR (1=2) OR (1=NULL)
  = TRUE OR FALSE OR UNKNOWN = TRUE → 保留 ✓

检查 id = 3：
  3 IN (1, 2, NULL) = FALSE OR FALSE OR UNKNOWN
  = UNKNOWN → 不保留 ✗
```

IN 遇到 NULL 影响较小——匹配到非 NULL 值的行还是能正确返回，只是**无法匹配值为 NULL 的那一项**（NULL = NULL 是 UNKNOWN，不是 TRUE）。

#### EXISTS 不受 NULL 影响

```sql
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

EXISTS 只看子查询**是否返回行**，不做值比较，所以完全不受 NULL 的三值逻辑影响。这是 **NOT EXISTS 比 NOT IN 更安全的根本原因**。

### 六、空值陷阱总结

| | IN | NOT IN | EXISTS | NOT EXISTS |
|---|-----|--------|--------|------------|
| 子查询结果含 NULL | 能正确匹配非 NULL 值，忽略 NULL 项 | **整个查询返回空！** | 不受影响 | 不受影响 |
| 安全性 | 基本安全 | **危险** | 安全 | 安全 |
| 建议 | 可用 | **避免使用**，或加 `WHERE col IS NOT NULL` | 可用 | **优先使用** |

### 七、防御写法

如果必须用 NOT IN，要显式排除 NULL：

```sql
-- 安全写法：过滤掉 NULL
SELECT * FROM users
WHERE id NOT IN (SELECT user_id FROM orders WHERE user_id IS NOT NULL);
```

但更推荐直接用 NOT EXISTS：

```sql
-- 最安全、性能也好
SELECT * FROM users u
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

或者用 LEFT JOIN + IS NULL（等价写法）：

```sql
SELECT u.* FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.user_id IS NULL;
```

### 八、面试回答模板

> "IN 和 EXISTS 的核心区别在于**驱动方式**：IN 先执行子查询得到结果集，外层逐行去集合里匹配；EXISTS 遍历外层表每一行，代入子查询看是否返回结果。**选择原则是小表驱动大表**——子查询结果小用 IN，外层表小用 EXISTS。但现代 MySQL 优化器（5.6+）会做 semi-join 改写，很多情况下执行计划相同。
>
> 更重要的区别在 NOT IN 和 NOT EXISTS。NOT IN 有**空值陷阱**：如果子查询结果包含 NULL，由于 SQL 三值逻辑（任何值和 NULL 比较结果都是 UNKNOWN），NOT IN 会导致**整个查询返回空结果集**。而 NOT EXISTS 只判断子查询是否返回行，不做值比较，不受 NULL 影响。所以**生产中一律用 NOT EXISTS 替代 NOT IN**，或者至少在 NOT IN 子查询里加 `WHERE col IS NOT NULL`。"

---

## SQL 查询语句的执行顺序

**类别**：MySQL / SQL 基础 / 查询原理

### 一、书写顺序 vs 执行顺序

SQL 的**书写顺序**和**实际执行顺序**是不一样的：

```
书写顺序（我们写 SQL 的顺序）：
SELECT → DISTINCT → FROM → JOIN → ON → WHERE → GROUP BY → HAVING → ORDER BY → LIMIT

执行顺序（数据库引擎实际处理的顺序）：
FROM → ON → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT
```

### 二、完整执行顺序详解

用一个具体的 SQL 来走一遍：

```sql
SELECT DISTINCT u.city, COUNT(*) AS order_count
FROM orders o                          -- ① FROM
JOIN users u ON o.user_id = u.id       -- ② ON → ③ JOIN
WHERE o.amount > 100                   -- ④ WHERE
GROUP BY u.city                        -- ⑤ GROUP BY
HAVING COUNT(*) > 5                    -- ⑥ HAVING
ORDER BY order_count DESC              -- ⑧ ORDER BY（在 SELECT 之后，所以能用别名）
LIMIT 10;                             -- ⑨ LIMIT
                                       -- ⑦ SELECT（含 DISTINCT）
```

#### ① FROM —— 确定数据来源

```
FROM orders o
```

第一步先确定从哪张表取数据，加载 `orders` 表（逻辑上生成一个虚拟表 VT1）。

**为什么最先执行**：你得先知道"从哪里取数据"，后面的过滤、分组、排序才有操作对象。就像做菜之前先得把食材拿出来。

#### ② ON —— 连接条件

```
ON o.user_id = u.id
```

确定两张表之间的关联条件，准备进行连接。

#### ③ JOIN —— 表连接

```
JOIN users u
```

根据 ON 条件把 `orders` 和 `users` 连接起来，生成笛卡尔积的子集（VT2）。

不同 JOIN 类型的处理：
- INNER JOIN：只保留两表都匹配的行
- LEFT JOIN：保留左表所有行，右表不匹配的填 NULL
- RIGHT JOIN：保留右表所有行，左表不匹配的填 NULL

**为什么在 WHERE 之前**：JOIN 先把两张表"拼"成一张宽表，WHERE 再从这张宽表上过滤。如果先 WHERE 再 JOIN，那 WHERE 条件里涉及另一张表的字段就没法用了。

#### ④ WHERE —— 行级过滤

```
WHERE o.amount > 100
```

对 JOIN 后的结果逐行过滤，不满足条件的行被丢弃（VT3）。

**为什么在 GROUP BY 之前**：先过滤掉不需要的行，再分组。减少参与分组的数据量，效率更高。

**关键限制**：WHERE 中**不能使用聚合函数**（如 `WHERE COUNT(*) > 5` 是错的），因为此时还没分组，聚合函数无法计算。也**不能使用 SELECT 中定义的别名**（如 `WHERE order_count > 5` 是错的），因为 SELECT 还没执行。

#### ⑤ GROUP BY —— 分组

```
GROUP BY u.city
```

按指定列分组，相同值的行归为一组（VT4）。分组后每组只能输出一行结果。

**为什么在 HAVING 之前**：得先分好组，才能对每组做聚合计算（COUNT、SUM 等），HAVING 才有东西可过滤。

#### ⑥ HAVING —— 组级过滤

```
HAVING COUNT(*) > 5
```

对分组后的结果进行过滤，不满足条件的**组**被丢弃（VT5）。

**HAVING vs WHERE 的区别**：
- WHERE 在分组前过滤**行**，不能用聚合函数
- HAVING 在分组后过滤**组**，可以用聚合函数

```sql
-- 错误：WHERE 不能用聚合函数
SELECT city, COUNT(*) FROM orders GROUP BY city WHERE COUNT(*) > 5;

-- 正确：HAVING 过滤组
SELECT city, COUNT(*) FROM orders GROUP BY city HAVING COUNT(*) > 5;
```

#### ⑦ SELECT —— 选择列 + 计算表达式

```
SELECT DISTINCT u.city, COUNT(*) AS order_count
```

到这一步才决定最终输出哪些列，计算表达式和别名。

**为什么这么晚**：SELECT 只是"选择要展示什么"，它依赖前面所有步骤的结果——需要 FROM 的表、JOIN 的关联、WHERE 的过滤、GROUP BY 的分组、HAVING 的筛选全部完成后，才知道最终有哪些数据，然后从中选列输出。

**这就是为什么 WHERE 里不能用 SELECT 的别名**：

```sql
-- 错误：WHERE 执行时 SELECT 还没执行，order_count 别名不存在
SELECT COUNT(*) AS order_count FROM orders GROUP BY city WHERE order_count > 5;

-- 正确：HAVING 虽然也在 SELECT 前，但 SQL 标准允许 HAVING 引用聚合表达式
SELECT COUNT(*) AS order_count FROM orders GROUP BY city HAVING COUNT(*) > 5;
```

**注意**：MySQL 做了扩展，允许在 HAVING 和 ORDER BY 中使用 SELECT 的别名（标准 SQL 不一定允许）。

#### DISTINCT —— 去重

在 SELECT 之后对结果集去重。

#### ⑧ ORDER BY —— 排序

```
ORDER BY order_count DESC
```

对最终结果排序。

**为什么在 SELECT 之后**：排序需要知道最终的列和值（包括计算列、别名），所以必须等 SELECT 完成。这也是为什么 **ORDER BY 可以使用 SELECT 中定义的别名**。

#### ⑨ LIMIT —— 截取

```
LIMIT 10
```

最后截取前 N 行返回给客户端。

**为什么最后执行**：得先排好序，再取前 N 行才有意义。如果先 LIMIT 再排序，结果就乱了。

### 三、执行顺序一图流

```
┌─────────────────────────────────────────────────────┐
│  ① FROM        确定数据来源，加载表                     │
│  ② ON          确定连接条件                            │
│  ③ JOIN        执行表连接，生成中间结果集                │
│  ④ WHERE       行级过滤（不能用聚合函数、不能用别名）     │
│  ⑤ GROUP BY    分组                                   │
│  ⑥ HAVING      组级过滤（可以用聚合函数）                │
│  ⑦ SELECT      选择列、计算表达式、定义别名              │
│     DISTINCT   去重                                   │
│  ⑧ ORDER BY    排序（可以用别名）                       │
│  ⑨ LIMIT       截取前 N 行                             │
└─────────────────────────────────────────────────────┘
```

### 四、执行顺序的实际影响

#### 影响 1：别名的可用范围

```sql
SELECT amount * 0.9 AS discounted_price FROM orders
WHERE discounted_price > 100;   -- ✗ 错误！WHERE 在 SELECT 之前，别名不存在
ORDER BY discounted_price;      -- ✓ 正确！ORDER BY 在 SELECT 之后
```

#### 影响 2：WHERE vs HAVING 的选择

能用 WHERE 过滤的就不要放到 HAVING：

```sql
-- 低效：所有行先分组，再用 HAVING 过滤
SELECT city, COUNT(*) FROM orders
GROUP BY city HAVING city != '北京';

-- 高效：WHERE 先过滤掉北京，再分组（参与分组的数据量更少）
SELECT city, COUNT(*) FROM orders
WHERE city != '北京' GROUP BY city;
```

#### 影响 3：JOIN 优化——条件放在 ON 还是 WHERE

LEFT JOIN 时，条件放在 ON 和 WHERE 结果不同：

```sql
-- ON 中的条件：不影响左表行的保留，不匹配的右表填 NULL
SELECT * FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.amount > 100;
-- 所有 users 都会出现，没有 >100 订单的 users 对应的 orders 列为 NULL

-- WHERE 中的条件：JOIN 之后再过滤，会把不满足的行（包括左表）都丢掉
SELECT * FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100;
-- 没有 >100 订单的 users 会被过滤掉（LEFT JOIN 退化成 INNER JOIN）
```

### 五、补充：实际执行 vs 逻辑顺序

上面说的是**逻辑执行顺序**（SQL 标准定义的语义），实际 MySQL 的查询优化器会做大量改写和优化：

- **谓词下推**：把 WHERE 条件尽可能下推到 JOIN 之前甚至 FROM 阶段
- **JOIN 顺序重排**：优化器自动选择最优的表连接顺序（不一定按你写的顺序）
- **索引选择**：根据 WHERE、JOIN 条件选择合适的索引
- **子查询改写**：IN 子查询可能被改写为 semi-join

所以**逻辑顺序决定了 SQL 的语义（什么语法合法、结果是什么），物理执行顺序由优化器决定（怎么跑最快）**。

### 六、面试回答模板

> "SQL 的执行顺序和书写顺序不同。逻辑执行顺序是：**FROM → ON → JOIN → WHERE → GROUP BY → HAVING → SELECT → DISTINCT → ORDER BY → LIMIT**。理解这个顺序的关键在于：FROM 最先执行确定数据来源；WHERE 在 GROUP BY 之前做行级过滤所以不能用聚合函数；SELECT 在 HAVING 之后执行所以 WHERE 不能用别名但 ORDER BY 可以；HAVING 在 GROUP BY 之后做组级过滤所以可以用聚合函数。实际影响：能用 WHERE 过滤的不要放 HAVING（减少分组数据量）；LEFT JOIN 的条件放 ON 和 WHERE 结果不同（WHERE 会让 LEFT JOIN 退化为 INNER JOIN）。当然这是逻辑顺序，实际执行时优化器会做谓词下推、JOIN 重排等优化。"

---

## MySQL 一条查询语句和一条更新语句的执行流程

**类别**：MySQL / 架构 / 执行原理

### 一、先搞清 MySQL 的整体架构

MySQL 分为两大层：**Server 层**和**存储引擎层**。

```
┌──────────────────────────────────────────────┐
│                  Server 层                    │
│                                              │
│  客户端 → ① 连接器 → ② 查询缓存（8.0已移除）   │
│           → ③ 分析器 → ④ 优化器 → ⑤ 执行器    │
│                                              │
├──────────────────────────────────────────────┤
│                存储引擎层                      │
│                                              │
│  InnoDB / MyISAM / Memory ...                │
│  （数据的存储和读取）                           │
│                                              │
│  InnoDB 内部：                                │
│  Buffer Pool、undo log、redo log、锁、MVCC    │
└──────────────────────────────────────────────┘
```

各组件职责：

| 组件       | 职责                                                              |
| -------- | --------------------------------------------------------------- |
| **连接器**  | 管理客户端连接、身份认证（用户名密码）、权限校验                                        |
| **查询缓存** | key=SQL语句，value=结果集；命中直接返回。**MySQL 8.0 已彻底移除**（命中率低，表一更新整个缓存失效） |
| **分析器**  | 词法分析（识别关键字、表名、列名）+ 语法分析（构建语法树，检查 SQL 是否合法）                      |
| **优化器**  | 决定执行计划：选择索引、JOIN 顺序、是否用覆盖索引等                                    |
| **执行器**  | 校验权限 → 调用存储引擎接口逐行/批量读写数据 → 返回结果                                 |

### 二、一条查询语句的执行流程

```sql
SELECT * FROM users WHERE id = 1;
```

```
客户端发送 SQL
    │
    ▼
① 连接器
    - 验证用户名密码
    - 获取该用户的权限信息（后续操作都基于此时获取的权限）
    │
    ▼
② 查询缓存（MySQL 8.0 前）
    - 以 SQL 字符串为 key 查缓存
    - 命中 → 直接返回结果（跳过后续所有步骤）
    - 未命中 → 继续往下
    - 注意：SQL 多一个空格都不命中（精确匹配）
    │
    ▼
③ 分析器
    - 词法分析：识别出 SELECT、*、FROM、users、WHERE、id、=、1
    - 语法分析：构建语法树，检查语法是否正确
    - 如果表名/列名不存在 → 报错 "Unknown column / Table doesn't exist"
    │
    ▼
④ 优化器
    - 决定执行计划：
      · id = 1 → 走主键索引（聚簇索引直接定位）
      · 如果是 WHERE name = 'xxx' AND age > 25 → 选择走 name 索引还是 age 索引
      · 多表 JOIN 时决定驱动表顺序
    - 生成执行计划
    │
    ▼
⑤ 执行器
    - 校验权限：当前用户有没有 users 表的 SELECT 权限
    - 调用存储引擎接口：
      · 调用 InnoDB：根据主键 id=1 在 B+ 树中查找
      · InnoDB 先查 Buffer Pool（内存）
        - 命中 → 直接返回数据页
        - 未命中 → 从磁盘加载数据页到 Buffer Pool → 返回
    - 执行器拿到数据后返回给客户端
    - 如果有查询缓存 → 把结果放入缓存
```

**一句话**：连接器（认证）→ 查询缓存（8.0 前）→ 分析器（词法+语法）→ 优化器（执行计划）→ 执行器（调存储引擎取数据）→ 返回结果。

### 三、一条更新语句的执行流程

```sql
UPDATE users SET name = '张三' WHERE id = 1;
```

更新语句比查询**多了日志写入环节**——涉及 redo log 和 binlog 的**两阶段提交**。

```
客户端发送 SQL
    │
    ▼
① 连接器 → ② 分析器 → ③ 优化器
    （和查询一样：认证 → 解析 → 生成执行计划）
    （更新语句会使查询缓存中该表的所有缓存失效）
    │
    ▼
④ 执行器 + 存储引擎协作（核心区别在这里）

    Step 1：读取旧数据
    ┌─────────────────────────────────────────────┐
    │ 执行器调用 InnoDB：查找 id=1 的行               │
    │ → Buffer Pool 有 → 直接返回                    │
    │ → Buffer Pool 没有 → 从磁盘读到 Buffer Pool     │
    │ 返回旧数据 (id=1, name='李四')                  │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    Step 2：写 undo log
    ┌─────────────────────────────────────────────┐
    │ InnoDB 将旧值 (name='李四') 写入 undo log      │
    │ → 用于事务回滚和 MVCC 版本链                     │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    Step 3：更新内存（Buffer Pool）
    ┌─────────────────────────────────────────────┐
    │ 在 Buffer Pool 中将 id=1 的 name 改为 '张三'    │
    │ 该数据页变成"脏页"（内存和磁盘不一致）              │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    Step 4：写 redo log（prepare 状态）
    ┌─────────────────────────────────────────────┐
    │ InnoDB 将本次修改写入 redo log                  │
    │ 状态标记为 prepare（预提交）                     │
    │ redo log 是物理日志：记录"某数据页某偏移量改成XX"   │
    │ 写入方式：顺序写入，性能远高于随机写磁盘             │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    Step 5：写 binlog
    ┌─────────────────────────────────────────────┐
    │ 执行器将本次操作写入 binlog                      │
    │ binlog 是逻辑日志：记录"对 id=1 做了什么修改"      │
    │ binlog 属于 Server 层（所有引擎通用）             │
    │ 用途：主从复制、数据恢复                          │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    Step 6：提交事务（redo log 改为 commit 状态）
    ┌─────────────────────────────────────────────┐
    │ InnoDB 将 redo log 状态从 prepare 改为 commit   │
    │ 事务正式提交，更新完成                            │
    └─────────────────────────────────────────────┘
                    │
                    ▼
    后台：脏页刷盘
    ┌─────────────────────────────────────────────┐
    │ InnoDB 后台线程择机将 Buffer Pool 中的脏页        │
    │ 刷回磁盘（checkpoint 机制）                      │
    │ 注意：这不是立即执行的，而是异步的                  │
    └─────────────────────────────────────────────┘
```

### 四、redo log 和 binlog 的两阶段提交

这是更新流程中**最核心的考点**。

#### 为什么需要两阶段提交？

redo log（InnoDB 引擎层）和 binlog（Server 层）是两个独立的日志系统，如果不做协调，可能出现不一致：

**场景 1：先写 redo log 后写 binlog，redo log 写完崩溃**
```
redo log：id=1, name='张三'  ✓ 已写入
binlog：                     ✗ 还没写
→ 重启后 InnoDB 用 redo log 恢复 → 数据是 '张三'
→ 但 binlog 没有这条记录 → 从库同步 binlog 后数据还是 '李四'
→ 主从不一致！
```

**场景 2：先写 binlog 后写 redo log，binlog 写完崩溃**
```
binlog：UPDATE name='张三'   ✓ 已写入
redo log：                   ✗ 还没写
→ 重启后 InnoDB 没有 redo log → 数据还是 '李四'
→ 但 binlog 有记录 → 从库同步后变成 '张三'
→ 主从不一致！
```

#### 两阶段提交怎么解决

```
① redo log 写入，状态 = prepare
② binlog 写入
③ redo log 状态改为 commit

崩溃恢复规则：
- redo log 是 commit 状态 → 直接提交（正常完成）
- redo log 是 prepare 状态 + binlog 完整 → 提交（②已完成）
- redo log 是 prepare 状态 + binlog 不完整 → 回滚（②没完成）
```

这样无论在哪个步骤崩溃，恢复后 redo log 和 binlog **要么都有、要么都没有**，保证一致。

### 五、三种日志对比

| | redo log | binlog | undo log |
|---|---------|--------|----------|
| **所属层** | InnoDB 引擎层 | Server 层 | InnoDB 引擎层 |
| **日志类型** | 物理日志（数据页的修改） | 逻辑日志（SQL 或行变更） | 逻辑日志（反向操作） |
| **写入时机** | 事务执行中持续写入 | 事务提交时写入 | 修改前写入 |
| **用途** | **崩溃恢复**（保证持久性） | **主从复制** + 数据恢复 | **事务回滚** + MVCC |
| **大小** | 固定大小，循环写（环形缓冲） | 追加写，不覆盖 | 追加写 |
| **是否所有引擎都有** | 仅 InnoDB | 所有引擎 | 仅 InnoDB |

### 六、查询 vs 更新的流程对比

```
查询：连接器 → 缓存 → 分析器 → 优化器 → 执行器 → 存储引擎读数据 → 返回

更新：连接器 → 分析器 → 优化器 → 执行器 → 存储引擎：
      读旧数据 → 写 undo log → 更新 Buffer Pool
      → 写 redo log(prepare) → 写 binlog → redo log(commit)
      → 后台异步刷脏页
```

关键区别：
- 更新多了 **undo log**（回滚 + MVCC）、**redo log**（崩溃恢复）、**binlog**（主从复制）
- 更新的数据先改内存（Buffer Pool），**不立即写磁盘**，靠 redo log 保证崩溃后能恢复
- redo log 和 binlog 通过**两阶段提交**保证一致性

### 七、面试回答模板

> "**查询语句**的执行流程：客户端连接后经过**连接器**认证鉴权 → **查询缓存**（8.0 已移除）→ **分析器**做词法语法解析 → **优化器**选择索引和执行计划 → **执行器**调用存储引擎接口读数据返回。
>
> **更新语句**的前半段和查询一样（解析 + 优化），核心区别在执行阶段：执行器调 InnoDB 读取旧数据 → 写 **undo log**（保存旧值用于回滚和 MVCC）→ 在 **Buffer Pool** 中更新数据（变成脏页）→ 写 **redo log 并标记为 prepare** → 写 **binlog** → 将 redo log 标记为 **commit**。这个 redo log 和 binlog 的**两阶段提交**保证了崩溃恢复时两份日志的一致性——恢复时 redo log 是 commit 直接提交，prepare + binlog 完整也提交，prepare + binlog 不完整则回滚。脏页由后台线程异步刷盘，不阻塞事务提交。"

---

## MySQL 存储引擎与索引类型（B+ 树 / 哈希 / 全文索引）

**类别**：MySQL / 存储引擎 / 索引原理

### 一、MySQL 存储引擎

MySQL 采用**插件式存储引擎架构**——Server 层负责 SQL 解析、优化、执行，存储引擎层负责数据的存储和读取。不同的表可以使用不同的存储引擎。

#### InnoDB（默认引擎，MySQL 5.5+ 开始）

**最重要、面试必考的引擎。**

| 特性 | 说明 |
|------|------|
| **事务支持** | 完整 ACID 支持（Atomicity, Consistency, Isolation, Durability） |
| **行级锁** | 默认行级锁（Record Lock、Gap Lock、Next-Key Lock），并发性能好 |
| **MVCC** | 通过 undo log 版本链 + ReadView 实现多版本并发控制 |
| **外键** | 支持外键约束 |
| **崩溃恢复** | 通过 redo log（WAL）保证崩溃后数据不丢 |
| **索引结构** | B+ 树（聚簇索引 + 二级索引）；自适应哈希索引（内部自动优化） |
| **存储方式** | 聚簇索引：数据和主键索引存在一起（.ibd 文件） |
| **适用场景** | 几乎所有 OLTP 场景，特别是需要事务、高并发读写的业务 |

#### MyISAM（MySQL 5.5 之前的默认引擎）

| 特性 | 说明 |
|------|------|
| **事务支持** | ❌ 不支持事务 |
| **锁级别** | 表级锁，并发写性能差 |
| **MVCC** | ❌ 不支持 |
| **外键** | ❌ 不支持 |
| **崩溃恢复** | 能力弱，可能数据损坏 |
| **全文索引** | ✅ 原生支持全文索引（InnoDB 5.6+ 也支持了） |
| **存储方式** | 非聚簇索引：数据文件（.MYD）和索引文件（.MYI）分开存放 |
| **计数优化** | `SELECT COUNT(*)` 直接存了行数，O(1) 返回（InnoDB 需要遍历） |
| **适用场景** | 读多写少、不需要事务的场景（如日志表、统计表）；现在基本被 InnoDB 替代 |

#### Memory（HEAP）

| 特性 | 说明 |
|------|------|
| **存储位置** | 数据全部存在**内存**中 |
| **索引结构** | 默认**哈希索引**（也支持 B+ 树索引） |
| **事务支持** | ❌ 不支持 |
| **持久化** | ❌ 重启数据丢失 |
| **锁级别** | 表级锁 |
| **适用场景** | 临时表、缓存表、会话级临时数据 |

#### 三大引擎对比

| | InnoDB | MyISAM | Memory |
|---|--------|--------|--------|
| 事务 | ✅ | ❌ | ❌ |
| 行级锁 | ✅ | ❌（表锁） | ❌（表锁） |
| MVCC | ✅ | ❌ | ❌ |
| 外键 | ✅ | ❌ | ❌ |
| 崩溃恢复 | ✅（redo log） | 弱 | ❌（内存丢失） |
| 全文索引 | ✅（5.6+） | ✅ | ❌ |
| 哈希索引 | 自适应（内部） | ❌ | ✅（默认） |
| 聚簇索引 | ✅ | ❌ | ❌ |
| COUNT(*) | 遍历计算 | O(1) 直接返回 | 遍历计算 |

### 二、B+ 树索引（最核心）

MySQL（InnoDB）默认的索引结构，面试中说"索引"基本就是指 B+ 树索引。

#### 为什么是 B+ 树而不是其他数据结构？

| 数据结构 | 问题 |
|---------|------|
| 二叉搜索树 | 可能退化成链表，O(n) |
| AVL / 红黑树 | 树太高（二叉 → 每层只分 2 路），磁盘 IO 次数 = 树高，太多 |
| B 树 | 非叶节点也存数据 → 每个节点能放的 key 更少 → 树更高 → IO 更多 |
| **B+ 树** | 非叶节点只存 key 不存数据 → 每个节点能放更多 key → 树更矮 → IO 更少 |
| 哈希 | 不支持范围查询、排序 |

#### B+ 树的核心特点

```
          [30 | 60]                    ← 非叶节点（只存 key，不存数据）
         /    |    \
    [10|20] [40|50] [70|80|90]         ← 非叶节点
    / | \   / | \   / |  |  \
   叶  叶  叶  叶  叶  叶  叶  叶       ← 叶节点（存 key + 数据/指针）
   ←→  ←→  ←→  ←→  ←→  ←→  ←→         ← 叶节点之间双向链表
```

1. **非叶节点只存 key，不存数据** → 每个 16KB 的页能放更多 key → 树更矮（通常 3-4 层就能存千万级数据）
2. **数据全部存在叶节点** → 每次查询都要走到叶子，查询性能稳定
3. **叶节点之间用双向链表连接** → 天然支持范围查询和排序（沿链表扫描即可）
4. **树高 = 磁盘 IO 次数**：3 层 B+ 树 → 最多 3 次磁盘 IO 就能定位到数据

#### InnoDB 的两种 B+ 树索引

**聚簇索引（主键索引）**：
- 叶节点存储**完整行数据**
- 一张表只有一个聚簇索引（主键）
- 数据按主键顺序物理存储

**二级索引（非主键索引）**：
- 叶节点存储**索引列的值 + 主键值**（不存完整行数据）
- 通过二级索引查询时，先从二级索引找到主键 → 再回到聚簇索引取完整数据（**回表**）
- 如果查询的列全在索引中（**覆盖索引**），则不需要回表

```
聚簇索引（主键 id）：
叶节点：[id=1, name='张三', age=25, ...完整行数据]

二级索引（name 列）：
叶节点：[name='张三', id=1]  ← 只存 name 和主键 id

查 SELECT * FROM users WHERE name = '张三'：
  ① 二级索引查 name='张三' → 拿到 id=1
  ② 回到聚簇索引查 id=1 → 拿到完整行数据（回表）

查 SELECT id, name FROM users WHERE name = '张三'：
  ① 二级索引查 name='张三' → 直接拿到 id 和 name
  ② 不需要回表（覆盖索引）
```

### 三、哈希索引

#### 原理

用哈希表实现：对索引列的值计算哈希值，定位到桶（bucket），桶里存指向数据行的指针。

```
key='张三' → hash('张三') = 42 → bucket[42] → 指向行数据
```

#### 特点

| 优势 | 限制 |
|------|------|
| 等值查询极快，O(1) | ❌ **不支持范围查询**（`> < BETWEEN`），哈希值无序 |
| | ❌ **不支持排序**（ORDER BY），哈希值无序 |
| | ❌ **不支持最左前缀匹配**（联合索引只能全列命中） |
| | ❌ **不支持 LIKE 前缀匹配** |
| | ❌ 哈希冲突时退化为链表遍历 |

#### MySQL 中哈希索引的存在形式

**1. Memory 引擎**：默认索引类型就是哈希索引

```sql
CREATE TABLE cache_table (
    id INT,
    value VARCHAR(100),
    INDEX USING HASH (id)
) ENGINE = MEMORY;
```

**2. InnoDB 自适应哈希索引（Adaptive Hash Index, AHI）**：

- InnoDB 自动维护，**用户不能手动创建**
- 当 InnoDB 发现某些索引页被频繁访问时，自动在内存中为这些热点页建哈希索引
- 等值查询从 B+ 树的 O(logN) 优化到 O(1)
- 完全由引擎内部管理，对用户透明

```sql
-- 查看 AHI 状态
SHOW ENGINE INNODB STATUS;  -- 搜索 "Hash table size"

-- 开关控制
SET GLOBAL innodb_adaptive_hash_index = ON/OFF;
```

### 四、全文索引（Full-Text Index）

#### 解决什么问题

普通 B+ 树索引做文本搜索时，只支持**前缀匹配**（`LIKE '张%'`），不支持**包含匹配**（`LIKE '%关键词%'`，这会全表扫描）。

全文索引解决的就是**在大段文本中高效搜索关键词**的问题。

#### 原理：倒排索引（Inverted Index）

```
文档1："MySQL 是一个关系型数据库"
文档2："Redis 是一个缓存数据库"
文档3："MySQL 支持全文索引"

构建倒排索引：
┌──────────┬──────────────┐
│ 关键词    │ 出现在哪些文档  │
├──────────┼──────────────┤
│ MySQL    │ 文档1, 文档3   │
│ 数据库    │ 文档1, 文档2   │
│ Redis    │ 文档2         │
│ 缓存      │ 文档2         │
│ 全文索引   │ 文档3         │
│ 关系型    │ 文档1         │
└──────────┴──────────────┘

搜索 "MySQL"：
  → 查倒排索引 → 文档1, 文档3 → 直接定位，不用扫全表
```

**本质**：从"文档 → 包含哪些词"反转为"词 → 出现在哪些文档"，搜索时直接通过词定位文档。

#### MySQL 中的使用

```sql
-- 创建全文索引
CREATE TABLE articles (
    id INT PRIMARY KEY,
    title VARCHAR(200),
    content TEXT,
    FULLTEXT INDEX ft_idx (title, content)
) ENGINE = InnoDB;

-- 使用全文索引查询（MATCH ... AGAINST）
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('MySQL 索引' IN NATURAL LANGUAGE MODE);

-- 布尔模式（更灵活，支持 +/- 操作符）
SELECT * FROM articles
WHERE MATCH(title, content) AGAINST('+MySQL -Redis' IN BOOLEAN MODE);
-- +MySQL：必须包含 MySQL
-- -Redis：不能包含 Redis
```

#### 全文索引的限制

| 限制 | 说明 |
|------|------|
| 中文支持 | MySQL 5.7.6+ 内置 ngram 分词器支持中文，之前需要第三方插件 |
| 最小词长 | 默认 3 个字符（`innodb_ft_min_token_size`），太短的词不索引 |
| 停用词 | 常见词（the, a, is 等）默认不索引 |
| 性能 | 大数据量下不如专业搜索引擎（Elasticsearch） |
| 事务性 | 全文索引更新有延迟（InnoDB 内部有缓存） |

**生产建议**：简单的关键词搜索可以用 MySQL 全文索引；复杂搜索需求（分词、相关性排序、拼音、同义词等）直接上 **Elasticsearch**。

### 五、三种索引类型对比

| | B+ 树索引 | 哈希索引 | 全文索引 |
|---|---------|---------|---------|
| **数据结构** | B+ 树 | 哈希表 | 倒排索引 |
| **等值查询** | O(logN)，3-4 次 IO | O(1)，最快 | 不适用 |
| **范围查询** | ✅ 天然支持（叶节点链表） | ❌ 不支持 | 不适用 |
| **排序** | ✅ 支持 | ❌ 不支持 | 按相关性排序 |
| **模糊匹配** | 前缀匹配（LIKE 'abc%'） | ❌ 不支持 | ✅ 全文搜索 |
| **适用场景** | 绝大部分查询 | 精确等值查询 | 文本关键词搜索 |
| **InnoDB 支持** | ✅ 默认 | 自适应（自动） | ✅（5.6+） |
| **Memory 支持** | ✅ | ✅（默认） | ❌ |

### 六、面试回答模板

> "MySQL 的存储引擎是插件式的，最重要的是 **InnoDB**（默认，支持事务、行级锁、MVCC、崩溃恢复）和 **MyISAM**（不支持事务，表级锁，COUNT(*) O(1)，基本已被淘汰）。Memory 引擎数据存内存，重启丢失，默认哈希索引。
>
> 索引类型方面：**B+ 树索引**是 InnoDB 的默认索引，非叶节点只存 key 让树更矮（3 层存千万数据），叶节点用双向链表连接支持范围查询和排序。聚簇索引叶节点存完整行数据，二级索引叶节点存主键需要回表。**哈希索引**等值查询 O(1) 最快，但不支持范围查询和排序；InnoDB 内部有自适应哈希索引对热点页自动优化，用户不能手动创建。**全文索引**基于倒排索引，解决文本关键词搜索问题，MySQL 5.7.6+ 支持中文（ngram 分词），但大规模场景建议用 Elasticsearch。"

---

## MySQL 三大日志：binlog、redo log、undo log

**类别**：MySQL / InnoDB / 日志机制 / 事务

### 一、全景图：三种日志各保什么

```
                  ┌──────────────────────────────────────┐
                  │             一条 UPDATE 语句           │
                  └──────────┬───────────────────────────┘
                             │
         ┌───────────────────┼───────────────────────┐
         │                   │                       │
         ▼                   ▼                       ▼
   ┌──────────┐       ┌──────────┐           ┌──────────┐
   │ undo log │       │ redo log │           │  binlog  │
   │          │       │          │           │          │
   │ 记录旧值  │       │ 记录新值  │           │ 记录操作  │
   │ "改之前"  │       │ "改之后"  │           │ "改了啥"  │
   │          │       │          │           │          │
   │ 用途：    │       │ 用途：    │           │ 用途：    │
   │ 回滚     │       │ 崩溃恢复  │           │ 主从复制  │
   │ MVCC     │       │ 持久性    │           │ 数据恢复  │
   └──────────┘       └──────────┘           └──────────┘
    InnoDB 引擎层       InnoDB 引擎层            Server 层
```

**一句话记忆**：undo 管回滚，redo 管崩溃恢复，binlog 管复制和备份。

---

### 二、redo log（重做日志）

#### 它是什么

redo log 是 InnoDB 引擎层的**物理日志**，记录的是**"某个数据页的某个偏移量上的值改成了 XX"**。

#### 为什么需要它——WAL（Write-Ahead Logging）

InnoDB 更新数据时**不直接写磁盘**（随机 IO 太慢），而是：
1. 先改 Buffer Pool 中的内存页（变成脏页）
2. 把修改记录写入 redo log（**顺序写，极快**）
3. 事务提交后，脏页由后台线程择机异步刷盘

```
没有 redo log：
  UPDATE → 写磁盘（随机IO，慢）→ 如果还没写完就崩溃 → 数据丢失

有 redo log（WAL）：
  UPDATE → 改内存 + 写 redo log（顺序IO，快）→ 事务提交
  → 崩溃了？没关系，用 redo log 重放恢复
  → 脏页后台慢慢刷，不着急
```

**WAL 的核心思想**：用**顺序写日志**替代**随机写数据文件**，把持久性的保证从"写数据文件"转移到"写日志文件"。

#### redo log 的结构：环形缓冲

```
redo log 由一组固定大小的文件组成（如 4 个 1GB 文件）：

  ib_logfile0 → ib_logfile1 → ib_logfile2 → ib_logfile3
       ↑                                        │
       └────────────────────────────────────────┘
                     循环写入

  write pos：当前写入位置（往前推进）
  checkpoint：当前已刷盘的位置（往前推进）

  write pos 和 checkpoint 之间 = 还没刷盘的脏数据
  如果 write pos 追上 checkpoint → redo log 满了 → 必须停下来先刷脏页
```

#### redo log 的写入时机

| 时机 | 行为 |
|------|------|
| 事务执行中 | 修改操作持续产生 redo log，先写入 **redo log buffer**（内存） |
| 事务提交时 | 根据 `innodb_flush_log_at_trx_commit` 参数决定刷盘策略 |

#### innodb_flush_log_at_trx_commit（面试高频）

| 值 | 行为 | 性能 | 安全性 |
|----|------|------|--------|
| **0** | 每秒批量刷盘，不管是否提交 | 最快 | 最差（崩溃丢最多 1 秒数据） |
| **1**（默认） | 每次事务提交都 fsync 到磁盘 | 最慢 | 最安全（不丢数据） |
| **2** | 每次提交写到 OS page cache，每秒 fsync | 中等 | 中等（OS 崩溃才丢数据） |

**生产建议**：核心业务用 1，日志表等非关键数据可以用 2 提升性能。

#### redo log 的崩溃恢复过程

```
MySQL 崩溃重启：
  1. 读取 redo log，找到 checkpoint 之后的所有记录
  2. 将这些记录重放（redo）到 Buffer Pool / 数据文件
  3. 配合 undo log 回滚未提交的事务
  → 数据恢复到崩溃前的一致状态
```

---

### 三、binlog（归档日志）

#### 它是什么

binlog 是 **Server 层**的日志，所有存储引擎都可以使用。它是**逻辑日志**，记录的是**"对某一行做了什么修改"**（或原始 SQL 语句）。

#### 和 redo log 的核心区别

| | redo log | binlog |
|---|---------|--------|
| **所属层** | InnoDB 引擎层 | Server 层（所有引擎通用） |
| **日志类型** | 物理日志（页级修改） | 逻辑日志（行级变更 / SQL 语句） |
| **写入方式** | **循环写**，固定大小，写满会覆盖 | **追加写**，文件写满开新文件，不覆盖 |
| **用途** | 崩溃恢复（保证持久性） | 主从复制 + 数据恢复/审计 |
| **事务相关** | 事务执行中持续写入 | 事务提交时一次性写入 |

**关键区别**：redo log 是循环写会覆盖，不能用于长期归档；binlog 是追加写不覆盖，可以保留完整历史，所以主从复制和数据恢复靠 binlog。

#### binlog 的三种格式

| 格式 | 记录内容 | 优点 | 缺点 |
|------|---------|------|------|
| **STATEMENT** | 原始 SQL 语句 | 日志量小 | 某些函数（NOW()、RAND()）主从执行结果可能不同 |
| **ROW**（推荐） | 每一行的具体变更（改前值 + 改后值） | 精确，不会主从不一致 | 日志量大（UPDATE 100 万行 = 100 万条记录） |
| **MIXED** | 默认用 STATEMENT，遇到不确定函数自动切 ROW | 折中 | 实现复杂，有些场景仍可能不一致 |

**生产建议**：用 **ROW 格式**，牺牲存储换精确性。大厂基本都是 ROW。

#### binlog 的用途

**1. 主从复制**

```
主库：事务提交 → 写 binlog
  ↓
binlog dump 线程 → 将 binlog 发送给从库
  ↓
从库 IO 线程：接收 binlog → 写入 relay log（中继日志）
  ↓
从库 SQL 线程：读取 relay log → 重放 SQL → 数据和主库一致
```

**2. 数据恢复（基于时间点恢复）**

```
场景：有人误删了表（DROP TABLE）
恢复流程：
  1. 用最近的全量备份恢复到某个时间点
  2. 从该时间点开始，用 binlog 重放后续所有操作
  3. 跳过那条 DROP TABLE
  → 数据恢复到删表之前的状态
```

**3. 数据同步**（Canal 监听 binlog → 同步到 ES / Redis / 数据仓库）

#### sync_binlog 参数（面试高频）

| 值 | 行为 | 安全性 |
|----|------|--------|
| **0** | 由 OS 决定何时 fsync | 最快，崩溃可能丢 |
| **1**（推荐） | 每次事务提交都 fsync | 最安全 |
| **N** | 每 N 次事务提交 fsync 一次 | 折中 |

---

### 四、undo log（回滚日志）

#### 它是什么

undo log 是 InnoDB 引擎层的**逻辑日志**，记录的是**数据修改前的旧值**（反向操作）。

```
执行 UPDATE users SET name='张三' WHERE id=1;（原来 name='李四'）

undo log 记录：
  "将 id=1 的 name 从 '张三' 改回 '李四'"
  （存的是反向操作，不是原始 SQL）
```

#### 两大用途

**用途 1：事务回滚**

```
BEGIN;
UPDATE users SET name='张三' WHERE id=1;  -- undo log: 记录旧值 '李四'
UPDATE users SET age=30 WHERE id=1;       -- undo log: 记录旧值 25
ROLLBACK;  -- 按 undo log 反向执行：age→25, name→'李四'，数据恢复原样
```

**用途 2：MVCC 版本链**

undo log 串成版本链，供 MVCC 的 ReadView 做可见性判断（这块在前面 MVCC 那道面试题中讲过）：

```
当前行：[id=1, name='张三', trx_id=100, roll_pointer→]
  ↓ roll_pointer
undo log 版本1：[id=1, name='李四', trx_id=80, roll_pointer→]
  ↓ roll_pointer
undo log 版本2：[id=1, name='王五', trx_id=50, roll_pointer→null]

事务读取时沿版本链找到自己 ReadView 可见的版本
```

#### undo log 的生命周期

| 类型 | 何时产生 | 何时删除 |
|------|---------|---------|
| **insert undo log** | INSERT 操作时 | 事务提交后立即删除（INSERT 的回滚只需删除新行，提交后无需保留） |
| **update undo log** | UPDATE / DELETE 操作时 | 事务提交后**不能立即删除**——因为可能有其他事务的 MVCC 快照读还需要它。由 **purge 线程**在没有任何事务引用时异步清理 |

**注意**：长事务会导致 undo log 大量堆积（因为 purge 线程不敢清理还在被引用的旧版本），最终导致表空间膨胀。这就是**生产中要避免长事务**的重要原因之一。

---

### 五、三种日志的协作：一条 UPDATE 的完整流程

```sql
UPDATE users SET name='张三' WHERE id=1;  -- 原值 name='李四'
```

```
① 从 Buffer Pool 读取 id=1 的数据页（不在则从磁盘加载）
② 写 undo log：记录旧值 (name='李四')                    ← 保证能回滚
③ 在 Buffer Pool 中修改数据 (name→'张三')，标记为脏页
④ 写 redo log，标记为 prepare 状态                       ← 保证崩溃能恢复
⑤ 写 binlog                                             ← 保证能复制和归档
⑥ 将 redo log 标记为 commit                              ← 两阶段提交完成
⑦ 后台异步刷脏页到磁盘（checkpoint）
```

**三条日志的写入时序**：undo log 最先（修改前）→ redo log prepare（修改后）→ binlog → redo log commit

---

### 六、两阶段提交的崩溃恢复

| 崩溃时机 | redo log 状态 | binlog 状态 | 恢复策略 |
|---------|--------------|-------------|---------|
| ④之前崩溃 | 无 / 不完整 | 无 | 事务未提交，用 undo log 回滚 |
| ④之后⑤之前 | prepare | 无 | binlog 不完整 → 回滚 |
| ⑤之后⑥之前 | prepare | 完整 | binlog 完整 → **提交**（补 commit） |
| ⑥之后 | commit | 完整 | 正常提交，恢复完成 |

**核心规则**：以 binlog 是否完整为准——prepare + binlog 完整 = 提交，prepare + binlog 不完整 = 回滚。

**目的**：为了保证binlog和redolog的一致性，从而在崩溃恢复和主从复制场景下确保数据不丢失、不紊乱。

---

### 七、面试回答模板

> "MySQL 有三种核心日志：
>
> **redo log** 是 InnoDB 的物理日志，实现 **WAL 机制**——更新时先改内存写 redo log（顺序 IO），不立即写数据文件（随机 IO），保证崩溃后能用 redo log 重放恢复数据。redo log 是循环写固定大小的文件，`innodb_flush_log_at_trx_commit=1` 保证每次提交都 fsync 不丢数据。
>
> **binlog** 是 Server 层的逻辑日志，追加写不覆盖，用于**主从复制**和**基于时间点的数据恢复**。三种格式中 **ROW 格式**最精确，记录每行的变更前后值。`sync_binlog=1` 保证每次提交都 fsync。
>
> **undo log** 是 InnoDB 的逻辑日志，记录旧值，用于**事务回滚**和 **MVCC 版本链**。update undo log 事务提交后不能立即删除（可能被其他事务的 MVCC 读引用），由 purge 线程异步清理，这也是要避免长事务的原因。
>
> 三者通过**两阶段提交**协作：undo log 先写（保回滚）→ redo log prepare → binlog → redo log commit。崩溃恢复时以 binlog 是否完整为准判断提交还是回滚，保证 redo log 和 binlog 一致。"

---

## Checkpoint 机制与脏页刷盘

**类别**：MySQL / InnoDB / 持久化 / 性能

### 一、为什么需要 Checkpoint

回顾 WAL 机制：InnoDB 更新数据时**先改内存（Buffer Pool），再写 redo log**，数据文件的修改由后台异步完成。这就产生了一个问题：

```
内存中有大量"脏页"（已修改但还没写回磁盘的数据页）
redo log 记录了这些修改

如果脏页永远不刷盘：
  1. Buffer Pool 内存有限，放不下更多新数据
  2. redo log 文件是循环写的、大小固定，写满了就不能再写
  3. 崩溃恢复时要从很早的位置开始重放，恢复时间极长
```

**Checkpoint 的作用**：告诉 InnoDB——"这个位置之前的 redo log 对应的脏页都已经刷到磁盘了，这些 redo log 可以被覆盖了，崩溃恢复也只需要从这个位置开始。"

```
redo log 文件（环形）：

  ┌──────────────────────────────────────────────┐
  │ [已刷盘,可覆盖] [已刷盘,可覆盖] [未刷盘] [未刷盘] │
  └──────────────────────────────────────────────┘
                     ↑                        ↑
                 checkpoint              write pos
                 (刷盘推进点)             (写入推进点)

  checkpoint → write pos 之间 = 还有脏页未刷盘的 redo log（不能覆盖）
  checkpoint 之前 = 脏页已刷盘，redo log 可以安全覆盖
```

### 二、Checkpoint 做了什么

Checkpoint 的核心动作就是两件事：

1. **将 Buffer Pool 中的脏页刷写到磁盘上的数据文件**
2. **推进 redo log 的 checkpoint 位置**（标记"这之前的 redo log 可以覆盖了"）

```
刷脏页前：
  checkpoint ────────── write pos
  [可覆盖][可覆盖][脏页][脏页][脏页][脏页]
                                      ↑ 快写满了！

刷脏页后（checkpoint 推进）：
              checkpoint ── write pos
  [可覆盖][可覆盖][可覆盖][可覆盖][脏页][脏页]
  ↑ 腾出了空间，可以继续写 redo log
```

### 三、两种 Checkpoint 类型

#### Sharp Checkpoint（全量刷盘）

将**所有脏页**一次性全部刷到磁盘。

```
触发时机：数据库正常关闭时（innodb_fast_shutdown=0）
```

**缺点**：刷盘期间数据库不可用，不能在运行时使用。

#### Fuzzy Checkpoint（部分刷盘，运行时使用）

只刷一部分脏页，不影响数据库正常运行。InnoDB 在运行时使用的都是 Fuzzy Checkpoint，它有以下几种触发场景：

### 四、Fuzzy Checkpoint 的四种触发场景

#### 场景 1：Master Thread 定时刷新

InnoDB 的主线程每隔一段时间会刷一批脏页：

```
每 1 秒：
  - 如果过去 1 秒的 IO 次数 < 5 → 认为 IO 空闲 → 刷 100 个脏页
  - 合并 Insert Buffer

每 10 秒：
  - 不管 IO 忙不忙 → 刷 100 个脏页
  - 合并 Insert Buffer
  - 删除无用的 undo log（purge）
  - 如果脏页比例 > 70% → 再多刷一些
```

**目的**：利用 IO 空闲时间"悄悄"刷脏页，不影响前台查询。

#### 场景 2：FLUSH_LRU_LIST —— Buffer Pool 腾空间

```
Buffer Pool 用 LRU 算法管理数据页：
  - 新读入的页放到 LRU 列表
  - 当 Buffer Pool 满了，需要淘汰最久未使用的页
  - 如果被淘汰的页是脏页 → 必须先刷盘才能释放

InnoDB 会保证 LRU 列表尾部始终有一定数量的空闲页（innodb_lru_scan_depth）
如果空闲页不够 → 触发 FLUSH_LRU_LIST checkpoint → 刷掉尾部的脏页腾空间
```

**触发条件**：Buffer Pool 可用空间不足时。

#### 场景 3：Async/Sync Flush —— redo log 快写满

这是**最紧急**的 checkpoint，redo log 空间不够了必须强制刷脏页。

```
定义两个水位线：
  async_water_mark = 75% 的 redo log 空间
  sync_water_mark  = 90% 的 redo log 空间

redo log 已用空间在 checkpoint 到 write pos 之间：

  已用 < 75%  → 不触发，正常写入
  75% ≤ 已用 < 90% → 触发 Async Flush（异步刷脏页，不阻塞前台）
  已用 ≥ 90%  → 触发 Sync Flush（同步刷脏页，阻塞前台所有写入！）
```

**Sync Flush 是最严重的情况**——前台所有 DML 操作被阻塞，直到刷够脏页腾出 redo log 空间。生产中如果频繁触发 Sync Flush，说明 redo log 文件太小或脏页刷盘太慢。

#### 场景 4：Dirty Page Too Much —— 脏页比例太高

```
参数：innodb_max_dirty_pages_pct（默认 75%）

当 Buffer Pool 中脏页比例超过该阈值 → 触发 Checkpoint → 刷脏页降低比例
```

### 五、InnoDB 怎么控制刷脏页的速度

InnoDB 不是"有脏页就拼命刷"，而是根据多个因素**动态调整刷盘速度**，在性能和安全之间平衡：

```
刷盘速度取决于：
  1. 脏页比例：越接近 innodb_max_dirty_pages_pct → 刷越快
  2. redo log 剩余空间：空间越少 → 刷越快
  3. innodb_io_capacity：告诉 InnoDB 磁盘的 IOPS 能力
     - HDD：建议设 200-400
     - SSD：建议设 2000-10000
     InnoDB 会按这个值的百分比来调节实际刷盘速度
  4. innodb_io_capacity_max：刷盘速度的上限
```

**关键参数 `innodb_io_capacity`**：

如果设太低（比如 SSD 上还用默认的 200），InnoDB 会以为磁盘很慢、不敢多刷 → 脏页堆积 → 最终触发 Sync Flush → 前台阻塞。**这是生产中常见的性能问题**。

### 六、Buffer Pool 与 LRU 算法

脏页管理离不开 Buffer Pool 的 LRU 策略，补充一下：

#### 传统 LRU 的问题

```
如果做一次全表扫描：
  大量冷数据页被读入 → 把热点页从 LRU 头部挤走 → 缓存命中率暴跌
```

#### InnoDB 改良的 LRU：冷热分离

```
Buffer Pool LRU 列表分两段：

  ┌──────────── Young 区（热数据，默认 5/8）──────────────┐
  │ 最近频繁访问的页                                       │
  ├──────────── Old 区（冷数据，默认 3/8）──────────────┤
  │ 新读入的页先放在这里                                    │
  └─────────────────────────────────────────────────────┘

  - 新读入的页放到 Old 区头部（不放 Young 区）
  - 只有在 Old 区存活超过 innodb_old_blocks_time（默认 1s）
    且再次被访问时，才提升到 Young 区
  - 这样全表扫描的页大概率只在 Old 区短暂停留就被淘汰，不会冲掉热数据
```

### 七、Checkpoint 相关参数汇总

| 参数 | 含义 | 建议值 |
|------|------|--------|
| `innodb_log_file_size` | 单个 redo log 文件大小 | 1-4GB（太小容易触发 Sync Flush） |
| `innodb_log_files_in_group` | redo log 文件数量 | 2-4 个 |
| `innodb_io_capacity` | 告诉 InnoDB 磁盘的 IOPS | SSD: 2000+，HDD: 200 |
| `innodb_max_dirty_pages_pct` | 脏页比例阈值 | 75%（默认） |
| `innodb_buffer_pool_size` | Buffer Pool 大小 | 物理内存的 50-80% |
| `innodb_flush_log_at_trx_commit` | redo log 刷盘策略 | 1（最安全） |
| `innodb_lru_scan_depth` | LRU 尾部扫描深度 | 1024（默认） |
| `innodb_old_blocks_time` | 冷区页提升到热区的等待时间 | 1000ms（默认） |

### 八、面试回答模板

> "Checkpoint 的作用是**将 Buffer Pool 中的脏页刷到磁盘，并推进 redo log 的可覆盖位置**。因为 redo log 是循环写固定大小的，checkpoint 之前的 redo log 对应的脏页已刷盘可以被覆盖，checkpoint 到 write pos 之间的不能覆盖。
>
> InnoDB 运行时使用 **Fuzzy Checkpoint**（部分刷盘），有四种触发场景：①**Master Thread 定时刷新**（利用 IO 空闲刷 100 个脏页）；②**LRU 淘汰脏页**（Buffer Pool 空间不足时先刷再淘汰）；③**redo log 快满**（最紧急，75% 异步刷，90% 同步刷阻塞前台）；④**脏页比例超阈值**（默认 75%）。
>
> 刷盘速度由 `innodb_io_capacity` 控制——它告诉 InnoDB 磁盘的 IOPS 能力，SSD 上如果设太低会导致脏页堆积最终触发 Sync Flush 阻塞。Buffer Pool 用**改良 LRU**（冷热分离）管理数据页，新读入的页先放 Old 区，存活够久且再次访问才提升到 Young 区，防止全表扫描冲掉热数据。"

---

## 联合索引的正确使用与最左前缀原则

**类别**：MySQL / 索引优化 / 查询调优

### 一、什么是联合索引

联合索引（复合索引）是在**多个列**上建立的一个 B+ 树索引。

```sql
-- 在 (name, age, city) 三列上建联合索引
ALTER TABLE users ADD INDEX idx_name_age_city (name, age, city);
```

### 二、联合索引的 B+ 树结构

联合索引的 B+ 树**按照建索引时的列顺序**来排序：**先按第一列排序，第一列相同再按第二列排序，第二列也相同再按第三列排序**。

```
索引 (name, age, city) 的 B+ 树叶节点排列顺序：

  (Alice, 20, 北京)
  (Alice, 25, 上海)    ← Alice 相同，按 age 排
  (Alice, 25, 深圳)    ← Alice+25 相同，按 city 排
  (Bob,   22, 广州)
  (Bob,   30, 北京)
  (Charlie, 18, 上海)
  ...
```

**关键理解**：
- **name 是全局有序的**（整棵树按 name 排）
- **age 在 name 相同的范围内有序**（name 不同时 age 无序）
- **city 在 name + age 都相同的范围内有序**

这就是最左前缀原则的底层原因。

### 三、最左前缀原则

联合索引 `(a, b, c)` 能被使用的前提是：**查询条件必须从最左列开始连续匹配**。

#### 能命中索引的情况

```sql
-- 联合索引 (name, age, city)

-- ✅ 命中全部三列
WHERE name = 'Alice' AND age = 25 AND city = '北京'

-- ✅ 命中前两列（name + age）
WHERE name = 'Alice' AND age = 25

-- ✅ 只命中第一列（name）
WHERE name = 'Alice'

-- ✅ 顺序无关！优化器会自动调整
WHERE age = 25 AND name = 'Alice'  -- 优化器重排为 name='Alice' AND age=25
```

#### 不能命中索引的情况

```sql
-- ❌ 跳过了 name，直接用 age
WHERE age = 25
-- 因为 age 只在 name 相同时有序，全局无序，无法用 B+ 树查找

-- ❌ 跳过了 age，用 name + city
WHERE name = 'Alice' AND city = '北京'
-- name 能命中，但 city 不能（中间跳过了 age）
-- 实际：只用到 name 列的索引，city 在索引内做过滤（Index Condition Pushdown）

-- ❌ 跳过了 name 和 age
WHERE city = '北京'
-- 完全无法使用该联合索引
```

### 四、范围查询对联合索引的影响

**规则**：遇到范围查询（`>`、`<`、`BETWEEN`、`LIKE 'xx%'`），该列可以用索引，但**范围列之后的列无法用索引排序查找**。

```sql
-- 联合索引 (name, age, city)

-- ✅ name 等值 + age 等值 + city 等值 → 三列全用到
WHERE name = 'Alice' AND age = 25 AND city = '北京'

-- ⚠️ name 等值 + age 范围 → name 和 age 用到索引，city 用不到
WHERE name = 'Alice' AND age > 20 AND city = '北京'
-- 原因：age > 20 是范围查找，找到的结果中 city 不保证有序

-- ⚠️ name 范围 → 只有 name 用到索引
WHERE name > 'Alice' AND age = 25
-- 原因：name 是范围，结果中 age 无序

-- ✅ name 等值 + age 范围 → name 和 age 都用到
WHERE name = 'Alice' AND age BETWEEN 20 AND 30
-- name 定位到 'Alice'，在 Alice 范围内 age 有序，可以范围扫描
```

**口诀**：等值查询的列越多越好放前面，范围查询的列放最后。

### 五、ORDER BY 与联合索引

联合索引可以避免额外排序（filesort），但也要遵循最左前缀：

```sql
-- 联合索引 (name, age, city)

-- ✅ 利用索引排序，无需 filesort
SELECT * FROM users ORDER BY name;
SELECT * FROM users ORDER BY name, age;
SELECT * FROM users ORDER BY name, age, city;
SELECT * FROM users WHERE name = 'Alice' ORDER BY age;
-- name 等值固定后，age 在索引中有序，直接扫描

-- ❌ 无法利用索引排序
SELECT * FROM users ORDER BY age;            -- 跳过了 name
SELECT * FROM users ORDER BY name, city;     -- 跳过了 age
SELECT * FROM users ORDER BY name ASC, age DESC;  -- 排序方向不一致（MySQL 8.0 前）
```

**MySQL 8.0+ 支持降序索引**：

```sql
-- 8.0+ 可以指定每列的排序方向
ALTER TABLE users ADD INDEX idx_name_age (name ASC, age DESC);

-- 这样就能命中：
SELECT * FROM users ORDER BY name ASC, age DESC;  -- ✅
```

### 六、覆盖索引

如果查询的所有列都在联合索引中，就不需要回表（回聚簇索引取完整行数据），这就是**覆盖索引**。

```sql
-- 联合索引 (name, age, city)

-- ✅ 覆盖索引，不回表
SELECT name, age, city FROM users WHERE name = 'Alice';
-- 索引叶节点已经有 name, age, city + 主键id，直接返回

-- ❌ 需要回表
SELECT * FROM users WHERE name = 'Alice';
-- 需要 email、phone 等其他列，索引里没有，必须拿主键回聚簇索引取

-- EXPLAIN 中看到 Extra: Using index → 覆盖索引命中
```

**设计技巧**：高频查询涉及的列尽量放进联合索引，争取覆盖索引减少回表。

### 七、索引下推（Index Condition Pushdown, ICP）

MySQL 5.6+ 的优化，减少回表次数。

```sql
-- 联合索引 (name, age, city)

SELECT * FROM users WHERE name = 'Alice' AND city = '北京';
```

**没有 ICP（5.6 之前）**：
```
1. 用索引找到所有 name='Alice' 的行（假设 1000 行）
2. 对每一行回表，取完整数据
3. 在 Server 层用 city='北京' 过滤
→ 回表 1000 次
```

**有 ICP（5.6+）**：
```
1. 用索引找到所有 name='Alice' 的行
2. 在索引层直接检查 city 是否='北京'（虽然 city 没法用索引查找，但索引中存了 city 的值）
3. 只对满足 city='北京' 的行回表
→ 回表可能只有 100 次
```

```
EXPLAIN 中看到 Extra: Using index condition → ICP 生效
```

### 八、联合索引设计原则

#### 原则 1：最常用的列放最左边

```sql
-- 如果 90% 的查询都带 name 条件，name 放第一列
-- 这样无论是否带 age/city，name 都能命中索引
```

#### 原则 2：等值查询的列放前面，范围查询的列放后面

```sql
-- 查询模式：WHERE status = 1 AND create_time > '2026-01-01'
-- 建索引：(status, create_time) 而不是 (create_time, status)
-- status 等值查询定位到一批，create_time 范围扫描
```

#### 原则 3：选择性高的列放前面

选择性 = 不同值的数量 / 总行数。选择性越高，过滤能力越强。

```sql
-- user_id 选择性高（几乎唯一），status 选择性低（只有几个值）
-- 建索引：(user_id, status) 而不是 (status, user_id)
-- user_id 直接定位到一两行，status 再过滤几乎没意义了

-- 但如果大多数查询都只用 status 做条件，那 status 放前面更好
-- 具体要看查询模式
```

#### 原则 4：利用覆盖索引减少回表

```sql
-- 高频查询：SELECT name, age FROM users WHERE name = 'Alice'
-- 建索引 (name, age) 就能覆盖查询，不用回表
```

#### 原则 5：避免冗余索引

```sql
-- 已有联合索引 (name, age, city)
-- 不需要再建 (name) 单列索引 → 联合索引已经覆盖
-- 不需要再建 (name, age) → 联合索引的最左前缀已覆盖
-- 但如果需要 (age) 单列查询 → 联合索引帮不上，需要单独建
```

### 九、常见踩坑场景

#### 坑 1：在索引列上使用函数或运算

```sql
-- ❌ 索引失效
WHERE YEAR(create_time) = 2026
WHERE LEFT(name, 3) = 'Ali'
WHERE age + 1 = 26

-- ✅ 改写为
WHERE create_time >= '2026-01-01' AND create_time < '2027-01-01'
WHERE name LIKE 'Ali%'
WHERE age = 25
```

#### 坑 2：隐式类型转换

```sql
-- phone 列是 VARCHAR 类型
-- ❌ 传入数字，MySQL 做隐式转换 → 索引失效
WHERE phone = 13800138000

-- ✅ 传字符串
WHERE phone = '13800138000'
```

#### 坑 3：LIKE 以 % 开头

```sql
-- ❌ 无法使用索引（不知道从哪开始查 B+ 树）
WHERE name LIKE '%Alice%'

-- ✅ 可以使用索引（前缀匹配）
WHERE name LIKE 'Alice%'
```

#### 坑 4：OR 条件导致索引失效

```sql
-- ❌ 如果 age 没有索引，整个查询都不走索引
WHERE name = 'Alice' OR age = 25

-- ✅ 如果 name 和 age 都有索引 → Index Merge 优化（不一定生效）
-- ✅ 或者改写为 UNION
SELECT * FROM users WHERE name = 'Alice'
UNION
SELECT * FROM users WHERE age = 25;
```

### 十、面试回答模板

> "联合索引的正确使用核心是理解**最左前缀原则**——联合索引 (a, b, c) 的 B+ 树先按 a 排序，a 相同按 b 排序，b 相同按 c 排序。所以查询必须从最左列开始连续匹配，跳过中间列后续列无法走索引查找。
>
> **范围查询**（>、<、BETWEEN、LIKE）的列之后的列无法用索引，所以设计时**等值查询的列放前面，范围查询的列放最后**。
>
> **覆盖索引**是重要优化——查询的列都在联合索引中就不用回表。**索引下推（ICP，5.6+）** 在索引层提前过滤不满足条件的行，减少回表次数。
>
> 常见索引失效：索引列上用函数/运算、隐式类型转换、LIKE 以 % 开头、OR 中有列没索引。设计联合索引时按'最常用列最左、等值列在前范围列在后、高选择性在前、争取覆盖索引、避免冗余'的原则。"

---

## 深分页问题与分页优化

**类别**：MySQL / 查询优化 / 性能

### 一、分页的基本用法

```sql
-- 查第 1 页（第 1-10 条）
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET 0;

-- 查第 100 页（第 991-1000 条）
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET 990;

-- 查第 100000 页（第 999991-1000000 条）
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET 999990;
-- 这条就很慢了！
```

### 二、为什么深分页效率低下

#### 根本原因：OFFSET 不是"跳过"，而是"扫描后丢弃"

`LIMIT 10 OFFSET 999990` 的实际执行过程：

```
MySQL 的执行方式（不是你以为的）：

  你以为：直接跳到第 999990 行，取 10 行
  实际上：
    1. 从索引/表中读取第 1 行 → 丢弃
    2. 读取第 2 行 → 丢弃
    3. 读取第 3 行 → 丢弃
    ...
    999990. 读取第 999990 行 → 丢弃
    999991. 读取第 999991 行 → 保留 ✓
    999992. 读取第 999992 行 → 保留 ✓
    ...
    1000000. 读取第 1000000 行 → 保留 ✓
    
  → 实际扫描了 1000000 行，只返回了 10 行
  → 前 999990 行全部白读了
```

#### 如果涉及回表，问题更严重

```sql
SELECT * FROM orders ORDER BY create_time LIMIT 10 OFFSET 999990;
-- 假设 create_time 有索引
```

```
执行过程：
  1. 在 create_time 二级索引上扫描 1000000 行
  2. 对每一行拿到主键 id → 回表到聚簇索引取完整数据（SELECT *）
  3. 前 999990 行取完数据后丢弃
  
  → 999990 次无效回表！每次回表一次随机 IO
  → 这就是深分页慢的核心原因
```

#### 性能对比

| 分页位置 | 扫描行数 | 耗时（百万级表，经验值） |
|---------|---------|----------------------|
| OFFSET 0 | 10 行 | < 1ms |
| OFFSET 1000 | 1010 行 | ~5ms |
| OFFSET 100000 | 100010 行 | ~200ms |
| OFFSET 1000000 | 1000010 行 | ~2-5s |
| OFFSET 10000000 | 10000010 行 | 10s+ 甚至超时 |

### 三、优化方案

#### 方案 1：子查询延迟关联（最常用）

**核心思想**：先在索引上定位 ID，再用 ID 回表取数据。避免对丢弃的行做无效回表。

```sql
-- 原始（慢）：扫描 100 万行 + 回表 100 万次
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET 999990;

-- 优化（快）：
SELECT * FROM orders
INNER JOIN (
    SELECT id FROM orders ORDER BY id LIMIT 10 OFFSET 999990
) AS tmp ON orders.id = tmp.id;
```

**为什么快？**

```
子查询部分：SELECT id FROM orders ORDER BY id LIMIT 10 OFFSET 999990
  → 在主键索引上扫描 1000000 行，但只取 id（覆盖索引，不回表！）
  → 得到 10 个 id

外层查询：SELECT * FROM orders WHERE id IN (这10个id)
  → 只回表 10 次

原来：回表 1000000 次
现在：回表 10 次
```

**关键**：子查询利用**覆盖索引**只取 id，把百万次回表降到了 10 次。

#### 方案 2：游标分页 / 基于上一页最后一条记录（推荐）

**核心思想**：用上一页最后一条记录的值作为起点，不用 OFFSET。

```sql
-- 第 1 页
SELECT * FROM orders WHERE id > 0 ORDER BY id LIMIT 10;
-- 返回 id: 1, 2, 3, ..., 10

-- 第 2 页（上一页最后一条 id = 10）
SELECT * FROM orders WHERE id > 10 ORDER BY id LIMIT 10;
-- 返回 id: 11, 12, ..., 20

-- 第 N 页（上一页最后一条 id = last_id）
SELECT * FROM orders WHERE id > last_id ORDER BY id LIMIT 10;
```

**为什么快？**

```
WHERE id > last_id ORDER BY id LIMIT 10
  → B+ 树直接定位到 id = last_id 的位置
  → 往后扫描 10 行就停
  → 无论第几页都只扫描 10 行！
  → 时间复杂度 O(1)，和页码无关
```

**适用场景**：
- "上一页 / 下一页"式翻页（移动端无限滚动列表最常见）
- 排序字段有索引且**单调递增**（如主键 id、时间戳）

**限制**：
- 不支持"跳到第 N 页"（不知道第 N 页的 last_id 是什么）
- 排序字段必须唯一（否则 `>` 可能跳过相同值的行）
- 如果排序字段不唯一，需要加主键兜底：`WHERE (create_time, id) > (last_time, last_id)`

#### 方案 3：用覆盖索引避免回表

如果业务只需要部分列，把这些列建成联合索引实现覆盖索引：

```sql
-- 假设只需要 id 和 create_time
-- 建索引 (create_time, id)

-- 覆盖索引查询，不回表
SELECT id, create_time FROM orders ORDER BY create_time LIMIT 10 OFFSET 999990;
-- 虽然还是扫描了很多行，但全在索引上完成，不回表
-- 比 SELECT * 快很多
```

**局限**：`SELECT *` 无法覆盖，只适合查少量列。

#### 方案 4：业务层限制（最简单粗暴）

很多场景下用户根本不需要翻到第 10 万页：

```
- Google 搜索结果最多显示 ~1000 条
- 淘宝商品列表最多翻 100 页
- 后台管理系统强制要求先搜索再翻页
```

```sql
-- 直接限制最大 OFFSET
SET @max_offset = 10000;
SELECT * FROM orders ORDER BY id LIMIT 10 OFFSET LEAST(@offset, @max_offset);
```

#### 方案 5：预计算分页标记

对于固定排序的分页，提前算好每页起始 ID 存起来：

```sql
-- 预计算表
CREATE TABLE page_markers (
    page_num INT PRIMARY KEY,
    start_id BIGINT
);
-- page_num=1, start_id=1
-- page_num=2, start_id=11
-- page_num=1000, start_id=9991
-- ...

-- 查第 1000 页
SELECT start_id FROM page_markers WHERE page_num = 1000;  -- 得到 9991
SELECT * FROM orders WHERE id >= 9991 ORDER BY id LIMIT 10;
```

**适用**：数据变化不频繁的场景（如排行榜、归档数据）。

### 四、方案对比

| 方案 | 效果 | 是否支持跳页 | 复杂度 | 适用场景 |
|------|------|-------------|--------|---------|
| 子查询延迟关联 | ⭐⭐⭐⭐ | ✅ | 低 | 通用，后台管理系统 |
| 游标分页 | ⭐⭐⭐⭐⭐ | ❌ | 低 | 移动端无限滚动、消息列表 |
| 覆盖索引 | ⭐⭐⭐ | ✅ | 中 | 只查少量列 |
| 业务限制 | ⭐⭐⭐ | ✅ | 低 | 面向用户的前端页面 |
| 预计算标记 | ⭐⭐⭐⭐ | ✅ | 高 | 数据稳定的场景 |

### 五、面试回答模板

> "深分页慢的根本原因是 **OFFSET 不是跳过，而是扫描后丢弃**——`LIMIT 10 OFFSET 100万` 实际会扫描 100 万零 10 行，前 100 万行全部白读；如果涉及回表（`SELECT *` + 二级索引），还会做 100 万次无效回表，每次一次随机 IO。
>
> **优化方案**我常用两种：第一种是**子查询延迟关联**——先用子查询在索引上只取 id（覆盖索引不回表），再用这些 id 回表取完整数据，把百万次回表降到个位数。第二种是**游标分页**——记录上一页最后一条的 id，下一页用 `WHERE id > last_id LIMIT 10`，B+ 树直接定位不用 OFFSET，无论第几页都只扫描 10 行，性能恒定。游标分页的限制是不支持跳页，适合移动端无限滚动；子查询方式支持跳页，适合后台管理系统。另外，很多业务直接限制最大翻页深度也是有效的实践。"

---

## JOIN 代替子查询、小表驱动大表、避免过多表 JOIN

**类别**：MySQL / 查询优化 / JOIN 原理

### 一、JOIN 代替子查询有什么好处

#### 子查询的执行问题

```sql
-- 子查询：查有订单的用户
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE amount > 100);
```

在 MySQL 5.5 及之前，优化器对子查询的处理非常粗暴：

```
对于 IN 子查询，MySQL 可能将其转化为 DEPENDENT SUBQUERY（依赖子查询）：
  遍历 users 表的每一行 →
    对每一行执行一次子查询 SELECT user_id FROM orders WHERE amount > 100 AND user_id = 当前行id
  → users 有 10 万行就执行 10 万次子查询！
```

虽然 MySQL 5.6+ 优化器可以将 IN 子查询自动改写为 semi-join，但并非所有场景都能优化。

#### JOIN 的执行方式

```sql
-- JOIN：等价查询
SELECT DISTINCT u.* FROM users u
INNER JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100;
```

```
JOIN 的执行：
  选择驱动表（优化器决定）→ 遍历驱动表每一行 →
  用关联条件在被驱动表的索引中查找匹配行
  → 只扫描一次，利用索引，效率稳定
```

#### 具体好处对比

| 维度 | 子查询 | JOIN |
|------|--------|------|
| **执行方式** | 可能被当作依赖子查询，外层每行执行一次 | 优化器选择最优 JOIN 算法（NLJ / Hash Join） |
| **中间结果** | 子查询结果可能需要物化成临时表 | 不需要物化，流式处理 |
| **优化器支持** | 优化改写有限，尤其是旧版本 | 优化器对 JOIN 的优化最成熟 |
| **可读性** | 嵌套多层时难以阅读 | 扁平结构，关联关系清晰 |
| **索引利用** | 子查询结果集无法使用外层索引 | 被驱动表的关联列可以走索引 |

**结论**：大部分场景下 **JOIN 性能优于或等于子查询**。MySQL 5.6+ 优化器会自动将部分子查询改写为 JOIN，但不如直接写 JOIN 稳定可控。

**例外**：EXISTS 子查询在某些场景下和 JOIN 性能相当；相关子查询（DEPENDENT SUBQUERY）如果无法被优化器改写，才是性能杀手。

---

### 二、JOIN 为什么要小表驱动大表

#### 先理解 JOIN 的执行算法

MySQL 的 JOIN 主要有三种执行算法：

**1. Nested-Loop Join（NLJ，嵌套循环）**

```
最基本的 JOIN 算法（伪代码）：

for each row r1 in 驱动表:          -- 外层循环
    for each row r2 in 被驱动表:     -- 内层循环（走索引查找）
        if r1.join_key == r2.join_key:
            output (r1, r2)
```

关键：内层循环**走索引**查找，不是全表扫描。

**成本分析**：
```
驱动表 A：m 行
被驱动表 B：n 行（关联列有索引，索引查找成本 ~logN）

总成本 = m（扫描驱动表）+ m × logN（被驱动表索引查找次数）
```

**小表驱动大表 vs 大表驱动小表**：

```
方案 1：小表驱动大表（A=100行, B=100万行）
  成本 = 100 + 100 × log(1000000) ≈ 100 + 100 × 20 = 2100

方案 2：大表驱动小表（A=100万行, B=100行）
  成本 = 1000000 + 1000000 × log(100) ≈ 1000000 + 1000000 × 7 = 8000000

差距：2100 vs 8000000 → 差了近 4000 倍！
```

**本质原因**：
- 驱动表要**全表扫描**（或按条件扫描），成本和行数成正比
- 被驱动表走**索引查找**，每次成本是 O(logN)，相对便宜
- 所以**让行数少的表做全表扫描（驱动），让行数多的表走索引（被驱动）**

**2. Block Nested-Loop Join（BNL，MySQL 8.0.18 之前）**

当被驱动表**没有索引**时使用。

```
把驱动表的数据分批读入 Join Buffer（内存）：

for each block of rows from 驱动表 (放入 Join Buffer):
    for each row r2 in 被驱动表:     -- 全表扫描
        for each row r1 in Join Buffer:
            if r1.join_key == r2.join_key:
                output (r1, r2)
```

```
没有 Join Buffer：被驱动表全表扫描 m 次（驱动表每行一次）
有 Join Buffer：被驱动表全表扫描 m / buffer_size 次（大幅减少）

小表驱动：Join Buffer 能放下全部驱动表数据 → 被驱动表只扫 1 次
大表驱动：Join Buffer 放不下 → 被驱动表要扫多次
```

所以**小表驱动大表在 BNL 下更加重要**——驱动表越小，Join Buffer 越容易装下，被驱动表扫描次数越少。

**3. Hash Join（MySQL 8.0.18+）**

替代了 BNL，在没有索引的情况下性能更好：

```
1. 用驱动表（小表）构建哈希表（存在内存中）
2. 扫描被驱动表（大表），每行去哈希表中查找匹配

成本 = m（建哈希表）+ n（扫描大表查找）= m + n
```

**小表建哈希表**的好处：
- 哈希表小 → 能放进内存，不用落盘
- 如果大表建哈希表 → 内存放不下 → 要写临时文件 → 性能暴跌

#### 小结：为什么小表驱动大表

| JOIN 算法 | 小表驱动大表的好处 |
|-----------|-------------------|
| NLJ（有索引） | 外层循环次数少（m 小），内层走索引 logN 便宜 |
| BNL（无索引） | 小表放入 Join Buffer，被驱动表只需扫描少数几次 |
| Hash Join | 小表建哈希表能放内存，大表建哈希表可能溢出到磁盘 |

**"小表"的判定不只看行数**，还要看过滤后的结果集大小。优化器会自动选择驱动表，但有时判断不准，可以用 `STRAIGHT_JOIN` 强制指定顺序。

---

### 三、为什么要避免使用 JOIN 关联太多的表

#### 原因 1：JOIN 顺序的组合爆炸

优化器要选择最优的 JOIN 顺序，N 张表的排列组合是 **N!**：

```
2 张表：2! = 2 种顺序
3 张表：3! = 6 种顺序
5 张表：5! = 120 种顺序
10 张表：10! = 3628800 种顺序
```

优化器不可能穷举所有顺序，表太多时要么**优化时间暴增**，要么**选了一个次优的执行计划**。

MySQL 通过 `optimizer_search_depth` 参数限制搜索深度（默认 62），但表太多时优化质量仍然下降。

#### 原因 2：中间结果集膨胀

每多 JOIN 一张表，中间结果集可能**指数级膨胀**：

```
users: 1万行
orders: 10万行
order_items: 100万行
products: 5万行
categories: 100行

users × orders × order_items × products × categories
= 中间结果可能非常大

即使最终结果只有 100 行，中间过程的内存 / 临时表开销巨大
```

#### 原因 3：锁竞争和事务复杂度

```
JOIN 5 张表：
  - 需要同时在 5 张表上获取读锁（或 MVCC 快照）
  - 任何一张表有写操作都可能造成锁等待
  - 事务持有锁的时间更长 → 并发性能下降
```

#### 原因 4：维护成本

```
JOIN 5+ 张表的 SQL：
  - 可读性差，排查问题困难
  - 任何一张表加字段/改索引都可能影响执行计划
  - EXPLAIN 输出复杂难以分析
```

#### 阿里巴巴开发规范

> 超过三个表禁止 JOIN。需要 JOIN 的字段，数据类型保持绝对一致；多表关联查询时，保证被关联的字段需要有索引。

#### 替代方案

```
1. 在业务层做关联：
   先查主表 → 拿到关联 ID → 再查从表 → 在代码里组装
   
2. 冗余字段：
   把常用的关联数据冗余到主表（如订单表冗余用户名），避免 JOIN
   
3. 宽表 / 数据仓库：
   定期把多表数据聚合成宽表，查询时直接查宽表
   
4. 分步查询 + 缓存：
   高频查询的关联数据缓存到 Redis
```

---

### 四、面试回答模板

> "**JOIN 代替子查询**：子查询在旧版本 MySQL 中可能被当作依赖子查询，外层每行执行一次内层查询，性能很差。JOIN 是优化器最成熟的操作，能选择最优算法（NLJ 走索引 / Hash Join），性能更稳定可控。
>
> **小表驱动大表**：NLJ 算法中驱动表做全表扫描（成本 = m），被驱动表走索引查找（成本 = m × logN）。让 m 更小总成本就更低。BNL/Hash Join 中小表做驱动可以放入 Join Buffer / 建哈希表留在内存，大表做驱动可能溢出到磁盘。所以始终让**过滤后结果集更小的表做驱动表**。
>
> **避免过多表 JOIN**：一是优化器的 JOIN 顺序搜索空间是 N! 级别，表太多执行计划质量下降；二是中间结果集可能指数膨胀，内存和临时表开销大；三是锁竞争加剧，并发性能下降。阿里规范建议不超过 3 张表 JOIN，超出的在业务层组装或用冗余字段/宽表解决。"

---

## 排序优化：filesort、全字段排序与 rowid 排序

**类别**：MySQL / 查询优化 / ORDER BY 原理

### 一、ORDER BY 的两种执行方式

MySQL 处理 ORDER BY 只有两条路：

```
路径 1：利用索引天然有序 → 直接按索引顺序读取 → 无需额外排序
路径 2：无法利用索引 → 把数据取出来在内存/磁盘中排序 → 这就是 filesort
```

```sql
EXPLAIN SELECT * FROM users ORDER BY name;

-- Extra: Using index     → 路径1，利用了索引顺序，最优
-- Extra: Using filesort  → 路径2，需要额外排序，有性能开销
```

**目标**：尽量走路径 1，避免 filesort。

### 二、什么是 filesort

filesort 不是"一定写文件"的意思，而是**MySQL 需要额外执行排序操作**的统称：

```
filesort 的实际行为：

  if 数据量 <= sort_buffer_size（默认 256KB ~ 几MB）:
      在内存中排序（快速排序）→ 不涉及磁盘
  else:
      数据量超过 sort_buffer → 分成多个块
      → 每块在内存中排序 → 写入临时文件
      → 多个有序文件做归并排序
      → 涉及磁盘 IO，很慢！
```

**所以 filesort 不一定慢**（小数据量内存排序还可以），但**大数据量一定慢**（需要外部归并排序，大量磁盘 IO）。

### 三、filesort 的两种算法

MySQL 的 filesort 有两种排序模式，优化器根据情况自动选择。

#### 全字段排序（Single-pass / 一次扫描）

```sql
SELECT name, age, city FROM users WHERE city = '北京' ORDER BY name LIMIT 100;
-- 假设 city 有索引，name 没有索引
```

**执行过程**：

```
1. 通过 city 索引找到所有 city='北京' 的行
2. 对每一行：从聚簇索引取出 name, age, city（SELECT 需要的所有字段）
   → 放入 sort_buffer
3. 在 sort_buffer 中按 name 排序
4. 取前 100 行返回给客户端

sort_buffer 中的内容：
┌──────┬─────┬──────┐
│ name │ age │ city │  ← 放了所有需要的字段
├──────┼─────┼──────┤
│ 张三  │ 25  │ 北京 │
│ 李四  │ 30  │ 北京 │
│ ...  │ ... │ ... │
└──────┴─────┴──────┘
排序后直接返回，不需要再回表
```

**优点**：排序完直接返回，**不需要二次回表**
**缺点**：每行放入 sort_buffer 的数据量大（所有字段），sort_buffer 容易不够用 → 溢出到磁盘

#### rowid 排序（Two-pass / 两次扫描）

**当单行数据太宽（字段太多/太大），sort_buffer 放不下太多行时**，MySQL 切换为 rowid 排序。

判断条件：**单行长度超过 `max_length_for_sort_data`（默认 4096 字节）**。

**执行过程**：

```
1. 通过 city 索引找到所有 city='北京' 的行
2. 对每一行：只取 name（排序字段）+ id（主键）
   → 放入 sort_buffer（每行数据量小，能放更多行）
3. 在 sort_buffer 中按 name 排序
4. 取前 100 行的 id
5. 用这 100 个 id 回表，取出 name, age, city 返回

sort_buffer 中的内容：
┌──────┬─────┐
│ name │ id  │  ← 只放排序字段 + 主键，数据量小
├──────┼─────┤
│ 张三  │ 42  │
│ 李四  │ 17  │
│ ...  │ ... │
└──────┴─────┘
排序后还需要拿 id 回表取完整数据
```

**优点**：每行数据小，sort_buffer 能放更多行，减少溢出到磁盘的概率
**缺点**：排序完还要**二次回表**（多一次随机 IO）

#### 两种排序的对比

| | 全字段排序 | rowid 排序 |
|---|---------|-----------|
| sort_buffer 存什么 | 所有 SELECT 字段 | 排序字段 + 主键 |
| 每行占用空间 | 大 | 小 |
| sort_buffer 能放的行数 | 少 | 多 |
| 溢出磁盘概率 | 高（行宽时） | 低 |
| 排序后是否回表 | ❌ 不需要 | ✅ 需要回表取完整数据 |
| 触发条件 | 单行长度 ≤ max_length_for_sort_data | 单行长度 > max_length_for_sort_data |

**MySQL 优先选择全字段排序**（少一次回表），只有单行太宽时才退化为 rowid 排序。

### 四、排序优化方案

#### 方案 1：利用索引避免 filesort（最优）

B+ 树索引本身是有序的，如果 ORDER BY 的字段有索引，直接按索引顺序读取，无需排序。

```sql
-- name 有索引 → 直接按索引顺序读取，无 filesort
SELECT * FROM users ORDER BY name LIMIT 100;

-- 联合索引 (city, name) → WHERE city='北京' 后 name 已有序
SELECT * FROM users WHERE city = '北京' ORDER BY name LIMIT 100;
-- Using index condition（走索引），无 filesort
```

**ORDER BY 能利用索引的条件**（和最左前缀原则一致）：

```sql
-- 索引 (a, b, c)

-- ✅ 能利用索引排序
ORDER BY a
ORDER BY a, b
ORDER BY a, b, c
WHERE a = 1 ORDER BY b         -- a 等值后 b 有序
WHERE a = 1 AND b = 2 ORDER BY c

-- ❌ 不能利用索引排序（产生 filesort）
ORDER BY b                     -- 跳过 a
ORDER BY a, c                  -- 跳过 b
ORDER BY a ASC, b DESC         -- 方向不一致（8.0 前）
WHERE a > 1 ORDER BY b         -- a 是范围，b 无序
```

#### 方案 2：覆盖索引 + 排序（避免回表）

```sql
-- 建联合索引 (city, name, age)

SELECT name, age FROM users WHERE city = '北京' ORDER BY name;
-- city 定位 + name 有序 + 覆盖索引不回表
-- 最理想的情况：Using index，无 filesort，无回表
```

#### 方案 3：增大 sort_buffer_size

```sql
-- 让更多数据在内存中排序，避免溢出到磁盘
SET sort_buffer_size = 4 * 1024 * 1024;  -- 4MB

-- 注意：这是每个连接独占的内存
-- 连接数 × sort_buffer_size = 总内存占用
-- 不能设太大，避免内存耗尽
```

#### 方案 4：减少 SELECT 字段

```sql
-- ❌ SELECT * 所有字段都放进 sort_buffer，占空间大
SELECT * FROM users WHERE city = '北京' ORDER BY name;

-- ✅ 只取需要的字段，sort_buffer 能放更多行
SELECT name, age FROM users WHERE city = '北京' ORDER BY name;
```

这也是**不要用 `SELECT *`** 的原因之一——在 filesort 场景下，多余的字段白白占用 sort_buffer 空间，增加溢出到磁盘的概率。

#### 方案 5：调整 max_length_for_sort_data

```sql
-- 增大阈值 → 尽量走全字段排序（减少回表）
SET max_length_for_sort_data = 8192;

-- 减小阈值 → 更容易走 rowid 排序（减少磁盘溢出）
SET max_length_for_sort_data = 1024;

-- 一般不需要调，MySQL 默认策略已经比较合理
```

### 五、EXPLAIN 中排序相关的标识

| Extra 字段 | 含义 |
|-----------|------|
| `Using index` | 利用索引顺序，无需排序（最优） |
| `Using filesort` | 需要额外排序（有性能开销） |
| `Using temporary` | 排序时还用了临时表（通常出现在 GROUP BY + ORDER BY 不同列） |
| `Using temporary; Using filesort` | 最差情况：先建临时表再排序 |

### 六、一个完整的优化案例

```sql
-- 原始查询（慢）
SELECT * FROM orders
WHERE user_id = 100 AND status = 1
ORDER BY create_time DESC
LIMIT 20;

-- EXPLAIN 显示：Using filesort
```

**优化思路**：

```sql
-- 建联合索引：(user_id, status, create_time)
ALTER TABLE orders ADD INDEX idx_uid_status_ctime (user_id, status, create_time);

-- 再次执行同样的查询
-- user_id=100 等值 → status=1 等值 → create_time 在索引中有序
-- 直接按索引倒序读取前 20 行，无 filesort
-- EXPLAIN：Using index condition，无 Using filesort
```

如果还需要进一步优化：

```sql
-- 只查需要的字段，建覆盖索引
-- 假设只需要 id, create_time, amount
ALTER TABLE orders ADD INDEX idx_cover (user_id, status, create_time, id, amount);

SELECT id, create_time, amount FROM orders
WHERE user_id = 100 AND status = 1
ORDER BY create_time DESC
LIMIT 20;
-- Using index（覆盖索引 + 索引排序，完美）
```

### 七、面试回答模板

> "ORDER BY 有两种执行方式：**利用索引天然有序**直接读取（最优），或者**filesort 额外排序**。filesort 数据量小时在内存排序（sort_buffer），数据量大时溢出到磁盘做外部归并排序，性能很差。
>
> filesort 有两种算法：**全字段排序**把所有 SELECT 字段放进 sort_buffer，排完直接返回不用回表，但占空间大容易溢出；**rowid 排序**只放排序字段 + 主键，占空间小不容易溢出，但排完要回表取数据。MySQL 优先用全字段排序，单行超过 `max_length_for_sort_data` 时切换 rowid 排序。
>
> **优化方向**：第一，建合适的索引让 ORDER BY 直接走索引顺序，遵循最左前缀——WHERE 等值列在前 + ORDER BY 列在后建联合索引；第二，尽量覆盖索引避免回表；第三，不要 `SELECT *`，减少 sort_buffer 中每行的数据量。如果不可避免 filesort，可以适当增大 `sort_buffer_size`，但要注意这是每连接独占内存。"

---

## MySQL 锁机制全面解析

**类别**：MySQL / InnoDB / 锁 / 并发控制

### 一、锁的分类全景图

MySQL 的锁可以从**四个维度**来分类：

```
维度 1：按粒度        → 全局锁、表级锁、行级锁
维度 2：按兼容性      → 共享锁（S）、排他锁（X）
维度 3：按加锁方式    → 乐观锁、悲观锁
维度 4：按锁的算法    → Record Lock、Gap Lock、Next-Key Lock（InnoDB 行锁的具体实现）
```

---

### 二、维度 1：按粒度分类

#### 1. 全局锁

锁住**整个数据库实例**，所有表全部变为只读。

```sql
-- 加全局读锁
FLUSH TABLES WITH READ LOCK;  -- FTWRL

-- 此时：
-- ✅ 可以读
-- ❌ 不能写（INSERT/UPDATE/DELETE 全被阻塞）
-- ❌ 不能建表/改表（DDL 被阻塞）

-- 解锁
UNLOCK TABLES;
```

**用途**：全库逻辑备份（mysqldump）时保证数据一致性。

**问题**：加锁期间整个库只读，业务完全停摆。

**更好的方案**：
- InnoDB 支持 `mysqldump --single-transaction`，利用 MVCC 在一致性快照上备份，不需要加全局锁
- 只有 MyISAM 等不支持事务的引擎才需要 FTWRL

#### 2. 表级锁

锁住**整张表**。InnoDB 和 MyISAM 都支持，有以下几种：

**（1）表锁**

```sql
-- 加表读锁（其他线程可读不可写）
LOCK TABLES users READ;

-- 加表写锁（其他线程既不可读也不可写）
LOCK TABLES users WRITE;

-- 解锁
UNLOCK TABLES;
```

InnoDB 有行锁，一般不用表锁。表锁主要是 MyISAM 在用。

**（2）元数据锁（MDL，Meta Data Lock）**

**自动加锁**，不需要手动操作。保护表结构不被并发修改。

```
- 对表做 DML（SELECT/INSERT/UPDATE/DELETE）→ 自动加 MDL 读锁
- 对表做 DDL（ALTER TABLE/DROP TABLE）→ 自动加 MDL 写锁

- MDL 读锁之间不冲突 → 多个 DML 可以并发
- MDL 读锁与写锁冲突 → DDL 要等所有 DML 完成
- MDL 写锁与写锁冲突 → DDL 之间串行
```

**经典生产事故**：

```
线程 A：SELECT * FROM users（长查询，持有 MDL 读锁不释放）
线程 B：ALTER TABLE users ADD COLUMN phone VARCHAR(20);（需要 MDL 写锁 → 被 A 阻塞）
线程 C：SELECT * FROM users;（需要 MDL 读锁 → 被 B 阻塞！）
线程 D、E、F...：全部排队等待

→ 一个慢查询 + 一个 DDL = 整张表的所有查询全被阻塞！
```

**教训**：线上执行 DDL 前确认没有长事务/慢查询；用 `pt-online-schema-change` 或 `gh-ost` 做在线 DDL。

**（3）意向锁（Intention Lock）**

InnoDB 特有，**自动加锁**，是表级别的锁，用来快速判断表中是否有行锁。

```
- 事务要给某行加 S 锁 → 先给表加意向共享锁（IS）
- 事务要给某行加 X 锁 → 先给表加意向排他锁（IX）
```

**为什么需要意向锁**：

```
场景：事务 A 对 id=1 的行加了行级 X 锁
     事务 B 想对整张表加表级 S 锁

没有意向锁：
  B 要遍历整张表的每一行，检查是否有行级 X 锁 → 太慢！

有意向锁：
  A 加行级 X 锁时已经给表加了 IX 锁
  B 想加表级 S 锁 → 发现表上有 IX 锁 → 直接冲突，无需遍历行
  → O(1) 判断
```

**意向锁兼容矩阵**：

| | IS | IX | S | X |
|---|----|----|---|---|
| **IS** | ✅ | ✅ | ✅ | ❌ |
| **IX** | ✅ | ✅ | ❌ | ❌ |
| **S** | ✅ | ❌ | ✅ | ❌ |
| **X** | ❌ | ❌ | ❌ | ❌ |

意向锁之间永远不冲突（IS-IS、IS-IX、IX-IX 都兼容），因为意向锁不锁具体行，真正的冲突在行锁层面判断。

#### 3. 行级锁（InnoDB 独有）

锁住**某一行或某个范围**。InnoDB 的行锁是**加在索引上**的，不是加在数据行上。

**这是最重要的一句话**：如果查询没有走索引 → InnoDB 会锁住整张表的所有行（退化为表锁效果）。

---

### 三、维度 2：按兼容性分类

#### 共享锁（S Lock，读锁）

```sql
-- 手动加共享锁
SELECT * FROM users WHERE id = 1 LOCK IN SHARE MODE;  -- MySQL 5.x
SELECT * FROM users WHERE id = 1 FOR SHARE;           -- MySQL 8.0+
```

- 多个事务可以同时对同一行持有 S 锁（读读不冲突）
- 其他事务不能对该行加 X 锁（读写冲突）

#### 排他锁（X Lock，写锁）

```sql
-- 手动加排他锁
SELECT * FROM users WHERE id = 1 FOR UPDATE;

-- 自动加排他锁的操作
INSERT INTO users VALUES (...);
UPDATE users SET name = '张三' WHERE id = 1;
DELETE FROM users WHERE id = 1;
```

- 持有 X 锁时，其他事务不能对该行加任何锁（S 或 X）
- **普通 SELECT 不加锁**（MVCC 快照读），所以普通读不被 X 锁阻塞

**兼容矩阵**：

| | S 锁 | X 锁 |
|---|-----|------|
| **S 锁** | ✅ 兼容 | ❌ 冲突 |
| **X 锁** | ❌ 冲突 | ❌ 冲突 |

---

### 四、维度 3：按加锁方式

#### 悲观锁

假设一定会冲突，先加锁再操作。

```sql
-- 悲观锁：先锁住再操作
BEGIN;
SELECT stock FROM products WHERE id = 1 FOR UPDATE;  -- 加 X 锁
-- 判断 stock > 0
UPDATE products SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

**优点**：安全，不会有并发修改问题
**缺点**：加锁等待，并发性能低

#### 乐观锁

假设不会冲突，提交时检查是否被别人改过。**不是数据库的锁，是业务层实现**。

```sql
-- 乐观锁：用版本号控制
-- 读取时记录版本号
SELECT stock, version FROM products WHERE id = 1;
-- 假设 stock=10, version=5

-- 更新时校验版本号
UPDATE products SET stock = stock - 1, version = version + 1
WHERE id = 1 AND version = 5;
-- 如果 affected_rows = 0 → 说明被其他事务改过 → 重试或报错
```

**优点**：不加锁，并发性能好
**缺点**：冲突多时大量重试，反而更慢
**适用**：读多写少、冲突概率低的场景

---

### 五、维度 4：InnoDB 行锁的三种算法（最核心）

InnoDB 的行锁都是**加在索引上**的。根据锁定范围不同，有三种：

#### 1. Record Lock（记录锁）

锁住**索引上的一条确切记录**。

```sql
-- 精确匹配主键 → 只锁 id=1 这一行
SELECT * FROM users WHERE id = 1 FOR UPDATE;
-- Record Lock on id=1
```

最精确的锁，只锁一行，对并发影响最小。

#### 2. Gap Lock（间隙锁）

锁住**索引记录之间的间隙**，不锁记录本身。**防止其他事务在间隙中插入新行**。

```sql
-- 假设 id 有值 1, 5, 10
-- 间隙为：(-∞,1) (1,5) (5,10) (10,+∞)

SELECT * FROM users WHERE id = 7 FOR UPDATE;
-- id=7 不存在 → 锁住间隙 (5, 10)
-- 其他事务不能在 5 和 10 之间 INSERT
-- 但 id=5 和 id=10 本身不被锁定
```

**Gap Lock 的特殊性**：
- Gap Lock 之间**不冲突**！两个事务可以同时持有同一个间隙的 Gap Lock
- Gap Lock 只阻止 INSERT（防止幻读），不阻止 SELECT/UPDATE/DELETE

**只在 RR（可重复读）隔离级别下存在**，RC（读已提交）没有 Gap Lock。

#### 3. Next-Key Lock（临键锁）

**Record Lock + Gap Lock 的组合**，锁住一条记录及其前面的间隙。形式为**左开右闭区间 (a, b]**。

```sql
-- 假设 id 有值 1, 5, 10
-- Next-Key Lock 的区间：(-∞, 1] (1, 5] (5, 10] (10, +∞)

SELECT * FROM users WHERE id <= 7 FOR UPDATE;
-- 锁住：(-∞, 1] (1, 5] (5, 10]
-- 包含了 id=1, 5 的记录锁 + 各区间的间隙锁 + id=10 的记录锁
```

**Next-Key Lock 是 InnoDB 在 RR 隔离级别下的默认行锁算法**，用来解决幻读问题。

### 六、不同查询条件下的加锁规则（RR 隔离级别）

这是面试最高频的考点——给一条 SQL，问加了什么锁。

**基本原则**：
1. 加锁的基本单位是 Next-Key Lock（左开右闭）
2. 查找过程中访问到的对象才加锁
3. 唯一索引上的**等值查询**，Next-Key Lock 退化为 **Record Lock**
4. 非唯一索引上的**等值查询**，向右遍历到第一个不满足条件的值时，Next-Key Lock 退化为 **Gap Lock**
5. 唯一索引上的**范围查询**，会访问到不满足条件的第一个值为止

#### 案例 1：唯一索引等值查询，记录存在

```sql
-- id 是主键（唯一索引），值有 1, 5, 10, 15
SELECT * FROM t WHERE id = 10 FOR UPDATE;

-- 加锁：Record Lock on id=10
-- 退化为记录锁（唯一索引等值命中 → 不需要间隙锁防幻读）
```

#### 案例 2：唯一索引等值查询，记录不存在

```sql
-- id 有值 1, 5, 10, 15
SELECT * FROM t WHERE id = 7 FOR UPDATE;

-- 加锁：Gap Lock (5, 10)
-- 记录不存在 → Next-Key Lock 退化为 Gap Lock
-- 防止其他事务 INSERT id=6,7,8,9
```

#### 案例 3：非唯一索引等值查询

```sql
-- age 是普通索引（非唯一），值有 10, 20, 20, 30
SELECT * FROM t WHERE age = 20 FOR UPDATE;

-- 加锁：
-- 1. Next-Key Lock (10, 20] → 锁住第一个 age=20
-- 2. Next-Key Lock (20, 20] → 锁住第二个 age=20（如果有多个）
-- 3. 向右遍历到 age=30，退化为 Gap Lock (20, 30)
-- 4. 对应的主键上加 Record Lock（因为要回表）
```

#### 案例 4：非唯一索引范围查询

```sql
-- age 是普通索引，值有 10, 20, 30, 40
SELECT * FROM t WHERE age >= 20 AND age < 30 FOR UPDATE;

-- 加锁：
-- Next-Key Lock (10, 20]
-- Next-Key Lock (20, 30]  ← 注意：30 也被锁了！
-- 对应主键上也加 Record Lock
```

#### 案例 5：没有索引的查询

```sql
-- name 列没有索引
SELECT * FROM t WHERE name = '张三' FOR UPDATE;

-- 加锁：锁住所有行的 Next-Key Lock → 效果等同于锁全表！
-- 因为 InnoDB 行锁是加在索引上的，没有索引只能锁主键索引的所有记录
-- 这就是为什么要确保 WHERE 条件走索引
```
### 三个锁在不同隔离等级下的生效模式：（补）

_Embedded asset omitted: Pasted image 20260307190848.png_
要理清记录锁、间隙锁和临键锁在不同隔离级别下的生效情况，可以牢记一个核心结论：**只有在可重复读（RR）及以上隔离级别，并且使用索引进行数据检索时，间隙锁和临键锁才会生效。** 在读未提交（RU）和读已提交（RC）级别下，InnoDB 只使用记录锁。

### 七、死锁

#### 什么是死锁

两个或多个事务互相持有对方需要的锁，永远等待下去。

```
事务 A：持有 id=1 的 X 锁 → 等待 id=2 的 X 锁
事务 B：持有 id=2 的 X 锁 → 等待 id=1 的 X 锁
→ 互相等待 → 死锁
```

#### InnoDB 的死锁处理

```
1. 死锁检测（默认开启）：innodb_deadlock_detect = ON
   - InnoDB 维护一个等待图（wait-for graph）
   - 检测到环 → 选择一个代价较小的事务回滚（undo log 量少的）
   - 通常毫秒级检测并处理

2. 锁等待超时：innodb_lock_wait_timeout = 50（默认 50 秒）
   - 等待超过 50 秒自动放弃，报错
   - 作为死锁检测的兜底
```

#### 如何避免死锁

```
1. 按固定顺序访问表和行
   不要：事务 A 先锁表1再锁表2，事务 B 先锁表2再锁表1
   应该：所有事务统一先锁表1再锁表2

2. 缩小事务范围
   锁持有时间越短，死锁概率越低

3. 降低隔离级别
   RC 没有 Gap Lock，死锁概率比 RR 低

4. 给 WHERE 条件加索引
   没索引 → 锁全表 → 死锁概率飙升

5. 一次性锁定所有需要的资源
   用 SELECT ... FOR UPDATE 一次把需要修改的行都锁住
```

### 八、锁的查看与排查

```sql
-- 查看当前持有的锁
SELECT * FROM performance_schema.data_locks;

-- 查看锁等待关系
SELECT * FROM performance_schema.data_lock_waits;

-- 查看 InnoDB 状态（包含最近一次死锁信息）
SHOW ENGINE INNODB STATUS;
-- 搜索 "LATEST DETECTED DEADLOCK" 部分

-- 查看正在运行的事务
SELECT * FROM information_schema.innodb_trx;
```

### 九、面试回答模板

> "MySQL 锁从**粒度**分为全局锁、表级锁、行级锁。全局锁用于全库备份（InnoDB 用 --single-transaction 更好）；表级锁包括表锁、MDL（自动加，保护表结构）和意向锁（快速判断表中是否有行锁）；**行级锁是 InnoDB 的核心**，加在索引上，不走索引则退化为锁全表。
>
> 行锁按**兼容性**分为共享锁（S，读读兼容）和排他锁（X，和所有锁冲突）。普通 SELECT 走 MVCC 快照读不加锁。
>
> InnoDB 行锁有三种**算法**：**Record Lock** 锁住一条记录；**Gap Lock** 锁住间隙防止插入（解决幻读）；**Next-Key Lock**（默认）= Record + Gap，左开右闭。加锁规则：唯一索引等值命中退化为 Record Lock，未命中退化为 Gap Lock；非唯一索引等值查询向右遍历到不满足条件时退化为 Gap Lock。Gap Lock 只在 RR 隔离级别存在。
>
> 死锁由 InnoDB 的等待图检测（wait-for graph），检测到环后回滚代价小的事务。避免死锁：按固定顺序访问行、缩小事务范围、确保 WHERE 走索引、降低隔离级别到 RC。"

---

## ACID 特性、事务隔离级别与 MVCC 机制

**类别**：MySQL / InnoDB / 事务 / MVCC

### 一、ACID 是什么，靠什么保证

#### Atomicity（原子性）

**含义**：事务中的所有操作，要么全部成功，要么全部回滚，不存在"做了一半"的状态。

**靠什么保证**：**undo log**
- 每次修改前，先把旧值写入 undo log
- 事务回滚时，按 undo log 逆序执行反向操作，恢复到事务开始前的状态
- 事务中途崩溃，重启后通过 undo log 回滚未完成的事务

```
BEGIN;
UPDATE account SET balance = balance - 100 WHERE id = 1;  -- undo: balance + 100
UPDATE account SET balance = balance + 100 WHERE id = 2;  -- undo: balance - 100
-- 此时崩溃 → 重启后用 undo log 回滚两条 UPDATE → 数据恢复
```

#### Consistency（一致性）

**含义**：事务执行前后，数据从一个合法状态转移到另一个合法状态，满足所有约束规则（主键、外键、唯一约束、业务规则等）。

**靠什么保证**：**是 AID 三者共同保证的结果**
- 一致性不是靠某个单独机制实现的
- 原子性保证"不会做一半"
- 隔离性保证"并发事务不互相干扰"
- 持久性保证"提交后不丢"
- 加上业务层的约束检查
- **四者共同保证了一致性**

#### Isolation（隔离性）

**含义**：并发执行的多个事务之间互不干扰，每个事务感觉像是独占数据库。

**靠什么保证**：**锁 + MVCC**
- **锁**（悲观并发控制）：写写冲突通过排他锁串行化
- **MVCC**（乐观并发控制）：读写不冲突，读操作访问快照版本而非最新数据
- 不同隔离级别通过不同的锁策略和 MVCC 行为来实现

#### Durability（持久性）

**含义**：事务一旦提交，修改就永久保存，即使系统崩溃也不丢失。

**靠什么保证**：**redo log（WAL 机制）**
- 事务提交时将修改写入 redo log 并 fsync 到磁盘
- 数据文件（Buffer Pool 中的脏页）异步刷盘
- 崩溃后通过 redo log 重放恢复已提交事务的修改

```
事务提交 → redo log fsync 到磁盘 → 返回成功
（脏页还在内存中没刷盘）
→ 崩溃 → 重启 → 用 redo log 重放 → 数据恢复
```

#### ACID 保证机制总结

| 特性 | 保证机制 | 一句话 |
|------|---------|--------|
| **原子性** | undo log | 回滚靠 undo log 逆向恢复 |
| **一致性** | AID 共同保证 + 约束检查 | 是目标，不是手段 |
| **隔离性** | 锁 + MVCC | 锁管写写，MVCC 管读写 |
| **持久性** | redo log（WAL） | 提交即 fsync 到 redo log，崩溃后重放 |

---

### 二、事务隔离级别

SQL 标准定义了四种隔离级别，从低到高：

#### 1. Read Uncommitted（读未提交）

```
事务 A：UPDATE balance = 0 WHERE id = 1;  -- 还没 COMMIT
事务 B：SELECT balance FROM account WHERE id = 1;
→ B 读到了 A 还没提交的 balance = 0（脏读）
→ 如果 A 回滚了，B 读到的数据根本不存在过
```

**问题**：脏读（读到未提交的数据）
**实现**：读不加锁，写加排他锁。读直接读最新值，不走 MVCC。
**生产**：几乎不使用。

#### 2. Read Committed（读已提交，RC）

```
事务 A：UPDATE balance = 0 WHERE id = 1; COMMIT;
事务 B：
  第一次 SELECT → balance = 100（A 还没提交）
  --- A 提交了 ---
  第二次 SELECT → balance = 0（A 已提交）
→ 同一个事务内两次读取结果不同（不可重复读）
```

**解决了**：脏读
**问题**：不可重复读（同一事务内两次读结果不一致）
**实现**：MVCC，**每次 SELECT 都生成新的 ReadView**
**生产**：Oracle、PostgreSQL 的默认级别；互联网公司常用（阿里内部就用 RC）。

#### 3. Repeatable Read（可重复读，RR）

```
事务 B：
  第一次 SELECT → balance = 100
  --- 事务 A 修改并提交了 ---
  第二次 SELECT → balance = 100（和第一次一样！）
→ 整个事务期间看到的快照一致
```

**解决了**：不可重复读
**问题**：幻读（其他事务插入/删除行后，范围查询结果数量变化）
**实现**：MVCC，**事务第一次 SELECT 时生成 ReadView，后续复用**
**MySQL 默认隔离级别**。InnoDB 通过 **Next-Key Lock 在一定程度上解决了幻读**。

#### 4. Serializable（可串行化）

所有事务完全串行执行，读加共享锁，写加排他锁。

**解决了**：所有并发问题
**问题**：性能极差，并发度为零
**实现**：所有 SELECT 自动变成 `SELECT ... LOCK IN SHARE MODE`
**生产**：极少使用。

#### 四种隔离级别对比

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现方式 | 性能 |
|---------|------|-----------|------|---------|------|
| Read Uncommitted | ✅ 存在 | ✅ 存在 | ✅ 存在 | 读不加锁直接读最新值 | 最好 |
| Read Committed | ❌ 解决 | ✅ 存在 | ✅ 存在 | MVCC（每次读生成新 ReadView） | 好 |
| Repeatable Read | ❌ 解决 | ❌ 解决 | ⚠️ 大部分解决 | MVCC（首次读生成 ReadView 复用）+ Next-Key Lock | 较好 |
| Serializable | ❌ 解决 | ❌ 解决 | ❌ 解决 | 读加 S 锁，写加 X 锁，完全串行 | 最差 |

#### 三种并发问题解释

```
脏读：         读到了其他事务【未提交】的数据
不可重复读：    同一事务内两次读同一行，结果【值】不同（别人改了并提交了）
幻读：         同一事务内两次范围查询，结果【行数】不同（别人插入/删除了行）
```

---

### 三、MVCC 机制详解

MVCC（Multi-Version Concurrency Control）是 InnoDB 实现 RC 和 RR 隔离级别的核心机制。**让读操作不加锁，读写不冲突**。

#### 核心组件

MVCC 依赖三个东西：**隐藏列 + undo log 版本链 + ReadView**。

#### 1. 隐藏列

InnoDB 每行数据有三个隐藏列：

| 隐藏列 | 大小 | 含义 |
|--------|------|------|
| `trx_id` | 6 字节 | 最后一次修改该行的事务 ID（递增分配） |
| `roll_pointer` | 7 字节 | 指向 undo log 中该行的上一个版本 |
| `row_id` | 6 字节 | 隐式主键（只有没定义主键时才有） |

#### 2. undo log 版本链

每次 UPDATE/DELETE 都会把旧值写入 undo log，通过 `roll_pointer` 串成一条**从新到旧**的链表：

```
当前行数据（Buffer Pool）：
┌──────────────────────────────────────────────┐
│ id=1, name='王五', trx_id=300, roll_ptr → │────┐
└──────────────────────────────────────────────┘    │
                                                    ▼
undo log 版本 1：                                    │
┌──────────────────────────────────────────────┐    │
│ id=1, name='李四', trx_id=200, roll_ptr → │────┐ │
└──────────────────────────────────────────────┘    │
                                                    ▼
undo log 版本 2：
┌──────────────────────────────────────────────┐
│ id=1, name='张三', trx_id=100, roll_ptr=NULL │
└──────────────────────────────────────────────┘

版本链：王五(trx300) → 李四(trx200) → 张三(trx100)
```

#### 3. ReadView（读视图）

ReadView 是事务执行**快照读**（普通 SELECT）时生成的一个"快照标记"，用来判断版本链上的哪个版本对当前事务可见。

**ReadView 包含四个字段**：

| 字段 | 含义 |
|------|------|
| `creator_trx_id` | 创建该 ReadView 的事务自身 ID |
| `m_ids` | 生成 ReadView 时，系统中所有**活跃（未提交）**事务的 ID 列表 |
| `min_trx_id` | m_ids 中的**最小值** |
| `max_trx_id` | 生成 ReadView 时系统即将分配的下一个事务 ID（当前最大 trx_id + 1） |

#### 4. 可见性判断规则

拿到一行数据的 `trx_id`，按以下规则判断该版本是否对当前事务可见：

```
                 trx_id 可见性判断流程
                        │
          ┌─────────────┼─────────────┐
          │             │             │
   trx_id < min_trx_id? │  trx_id >= max_trx_id?
          │             │             │
        YES ──→ ✅可见   │           YES ──→ ❌不可见
     （在 ReadView      │         （在 ReadView
      生成前已提交）      │          生成后才开始）
                        │
                        ▼
              trx_id == creator_trx_id?
                     │
                   YES ──→ ✅可见（自己修改的）
                     │
                    NO
                     │
                     ▼
              trx_id 在 m_ids 中？
                │           │
              YES          NO
                │           │
           ❌不可见      ✅可见
         （还没提交）   （已提交）
```

**用文字总结**：
1. `trx_id == creator_trx_id` → 自己改的，**可见**
2. `trx_id < min_trx_id` → 在 ReadView 生成前就已提交，**可见**
3. `trx_id >= max_trx_id` → 在 ReadView 生成后才开启的事务，**不可见**
4. `min_trx_id <= trx_id < max_trx_id` → 看是否在 m_ids 中：
   - **在 m_ids 中**：该事务还活跃（未提交），**不可见**
   - **不在 m_ids 中**：该事务已提交，**可见**

**如果当前版本不可见**：沿 roll_pointer 跳到 undo log 中的上一个版本，重复判断，直到找到可见版本或到链尾（返回空）。

#### 5. RC 和 RR 的核心区别

**唯一的区别就是 ReadView 的生成时机**：

| 隔离级别 | ReadView 生成时机 | 效果 |
|---------|------------------|------|
| **RC** | **每次** SELECT 都生成新的 ReadView | 能读到两次 SELECT 之间其他事务提交的数据 → 不可重复读 |
| **RR** | 事务**第一次** SELECT 时生成 ReadView，后续复用 | 整个事务看到的快照一致 → 可重复读 |

#### 6. 走一个完整例子

```
初始数据：id=1, name='张三', trx_id=100

时间线：
  T1: 事务 A (trx_id=200) 开始
  T2: 事务 B (trx_id=300) 开始
  T3: 事务 B 执行 UPDATE name='李四' WHERE id=1  → trx_id 变为 300
  T4: 事务 B COMMIT
  T5: 事务 A 执行 SELECT name FROM t WHERE id=1  ← 问：读到什么？
  T6: 事务 C (trx_id=400) 执行 UPDATE name='王五' WHERE id=1  → trx_id 变为 400
  T7: 事务 A 再次 SELECT name FROM t WHERE id=1  ← 问：读到什么？
```

**RR 隔离级别下**：

```
T5 时事务 A 第一次 SELECT → 生成 ReadView：
  creator_trx_id = 200
  m_ids = [200]          （A 自己还活跃，B 已提交不在列表中）
  min_trx_id = 200
  max_trx_id = 301       （下一个要分配的 ID）

当前行版本：name='李四', trx_id=300
  300 < 301 且 300 不在 m_ids[200] 中 → 300 已提交 → ✅可见
  → 读到 '李四'

T7 时事务 A 再次 SELECT → 复用 T5 的 ReadView（RR 特性）
当前行版本：name='王五', trx_id=400
  400 >= max_trx_id(301) → ❌不可见（ReadView 生成后才开始的事务）
  → 沿版本链找上一个版本：name='李四', trx_id=300
  300 不在 m_ids 中 → ✅可见
  → 读到 '李四'（和 T5 一样！可重复读！）
```

**RC 隔离级别下**：

```
T5 时生成新 ReadView → 读到 '李四'（同上）

T7 时重新生成 ReadView：
  m_ids = [200]          （只有 A 活跃，B 和 C... C 未提交？）
  
  实际上 T7 时 C(trx400) 还没提交 → m_ids = [200, 400]
  当前版本 trx_id=400 在 m_ids 中 → ❌不可见
  → 上一版本 trx_id=300 不在 m_ids 中 → ✅可见
  → 读到 '李四'

  如果 C 在 T7 之前提交了 → m_ids = [200]
  → trx_id=400 不在 m_ids 中 → ✅可见
  → 读到 '王五'（RC 下每次都能读到最新提交的数据）
```

#### 7. MVCC 不能完全解决幻读

```sql
-- RR 隔离级别

-- 事务 A
BEGIN;
SELECT * FROM users WHERE age = 25;  -- 结果：1 行（快照读，生成 ReadView）

-- 事务 B
INSERT INTO users (name, age) VALUES ('新人', 25);
COMMIT;

-- 事务 A
SELECT * FROM users WHERE age = 25;  -- 结果：还是 1 行（快照读，复用 ReadView）
-- ✅ MVCC 防住了幻读（快照读场景）

-- 但是：
UPDATE users SET name = '改了' WHERE age = 25;  -- 这是当前读！会读到 B 插入的行！
SELECT * FROM users WHERE age = 25;  -- 结果：2 行！（更新后该行的 trx_id 变成 A 的了）
-- ❌ 幻读出现了！
```

**结论**：
- **快照读**（普通 SELECT）：MVCC 可以防幻读
- **当前读**（SELECT FOR UPDATE / UPDATE / DELETE）：需要 **Next-Key Lock**（Gap Lock）来防幻读
- InnoDB 在 RR 下通过 MVCC + Next-Key Lock **组合**来尽可能解决幻读，但不是 100%

---

### 四、面试回答模板

> "**ACID 的保证机制**：原子性靠 **undo log**（回滚恢复）；持久性靠 **redo log**（WAL，提交即 fsync，崩溃后重放）；隔离性靠**锁 + MVCC**（锁管写写互斥，MVCC 管读写不冲突）；一致性是 AID 三者共同保证的结果。
>
> **四种隔离级别**：RU 读最新值有脏读；RC 用 MVCC 每次 SELECT 新建 ReadView 解决脏读但有不可重复读；RR（MySQL 默认）首次 SELECT 建 ReadView 后续复用，保证可重复读，配合 Next-Key Lock 解决大部分幻读；Serializable 读加 S 锁完全串行。
>
> **MVCC 三大组件**：①隐藏列（trx_id 记录修改者、roll_pointer 指向旧版本）；②undo log 版本链（新→旧串起所有历史版本）；③ReadView（记录活跃事务集合 m_ids、min_trx_id、max_trx_id、creator_trx_id）。可见性判断：trx_id < min 可见、>= max 不可见、在 [min,max) 之间看是否在 m_ids 中——在则未提交不可见，不在则已提交可见。**RC 和 RR 唯一区别**就是 ReadView 生成时机：RC 每次读新建，RR 首次读建好后复用。一句话：**RC 每次读换新眼镜，RR 全程戴同一副眼镜**。"

---

## 数据库分库分表

**类别**：MySQL / 架构 / 分布式数据库 / 高可用

### 一、为什么要分库分表

单库单表在数据量和并发量增长后会遇到瓶颈：

| 瓶颈类型 | 具体表现 | 解决方向 |
|---------|---------|---------|
| **单表数据量过大** | 单表几千万/上亿行 → B+ 树层数增加 → 查询变慢、DDL 超时 | **分表** |
| **单库写入瓶颈** | 单库 TPS 打满（MySQL 单机写 ~5000-10000 TPS）、连接数不够 | **分库** |
| **单库存储瓶颈** | 磁盘容量不够、单机存不下 | **分库** |
| **单库读瓶颈** | QPS 过高，读写混合互相影响 | **读写分离**（轻度）或**分库**（重度） |

**经验阈值**（不是绝对标准）：
- 单表行数 > **500 万 ~ 2000 万**行：考虑分表
- 单表大小 > **10GB**：考虑分表
- 单库 TPS > **5000**：考虑分库

### 二、分库分表的方式

#### 维度 1：垂直 vs 水平

```
垂直拆分：按业务/字段拆（不同的数据放不同的地方）
水平拆分：按行拆（同类数据按规则分散到多个地方）
```

#### 垂直分表

把一张宽表的字段拆成多张表，通常**把常用字段和不常用字段分开**。

```
拆分前：
┌────────────────────────────────────────────────┐
│ users 表                                        │
│ id | name | age | avatar(BLOB) | bio(TEXT) | ...│
└────────────────────────────────────────────────┘

拆分后：
┌─────────────────────────┐  ┌──────────────────────────┐
│ users 表（热数据）        │  │ users_detail 表（冷数据）  │
│ id | name | age          │  │ user_id | avatar | bio    │
└─────────────────────────┘  └──────────────────────────┘
```

**好处**：
- 热数据表行变窄 → 每页能放更多行 → Buffer Pool 利用率提升
- 大字段分离 → 减少 IO（不查详情就不读大字段）
- 和你在百度做的**物料数据库垂直拆分**是同一个思路

**适用**：表字段特别多或有大字段（TEXT/BLOB）的场景。

#### 垂直分库

按**业务模块**拆成独立的数据库，每个库负责一个业务域。

```
拆分前：
┌──────────────────────────┐
│        单体数据库          │
│ users | orders | products │
│ payments | logistics      │
└──────────────────────────┘

拆分后：
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ 用户库    │ │ 订单库    │ │ 商品库    │ │ 支付库    │
│ users    │ │ orders   │ │ products │ │ payments │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
   DB1          DB2          DB3          DB4
```

**好处**：
- 每个库独立部署，故障隔离
- 不同业务可以独立扩容
- 配合微服务架构，每个服务管自己的库

**问题**：跨库 JOIN、分布式事务。

#### 水平分表

把同一张表的数据**按行拆分**到多张结构相同的表。

```
拆分前：
┌──────────────────────────┐
│ orders 表（1亿行）        │
│ id | user_id | amount    │
└──────────────────────────┘

拆分后（按 id 取模）：
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ orders_0（3333万行）  │ │ orders_1（3333万行）  │ │ orders_2（3334万行）  │
│ 同一个数据库内        │ │ 同一个数据库内        │ │ 同一个数据库内        │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

**好处**：单表数据量减少 → 查询快、DDL 快
**问题**：路由逻辑、跨表查询、分布式主键

#### 水平分库

水平分表 + 把分出来的表放到不同的数据库实例上。

```
拆分后（按 user_id 取模，分到不同库）：
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ DB0           │ │ DB1           │ │ DB2           │
│ orders_0     │ │ orders_1     │ │ orders_2     │
│ user_id%3==0 │ │ user_id%3==1 │ │ user_id%3==2 │
└──────────────┘ └──────────────┘ └──────────────┘
  服务器 A          服务器 B          服务器 C
```

**好处**：既减少单表数据量，又分摊了数据库的 IO / CPU / 连接数压力。
**这是大规模系统的终极方案**。

#### 四种方式对比

| | 解决什么问题 | 改动范围 | 复杂度 |
|---|------------|---------|--------|
| **垂直分表** | 表太宽、大字段 | 小（同库拆表） | 低 |
| **垂直分库** | 业务耦合、单库压力 | 中（按业务拆库） | 中 |
| **水平分表** | 单表数据量过大 | 中（同库拆表） | 中 |
| **水平分库** | 单表+单库都撑不住 | 大（多库多表） | 高 |

### 三、水平分片的路由策略

水平拆分后，一条数据该落到哪个库/表？需要一个**路由规则**。

#### 策略 1：取模（Hash）

```
分片号 = hash(sharding_key) % N

例：user_id = 12345, N = 4
分片号 = 12345 % 4 = 1 → 落到 orders_1
```

**优点**：分布均匀、实现简单
**缺点**：扩容时 N 变化 → 大量数据需要迁移（rehash）

#### 策略 2：范围（Range）

```
id 1~1000万    → 分片 0
id 1000万~2000万 → 分片 1
id 2000万~3000万 → 分片 2
```

**优点**：扩容只需加新分片（旧数据不动）、范围查询友好
**缺点**：数据可能不均匀（新数据集中在最新分片，造成热点）

#### 策略 3：一致性哈希

```
将分片节点映射到哈希环上，key 顺时针找到最近的节点

扩容时只影响环上相邻的节点，迁移数据量小
```

**优点**：扩容友好，只迁移少量数据
**缺点**：实现复杂，可能数据不均匀（需要虚拟节点）

#### 策略 4：路由表

```
在一张独立的路由表中记录每个 sharding_key 对应哪个分片

sharding_key  →  分片号
user_001      →  DB0
user_002      →  DB1
```

**优点**：完全灵活，可以手动调整
**缺点**：路由表本身成为瓶颈和单点

#### 策略选择

| 策略 | 数据均匀 | 扩容友好 | 范围查询 | 复杂度 |
|------|---------|---------|---------|--------|
| 取模 | ✅ | ❌（需 rehash） | ❌ | 低 |
| 范围 | ❌（可能热点） | ✅ | ✅ | 低 |
| 一致性哈希 | ✅（加虚拟节点） | ✅ | ❌ | 中 |
| 路由表 | ✅ | ✅ | ✅ | 高 |

### 四、分库分表带来的问题

#### 问题 1：分布式主键

自增 ID 在多库多表下会冲突。

**解决方案**：

| 方案 | 原理 | 优缺点 |
|------|------|--------|
| **UUID** | 随机生成 128 位唯一 ID | 无序 → 插入 B+ 树性能差；太长占空间 |
| **雪花算法（Snowflake）** | 时间戳 + 机器 ID + 序列号 = 64 位 long | ✅ 趋势递增、高性能、不依赖 DB；❌ 依赖时钟 |
| **号段模式** | 从 DB 批量取一段 ID（如 1-1000），用完再取下一段 | ✅ 趋势递增；❌ 依赖号段表 |
| **Redis INCR** | 用 Redis 的原子自增 | ✅ 简单高性能；❌ 增加了 Redis 依赖 |

**生产首选**：**雪花算法**（不依赖外部存储、趋势递增对 B+ 树友好、高并发高性能）。

#### 问题 2：跨分片查询

```sql
-- user_id 是分片键
-- 按 user_id 查：路由到一个分片，没问题
SELECT * FROM orders WHERE user_id = 123;

-- 按 order_id 查：不知道在哪个分片 → 要查所有分片再合并！
SELECT * FROM orders WHERE order_id = 456;

-- 分页/排序：每个分片都查出来，在中间件层合并排序
SELECT * FROM orders ORDER BY create_time LIMIT 10 OFFSET 100;
-- 实际：每个分片都取 110 条 → 中间件合并排序 → 取第 101-110 条
```

**解决**：
- **合理选择分片键**（覆盖 80% 以上查询的条件字段）
- 非分片键查询：建**映射表**（如 order_id → user_id 的映射）或**冗余数据**
- 复杂查询：同步到 **ES** 等搜索引擎做聚合查询

#### 问题 3：跨分片 JOIN

分库后不能直接 JOIN 不同库的表。

**解决**：
- **冗余字段**：把需要 JOIN 的字段冗余到主表
- **应用层组装**：先查主表，拿到关联 ID，再查从表，代码层合并
- **全局表**（广播表）：字典表等小表在每个分片都放一份完整副本

#### 问题 4：分布式事务

跨库操作无法用单库的 ACID 事务。

**解决**：
- **最终一致性**（最常用）：消息队列 + 补偿机制（你在新大陆做的分片上传就是类似思路）
- **Seata**：分布式事务框架（AT 模式 / TCC 模式）
- **XA 事务**：MySQL 原生支持但性能差
- **Saga 模式**：每步操作都有补偿动作，失败时逆序补偿

#### 问题 5：扩容迁移

取模分片时增加节点，数据要重新分配。

**解决**：
- **翻倍扩容**：从 4 个分片扩到 8 个，每个旧分片只需拆成两半（简化迁移）
- **一致性哈希**：只迁移相邻节点的数据
- **双写 + 迁移**：新旧分片同时写入，后台迁移旧数据，验证后切流量

### 五、分库分表中间件

| 中间件 | 类型 | 特点 |
|--------|------|------|
| **ShardingSphere-JDBC** | 客户端 SDK（JAR 包） | 无需代理，嵌入应用层，性能好 |
| **ShardingSphere-Proxy** | 独立代理服务 | 对应用透明，支持任何语言 |
| **MyCat** | 独立代理服务 | 社区版，功能全但维护渐少 |
| **Vitess** | 独立代理服务 | YouTube 开源，云原生，适合大规模 |

### 六、分库分表的实施顺序

**不要一上来就分库分表**，按这个顺序逐步升级：

```
第 1 步：SQL 优化 + 加索引           ← 最低成本
第 2 步：读写分离（主写从读）         ← 中等成本
第 3 步：垂直分表（拆大字段）         ← 中等成本
第 4 步：垂直分库（按业务拆库）       ← 配合微服务
第 5 步：水平分表（单表数据量太大）    ← 引入中间件
第 6 步：水平分库（单机扛不住）       ← 最高复杂度
```

### 七、面试回答模板

> "分库分表从两个维度划分：**垂直**（按业务/字段拆）和**水平**（按行拆）。垂直分表把宽表的冷热字段分开（类似我在百度做的物料数据库垂直拆分）；垂直分库按业务模块拆成独立库配合微服务；水平分表把一张大表按路由规则（取模/范围/一致性哈希）拆成多张结构相同的表减少单表数据量；水平分库进一步把这些表分散到不同数据库实例分摊 IO 和连接压力。
>
> 分库分表带来五个核心问题：**分布式主键**用雪花算法（趋势递增对 B+ 树友好）；**跨分片查询**靠合理选分片键 + 映射表 + ES；**跨分片 JOIN** 靠冗余字段或应用层组装；**分布式事务**靠最终一致性（MQ + 补偿）或 Seata；**扩容**用翻倍扩容或一致性哈希减少迁移量。实施顺序上不要过早分库分表，先做 SQL 优化 → 读写分离 → 垂直拆分 → 水平拆分逐步升级。"
