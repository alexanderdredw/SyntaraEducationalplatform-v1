'use client';

import dynamic from 'next/dynamic';

/**
 * SafeMarkdown с ленивой загрузкой (OPT-05, О4-4): react-markdown и unified не входят в первую загрузку
 * страницы — урок ученика получает Markdown, уже отрисованный на сервере (`lessonMarkdown`), а этот компонент
 * нужен только там, где готовой разметки нет: предпросмотр учителя и запасной путь, если данные пришли из браузера.
 * Рендер и защита те же: skipHtml, rehype-sanitize, safeHref (REQ-NFR-SEC-06).
 */
export const LazyMarkdown = dynamic(() => import('./safe-markdown').then((m) => m.SafeMarkdown));
