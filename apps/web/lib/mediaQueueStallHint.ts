/**
 * 播客走 media 队列；长时间无事件时 UI 会追加一条温和提示。
 * 运维排查（media-worker / REDIS / FYV_PRODUCTION / health）见仓库 DEPLOYMENT.md 与 .env.ai-native.example，勿写进用户可见文案。
 */
export const MEDIA_QUEUE_STALL_HINT_MS = 45_000;
