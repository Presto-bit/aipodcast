"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import SmallPromptModal from "../../ui/SmallPromptModal";
import UserErrorBanner from "../../ui/UserErrorBanner";
import {
  type AuthorIpItem,
  type AuthorIpMaterial,
  type AuthorIpTrait,
  addAuthorIpMaterial,
  bootstrapAuthorIpsOnce,
  deleteAuthorIp,
  deleteAuthorIpMaterial,
  duplicateAuthorIp,
  fetchAuthorIpItem,
  fetchAuthorIpMaterials,
  learnAuthorIp,
  patchAuthorIp,
  patchAuthorIpMaterialLearning,
  submitAuthorIpColdStart,
} from "../../../lib/authorIp";
import AuthorIpAddMaterialChooserModal from "./AuthorIpAddMaterialChooserModal";
import AuthorIpArticleUploadModal from "./AuthorIpArticleUploadModal";
import AuthorIpCompactModal from "./AuthorIpCompactModal";
import AuthorIpMainPanel from "./AuthorIpMainPanel";
import AuthorIpMaterialPreviewModal from "./AuthorIpMaterialPreviewModal";
import AuthorIpMaterialsColumn from "./AuthorIpMaterialsColumn";
import AuthorIpPositioningWizard from "./AuthorIpPositioningWizard";
import AuthorIpResumeModal from "./AuthorIpResumeModal";
import AuthorIpStyleProfileDrawer from "./AuthorIpStyleProfileDrawer";
import AuthorIpWorkbenchHeader from "./AuthorIpWorkbenchHeader";
import {
  countMaterialsByType,
  filterMaterials,
  tagCloudFromItem,
  type MaterialSegment
} from "./utils";

type Props = {
  ipId: string;
};

export default function AuthorIpWorkbench({ ipId }: Props) {
  const router = useRouter();
  const [item, setItem] = useState<AuthorIpItem | null>(null);
  const [materials, setMaterials] = useState<AuthorIpMaterial[]>([]);
  const [segment, setSegment] = useState<MaterialSegment>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [positioningOpen, setPositioningOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [positioningError, setPositioningError] = useState<string | null>(null);

  const [chooserOpen, setChooserOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<AuthorIpMaterial | null>(null);
  const [previewMaterial, setPreviewMaterial] = useState<AuthorIpMaterial | null>(null);
  const [highlightTags, setHighlightTags] = useState<Set<string>>(new Set());

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ipId) return;
    setError(null);
    try {
      const bootstrapped =
        typeof sessionStorage !== "undefined" && sessionStorage.getItem("presto_author_ip_bootstrapped_v2");
      const bootPromise = bootstrapped ? Promise.resolve() : bootstrapAuthorIpsOnce();
      const [found, mats] = await Promise.all([
        fetchAuthorIpItem(ipId),
        fetchAuthorIpMaterials(ipId),
        bootPromise
      ]);
      setItem(found);
      setMaterials(mats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [ipId]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countMaterialsByType(materials), [materials]);
  const filtered = useMemo(() => filterMaterials(materials, segment), [materials, segment]);
  const readOnly = Boolean(item?.isReadOnly);
  const writeHref = `/notes/author-ip/${ipId}/write`;

  const submitPositioning = async (payload: {
    whoAmI: string;
    audience: string;
    oneLiner: string;
    traits: AuthorIpTrait[];
  }) => {
    if (!payload.oneLiner.trim()) {
      setPositioningError("请完成一句话定位");
      return;
    }
    setBusy(true);
    setPositioningError(null);
    try {
      const updated = await submitAuthorIpColdStart(ipId, {
        whoAmI: payload.whoAmI.trim(),
        audience: payload.audience.trim(),
        oneLiner: payload.oneLiner.trim(),
        traits: payload.traits
      });
      setItem(updated);
      setPositioningOpen(false);
      await load();
    } catch (e) {
      setPositioningError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const submitResume = async (payload: { title: string; body: string; experienceTemplateId: string }) => {
    setBusy(true);
    setResumeError(null);
    try {
      if (editingMaterial) {
        await deleteAuthorIpMaterial(ipId, editingMaterial.noteId);
      }
      await addAuthorIpMaterial(ipId, {
        title: payload.title,
        body: payload.body,
        materialType: "experience_card",
        experienceTemplateId: payload.experienceTemplateId
      });
      setResumeOpen(false);
      setEditingMaterial(null);
      setPreviewMaterial(null);
      await load();
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const openResumeEdit = (material: AuthorIpMaterial) => {
    setEditingMaterial(material);
    setResumeError(null);
    setPreviewMaterial(null);
    setResumeOpen(true);
  };

  const onDeleteMaterial = async (noteId: string) => {
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
    if (!item) return;
    const before = new Set(tagCloudFromItem(item));
    setBusy(true);
    try {
      const updated = await learnAuthorIp(ipId, "full");
      setItem(updated);
      const after = tagCloudFromItem(updated);
      const fresh = new Set<string>();
      for (const t of after) {
        if (!before.has(t)) fresh.add(t);
      }
      setHighlightTags(fresh);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "学习失败");
    } finally {
      setBusy(false);
    }
  };

  const onMaterialLearningToggle = async (noteId: string, include: boolean) => {
    setBusy(true);
    try {
      await patchAuthorIpMaterialLearning(ipId, noteId, include);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新参与学习设置失败");
    } finally {
      setBusy(false);
    }
  };

  const onDuplicate = async () => {
    if (!item) return;
    const msg = item.isTemplate
      ? "将复制示例 IP 的全部素材与特色，请随后改成你的真实情况。继续？"
      : "复制该 IP 的全部素材与特色？";
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const copy = await duplicateAuthorIp(item.id);
      router.push(`/notes/author-ip/${copy.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "复制失败");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteIp = async () => {
    if (!item || item.isSystemSeed || item.isTemplate) return;
    if (!window.confirm(`删除「${item.displayName}」？可在知识库一级导航的「回收站」中恢复。`)) return;
    setBusy(true);
    try {
      await deleteAuthorIp(item.id);
      router.push("/notes/author-ip");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!name) {
      setRenameError("请填写名称");
      return;
    }
    setBusy(true);
    setRenameError(null);
    try {
      const updated = await patchAuthorIp(ipId, { displayName: name });
      setItem(updated);
      setRenameOpen(false);
    } catch (e) {
      setRenameError(e instanceof Error ? e.message : "改名失败");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="p-8 text-sm text-muted">加载中…</p>;
  }

  if (!item) {
    return (
      <div className="p-8">
        <UserErrorBanner message={error || "未找到"} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AuthorIpWorkbenchHeader
        item={item}
        busy={busy}
        writeHref={writeHref}
        onRename={() => {
          setRenameName(item.displayName);
          setRenameError(null);
          setRenameOpen(true);
        }}
        onDuplicate={() => void onDuplicate()}
        onDelete={() => void onDeleteIp()}
      />

      {error ? <UserErrorBanner className="mx-4 mt-2 shrink-0" message={error} /> : null}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 lg:flex-row">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line/80 bg-surface">
          <AuthorIpMainPanel
            item={item}
            materials={materials}
            writeHref={writeHref}
            readOnly={readOnly}
            showOnboarding={!onboardingDismissed}
            onOpenProfile={() => setProfileOpen(true)}
            onAddMaterial={() => setChooserOpen(true)}
            onSetupPositioning={() => {
              setPositioningError(null);
              setPositioningOpen(true);
            }}
            onDismissOnboarding={() => setOnboardingDismissed(true)}
          />
        </div>

        <div className="h-[38vh] shrink-0 lg:h-auto lg:w-[32%] lg:min-w-[260px] lg:max-w-[380px]">
          <AuthorIpMaterialsColumn
            materials={filtered}
            segment={segment}
            onSegment={setSegment}
            counts={counts}
            readOnly={readOnly}
            busy={busy}
            onAdd={() => setChooserOpen(true)}
            onPreview={(m) => setPreviewMaterial(m)}
            onDelete={(id) => void onDeleteMaterial(id)}
          />
        </div>
      </div>

      <AuthorIpStyleProfileDrawer
        open={profileOpen}
        item={item}
        materials={materials}
        counts={{ experience: counts.experience, article: counts.article + counts.draft }}
        readOnly={readOnly}
        busy={busy}
        highlightTags={highlightTags}
        onClose={() => setProfileOpen(false)}
        onLearn={() => void onLearn()}
        onEditPositioning={() => {
          setProfileOpen(false);
          setPositioningError(null);
          setPositioningOpen(true);
        }}
      />

      <AuthorIpCompactModal
        open={positioningOpen && !readOnly}
        title="完善定位"
        description="约 2 分钟，帮助系统理解你的写作方向"
        maxWidthClass="max-w-lg"
        busy={busy}
        onClose={() => !busy && setPositioningOpen(false)}
      >
        <AuthorIpPositioningWizard
          busy={busy}
          error={positioningError}
          showLater
          onSubmit={(p) => void submitPositioning(p)}
          onLater={() => setPositioningOpen(false)}
          onCancel={() => setPositioningOpen(false)}
        />
      </AuthorIpCompactModal>

      <AuthorIpAddMaterialChooserModal
        open={chooserOpen}
        onPickResume={() => {
          setChooserOpen(false);
          setEditingMaterial(null);
          setResumeError(null);
          setResumeOpen(true);
        }}
        onPickUpload={() => {
          setChooserOpen(false);
          setUploadOpen(true);
        }}
        onCancel={() => setChooserOpen(false)}
      />

      <AuthorIpResumeModal
        open={resumeOpen}
        initialBody={editingMaterial?.body}
        initialTitle={editingMaterial?.title}
        busy={busy}
        error={resumeError}
        onSubmit={(p) => void submitResume(p)}
        onCancel={() => {
          if (!busy) {
            setResumeOpen(false);
            setEditingMaterial(null);
          }
        }}
      />

      <AuthorIpArticleUploadModal
        open={uploadOpen}
        notebookName={item.notebookName}
        busy={busy}
        onSuccess={() => {
          setUploadOpen(false);
          void load();
        }}
        onCancel={() => {
          if (!busy) setUploadOpen(false);
        }}
      />

      <AuthorIpMaterialPreviewModal
        open={Boolean(previewMaterial)}
        material={previewMaterial}
        readOnly={readOnly}
        onClose={() => setPreviewMaterial(null)}
        onEditResume={
          previewMaterial?.materialType === "experience_card" && !readOnly
            ? () => openResumeEdit(previewMaterial)
            : undefined
        }
        onLearningToggle={
          previewMaterial && !readOnly
            ? (include) => void onMaterialLearningToggle(previewMaterial.noteId, include)
            : undefined
        }
      />

      <SmallPromptModal
        open={renameOpen}
        title="改名"
        value={renameName}
        onChange={setRenameName}
        placeholder="IP 名称"
        submitLabel="保存"
        busy={busy}
        error={renameError}
        onCancel={() => {
          if (!busy) setRenameOpen(false);
        }}
        onSubmit={() => void submitRename()}
      />
    </div>
  );
}
