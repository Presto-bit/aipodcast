"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import SmallPromptModal from "../../ui/SmallPromptModal";
import UserErrorBanner from "../../ui/UserErrorBanner";
import {
  type AuthorIpItem,
  type AuthorIpMaterial,
  addAuthorIpMaterial,
  bootstrapAuthorIpsOnce,
  deleteAuthorIp,
  deleteAuthorIpMaterial,
  duplicateAuthorIp,
  fetchAuthorIpItem,
  fetchAuthorIpMaterials,
  learnAuthorIp,
  needsAuthorIpColdStart,
  patchAuthorIp,
  submitAuthorIpColdStart
} from "../../../lib/authorIp";
import AuthorIpColdStartModal from "./AuthorIpColdStartModal";
import AuthorIpDistillPanel from "./AuthorIpDistillPanel";
import AuthorIpIdentityPanel from "./AuthorIpIdentityPanel";
import AuthorIpMaterialFormModal from "./AuthorIpMaterialFormModal";
import AuthorIpMaterialsColumn from "./AuthorIpMaterialsColumn";
import AuthorIpWorkbenchHeader from "./AuthorIpWorkbenchHeader";
import {
  countMaterialsByType,
  filterMaterials,
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

  const [coldOpen, setColdOpen] = useState(false);
  const [coldDismissed, setColdDismissed] = useState(false);
  const [whoAmI, setWhoAmI] = useState("");
  const [audience, setAudience] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [coldError, setColdError] = useState<string | null>(null);

  const [materialModal, setMaterialModal] = useState<"experience" | "article" | null>(null);
  const [matTitle, setMatTitle] = useState("");
  const [matBody, setMatBody] = useState("");
  const [matTemplateId, setMatTemplateId] = useState("");
  const [matError, setMatError] = useState<string | null>(null);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!ipId) return;
    setError(null);
    try {
      await bootstrapAuthorIpsOnce();
      const [found, mats] = await Promise.all([fetchAuthorIpItem(ipId), fetchAuthorIpMaterials(ipId)]);
      setItem(found);
      setMaterials(mats);
      const prof = found.profile as { coldStart?: { whoAmI?: string; audience?: string; oneLiner?: string } };
      setWhoAmI(prof.coldStart?.whoAmI || "");
      setAudience(prof.coldStart?.audience || "");
      setOneLiner(found.oneLiner || prof.coldStart?.oneLiner || "");
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

  useEffect(() => {
    if (loading || !item || coldDismissed) return;
    if (needsAuthorIpColdStart(item)) setColdOpen(true);
  }, [loading, item, coldDismissed]);

  const counts = useMemo(() => countMaterialsByType(materials), [materials]);
  const filtered = useMemo(() => filterMaterials(materials, segment), [materials, segment]);
  const readOnly = Boolean(item?.isReadOnly);

  const openColdEdit = () => {
    if (!item) return;
    const prof = item.profile as { coldStart?: { whoAmI?: string; audience?: string } };
    setWhoAmI(prof.coldStart?.whoAmI || "");
    setAudience(prof.coldStart?.audience || "");
    setOneLiner(item.oneLiner || "");
    setColdError(null);
    setColdOpen(true);
  };

  const submitCold = async () => {
    if (!oneLiner.trim()) {
      setColdError("请填写一句话定位");
      return;
    }
    setBusy(true);
    setColdError(null);
    try {
      const updated = await submitAuthorIpColdStart(ipId, {
        whoAmI: whoAmI.trim(),
        audience: audience.trim(),
        oneLiner: oneLiner.trim()
      });
      setItem(updated);
      setColdOpen(false);
      await load();
    } catch (e) {
      setColdError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const openMaterialModal = (mode: "experience" | "article") => {
    setMaterialModal(mode);
    setMatTitle("");
    setMatBody("");
    setMatTemplateId("");
    setMatError(null);
  };

  const submitMaterial = async () => {
    if (!matTitle.trim() || !matBody.trim()) {
      setMatError("请填写标题与正文");
      return;
    }
    setBusy(true);
    setMatError(null);
    try {
      await addAuthorIpMaterial(ipId, {
        title: matTitle.trim(),
        body: matBody.trim(),
        materialType: materialModal === "article" ? "published" : "experience_card",
        experienceTemplateId: materialModal === "experience" ? matTemplateId : undefined
      });
      setMaterialModal(null);
      await load();
    } catch (e) {
      setMatError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
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
        writeHref={`/notes/author-ip/${ipId}/write`}
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
        <div className="h-[42vh] shrink-0 lg:h-auto lg:w-[30%] lg:min-w-[280px] lg:max-w-[400px]">
          <AuthorIpMaterialsColumn
            materials={filtered}
            segment={segment}
            onSegment={setSegment}
            counts={counts}
            readOnly={readOnly}
            busy={busy}
            onAddExperience={() => openMaterialModal("experience")}
            onAddArticle={() => openMaterialModal("article")}
            onDelete={(id) => void onDeleteMaterial(id)}
          />
        </div>

        <div className="flex min-h-[45vh] flex-1 flex-col overflow-hidden rounded-2xl border border-line/80 lg:min-h-0">
          <div className="h-[28%] min-h-[140px] shrink-0 lg:h-[30%] lg:min-h-[160px]">
            <AuthorIpIdentityPanel item={item} onEdit={openColdEdit} />
          </div>
          <div className="min-h-0 flex-1">
            <AuthorIpDistillPanel
              item={item}
              counts={{ experience: counts.experience, article: counts.article + counts.draft }}
              readOnly={readOnly}
              busy={busy}
              onLearn={() => void onLearn()}
            />
          </div>
        </div>
      </div>

      <AuthorIpColdStartModal
        open={coldOpen}
        whoAmI={whoAmI}
        audience={audience}
        oneLiner={oneLiner}
        onChangeWho={setWhoAmI}
        onChangeAudience={setAudience}
        onChangeOneLiner={setOneLiner}
        busy={busy}
        error={coldError}
        onSubmit={() => void submitCold()}
        onLater={() => {
          setColdDismissed(true);
          setColdOpen(false);
        }}
        onCancel={() => setColdOpen(false)}
      />

      <AuthorIpMaterialFormModal
        open={materialModal !== null}
        mode={materialModal === "article" ? "article" : "experience"}
        title={matTitle}
        body={matBody}
        templateId={matTemplateId}
        onTitle={setMatTitle}
        onBody={setMatBody}
        onTemplateId={setMatTemplateId}
        busy={busy}
        error={matError}
        onSubmit={() => void submitMaterial()}
        onCancel={() => setMaterialModal(null)}
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
