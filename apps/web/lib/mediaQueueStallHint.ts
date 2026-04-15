/** 播客走 media 队列；无 media-worker 时任务会长期 queued，用于 UI 超时提示文案与延时。 */

export const MEDIA_QUEUE_STALL_HINT_MS = 45_000;

export const MEDIA_QUEUE_STALL_HINT_ZH =
  "排队时间较长。若仍无进度：1) 请确认已启动 media-worker（或与编排器共用同一 REDIS_URL）；2) 生产环境 FYV_PRODUCTION=1 时默认关闭进程内嵌消费者，须单独部署 workers/media-worker，或显式设置 ORCHESTRATOR_EMBED_RQ_MEDIA_WORKER=1（仅小型部署）；3) 可请求编排器 GET /health 查看 media_pending、rq_workers.media 与 queue_alerts。本地请用 `make dev`（默认带 ai + media worker），勿仅用 `SKIP_DEV_WORKERS=1`。";
