export type NotebookMeta = {
  noteCount: number;
  sourceCount: number;
  createdAt: string;
  instanceId?: string;
};

export type NotebookSharingRow = {
  isPublic: boolean;
  publicAccess: "read_only" | "edit" | null;
  viewCount: number;
  listedInDiscover?: boolean;
};

export type PopularNotebookItem = {
  ownerUserId: string;
  notebook: string;
  publicAccess: string;
  viewCount: number;
  ownerDisplayName: string;
  sourceCount?: number;
  latestSourceAt?: string;
  coverMode?: string;
  coverPresetId?: string | null;
  hasUploadThumb?: boolean;
  autoCoverNoteId?: string | null;
};

export type NotebookCoverMeta = {
  coverMode?: string;
  coverPresetId?: string | null;
  hasUploadThumb?: boolean;
  autoCoverNoteId?: string | null;
};
