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

/** Раздел урока элемента без заголовка — содержимое вкладки окна (REQ-SCI-06): пункты «•» с новой строки. */
export function ElementSection({ body }: { body: string | null }) {
  const lines = (body ?? '').split('\n').filter((l) => l.trim());
  return (
    <p className="atlas-tab-text">
      {lines.map((line, j) => (
        <Fragment key={j}>
          {j > 0 ? <br /> : null}
          {line.trim().startsWith('- ') ? <>• {inlineMd(line.trim().slice(2))}</> : inlineMd(line.trim())}
        </Fragment>
      ))}
    </p>
  );
}

/** Подразделы учёного для вкладок (REQ-SCI-05): после нормализации — коды biography, discovery, legacy, facts. */
export const SCIENTIST_TABS = ['biography', 'discovery', 'legacy', 'facts'] as const;

export interface ScientistParts {
  tagline: string | null;
  /** Цитата и пометка в скобках («приписывается», решение В-12) — как в тексте урока. */
  quote: { text: string; note: string | null } | null;
  /** Подразделы «### Заголовок {#код}»: блоки текста до следующего подраздела. */
  sections: Array<{ code: string | null; title: string; blocks: string[] }>;
}

/**
 * Статья учёного → части окна (REQ-SCI-05, REQ-SCI-12): строка курсивом — подзаголовок, цитата — отдельная карточка,
 * подразделы — вкладки. Первая строка **жирным** — описание (оно уже под заголовком окна). Текст не теряется: всё
 * после подзаголовка подраздела — в его вкладке.
 */
export function scientistParts(body: string | null): ScientistParts {
  const blocks = (body ?? '')
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const parts: ScientistParts = { tagline: null, quote: null, sections: [] };
  let firstBold = true;
  for (const b of blocks) {
    const heading = /^###\s+(.+?)(?:\s+\{#([a-z0-9-]+)\})?$/.exec(b);
    if (heading) {
      parts.sections.push({ code: heading[2] ?? null, title: heading[1]!, blocks: [] });
      continue;
    }
    const current = parts.sections.at(-1);
    if (current) {
      current.blocks.push(b);
      continue;
    }
    if (firstBold && /^\*\*.+\*\*$/.test(b)) firstBold = false;
    else if (/^(\*[^*].*\*|_.+_)$/.test(b)) parts.tagline = b.slice(1, -1);
    else if (b.startsWith('> ')) {
      const m = /^>\s*(.+?)\s*(?:_\((.+)\)_)?$/.exec(b)!;
      parts.quote = { text: m[1]!, note: m[2] ?? null };
    }
  }
  return parts;
}

/** Содержимое подраздела учёного: списки, выделенные абзацы «**Название:** …», абзацы. */
export function ScientistBlocks({ blocks }: { blocks: string[] }) {
  return (
    <div className="scientist-details">
      {blocks.map((b, i) => {
        if (b.startsWith('- '))
          return (
            <ul key={i}>
              {b.split('\n').map((li, j) => (
                <li key={j}>{inlineMd(li.replace(/^-\s+/, ''))}</li>
              ))}
            </ul>
          );
        if (/^\*\*[^*]+:\*\*/.test(b))
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
