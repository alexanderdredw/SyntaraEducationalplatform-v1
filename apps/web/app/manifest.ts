import type { MetadataRoute } from 'next';
import ru from '@syntara/shared/i18n/ru.json';

/**
 * Web App Manifest (PWA, раздел 2.1). Офлайн-кеш выключен (PH-13 `features.offline = false`):
 * service worker не регистрируется, поэтому Serwist подключается только при включении офлайна.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: ru.common.appName,
    short_name: 'Syntara',
    description: ru.common.tagline,
    start_url: '/ru',
    display: 'standalone',
    background_color: '#070707',
    theme_color: '#070707',
    lang: 'ru',
  };
}
