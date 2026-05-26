"use client";

import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import UserErrorBanner from "../../../../../../components/ui/UserErrorBanner";
import {
  type AuthorIpItem,
  type AuthorIpMaterial,
  addAuthorIpMaterial,
  deleteAuthorIpMaterial,
  fetchAuthorIpItem,
  fetchAuthorIpMaterials,
  learnAuthorIp
} from "../../../../../../lib/authorIp";

const TYPE_LABEL: Record<string, string> = {
  experience_card: "经历卡",
  published: "已发表",
  draft: "草稿"
};

export default function AuthorIpMaterialsPage() {
  const params = useParams();
  const ipId = String(params?.ipId || "");
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [materials, setMaterials] = useState<AuthorIpMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [materialType, setMaterialType] = useState<"experience_card" | "published">("experience_card");

  const load = useCallback(async () => {
    if (!ipId) return;
    setLoading(true);
    setError(null);
    try {
      const [found, mats] = await Promise.all([fetchAuthorIpItem(ipId), fetchAuthorIpMaterials(ipId)]);
      setItem(found);
      setMaterials(mats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const readOnly = Boolean(item?.isReadOnly);

  const onAdd = async () => {
    if (!title.trim() || !body.trim()) {
      setError("请填写标题与正文");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addAuthorIpMaterial(ipId, {
        title: title.trim(),
        body: body.trim(),
        materialType
      });
      setTitle("");
      setBody("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (noteId: string) => {
    if (!window.confirm("移入回收站？可在知识库一级导航的「回收站」中恢复。")) return;
    setBusy(true);
    try {
      await deleteAuthorIpMaterial(ipId, noteId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const onLearn = async () => {
    setBusy(true);
    try {
      await learnAuthorIp(ipId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "学习失败");
    } finally {
      setBusy(false);
    }
  };

  const experiences = materials.filter((m) => m.materialType === "experience_card");
  const articles = materials.filter((m) => m.materialType === "published" || m.materialType === "draft");

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">素材</h1>
          <p className="mt-1 text-sm text-muted">
            经历与文章供写作时引用；状态 {item?.maturity ?? "—"} · 共 {materials.length} 条
          </p>
        </div>
        <button
          type="button"
          className="rounded-dawn-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-fill disabled:opacity-50"
          disabled={busy || readOnly}
          onClick={() => void onLearn()}
        >
          刷新学习
        </button>
      </header>

      {error ? <UserErrorBanner className="mt-4" message={error} /> : null}

      {loading ? (
        <p className="mt-6 text-sm text-muted">加载中…</p>
      ) : (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="text-sm font-semibold text-ink">经历卡（{experiences.length}）</h2>
            {experiences.length === 0 ? (
              <p className="mt-2 text-xs text-muted">暂无经历卡，可在下方添加或在「写一篇」完成冷启动三问。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {experiences.map((m) => (
                  <MaterialRow key={m.noteId} material={m} readOnly={readOnly} busy={busy} onDelete={onDelete} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-ink">文章（{articles.length}）</h2>
            {articles.length === 0 ? (
              <p className="mt-2 text-xs text-muted">成文后可点「保存到 IP 素材」入库。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {articles.map((m) => (
                  <MaterialRow key={m.noteId} material={m} readOnly={readOnly} busy={busy} onDelete={onDelete} />
                ))}
              </ul>
            )}
          </section>

          {!readOnly ? (
            <section className="rounded-2xl border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink">添加素材</h2>
              <div className="mt-3 flex flex-wrap gap-2 text-sm">
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={materialType === "experience_card"}
                    onChange={() => setMaterialType("experience_card")}
                  />
                  经历卡
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={materialType === "published"}
                    onChange={() => setMaterialType("published")}
                  />
                  文章
                </label>
              </div>
              <input
                className="mt-2 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
                placeholder="标题"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="mt-2 w-full rounded-dawn-md border border-line bg-canvas px-3 py-2 text-sm"
                rows={5}
                placeholder="正文"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <button
                type="button"
                className="mt-3 rounded-dawn-md bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void onAdd()}
              >
                添加
              </button>
            </section>
          ) : (
            <p className="text-sm text-muted">示例 IP 素材为只读；请复制后编辑。</p>
          )}
        </div>
      )}
    </>
  );
}

function MaterialRow({
  material,
  readOnly,
  busy,
  onDelete
}: {
  material: AuthorIpMaterial;
  readOnly: boolean;
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="rounded-xl border border-line bg-fill/30 p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-ink">{material.title}</p>
          <p className="text-xs text-muted">
            {TYPE_LABEL[material.materialType] || material.materialType} · {material.bodyLength ?? 0} 字
          </p>
        </div>
        {!readOnly ? (
          <button
            type="button"
            className="shrink-0 text-xs text-danger-ink hover:underline disabled:opacity-50"
            disabled={busy}
            onClick={() => onDelete(material.noteId)}
          >
            删除
          </button>
        ) : null}
      </div>
      {material.preview ? (
        <p className="mt-2 line-clamp-3 text-xs text-ink/80">{material.preview}</p>
      ) : null}
    </li>
  );
}
