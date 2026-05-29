# Commit & Push（Terminal / Agent 执行）

用户已明确要求 **提交并推送**。必须在 **Terminal（Shell 工具）** 中实际执行，不要只列出步骤或让用户手动运行。

## 前置

1. 并行运行：`git status`、`git diff`、`git log -5 --oneline`
2. 核对：不含 `.env`、密钥、凭证；未跟踪文件是否应纳入本次提交
3. 撰写 1–2 句 commit message，说明 **why**（与仓库近期 commit 风格一致）

## 执行顺序

```bash
git add <相关路径>
git commit -m "$(cat <<'EOF'
<commit message>

EOF
)"
git status
git push -u origin HEAD   # 分支尚未跟踪远程时用 -u；已跟踪则 git push
```

## 安全约束

- **禁止** `git config`、force push 到 main/master、`--no-verify`（除非用户明确要求）
- pre-commit hook 失败：**修复后新建 commit**，不要 amend（除非用户明确要求 amend 且 HEAD 未 push）
- **禁止** push 除非用户在本轮对话中明确要求 push

## 完成

回报：commit hash、push 结果、是否还有未提交变更。
