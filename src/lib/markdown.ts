/* lib/markdown.ts — mini Markdown renderer for the notes field.
 * Escapes HTML first (safe against injection), then supports headings,
 * **bold**, *italic*, `code`, bullet lists, and preserves paragraphs/line breaks.
 */

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(text: string): string {
  const lines = escapeHtml(text).split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  let para: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      out.push('<p>' + para.map(inline).join('<br>') + '</p>');
      para = [];
    }
  };
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li = line.match(/^[-*]\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      const level = h[1]!.length;
      out.push(`<h${level + 3}>${inline(h[2]!)}</h${level + 3}>`);
    } else if (li) {
      flushPara();
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push('<li>' + inline(li[1]!) + '</li>');
    } else if (line.trim() === '') {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}
