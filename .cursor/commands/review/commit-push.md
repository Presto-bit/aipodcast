# Review 后 Commit & Push

在 **Agent Review / `@Branch` 审阅** 完成、用户确认可以合并前，执行提交与推送。

## 何时使用

- 用户说「review 完了，commit & push」「审查通过，提交推送」
- `/review` 结束后用户确认要落地代码

## 流程

1. **快速复核**（若刚做完 review 可跳过重复大 diff）  
   - `git status`、`git diff --stat`  
   - 确认无调试代码、无 secrets、无意外大范围改动

2. **按 Terminal 规范提交**  
   - 执行与 `/terminal/commit-push` 相同的安全协议（add → HEREDOC commit → status → push）  
   - 详见 `.cursor/commands/terminal/commit-push.md` 或规则 `@git-commit-push`

3. **回报**  
   - 变更摘要、commit message、远程分支与 push 状态

## 注意

- Review 阶段 **不要** 自动 commit；须用户在本轮明确同意后再 push
- 若 review 发现必须修复的问题，先修再 commit，不要带着已知 blocker 推送
