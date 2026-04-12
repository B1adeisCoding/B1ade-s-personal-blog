---
title: "Golang 八股汇总"
type: note
category: "Go Runtime"
tags:
  - 八股
  - 面试
  - Go Runtime
  - 并发调度
  - Goroutine
  - Golang
date: 2026-03-31
updated: 2026-04-12
hidden: false
summary: "Go 的并发模型核心是 **GMP 调度器**，它是 Go Runtime 实现的一套用户态线程调度系统，让成千上万的 goroutine 可以高效地运行在少量的操作系统线程上。"
---

> 相关笔记：[并发八股汇总](/notes/并发八股汇总/) | [jvm八股汇总](/notes/jvm八股汇总/) | [redis八股汇总](/notes/redis八股汇总/)

---

## GMP 调度模型

**类别**：Go Runtime / 并发调度 / Goroutine

### 一、GMP 是什么

Go 的并发模型核心是 **GMP 调度器**，它是 Go Runtime 实现的一套用户态线程调度系统，让成千上万的 goroutine 可以高效地运行在少量的操作系统线程上。

```
GMP 三要素：

  G（Goroutine）：Go 协程，用户态的轻量级线程
    - 初始栈仅 2KB（可动态增长到 1GB）
    - 创建/销毁成本极低，百万级 goroutine 是常规操作

  M（Machine）：操作系统线程，真正执行代码的载体
    - 由 OS 内核调度
    - 默认最大数量 10000（可通过 runtime.SetMaxThreads 调整）
    - M 必须绑定一个 P 才能执行 G

  P（Processor）：逻辑处理器，调度的核心上下文
    - 数量默认等于 CPU 核数（GOMAXPROCS）
    - 持有本地运行队列（Local Run Queue，最多 256 个 G）
    - 提供 G 执行所需的资源（内存分配缓存 mcache 等）
```

### 二、GMP 整体架构

```
                    ┌──────────────────────────────────┐
                    │         Global Run Queue          │
                    │    (全局队列，存放等待运行的 G)      │
                    └──────────┬───────────────────┬────┘
                               │                   │
               ┌───────────────▼──┐         ┌──────▼────────────┐
               │       P0         │         │       P1          │
               │  ┌────────────┐  │         │  ┌────────────┐   │
               │  │Local Queue │  │         │  │Local Queue │   │
               │  │ G1 G2 G3   │  │         │  │ G5 G6      │   │
               │  └────────────┘  │         │  └────────────┘   │
               │    mcache        │         │    mcache         │
               └───────┬─────────┘         └────────┬──────────┘
                       │                             │
                       ▼                             ▼
                 ┌──────────┐                 ┌──────────┐
                 │    M0    │                 │    M1    │
                 │ (OS线程) │                 │ (OS线程) │
                 └──────────┘                 └──────────┘
                       │                             │
                       ▼                             ▼
                   OS Kernel 调度到 CPU 核心上执行
```

**关键关系**：
- P 的数量决定了并发度（同时能有多少个 G 在运行）
- M 的数量 >= P 的数量（有些 M 可能因为系统调用阻塞而没有绑定 P）
- G 的数量远大于 M 和 P（这正是 goroutine 轻量的意义）

### 三、调度流程详解

#### 1. Goroutine 的创建

```go
go func() {
    // 这行代码会创建一个新的 G
}()
```

创建流程：
1. 编译器将 `go func()` 翻译为 `runtime.newproc()` 调用
2. 从 P 的本地 gFree 列表（复用池）或全局池获取一个空闲 G 结构体；没有就 `malg()` 新建
3. 将函数指针、参数拷贝到 G 的栈上，初始化 G 的状态为 `_Grunnable`
4. **优先放入当前 P 的本地队列**；本地队列满（256）时，将本地队列的**一半** G 连同新 G 一起放到全局队列

#### 2. 调度循环（schedule loop）

每个 M 绑定 P 后进入调度循环 `runtime.schedule()`，核心逻辑：

```
schedule() {
    // 1/61 的概率从全局队列取 G（防止全局队列饿死）
    if random() % 61 == 0 {
        G = 从全局队列取
    }

    // 从当前 P 的本地队列取 G
    if G == nil {
        G = 从本地队列取
    }

    // 本地也没有，尝试从其他地方找
    if G == nil {
        G = findrunnable()  // 这里会阻塞直到找到可运行的 G
    }

    execute(G)  // 切换到 G 的上下文执行
}
```

#### 3. findrunnable() —— 找活干

这是调度器最复杂的部分，按优先级依次尝试：

```
findrunnable() {
    1. 再检查一次本地队列
    2. 检查全局队列（每次取 min(len/GOMAXPROCS+1, len/2) 个）
    3. 检查 netpoll（网络 I/O 就绪的 G）
    4. Work Stealing：随机选一个其他 P，偷它本地队列的一半 G
    5. 再次检查全局队列和 netpoll
    6. 都没有 → 将 P 放入空闲列表，M 休眠（park）
}
```

### 四、核心调度策略

#### 1. Work Stealing（工作窃取）

```
P0 本地队列: [G1, G2, G3, G4]     P1 本地队列: [] (空了)

P1 绑定的 M 会随机选择一个 P（比如 P0），偷走它一半的 G：

P0 本地队列: [G1, G2]             P1 本地队列: [G3, G4] (偷来了)
```

**为什么偷一半而不是一个？** 减少窃取频率，降低锁竞争开销。

#### 2. Hand Off（交接机制）

当 M 因为系统调用（syscall）阻塞时，不能让它绑定的 P 也跟着干等：

```
正常状态:    M0  bindTo P0 (执行 G1)

G1 发起阻塞 syscall（如文件 I/O）:
  1. M0 进入 syscall，P0 与 M0 解绑
  2. P0 被交给其他空闲 M（或新建一个 M）继续执行队列中的 G
  3. syscall 返回后，M0 尝试重新获取 P0
     - P0 空闲 → 重新绑定
     - P0 被占 → 尝试获取其他空闲 P
     - 没有空闲 P → G1 放到全局队列，M0 休眠
```

这就是为什么 M 的数量可能超过 P 的数量 —— 阻塞的 M 在等 syscall 返回，而 P 已经被交给了新的 M。

#### 3. 抢占式调度

Go 1.14 之前是**协作式抢占**，之后引入了**基于信号的异步抢占**。

**协作式抢占（Go 1.2+）**：
- 编译器在函数调用入口插入 `morestack` 检查点
- sysmon 监控线程发现某个 G 运行超过 10ms，会设置该 G 的抢占标记 `stackguard0 = stackPreempt`
- 该 G 下次调用函数时检查到标记，主动让出 CPU

**问题**：如果 G 里有死循环且没有函数调用，永远不会被抢占：
```go
go func() {
    for { // 没有函数调用 → 不会触发 morestack → 不会被抢占
        i++
    }
}()
```

**异步抢占（Go 1.14+）**：
- sysmon 发现 G 运行超过 10ms → 向该 M 发送 `SIGURG` 信号
- M 的信号处理函数将当前 G 的执行现场保存，然后触发调度
- 即使没有函数调用也能被抢占

#### 4. sysmon —— 系统监控线程

sysmon 是一个特殊的 M，**不需要绑定 P**，独立运行，职责包括：

```
sysmon 的职责：
  1. 检查死锁（所有 G 都在休眠 → deadlock）
  2. 网络轮询（将就绪的网络 G 放回运行队列）
  3. 抢占长时间运行的 G（>10ms）
  4. 回收长时间未使用的 syscall 阻塞的 P（hand off）
  5. 触发 GC（2 分钟未触发过就强制一次）
  6. 定时器检查（timer 到期唤醒对应 G）
```

运行节奏：初始每 20μs 检查一次，如果连续无事可做，逐步退避到最大 10ms。

### 五、G 的生命周期与状态机

```
             ┌─────────────────────────────────────────────┐
             │                                             │
             ▼                                             │
 ┌──────────────────┐    schedule()     ┌──────────┐      │
 │   _Grunnable     │ ───────────────→  │ _Grunning │      │
 │  (在队列中等待)   │                   │ (正在执行) │      │
 └──────────────────┘                   └──────┬───┘      │
         ▲                                     │          │
         │                          ┌──────────┼──────────┤
         │                          │          │          │
         │                          ▼          ▼          ▼
         │                    channel/锁    syscall      完成
         │                    阻塞          阻塞
         │                          │          │          │
         │                          ▼          ▼          ▼
         │                    _Gwaiting   _Gsyscall    _Gdead
         │                          │          │       (可复用)
         │                          │          │
         └──────────────────────────┴──────────┘
                             被唤醒后回到 _Grunnable
```

### 六、Goroutine 栈管理

Go 的 goroutine 栈是**动态增长**的：

```
初始栈大小：2KB（Go 1.4+）

增长机制（连续栈 / Contiguous Stack）：
  1. 函数调用时 morestack 检查剩余栈空间
  2. 空间不足 → 分配一个 2 倍大小的新栈
  3. 将旧栈内容拷贝到新栈
  4. 调整所有指向旧栈的指针
  5. 释放旧栈

缩小机制：
  GC 时检查栈使用率，低于 1/4 时缩小为一半
```

**对比线程栈**：OS 线程默认栈 1MB~8MB（固定分配），1000 个线程就要 1GB~8GB。而 1000 个 goroutine 初始只占 2MB。

### 七、常见面试题

---

#### Q1: 为什么 Go 不用 OS 线程而要自己实现调度器？

```
1. OS 线程创建/切换开销大：
   - 创建线程：约 1MB 栈 + 内核数据结构
   - 上下文切换：需要陷入内核态，保存/恢复寄存器，刷新 TLB
   - 代价：约 1~10 μs

2. Goroutine 极其轻量：
   - 创建：只需分配 2KB 栈 + 一个 G 结构体（约 ~0.3μs）
   - 切换：纯用户态操作，只需保存/恢复少量寄存器（SP、PC 等）
   - 代价：约 0.1~0.2 μs

3. 控制权在 Runtime 手中：
   - 可以实现更智能的调度策略（work stealing、hand off）
   - 可以感知 channel、锁等语言级同步原语，做出更优调度决策
   - 协作+抢占结合，避免纯抢占的开销
```

---

#### Q2: GOMAXPROCS 设多少合适？

```
GOMAXPROCS = P 的数量 = 同时可运行 G 的最大并行度

默认值：runtime.NumCPU()（CPU 核数）

设置建议：
  CPU 密集型：= CPU 核数（默认值就好）
  I/O 密集型：可以适当大于 CPU 核数（因为很多 G 在等 I/O，不占 CPU）
  容器环境：注意 Go 默认读的是宿主机核数，不是容器 limit
    - Go 1.19+ 自动识别 cgroup limit
    - 之前版本需要手动设置或用 uber/automaxprocs 库
```

---

#### Q3: Goroutine 泄漏怎么排查？

```
泄漏原因（G 一直卡在 _Gwaiting 状态不释放）：
  1. 向无人接收的 channel 发送数据
  2. 从无人发送的 channel 接收数据
  3. 死锁（互相等待对方的 channel/锁）
  4. 无限循环没有退出条件
  5. WaitGroup 计数不匹配

排查手段：
  1. runtime.NumGoroutine() 监控 goroutine 数量变化趋势
  2. pprof: go tool pprof http://localhost:6060/debug/pprof/goroutine
     - 查看每个 goroutine 的栈信息，找到卡住的位置
  3. runtime.Stack() 打印所有 goroutine 栈

预防：
  - 使用 context.WithCancel/WithTimeout 控制 goroutine 生命周期
  - 使用 errgroup 管理一组 goroutine
  - channel 操作配合 select + default 或 timeout
```

---

#### Q4: channel 的底层实现？

```go
// runtime/chan.go
type hchan struct {
    qcount   uint           // 当前队列中的元素数
    dataqsiz uint           // 环形缓冲区大小（make(chan T, N) 中的 N）
    buf      unsafe.Pointer // 环形缓冲区指针
    elemsize uint16         // 单个元素大小
    closed   uint32         // 是否已关闭
    sendx    uint           // 发送索引
    recvx    uint           // 接收索引
    recvq    waitq          // 等待接收的 G 队列（双向链表）
    sendq    waitq          // 等待发送的 G 队列（双向链表）
    lock     mutex          // 互斥锁
}
```

```
发送流程（ch <- val）：
  1. 有等待接收的 G → 直接将数据拷贝给它，唤醒它（不经过 buf）
  2. buf 未满 → 数据拷贝到 buf
  3. buf 满了 → 当前 G 挂到 sendq，进入 _Gwaiting

接收流程（val := <-ch）：
  1. 有等待发送的 G → 直接从它那里拷贝数据，唤醒它
  2. buf 有数据 → 从 buf 取
  3. buf 空 → 当前 G 挂到 recvq，进入 _Gwaiting

向已关闭的 channel 发送 → panic
从已关闭的 channel 接收 → 返回零值 + false
```

---

#### Q5: Go 的 GC 机制？

```
Go 使用三色标记 + 混合写屏障的并发垃圾回收：

三色标记法：
  白色：未被扫描（GC 结束后白色对象被回收）
  灰色：已发现但子对象未扫描完
  黑色：自身和子对象都已扫描

标记过程：
  1. 初始所有对象为白色
  2. GC Roots（栈、全局变量等）标记为灰色
  3. 取出灰色对象，扫描其引用的对象标记为灰色，自身变黑
  4. 重复直到没有灰色对象
  5. 剩余白色对象就是垃圾

并发标记的问题 —— 三色不变式可能被打破：
  在标记过程中用户程序（mutator）继续运行，可能出现：
    黑色对象引用了白色对象（而灰色对象对该白色对象的引用被删除）
    → 白色对象被误回收 → 程序崩溃

写屏障（Write Barrier）解决：
  Go 1.8+ 使用混合写屏障（Hybrid Write Barrier）：
    - 将被覆盖的指针指向的对象标灰（删除屏障）
    - 将新指针指向的对象标灰（插入屏障）
    - 栈上的对象在 GC 开始时全部标黑（避免 STW 重新扫描栈）

GC 触发条件：
  1. 堆内存增长到上次 GC 后的 2 倍（GOGC=100，即 100% 增长率）
  2. 距上次 GC 超过 2 分钟（sysmon 强制触发）
  3. 手动调用 runtime.GC()

STW（Stop The World）阶段：
  Go 1.8+ 只有两个极短的 STW：
    STW1：开启写屏障（通常 < 1ms）
    STW2：关闭写屏障、清理状态（通常 < 1ms）
  标记阶段是并发的，不停止用户程序
```

---

#### Q6: Go 的 map 是并发安全的吗？

```
不安全。并发读写 map 会触发 fatal error: concurrent map read and map write。

解决方案：
  1. sync.Mutex / sync.RWMutex 加锁
  2. sync.Map（适合读多写少场景）

sync.Map 原理：
  - 内部维护 read（只读 map，原子操作，无锁）和 dirty（读写 map，需加锁）两个 map
  - 读操作优先查 read（无锁快路径）
  - 写操作写入 dirty
  - miss 次数达到阈值后，dirty 提升为 read

sync.Map 适用场景：
  ✅ key 相对稳定，读远多于写（如缓存）
  ❌ 大量写入时性能反而不如 RWMutex + 普通 map
```

---

#### Q7: Go 的内存分配机制？

```
Go 内存分配器基于 TCMalloc 思想，多级缓存减少锁竞争：

分配层级：
  mcache（每个 P 一个，无锁）
    → mcentral（每个 size class 一个，有锁）
      → mheap（全局唯一，有锁）
        → OS（mmap 系统调用）

对象大小分类：
  微对象（<16B 且无指针）：mcache 的 tiny allocator 合并分配
  小对象（16B ~ 32KB）：mcache 按 size class 从 mspan 分配
  大对象（>32KB）：直接从 mheap 分配

mspan：Go 内存管理的基本单位
  - 由连续的 8KB page 组成
  - 按 size class 划分成固定大小的 slot
  - 共 67 种 size class（8B、16B、32B ... 32KB）
```

---

#### Q8: defer 的执行顺序和底层原理？

```go
func example() {
    defer fmt.Println("first")
    defer fmt.Println("second")
    defer fmt.Println("third")
}
// 输出: third → second → first（LIFO 后进先出）
```

```
底层实现演进：
  Go 1.12-：堆分配 defer 结构体，挂到 G 的 _defer 链表
  Go 1.13：编译器优化，在栈上分配 defer 结构体（性能提升 ~30%）
  Go 1.14+：开放编码（open-coded defer），直接在函数末尾内联 defer 代码
            （条件：defer 数量 ≤ 8 且不在循环中）

defer + recover 捕获 panic：
  - panic 发生时沿 _defer 链表逆序执行
  - 遇到 recover() 就停止 panic 传播
  - recover 只在 defer 函数中有效
```

---

#### Q9: Go 接口的底层实现？

```go
// 带方法的接口
type iface struct {
    tab  *itab          // 类型信息 + 方法表
    data unsafe.Pointer // 指向实际数据的指针
}

// 空接口 interface{}
type eface struct {
    _type *_type         // 类型信息
    data  unsafe.Pointer // 指向实际数据的指针
}
```

```
接口赋值的代价：
  var r io.Reader = &File{}
  1. 查找/缓存 itab（File 类型是否实现了 io.Reader 的所有方法）
  2. 将 &File{} 的指针赋给 data

类型断言的代价：
  f, ok := r.(*File)
  1. 比较 iface.tab.inter 和目标接口类型
  2. 比较 iface.tab._type 和目标具体类型
  → O(1) 操作

类型 switch 的代价：
  switch v := r.(type) { ... }
  → 逐个比较，O(n) 但 n 通常很小
```

---

#### Q10: Go 的 select 机制？

```go
select {
case msg := <-ch1:
    fmt.Println(msg)
case ch2 <- "hello":
    fmt.Println("sent")
case <-time.After(1 * time.Second):
    fmt.Println("timeout")
default:
    fmt.Println("no channel ready")
}
```

```
select 底层实现（runtime.selectgo）：
  1. 将所有 case 随机打乱顺序（保证公平性，避免饿死）
  2. 按 channel 地址排序加锁（避免死锁）
  3. 遍历所有 case 检查是否有就绪的 channel
     - 有 → 执行对应 case，解锁，返回
     - 没有且有 default → 执行 default，解锁，返回
     - 没有且无 default → 将当前 G 挂到所有 case 的 channel 等待队列
       → 当某个 channel 就绪时唤醒 G
       → 从其他 channel 的等待队列中移除
```
