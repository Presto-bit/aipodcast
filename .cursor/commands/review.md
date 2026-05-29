# Code Review（本地 / @Branch）

对当前工作区或 `@Branch` 相对 main 的变更做代码审查。

## 步骤

1. 读取变更：`git diff main...HEAD` 或 `@Branch`；必要时 `git log main..HEAD --oneline`
2. 按优先级反馈：
   - 🔴 必须修：逻辑错误、安全、数据丢失、破坏 API
   - 🟡 建议修：边界条件、错误处理、与项目惯例不一致
   - 🔵 可选：命名、可读性、小优化
3. 对照项目：`.cursorrules`、相邻模块既有写法
4. **不要** 在本命令内自动 commit / push

## 审查完成后

若用户确认可以提交，提示其运行：

- **`/review/commit-push`** — Review 通过后提交并推送  
- 或 **`/terminal/commit-push`** — 直接提交推送（未做 review 时）
