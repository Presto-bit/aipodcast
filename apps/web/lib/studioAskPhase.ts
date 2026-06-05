const RETRIEVAL_PHASE_RE = /检索|整理勾选资料/;

/** 资料绑定指纹：同 work 内 noteIds 未变则视为同一批资料 */
export function studioCorpusBindingKey(notebook: string, noteIds: string[]): string {
  const nb = notebook.trim();
  const ids = [...noteIds].map((id) => id.trim()).filter(Boolean).sort();
  return `${nb}|${ids.join(",")}`;
}

/**
 * 同资料后续轮次不再强调「检索并整理」，改为「正在生成回答…」。
 * 换绑资料后会对新 binding 再展示一次完整检索文案。
 */
export function softenStudioRagPhaseMessage(
  message: string,
  bindingKey: string,
  warmedBindings: Set<string>
): string {
  const msg = message.trim();
  if (!msg || !RETRIEVAL_PHASE_RE.test(msg)) return msg;
  if (warmedBindings.has(bindingKey)) return "正在生成回答…";
  warmedBindings.add(bindingKey);
  return msg;
}

export function resetStudioRagWarmOnBindingChange(
  bindingKey: string,
  prevBindingKeyRef: { current: string | null },
  warmedBindings: Set<string>
): void {
  if (prevBindingKeyRef.current === bindingKey) return;
  if (prevBindingKeyRef.current) warmedBindings.delete(prevBindingKeyRef.current);
  prevBindingKeyRef.current = bindingKey;
}
