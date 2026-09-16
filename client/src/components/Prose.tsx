import { Fragment, type ReactNode } from 'react';

/**
 * Renders the blog's light markdown to React elements (never HTML strings):
 * blank-line paragraphs, "## " / "### " headings, "- " lists, **bold**, _italic_, and
 * [links](https://…) limited to http(s). Anything else is shown as typed.
 */
export function Prose({ text }: { text: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return (
    <div className="prose">
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim() !== '');
        if (lines.length === 0) return null;
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        const h = /^(#{2,3})\s+(.*)$/.exec(lines[0]!);
        if (h && lines.length === 1) return h[1] === '##' ? <h2 key={i}>{inline(h[2]!)}</h2> : <h3 key={i}>{inline(h[2]!)}</h3>;
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const INLINE = /(\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g;

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(s.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(<strong key={idx}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('_')) out.push(<em key={idx}>{tok.slice(1, -1)}</em>);
    else {
      const text = tok.slice(1, tok.indexOf(']('));
      out.push(
        <a key={idx} href={m[2]} target="_blank" rel="noreferrer noopener">
          {text}
        </a>,
      );
    }
    last = idx + tok.length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
