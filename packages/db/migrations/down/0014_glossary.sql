-- Откат 0014_glossary (REQ-GLOS-01…06): таблицы глоссария; предметы и темы не затрагиваются.
DROP TABLE IF EXISTS "glossary_term_translations";
DROP TABLE IF EXISTS "glossary_terms";
DROP TABLE IF EXISTS "glossary_section_translations";
DROP TABLE IF EXISTS "glossary_sections";
