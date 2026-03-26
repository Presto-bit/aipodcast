/**
 * 默认音色：按性别 / 语言 / 类型（短标签）分组，供设置页与下拉框共用。
 */

const PRESET_KEY_ORDER = ['mini', 'max'];

/** 语言在分组内的排序（未列入的排后） */
const LANG_ORDER = [
  '内置',
  '中文 (普通话)',
  '中文 (粤语)',
  '英文',
  '日文',
  '韩文',
  '法文',
  '德文',
  '西班牙文',
  '葡萄牙文',
  '印尼文',
  '俄文',
  '意大利文',
  '阿拉伯文',
  '土耳其文',
  '乌克兰文',
  '荷兰文',
  '越南文',
  '泰文',
  '波兰文',
  '罗马尼亚文',
  '希腊文',
  '捷克文',
  '芬兰文',
  '印地文',
  '其他'
];

const LANG_COMPACT = {
  内置: '内置',
  '中文 (普通话)': '普通话',
  '中文 (粤语)': '粤语',
  英文: '英语',
  日文: '日语',
  韩文: '韩语',
  法文: '法语',
  德文: '德语',
  西班牙文: '西语',
  葡萄牙文: '葡语',
  印尼文: '印尼',
  俄文: '俄语',
  意大利文: '意语',
  阿拉伯文: '阿语',
  土耳其文: '土语',
  乌克兰文: '乌语',
  荷兰文: '荷语',
  越南文: '越语',
  泰文: '泰语',
  波兰文: '波语',
  罗马尼亚文: '罗语',
  希腊文: '希腊',
  捷克文: '捷克',
  芬兰文: '芬兰',
  印地文: '印地',
  其他: '其他'
};

function langRank(language) {
  const i = LANG_ORDER.indexOf(language);
  return i === -1 ? 500 + String(language).localeCompare('', 'zh-CN') : i;
}

function compactLanguageLabel(language) {
  return LANG_COMPACT[language] || (language.length > 6 ? `${language.slice(0, 5)}…` : language);
}

function shortenTypeLabel(raw, nameFallback) {
  let s = (raw || nameFallback || '').trim();
  if (!s) return nameFallback || '';
  s = s
    .replace(/音色-beta/gi, 'β')
    .replace(/-beta/gi, 'β')
    .replace(/音色$/g, '')
    .trim();
  if (s.length > 14) {
    return `${s.slice(0, 13)}…`;
  }
  return s;
}

/**
 * 从后端 DEFAULT_VOICES 单条解析：语言、类型短名、分组用性别标签
 */
export function parseVoiceMeta(key, val) {
  const name = (val && val.name) || key || '';
  const desc = ((val && val.description) || '').trim();
  const genderRaw = ((val && val.gender) || '').toLowerCase();
  const voiceId = (val && val.voice_id) || '';

  let language = '其他';
  let typeSource = name;

  if (desc.includes(' · ')) {
    const parts = desc.split(' · ');
    language = (parts[0] || '').trim() || '其他';
    typeSource = parts.slice(1).join(' · ').trim() || name;
  } else if (desc && (/女声|男声/.test(desc) || /Mini|Max/i.test(name))) {
    language = '内置';
    typeSource = name;
  } else if (desc) {
    typeSource = desc.length > 40 ? name : desc;
  }

  const genderGroup = genderRaw === 'male' ? '男' : genderRaw === 'female' ? '女' : '其他';
  const typeShort = shortenTypeLabel(typeSource, name);
  const langShort = compactLanguageLabel(language);
  const selectGroupLabel = `${genderGroup} · ${langShort}`;
  const optionTitle = [name, desc].filter(Boolean).join(' — ') || key;

  return {
    key,
    voiceId,
    name,
    description: desc,
    gender: genderRaw,
    genderGroup,
    language,
    typeShort,
    selectGroupLabel,
    optionTitle
  };
}

function presetKeyOrderIndex(key) {
  const i = PRESET_KEY_ORDER.indexOf(key);
  return i === -1 ? 100 : i;
}

/**
 * 将 API 返回的 voices 对象转为扁平 meta 列表（已排序：mini/max 优先，其余按分组键）
 */
export function listVoiceMetasFromVoicesObject(voicesObj) {
  if (!voicesObj || typeof voicesObj !== 'object') {
    return [];
  }
  const entries = Object.entries(voicesObj).map(([k, v]) => parseVoiceMeta(k, v));
  entries.sort((a, b) => {
    const pa = presetKeyOrderIndex(a.key);
    const pb = presetKeyOrderIndex(b.key);
    if (pa !== pb) return pa - pb;
    const ga = a.genderGroup === '男' ? 0 : a.genderGroup === '女' ? 1 : 2;
    const gb = b.genderGroup === '男' ? 0 : b.genderGroup === '女' ? 1 : 2;
    if (ga !== gb) return ga - gb;
    const la = langRank(a.language);
    const lb = langRank(b.language);
    if (la !== lb) return la - lb;
    return a.typeShort.localeCompare(b.typeShort, 'zh-CN');
  });
  return entries;
}

/**
 * 下拉框 optgroup：{ label, voices: [{ key, typeShort, optionTitle }] }
 */
export function buildGroupedSelectOptions(voicesObj) {
  const metas = listVoiceMetasFromVoicesObject(voicesObj);
  const map = new Map();
  for (const m of metas) {
    const label = m.selectGroupLabel;
    if (!map.has(label)) map.set(label, []);
    map.get(label).push({
      key: m.key,
      typeShort: m.typeShort,
      optionTitle: m.optionTitle
    });
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.typeShort.localeCompare(b.typeShort, 'zh-CN'));
  }
  const labels = Array.from(map.keys()).sort((a, b) => {
    const ma = metas.find((x) => x.selectGroupLabel === a);
    const mb = metas.find((x) => x.selectGroupLabel === b);
    const ga = ma.genderGroup === '男' ? 0 : ma.genderGroup === '女' ? 1 : 2;
    const gb = mb.genderGroup === '男' ? 0 : mb.genderGroup === '女' ? 1 : 2;
    if (ga !== gb) return ga - gb;
    const la = langRank(ma.language);
    const lb = langRank(mb.language);
    if (la !== lb) return la - lb;
    return a.localeCompare(b, 'zh-CN');
  });
  return labels.map((label) => ({ label, voices: map.get(label) }));
}

/**
 * 设置页树：男/女/其他 → 语言 → 条目（短名 + voiceId）
 */
export function buildSettingsVoiceTree(voicesObj) {
  const metas = listVoiceMetasFromVoicesObject(voicesObj);
  const byGender = new Map();
  const genderOrder = ['男', '女', '其他'];

  for (const m of metas) {
    const g = m.genderGroup;
    if (!byGender.has(g)) byGender.set(g, new Map());
    const byLang = byGender.get(g);
    if (!byLang.has(m.language)) byLang.set(m.language, []);
    byLang.get(m.language).push(m);
  }

  for (const byLang of byGender.values()) {
    for (const arr of byLang.values()) {
      arr.sort((a, b) => a.typeShort.localeCompare(b.typeShort, 'zh-CN'));
    }
  }

  return genderOrder
    .filter((g) => byGender.has(g))
    .map((genderGroup) => {
      const byLang = byGender.get(genderGroup);
      const languages = Array.from(byLang.keys()).sort((a, b) => langRank(a) - langRank(b));
      return {
        genderGroup,
        genderTitle: genderGroup === '男' ? '男声' : genderGroup === '女' ? '女声' : '其他',
        languages: languages.map((language) => ({
          language,
          langTitle: compactLanguageLabel(language),
          voices: byLang.get(language)
        }))
      };
    });
}

/** 语言列表去重并按预设顺序排序（用于筛选芯片） */
export function sortUniqueLanguages(langArray) {
  const uniq = [...new Set(langArray || [])];
  uniq.sort((a, b) => langRank(a) - langRank(b));
  return uniq;
}

/** 语言短标签（与下拉分组一致） */
export function getLanguageShortLabel(language) {
  return compactLanguageLabel(language);
}

/**
 * 按分组标签「性别 · 语言」筛选 buildGroupedSelectOptions 的结果
 * @param {'all'|'male'|'female'|'other'} genderFilter
 * @param {string} langFilter 语言短标签或 'all'
 */
export function filterGroupedVoiceGroups(groups, genderFilter, langFilter) {
  if (!Array.isArray(groups)) return [];
  return groups.filter((g) => {
    const parts = String(g.label || '')
      .split(' · ')
      .map((s) => s.trim());
    const gen = parts[0] || '';
    const lang = parts[1] || '';
    if (genderFilter === 'male' && gen !== '男') return false;
    if (genderFilter === 'female' && gen !== '女') return false;
    if (genderFilter === 'other' && gen !== '其他') return false;
    if (langFilter !== 'all' && lang !== langFilter) return false;
    return true;
  });
}

/** 从分组标签中提取不重复的语言短标签 */
export function uniqueLangShortsFromVoiceGroups(groups) {
  const set = new Set();
  for (const g of groups || []) {
    const parts = String(g.label || '')
      .split(' · ')
      .map((s) => s.trim());
    if (parts.length >= 2 && parts[1]) set.add(parts[1]);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
