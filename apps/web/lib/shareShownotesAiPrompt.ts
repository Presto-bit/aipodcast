/** 与分享页 SharePublishClient 中 AI Shownotes 提词占位一致，保证多端默认行为相同 */

export const SHARE_SHOWNOTES_REFINE_HINT_LINE_A = "时间戳数量限制在 10 个以内";
export const SHARE_SHOWNOTES_REFINE_HINT_LINE_B = "风格改为二次元解说口吻（轻松有梗、少用书面语）";

/** 置灰占位：列出可照做的优化步骤，用户可整段替换或按需删改后再点「生成」。 */
export const SHARE_SHOWNOTES_REFINE_PROMPT_PLACEHOLDER = `1）把「## 要点」每条压到一句内（约 12～28 字），合并重复表述。
2）「## 节目导听」须放在「## 金句」**上方**；时间锚只保留 5～8 个最关键跳转。
3）「## 金句」压缩为 2～3 条最有传播力的短句，避免与要点同句重复。
4）统一语气：更像给听友看的介绍，少用内部纪要腔与空泛形容词。
5）检查人名、数字、书名与口播一致，不编造未出现的信息。`;
