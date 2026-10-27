import { Fragment, type ReactNode } from 'react';

/**
 * Тексты урока (исправленный Markdown из content/, решение 10) → разметка оригинала атласа: «Обзор» элемента — как
 * HTML details (<b>Заголовок</b><br>• пункт…), статья учёного — как <div class='scientist-details'>. Только React-
 * узлы, без innerHTML; ссылки — только http(s) (REQ-NFR-SEC-06).
 */

const SAFE_URL = /^https?:\/\//;

/** **жирный** → <b> (или <strong>), *курсив* / _курсив_ → <i>, [текст](https://…) → ссылка. */
export function inlineMd(text: string, bold: 'b' | 'strong' = 'b'): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined)
      out.push(bold === 'b' ? <b key={key++}>{m[1]}</b> : <strong key={key++}>{m[1]}</strong>);
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<i key={key++}>{m[2] ?? m[3]}</i>);
    else if (m[4] !== undefined && m[5] !== undefined && SAFE_URL.test(m[5]))
      out.push(
        <a key={key++} href={m[5]} target="_blank" rel="noopener noreferrer">
          {m[4]}
        </a>,
      );
    else out.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export interface TextSection {
  title: string;
  body: string | null;
}

const LINK_ITEM = /^-\s+\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*$/;

/** Последний раздел урока — «Источники» (только ссылки): в атласе это «Внешние ресурсы», а не текст «Обзора». */
export function splitSources<T extends TextSection>(
  sections: T[],
): {
  text: T[];
  links: Array<{ text: string; url: string }>;
} {
  const last = sections.at(-1);
  const lines = (last?.body ?? '').split('\n').filter((l) => l.trim());
  if (!last || lines.length === 0 || !lines.every((l) => LINK_ITEM.test(l.trim())))
    return { text: sections, links: [] };
  return {
    text: sections.slice(0, -1),
    links: lines.map((l) => {
      const m = LINK_ITEM.exec(l.trim())!;
      return { text: m[1]!, url: m[2]! };
    }),
  };
}

/** «Обзор» элемента: разделы — жирной строкой, пункты — «•» с новой строки, разделы через пустую строку. */
export function ElementDetails({ sections }: { sections: TextSection[] }) {
  return sections.map((s, i) => {
    const lines = (s.body ?? '').split('\n').filter((l) => l.trim());
    return (
      <Fragment key={i}>
        {i > 0 ? (
          <>
            <br />
            <br />
          </>
        ) : null}
        <b>{s.title}</b>
        {lines.map((line, j) => (
          <Fragment key={j}>
            <br />
            {line.trim().startsWith('- ') ? <>• {inlineMd(line.trim().slice(2))}</> : inlineMd(line.trim())}
          </Fragment>
        ))}
      </Fragment>
    );
  });
}

/**
 * Статья учёного (как details учёного в атласе): строка курсивом — scientist-tagline, цитата — scientist-quote,
 * «### …» — h3, абзац «**Название:** …» — highlight-box (кроме последнего — «Интересный факт»), списки — ul.
 * Первая строка **жирным** — описание учёного: в окне оно уже под заголовком, в статье не повторяется.
 */
export function ScientistArticle({ body }: { body: string | null }) {
  const blocks = (body ?? '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const firstBold = blocks.findIndex((b) => /^\*\*.+\*\*$/.test(b));
  const content = blocks.filter((_, i) => i !== firstBold);
  return (
    <div className="scientist-details">
      {content.map((b, i) => {
        if (/^(\*[^*].*\*|_.+_)$/.test(b))
          return (
            <div key={i} className="scientist-tagline">
              {b.slice(1, -1)}
            </div>
          );
        if (b.startsWith('> '))
          return (
            <blockquote key={i} className="scientist-quote">
              {inlineMd(b.slice(2))}
            </blockquote>
          );
        if (b.startsWith('### ')) return <h3 key={i}>{b.slice(4)}</h3>;
        if (b.startsWith('- '))
          return (
            <ul key={i}>
              {b.split('\n').map((li, j) => (
                <li key={j}>{inlineMd(li.replace(/^-\s+/, ''))}</li>
              ))}
            </ul>
          );
        if (/^\*\*[^*]+:\*\*/.test(b) && i !== content.length - 1)
          return (
            <div key={i} className="highlight-box">
              {inlineMd(b, 'strong')}
            </div>
          );
        return <p key={i}>{inlineMd(b)}</p>;
      })}
    </div>
  );
}
