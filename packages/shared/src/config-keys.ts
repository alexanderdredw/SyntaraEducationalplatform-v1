/**
 * Ключи конфигурации заглушек (раздел 11 SPEC). Значения хранятся в `app_config`
 * (seed `packages/db/seed/config.json`, итерация 2) и читаются через `config.get('<key>')`.
 * `prodBlocked` — ключ блокирует сборку продуктива, пока не подтверждён.
 */
export interface ConfigKeyMeta {
  ph: `PH-${string}`;
  prodBlocked?: boolean;
}

export const CONFIG_KEYS = {
  'catalog.public_subjects': { ph: 'PH-01' },
  'home.subjects_subtitle': { ph: 'PH-01' },
  'demo.questions': { ph: 'PH-02' },
  'home.benefits': { ph: 'PH-03' },
  'i18n.enabled_locales': { ph: 'PH-04' },
  'i18n.review_status': { ph: 'PH-04' },
  'brand.use_text_logo': { ph: 'PH-05' },
  'team.photos': { ph: 'PH-05' },
  'auth.password_min_length': { ph: 'PH-06' },
  'auth.reset_link_ttl_hours': { ph: 'PH-06' },
  'class.code': { ph: 'PH-07' },
  'privacy.requests_as_tickets': { ph: 'PH-08' },
  'support.email': { ph: 'PH-09', prodBlocked: true },
  'atlas.urls': { ph: 'PH-10' },
  'about.metric_access': { ph: 'PH-11' },
  'pricing.visible': { ph: 'PH-11' },
  'schools.trial': { ph: 'PH-12' },
  'features.offline': { ph: 'PH-13' },
  'about.metric_pwa': { ph: 'PH-13' },
  'legal.draft_banner': { ph: 'PH-14', prodBlocked: true },
  'forms.consent_text': { ph: 'PH-15' },
  'infra.data_residency': { ph: 'PH-16' },
  'auth.student_self_registration': { ph: 'PH-17' },
  retention_days: { ph: 'PH-18' },
  'ai.mode': { ph: 'PH-19' },
  'ai.public_quick_answers': { ph: 'PH-19' },
  'ai.unavailable_public': { ph: 'PH-19' },
  'ai.unavailable_tutor': { ph: 'PH-19' },
  'ai.limits': { ph: 'PH-20' },
  'ai.quick_actions': { ph: 'PH-21' },
  'ai.explain_level': { ph: 'PH-21' },
  'support.hours': { ph: 'PH-22' },
  limits: { ph: 'PH-23' },
  'teacher.mastery_map': { ph: 'PH-24' },
  'topic.versions_restore': { ph: 'PH-25' },
  'cover.selection': { ph: 'PH-26' },
  'topic.unpublish_enabled': { ph: 'PH-27' },
  'quiz.text_answer_normalize': { ph: 'PH-28' },
  'assignments.manual_review': { ph: 'PH-29' },
  analytics: { ph: 'PH-30' },
  'datetime.format': { ph: 'PH-31' },
  'notifications.limit': { ph: 'PH-32' },
  'student.assignments_page': { ph: 'PH-33' },
  'student.continue_target': { ph: 'PH-34' },
  'topics.sequential_lock': { ph: 'PH-35' },
  'overview.accordion_multi': { ph: 'PH-36' },
  quiz: { ph: 'PH-37' },
  progress: { ph: 'PH-38' },
  xp: { ph: 'PH-39' },
  'class.leave_confirm': { ph: 'PH-40' },
  'load.expected': { ph: 'PH-41' },
  'platform.tz': { ph: 'PH-42' },
  'routes.legal': { ph: 'PH-43' },
  'auth.student_registration_by_class_code': { ph: 'PH-44' },
} as const satisfies Record<string, ConfigKeyMeta>;

export type ConfigKey = keyof typeof CONFIG_KEYS;
