---
title: "SQL 语法教程（Spark SQL 兼容）"
type: note
category: "面试八股"
tags:
  - 八股
  - 面试
  - SQL
date: 2026-03-12
updated: 2026-04-12
hidden: false
summary: "当你想**按某个维度分别统计**时，用 GROUP BY。"
---

> 相关笔记：[mysql八股汇总](/notes/mysql八股汇总/)

> 写给没有计算机基础的人，看完就能写基本的数据查询。

---

## 第一章：SQL 是什么

SQL（Structured Query Language）就是**用来查数据的语言**。你可以把数据库想象成一个巨大的 Excel：

```
数据库 = 一个 Excel 文件
表（Table） = Excel 里的一个 Sheet
行（Row） = Sheet 里的一行数据
列（Column） = Sheet 里的一列（字段名）
```

比如有一张 `students` 表：

| id | name | age | city | score |
|----|------|-----|------|-------|
| 1 | 小明 | 20 | 北京 | 85 |
| 2 | 小红 | 22 | 上海 | 92 |
| 3 | 小刚 | 21 | 北京 | 78 |
| 4 | 小美 | 23 | 广州 | 95 |
| 5 | 小亮 | 20 | 上海 | 88 |

下面所有例子都基于这张表。

---

## 第二章：查询数据（SELECT）

### 查所有数据

```sql
SELECT * FROM students;
```

`*` 表示所有列。意思是：从 students 表里，把所有列都查出来。

### 查指定的列

```sql
SELECT name, age FROM students;
```

只查 name 和 age 两列：

| name | age |
|------|-----|
| 小明 | 20 |
| 小红 | 22 |
| ... | ... |

### 给列取别名（AS）

```sql
SELECT name AS 姓名, age AS 年龄 FROM students;
```

| 姓名 | 年龄 |
|------|------|
| 小明 | 20 |
| 小红 | 22 |

---

## 第三章：筛选数据（WHERE）

### 基本条件

```sql
-- 查北京的学生
SELECT * FROM students WHERE city = '北京';

-- 查年龄大于 21 的
SELECT * FROM students WHERE age > 21;

-- 查分数在 80 到 90 之间的
SELECT * FROM students WHERE score BETWEEN 80 AND 90;
```

### 多个条件（AND / OR）

```sql
-- 北京的 且 分数大于 80 的
SELECT * FROM students WHERE city = '北京' AND score > 80;

-- 北京的 或 上海的
SELECT * FROM students WHERE city = '北京' OR city = '上海';
```

### 在某个范围内（IN）

```sql
-- 查北京和上海的学生（和上面的 OR 等价，但更简洁）
SELECT * FROM students WHERE city IN ('北京', '上海');
```

### 模糊查询（LIKE）

```sql
-- 名字里包含"小"的
SELECT * FROM students WHERE name LIKE '%小%';

-- 名字以"小"开头的
SELECT * FROM students WHERE name LIKE '小%';

-- % 代表"任意多个字符"
-- _ 代表"一个字符"
```

### 空值判断（IS NULL / IS NOT NULL）

```sql
-- 查 city 为空的
SELECT * FROM students WHERE city IS NULL;

-- 查 city 不为空的
SELECT * FROM students WHERE city IS NOT NULL;

-- 注意：不能写 city = NULL，必须用 IS NULL
```

---

## 第四章：排序（ORDER BY）

```sql
-- 按分数从低到高排
SELECT * FROM students ORDER BY score;

-- 按分数从高到低排（DESC = 降序）
SELECT * FROM students ORDER BY score DESC;

-- 先按城市排，城市相同的再按分数从高到低排
SELECT * FROM students ORDER BY city, score DESC;
```

---

## 第五章：去重（DISTINCT）

```sql
-- 查有哪些不同的城市
SELECT DISTINCT city FROM students;
```

结果：

| city |
|------|
| 北京 |
| 上海 |
| 广州 |

---

## 第六章：聚合函数（统计计算）

| 函数 | 作用 | 例子 |
|------|------|------|
| COUNT() | 计数 | 有多少行 |
| SUM() | 求和 | 总分是多少 |
| AVG() | 平均值 | 平均分是多少 |
| MAX() | 最大值 | 最高分是多少 |
| MIN() | 最小值 | 最低分是多少 |

```sql
-- 一共有多少学生
SELECT COUNT(*) AS 学生总数 FROM students;

-- 平均分
SELECT AVG(score) AS 平均分 FROM students;

-- 最高分
SELECT MAX(score) AS 最高分 FROM students;

-- 北京学生的平均分
SELECT AVG(score) AS 北京平均分 FROM students WHERE city = '北京';
```

---

## 第七章：分组统计（GROUP BY）

当你想**按某个维度分别统计**时，用 GROUP BY。

```sql
-- 每个城市有多少学生
SELECT city, COUNT(*) AS 人数
FROM students
GROUP BY city;
```

| city | 人数 |
|------|------|
| 北京 | 2 |
| 上海 | 2 |
| 广州 | 1 |

```sql
-- 每个城市的平均分
SELECT city, AVG(score) AS 平均分
FROM students
GROUP BY city;
```

| city | 平均分 |
|------|-------|
| 北京 | 81.5 |
| 上海 | 90.0 |
| 广州 | 95.0 |

### 分组后再筛选（HAVING）

WHERE 是分组前筛选，HAVING 是分组后筛选：

```sql
-- 平均分大于 85 的城市
SELECT city, AVG(score) AS 平均分
FROM students
GROUP BY city
HAVING AVG(score) > 85;
```

| city | 平均分 |
|------|-------|
| 上海 | 90.0 |
| 广州 | 95.0 |

---

## 第八章：限制结果数量（LIMIT）

```sql
-- 只取前 3 条
SELECT * FROM students LIMIT 3;

-- 分数最高的 2 个学生
SELECT * FROM students ORDER BY score DESC LIMIT 2;
```

---

## 第九章：多表关联（JOIN）

假设还有一张 `classes` 表：

| class_id | class_name |
|----------|------------|
| 1 | 计算机班 |
| 2 | 数学班 |

`students` 表加了一个 `class_id` 列：

| id | name | class_id | score |
|----|------|----------|-------|
| 1 | 小明 | 1 | 85 |
| 2 | 小红 | 2 | 92 |
| 3 | 小刚 | 1 | 78 |

### INNER JOIN（内连接，两边都有才出现）

```sql
SELECT s.name, c.class_name, s.score
FROM students s
JOIN classes c ON s.class_id = c.class_id;
```

| name | class_name | score |
|------|-----------|-------|
| 小明 | 计算机班 | 85 |
| 小红 | 数学班 | 92 |
| 小刚 | 计算机班 | 78 |

解释：
- `FROM students s`：给 students 表取个简称叫 `s`
- `JOIN classes c`：关联 classes 表，简称 `c`
- `ON s.class_id = c.class_id`：关联条件是 class_id 相等

### LEFT JOIN（左连接，左边的表全保留）

```sql
SELECT s.name, c.class_name
FROM students s
LEFT JOIN classes c ON s.class_id = c.class_id;
```

即使某个学生没有对应的班级（class_id 为空），也会出现在结果里，class_name 显示为 NULL。

### 简单理解

```
INNER JOIN：两张表的交集（两边都有的）
LEFT JOIN：左边表全保留，右边没有的补 NULL
RIGHT JOIN：右边表全保留，左边没有的补 NULL
FULL JOIN：两边都全保留（Spark SQL 支持）
```

---

## 第十章：子查询

把一个查询的结果当作另一个查询的条件或数据源。

### 放在 WHERE 里

```sql
-- 查分数高于平均分的学生
SELECT * FROM students
WHERE score > (SELECT AVG(score) FROM students);
```

### 放在 FROM 里（当临时表用）

```sql
-- 先算每个城市的平均分，再筛选平均分大于 85 的
SELECT *
FROM (
    SELECT city, AVG(score) AS avg_score
    FROM students
    GROUP BY city
) t
WHERE t.avg_score > 85;
```

`t` 是给子查询取的临时名字（Spark SQL 要求子查询必须有别名）。

---

## 第十一章：常用函数

### 字符串函数

```sql
-- 拼接
SELECT CONCAT(name, '-', city) FROM students;
-- 结果：小明-北京

-- 截取
SELECT SUBSTRING(name, 1, 1) FROM students;
-- 结果：小（从第 1 个字符开始，取 1 个）

-- 长度
SELECT LENGTH(name) FROM students;

-- 大小写（英文）
SELECT UPPER('hello'), LOWER('HELLO');

-- 去空格
SELECT TRIM('  hello  ');

-- 替换
SELECT REPLACE(name, '小', '大') FROM students;
-- 结果：大明、大红、大刚...
```

### 数字函数

```sql
-- 四舍五入
SELECT ROUND(3.1415, 2);   -- 3.14

-- 向上取整
SELECT CEIL(3.2);           -- 4

-- 向下取整
SELECT FLOOR(3.8);          -- 3

-- 绝对值
SELECT ABS(-10);            -- 10
```

### 日期函数

```sql
-- 当前日期
SELECT CURRENT_DATE();

-- 当前时间戳
SELECT CURRENT_TIMESTAMP();

-- 日期格式化
SELECT DATE_FORMAT(CURRENT_DATE(), 'yyyy-MM-dd');

-- 日期加减
SELECT DATE_ADD(CURRENT_DATE(), 7);    -- 7 天后
SELECT DATE_SUB(CURRENT_DATE(), 30);   -- 30 天前

-- 两个日期相差天数
SELECT DATEDIFF('2026-03-12', '2026-03-01');  -- 11
```

### 条件函数

```sql
-- CASE WHEN（相当于 if-else）
SELECT name, score,
    CASE
        WHEN score >= 90 THEN '优秀'
        WHEN score >= 80 THEN '良好'
        WHEN score >= 60 THEN '及格'
        ELSE '不及格'
    END AS 等级
FROM students;
```

| name | score | 等级 |
|------|-------|------|
| 小明 | 85 | 良好 |
| 小红 | 92 | 优秀 |
| 小刚 | 78 | 及格 |
| 小美 | 95 | 优秀 |

```sql
-- IF 函数（简单二选一）
SELECT name, IF(score >= 90, '优秀', '普通') AS 评价
FROM students;

-- COALESCE（取第一个非空值）
SELECT COALESCE(city, '未知') FROM students;
-- 如果 city 是 NULL，就返回 '未知'
```

### 类型转换

```sql
-- 字符串转数字
SELECT CAST('123' AS INT);

-- 数字转字符串
SELECT CAST(123 AS STRING);

-- 转日期
SELECT CAST('2026-03-12' AS DATE);
```

---

## 第十二章：窗口函数（进阶）

窗口函数可以**在不合并行的情况下做统计**——既能看到每一行的明细，又能看到统计结果。

### ROW_NUMBER()：排名

```sql
-- 按分数排名
SELECT name, score,
    ROW_NUMBER() OVER (ORDER BY score DESC) AS 排名
FROM students;
```

| name | score | 排名 |
|------|-------|------|
| 小美 | 95 | 1 |
| 小红 | 92 | 2 |
| 小亮 | 88 | 3 |
| 小明 | 85 | 4 |
| 小刚 | 78 | 5 |

### 分组内排名

```sql
-- 每个城市内按分数排名
SELECT name, city, score,
    ROW_NUMBER() OVER (PARTITION BY city ORDER BY score DESC) AS 城市内排名
FROM students;
```

| name | city | score | 城市内排名 |
|------|------|-------|-----------|
| 小明 | 北京 | 85 | 1 |
| 小刚 | 北京 | 78 | 2 |
| 小红 | 上海 | 92 | 1 |
| 小亮 | 上海 | 88 | 2 |
| 小美 | 广州 | 95 | 1 |

### 三种排名函数的区别

```sql
-- 假设分数：95, 92, 92, 85, 78

ROW_NUMBER()：1, 2, 3, 4, 5      -- 严格递增，不管并列
RANK()：      1, 2, 2, 4, 5      -- 并列同名次，跳过下一个
DENSE_RANK()：1, 2, 2, 3, 4      -- 并列同名次，不跳过
```

### 窗口聚合

```sql
-- 每个学生的分数 和 所在城市的平均分 放在一起看
SELECT name, city, score,
    AVG(score) OVER (PARTITION BY city) AS 城市平均分
FROM students;
```

| name | city | score | 城市平均分 |
|------|------|-------|-----------|
| 小明 | 北京 | 85 | 81.5 |
| 小刚 | 北京 | 78 | 81.5 |
| 小红 | 上海 | 92 | 90.0 |
| 小亮 | 上海 | 88 | 90.0 |

---

## 速查表

```sql
-- 查询模板
SELECT 列名                    -- 要查什么
FROM 表名                      -- 从哪查
WHERE 条件                     -- 筛选哪些行
GROUP BY 列名                  -- 按什么分组
HAVING 聚合条件                -- 分组后再筛选
ORDER BY 列名 [DESC]          -- 怎么排序
LIMIT 数量                     -- 取多少条

-- 执行顺序（不是写的顺序！）
FROM → WHERE → GROUP BY → HAVING → SELECT → ORDER BY → LIMIT
```
