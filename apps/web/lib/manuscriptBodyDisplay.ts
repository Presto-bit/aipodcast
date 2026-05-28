export type ManuscriptDisplaySection = {
  heading: string;
  content: string;
};

function sectionFromObject(item: unknown): ManuscriptDisplaySection | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const heading = String(o.heading ?? o.title ?? o.section_title ?? o.name ?? "").trim();
  const content = String(o.content ?? o.body ?? o.text ?? o.paragraph ?? "").trim();
  if (!heading && !content) return null;
  return { heading, content };
}

function unescapePythonString(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** 解析正文里泄漏的 Python dict 小节：`{'heading':'…','content':'📌…'}` */
export function parsePythonDictManuscriptSections(raw: string): ManuscriptDisplaySection[] {
  const text = String(raw || "").trim();
  if (!text || !/['"]heading['"]\s*:/.test(text)) return [];

  const sections: ManuscriptDisplaySection[] = [];
  const re =
    /\{\s*['"]heading['"]\s*:\s*['"]((?:\\.|[^'\\])*)['"]\s*,\s*['"]content['"]\s*:\s*['"]((?:\\.|[^'\\])*)['"]\s*\}/gs;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    sections.push({
      heading: unescapePythonString(match[1]),
      content: unescapePythonString(match[2])
    });
  }
  return sections;
}

function parseJsonArraySections(raw: string): ManuscriptDisplaySection[] {
  const text = String(raw || "").trim();
  if (!text.startsWith("[")) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => sectionFromObject(item))
      .filter((s): s is ManuscriptDisplaySection => Boolean(s && (s.heading || s.content)));
  } catch {
    return [];
  }
}

function parseMarkdownHeadingSections(raw: string): ManuscriptDisplaySection[] {
  const text = String(raw || "").trim();
  if (!/^##\s+/m.test(text)) return [];

  const chunks = text.split(/^##\s+/m).filter((c) => c.trim());
  if (chunks.length < 2 && !text.startsWith("##")) return [];

  const sections: ManuscriptDisplaySection[] = [];
  if (text.startsWith("##")) {
    for (const chunk of chunks) {
      const nl = chunk.indexOf("\n");
      if (nl === -1) {
        sections.push({ heading: chunk.trim(), content: "" });
      } else {
        sections.push({
          heading: chunk.slice(0, nl).trim(),
          content: chunk.slice(nl + 1).trim()
        });
      }
    }
    return sections;
  }
  return [];
}

/**
 * 将正文拆成可渲染的小节：优先 JSON / Python dict 泄漏，其次 Markdown ## 标题。
 */
export function manuscriptBodyToDisplaySections(raw: string): ManuscriptDisplaySection[] {
  const text = String(raw || "").trim();
  if (!text) return [];

  const fromJson = parseJsonArraySections(text);
  if (fromJson.length) return fromJson;

  const fromPython = parsePythonDictManuscriptSections(text);
  if (fromPython.length) return fromPython;

  const fromMarkdown = parseMarkdownHeadingSections(text);
  if (fromMarkdown.length) return fromMarkdown;

  return [{ heading: "", content: text }];
}

export function manuscriptBodyHasMultipleSections(raw: string): boolean {
  const sections = manuscriptBodyToDisplaySections(raw);
  return sections.length > 1 || Boolean(sections[0]?.heading);
}
