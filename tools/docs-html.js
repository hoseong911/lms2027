// tools/docs-html.js — 레포 문서(.md)를 목차 달린 HTML로 굽는다. 쓰는 법: node tools/docs-html.js
// 문서를 고친 뒤 이걸 다시 돌려야 tools/*.html이 갱신된다. 색은 본체와 같은 네이비, 레드.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');  // 레포 뿌리
const DOCS = [
  ['LMS2027_요구사항.md', '요구사항'],
  ['LMS2027.md', '설계'],
  ['LMS2027_작업기록.md', '작업기록'],
  ['CLAUDE.md', '규칙'],
];
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const inline = s => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

function render(md) {
  const lines = md.split(/\r?\n/);
  const out = []; const toc = [];
  let i = 0, listType = null, inCode = false;
  // 깃허브와 같은 방식으로 제목 id를 만든다 — 문서 안 [링크](#제목)가 그대로 먹게.
  const used = new Map();
  const slugify = s => {
    let g = s.toLowerCase().replace(/[*`_~]/g, '')
      .replace(/[^\w가-힣\s-]/g, '').trim().replace(/\s+/g, '-');
    if (!g) g = 'section';
    const n = (used.get(g) || 0) + 1; used.set(g, n);
    return n > 1 ? `${g}-${n - 1}` : g;
  };
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
  while (i < lines.length) {
    const L = lines[i];
    if (/^```/.test(L)) {
      closeList();
      if (!inCode) { out.push('<pre><code>'); inCode = true; } else { out.push('</code></pre>'); inCode = false; }
      i++; continue;
    }
    if (inCode) { out.push(esc(L)); i++; continue; }
    // 표
    if (/^\s*\|/.test(L) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1] || '')) {
      closeList();
      const cell = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      const head = cell(L);
      i += 2;
      const body = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(cell(lines[i])); i++; }
      out.push('<div class="tw"><table><thead><tr>' + head.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    let m;
    if ((m = L.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const lv = m[1].length, id = slugify(m[2]);
      if (lv <= 3) toc.push({ lv, id, text: m[2].replace(/[*`]/g, '') });
      out.push(`<h${lv} id="${id}">${inline(m[2])}</h${lv}>`);
      i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(L)) { closeList(); out.push('<hr>'); i++; continue; }
    // 인용 — 이어지는 > 줄을 상자 하나로 묶는다(줄마다 상자가 생기면 못 읽는다)
    if (/^\s*>/.test(L)) {
      closeList();
      const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      const paras = q.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      out.push(`<blockquote>${paras.map(p => `<p>${inline(p.replace(/\n/g, ' '))}</p>`).join('')}</blockquote>`);
      continue;
    }
    // 새 항목이 시작되는 줄인가 (들여쓰기한 이어지는 줄과 구분하기 위해)
    const startsBlock = s => /^(\s*([-*+]|\d+\.)\s|#{1,6}\s|\s*\||```|\s*>|\s*(-{3,}|\*{3,})\s*$)/.test(s);
    if ((m = L.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/))) {
      const t = /\d/.test(m[2]) ? 'ol' : 'ul';
      if (listType !== t) { closeList(); out.push(`<${t}>`); listType = t; }
      const deep = m[1].length >= 2 ? ' class="sub"' : '';
      // 들여써서 이어지는 줄은 같은 항목에 붙인다. 안 붙이면 목록이 끊기고 번호가 1부터 다시 센다
      const body = [m[3]];
      while (i + 1 < lines.length && lines[i+1].trim() && !startsBlock(lines[i+1]) && /^\s{2,}/.test(lines[i+1])) {
        body.push(lines[i+1].trim()); i++;
      }
      out.push(`<li${deep}>${inline(body.join(' '))}</li>`);
      i++; continue;
    }
    if (!L.trim()) { closeList(); i++; continue; }
    // 문단 (이어지는 줄 합치기)
    closeList();
    const para = [L];
    while (i + 1 < lines.length && lines[i+1].trim() && !/^(\s*([-*+]|\d+\.)\s|#{1,6}\s|\s*\||```|\s*>)/.test(lines[i+1])) { para.push(lines[i+1]); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
    i++;
  }
  closeList();
  if (inCode) out.push('</code></pre>');
  return { html: out.join('\n'), toc };
}

for (const [file, label] of DOCS) {
  const md = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const { html, toc } = render(md);
  const nav = DOCS.map(([f, l]) => `<a class="doc${f === file ? ' on' : ''}" href="${f.replace(/\.md$/, '.html')}">${l}</a>`).join('');
  const tocHtml = toc.map(t => `<a class="t t${t.lv}" href="#${t.id}">${esc(t.text)}</a>`).join('');
  const page = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${label} : LMS2027</title>
<style>
/* 색은 lms2027 본체와 같은 롯데 자이언츠 네이비, 레드 */
:root{--bg:#fff;--text:#041E42;--sub:#68727F;--line:#DDE2E9;--accent:#041E42;--red:#D00F31;--code:#F1F4F8;--side:#F7F9FB}
@media (prefers-color-scheme:dark){:root{--bg:#0B1420;--text:#DCE3EC;--sub:#8E99A8;--line:#1F2D3F;--accent:#7FA6D8;--red:#FF5571;--code:#121D2B;--side:#0E1926}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.75 "Pretendard","Malgun Gothic",system-ui,sans-serif;display:flex}
aside{position:sticky;top:0;height:100vh;width:260px;flex:none;overflow:auto;background:var(--side);border-right:1px solid var(--line);padding:16px 0}
.docs{display:flex;flex-wrap:wrap;gap:4px;padding:0 14px 12px;border-bottom:1px solid var(--line);margin-bottom:10px}
.doc{font-size:13px;padding:5px 9px;border-radius:7px;text-decoration:none;color:var(--sub)}
.doc:hover{color:var(--text)}
.doc.on{color:var(--text);background:var(--bg);border:1px solid var(--line)}
.t{display:block;padding:3px 14px;font-size:13px;color:var(--sub);text-decoration:none;line-height:1.5;border-left:2px solid transparent}
.t:hover{color:var(--accent);border-left-color:var(--accent)}
.t1{font-weight:700;color:var(--text);margin-top:10px}
.t2{padding-left:22px}
.t3{padding-left:34px;font-size:12.5px}
main{flex:1;min-width:0;padding:34px 44px 140px;max-width:960px}
h1,h2,h3,h4{line-height:1.35;scroll-margin-top:16px}
h1{font-size:28px;border-bottom:2px solid var(--accent);padding-bottom:10px;margin-top:0}
h2{font-size:22px;margin-top:44px;border-bottom:1px solid var(--line);padding-bottom:7px}
h3{font-size:17.5px;margin-top:30px}
h4{font-size:15.5px;margin-top:22px;color:var(--sub)}
p{margin:11px 0}
li{margin:4px 0}
li.sub{margin-left:18px;list-style-type:circle;color:var(--sub)}
code{background:var(--code);padding:1.5px 5px;border-radius:5px;font-size:13.5px;font-family:ui-monospace,Consolas,monospace}
pre{background:var(--code);padding:14px 16px;border-radius:10px;overflow:auto}
pre code{background:none;padding:0;font-size:13px;line-height:1.6}
blockquote{margin:12px 0;padding:8px 16px;border-left:3px solid var(--accent);background:var(--code);border-radius:0 8px 8px 0;color:var(--sub)}
hr{border:0;border-top:1px solid var(--line);margin:34px 0}
.tw{overflow-x:auto;margin:14px 0}
table{border-collapse:collapse;font-size:14px;min-width:100%}
th,td{border:1px solid var(--line);padding:7px 11px;text-align:left;vertical-align:top}
th{background:var(--code);font-weight:700;white-space:nowrap}
a{color:var(--accent)}
strong{font-weight:700}
h2::before{content:"";display:inline-block;width:3px;height:16px;background:var(--red);margin-right:9px;vertical-align:-2px}
@media (max-width:860px){aside{display:none}main{padding:20px 16px 100px}}
</style></head><body>
<aside><div class="docs">${nav}</div>${tocHtml}</aside>
<main>${html}</main>
</body></html>`;
  fs.writeFileSync(path.join(ROOT, 'tools', file.replace(/\.md$/, '.html')), page, 'utf8');
  console.log('wrote tools/' + file.replace(/\.md$/, '.html') + '  (목차 ' + toc.length + '개)');
}
