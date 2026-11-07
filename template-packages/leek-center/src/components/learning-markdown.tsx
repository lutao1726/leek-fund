import React from 'react';

// Render repository text as React nodes. Raw HTML, scripts and remote embeds stay inert.
function inline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return /^https?:\/\//i.test(link[2]) ? <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : <span key={index}>{link[1]}</span>;
    return part;
  });
}
export default function LearningMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      const code = []; const key = i;
      while (++i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i]);
      nodes.push(<pre key={key}><code>{code.join('\n')}</code></pre>); continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) { nodes.push(React.createElement(`h${heading[1].length}`, { key: i }, inline(heading[2]))); continue; }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) { nodes.push(<hr key={i} />); continue; }
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
      const headers = cells(line); const rows = []; const key = i; i++;
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) rows.push(cells(lines[++i]));
      nodes.push(<div className="learning-table" key={key}><table><thead><tr>{headers.map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>); continue;
    }
    if (/^\s*>/.test(line)) { nodes.push(<blockquote key={i}>{inline(line.replace(/^\s*>\s?/, ''))}</blockquote>); continue; }
    if (/^\s*([-+*]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line); const items = []; const key = i;
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-+*]\s+/;
      do { items.push(<li key={i}>{inline(lines[i].replace(pattern, ''))}</li>); i++; } while (i < lines.length && pattern.test(lines[i]));
      i--; nodes.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>); continue;
    }
    nodes.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="learning-markdown">{nodes}</div>;
}
