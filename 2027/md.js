// Маленький разметчик для текстов разбора: абзацы, **жирный**, ### заголовки, списки «- » и «1. ».
// Весь текст сначала экранируется, поэтому HTML из текстов не исполняется
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

export function md(text) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { close(); continue; }
    let m;
    if ((m = /^###\s+(.+)$/.exec(line))) { close(); out.push(`<h3>${inline(m[1])}</h3>`); continue; }
    if ((m = /^-\s+(.+)$/.exec(line))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    if ((m = /^\d+\.\s+(.+)$/.exec(line))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`); continue;
    }
    close();
    out.push(`<p>${inline(line)}</p>`);
  }
  close();
  return out.join('\n');
}
