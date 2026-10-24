'use client';

import { usePreservedState } from '../preferences/preserved-state';
import { StudentAuth } from './student-auth';

/** Экран ученика с кодом класса, введённым ранее на /join (память вкладки, REQ-GEN-AUTH-03). */
export function StudentAuthFromJoin({ returnTo = null }: { returnTo?: string | null }) {
  const [code] = usePreservedState('join.code', '');
  return <StudentAuth initialCode={code} returnTo={returnTo} />;
}
