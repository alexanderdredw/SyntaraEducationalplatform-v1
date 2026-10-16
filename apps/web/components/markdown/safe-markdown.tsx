import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { cn } from '@syntara/ui';

/** Ссылка из Markdown: только http(s) и внутренние пути; остальное (javascript:, data:) — просто текст. */
export function safeHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return /^https?:\/\//i.test(href) ? href : null;
}

/**
 * Markdown урока (REQ-TCH-TOP-03, REQ-NFR-SEC-06): заголовки, списки, жирный, курсив. Сырой HTML не
 * выполняется (skipHtml), результат проходит rehype-sanitize; один компонент — для предпросмотра учителя
 * и для ученика (итерация 8).
 */
export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('markdown', className)}>
      <ReactMarkdown
        skipHtml
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children: text }) => {
            const safe = safeHref(href);
            if (!safe) return <span>{text}</span>;
            return safe.startsWith('/') ? (
              <a href={safe}>{text}</a>
            ) : (
              <a href={safe} target="_blank" rel="noopener noreferrer nofollow">
                {text}
              </a>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
