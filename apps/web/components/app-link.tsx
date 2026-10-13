'use client';

import { type ComponentProps } from 'react';
import { Link } from '@/i18n/navigation';
import { usePreferences } from './preferences/preferences-provider';

/** Внутренняя ссылка с префиксом локали; в режиме экономии трафика prefetch выключен (REQ-GEN-PREF-04). */
export function AppLink(props: ComponentProps<typeof Link>) {
  const { dataSaver } = usePreferences();
  return <Link {...props} prefetch={dataSaver ? false : props.prefetch} />;
}
