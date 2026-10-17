import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { isAllowedLink } from '@syntara/shared';
import { AppLink } from '../app-link';

/** Ответ помощника: Markdown без HTML; ссылки — только внутренние маршруты и атласы (BR-AI-07). */
export function AssistantText({ text, atlasUrls }: { text: string; atlasUrls: string[] }) {
  return (
    <div className="flex flex-col gap-2 [&_a]:font-semibold [&_a]:text-[var(--accent)] [&_a]:underline">
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children }) => {
            if (!href || !isAllowedLink(href, atlasUrls)) return <span>{children}</span>;
            if (href.startsWith('/')) return <AppLink href={href}>{children}</AppLink>;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
