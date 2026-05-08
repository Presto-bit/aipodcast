/**
 * 音频剪辑页（PrestoFlowEditor）PRD 布局开关与「暂不展示」功能清单。
 *
 * 部署时设置 `NEXT_PUBLIC_CLIP_PRD_EDITOR_LAYOUT=0` 可恢复改版前的完整 UI（右侧工作台、顶栏内联上传等）。
 */
export function clipEditorUsesPrdLayout(): boolean {
  return process.env.NEXT_PUBLIC_CLIP_PRD_EDITOR_LAYOUT !== "0";
}

/**
 * PRD 布局启用时：代码仍保留，但不在前端展示或与 PRD 合并收纳的能力。
 * 产品验收后可逐项决定重新露出或删除。
 */
export const CLIP_EDITOR_FEATURES_HIDDEN_WHILE_PRD_LAYOUT = [
  "顶栏左侧「返回列表」箭头（PRD 改为 Presto Logo 回首页 + 「项目空间」进 /clip）",
  "顶栏内联「上传音频」与「音频剪辑」波形精细分割工具入口（收纳至左侧「素材」）",
  "顶栏内「开始转写」主按钮（收纳至左侧「素材」底部；逻辑不变）",
  "右侧固定工作台（Sparkles 建议 / 扳手引擎 / 变更历史 / 搜索图标栏 + 可抽屉）",
  "右侧工作台内的「下载导出文件」快捷图标（导出集中在顶栏「导出文件」）",
  "稿面上方「多段暂存轨」条（ClipStagingTracksBar 迁至左侧「素材」，不在稿面重复展示）",
  "稿面区的说话人筛选、「只看已选说话人」、按说话人批量删/恢复（非 PRD 文稿工具条范围）",
  "稿面右上角「快捷键说明」与「文稿全屏」按钮（逻辑保留，快捷键仍可触发）",
  "词链试听横幅与插入边界「+」、波形上可拖拽音频段重排等分段剪辑控件（PRD 未描述；拖序在左侧素材列表完成）",
  "双人访谈提示条（dualInterview，非 PRD；后端逻辑保留）",
  "导出 QC 门禁弹窗仍保留（PRD 未单列；属于导出链路）"
] as const;

export type ClipEditorHiddenPrdFeatureId = (typeof CLIP_EDITOR_FEATURES_HIDDEN_WHILE_PRD_LAYOUT)[number];
