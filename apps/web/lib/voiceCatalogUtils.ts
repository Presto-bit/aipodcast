/** 默认音色分组 */

const PRESET_KEY_ORDER = ["mini", "max"];

const LANG_ORDER = [
  "内置",
  "中文 (普通话)",
  "中文 (粤语)",
  "英文",
  "日文",
  "韩文",
  "法文",
  "德文",
  "西班牙文",
  "葡萄牙文",
  "印尼文",
  "俄文",
  "意大利文",
  "阿拉伯文",
  "土耳其文",
  "乌克兰文",
  "荷兰文",
  "越南文",
  "泰文",
  "波兰文",
  "罗马尼亚文",
  "希腊文",
  "捷克文",
  "芬兰文",
  "印地文",
  "其他"
];

const LANG_COMPACT: Record<string, string> = {
  内置: "内置",
  "中文 (普通话)": "普通话",
  "中文 (粤语)": "粤语",
  英文: "英语",
  日文: "日语",
  韩文: "韩语",
  法文: "法语",
  德文: "德语",
  西班牙文: "西语",
  葡萄牙文: "葡语",
  印尼文: "印尼",
  俄文: "俄语",
  意大利文: "意语",
  阿拉伯文: "阿语",
  土耳其文: "土语",
  乌克兰文: "乌语",
  荷兰文: "荷语",
  越南文: "越语",
  泰文: "泰语",
  波兰文: "波语",
  罗马尼亚文: "罗语",
  希腊文: "希腊",
  捷克文: "捷克",
  芬兰文: "芬兰",
  印地文: "印地",
  其他: "其他"
};

function langRank(language: string) {
  const i = LANG_ORDER.indexOf(language);
  return i === -1 ? 500 + String(language).localeCompare("", "zh-CN") : i;
}

function compactLanguageLabel(language: string) {
  return LANG_COMPACT[language] || (language.length > 6 ? `${language.slice(0, 5)}…` : language);
}

function shortenTypeLabel(raw: string, nameFallback: string) {
  let s = (raw || nameFallback || "").trim();
  if (!s) return nameFallback || "";
  s = s
    .replace(/音色-beta/gi, "β")
    .replace(/-beta/gi, "β")
    .replace(/音色$/g, "")
    .trim();
  if (s.length > 14) return `${s.slice(0, 13)}…`;
  return s;
}

export type VoiceMeta = {
  key: string;
  voiceId: string;
  name: string;
  description: string;
  provider: string;
  gender: string;
  genderGroup: string;
  language: string;
  voiceType: string;
  style: string;
  ageGroup: string;
  accent: string;
  tags: string[];
  typeShort: string;
  selectGroupLabel: string;
  optionTitle: string;
};

function pickText(val: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const raw = val[key];
    const s = String(raw || "").trim();
    if (s) return s;
  }
  return fallback;
}

function pickTags(val: Record<string, unknown>): string[] {
  const raw = val.tags ?? val.labels;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = String(item || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function parseVoiceMeta(key: string, val: Record<string, unknown>): VoiceMeta {
  const name = String((val && val.name) || key || "");
  const desc = String(((val && val.description) as string) || "").trim();
  const genderRaw = String(((val && val.gender) as string) || "").toLowerCase();
  const voiceId = String((val && (val.voice_id ?? val.voiceId ?? val.id)) || "");
  const providerRaw = pickText(val, ["provider"], /^mini|max$/i.test(key) ? "builtin" : "preset");
  const provider = providerRaw.toLowerCase();
  const voiceTypeRaw = pickText(val, ["voice_type", "type", "category"]);
  const styleRaw = pickText(val, ["style", "style_name", "tone", "emotion"]);
  const ageGroup = pickText(val, ["age_group", "age", "age_stage"]);
  const accent = pickText(val, ["accent", "dialect"]);
  const tags = pickTags(val);

  let language = "其他";
  let typeSource = voiceTypeRaw || name;

  if (desc.includes(" · ")) {
    const parts = desc.split(" · ");
    language = pickText(val, ["language", "language_name", "lang", "locale"], (parts[0] || "").trim() || "其他");
    typeSource = voiceTypeRaw || parts.slice(1).join(" · ").trim() || name;
  } else if (desc && (/女声|男声/.test(desc) || /Mini|Max/i.test(name))) {
    language = pickText(val, ["language", "language_name", "lang", "locale"], "内置");
    typeSource = voiceTypeRaw || name;
  } else if (desc) {
    language = pickText(val, ["language", "language_name", "lang", "locale"], "其他");
    typeSource = voiceTypeRaw || (desc.length > 40 ? name : desc);
  } else {
    language = pickText(val, ["language", "language_name", "lang", "locale"], "其他");
  }

  const genderGroup = genderRaw === "male" ? "男" : genderRaw === "female" ? "女" : "其他";
  const typeShort = shortenTypeLabel(typeSource, name);
  const langShort = compactLanguageLabel(language);
  const selectGroupLabel = `${genderGroup} · ${langShort}`;
  const optionTitle =
    [name, [language, voiceTypeRaw, styleRaw, ageGroup, accent].filter(Boolean).join(" · "), desc].filter(Boolean).join(" — ") || key;

  return {
    key,
    voiceId,
    name,
    description: desc,
    provider,
    gender: genderRaw,
    genderGroup,
    language,
    voiceType: voiceTypeRaw || "未分类",
    style: styleRaw || "",
    ageGroup: ageGroup || "",
    accent: accent || "",
    tags,
    typeShort,
    selectGroupLabel,
    optionTitle
  };
}

function presetKeyOrderIndex(key: string) {
  const i = PRESET_KEY_ORDER.indexOf(key);
  return i === -1 ? 100 : i;
}

export function listVoiceMetasFromVoicesObject(voicesObj: Record<string, Record<string, unknown>> | null | undefined) {
  if (!voicesObj || typeof voicesObj !== "object") return [];
  const entries = Object.entries(voicesObj).map(([k, v]) => parseVoiceMeta(k, v));
  entries.sort((a, b) => {
    const pa = presetKeyOrderIndex(a.key);
    const pb = presetKeyOrderIndex(b.key);
    if (pa !== pb) return pa - pb;
    const ga = a.genderGroup === "男" ? 0 : a.genderGroup === "女" ? 1 : 2;
    const gb = b.genderGroup === "男" ? 0 : b.genderGroup === "女" ? 1 : 2;
    if (ga !== gb) return ga - gb;
    const la = langRank(a.language);
    const lb = langRank(b.language);
    if (la !== lb) return la - lb;
    return a.typeShort.localeCompare(b.typeShort, "zh-CN");
  });
  return entries;
}

export function buildSettingsVoiceTree(voicesObj: Record<string, Record<string, unknown>> | null | undefined) {
  const metas = listVoiceMetasFromVoicesObject(voicesObj);
  const byGender = new Map<string, Map<string, VoiceMeta[]>>();
  const genderOrder = ["男", "女", "其他"];

  for (const m of metas) {
    const g = m.genderGroup;
    if (!byGender.has(g)) byGender.set(g, new Map());
    const byLang = byGender.get(g)!;
    if (!byLang.has(m.language)) byLang.set(m.language, []);
    byLang.get(m.language)!.push(m);
  }

  for (const byLang of byGender.values()) {
    for (const arr of byLang.values()) {
      arr.sort((a, b) => a.typeShort.localeCompare(b.typeShort, "zh-CN"));
    }
  }

  return genderOrder
    .filter((g) => byGender.has(g))
    .map((genderGroup) => {
      const byLang = byGender.get(genderGroup)!;
      const languages = Array.from(byLang.keys()).sort((a, b) => langRank(a) - langRank(b));
      return {
        genderGroup,
        genderTitle: genderGroup === "男" ? "男声" : genderGroup === "女" ? "女声" : "其他",
        languages: languages.map((language) => ({
          language,
          langTitle: compactLanguageLabel(language),
          voices: byLang.get(language)!
        }))
      };
    });
}

export function sortUniqueLanguages(langArray: string[]) {
  const uniq = [...new Set(langArray || [])];
  uniq.sort((a, b) => langRank(a) - langRank(b));
  return uniq;
}

export function getLanguageShortLabel(language: string) {
  return compactLanguageLabel(language);
}

export function buildGroupedSelectOptions(voicesObj: Record<string, Record<string, unknown>> | null | undefined) {
  const metas = listVoiceMetasFromVoicesObject(voicesObj);
  const map = new Map<string, { key: string; typeShort: string; optionTitle: string }[]>();
  for (const m of metas) {
    const label = m.selectGroupLabel;
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push({
      key: m.key,
      typeShort: m.typeShort,
      optionTitle: m.optionTitle
    });
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.typeShort.localeCompare(b.typeShort, "zh-CN"));
  }
  const labels = Array.from(map.keys()).sort((a, b) => {
    const ma = metas.find((x) => x.selectGroupLabel === a);
    const mb = metas.find((x) => x.selectGroupLabel === b);
    if (!ma || !mb) return a.localeCompare(b);
    const ga = ma.genderGroup === "男" ? 0 : ma.genderGroup === "女" ? 1 : 2;
    const gb = mb.genderGroup === "男" ? 0 : mb.genderGroup === "女" ? 1 : 2;
    if (ga !== gb) return ga - gb;
    const la = langRank(ma.language);
    const lb = langRank(mb.language);
    if (la !== lb) return la - lb;
    return a.localeCompare(b, "zh-CN");
  });
  return labels.map((label) => ({ label, voices: map.get(label)! }));
}
