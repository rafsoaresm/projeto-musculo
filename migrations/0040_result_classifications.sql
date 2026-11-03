-- Additive migration: the classification of a result by the reference tables the user sent (PENDENCIAS T*, ROADMAP 0.92).
-- 0001..0039 stay untouched; nothing existing is deleted or rewritten.
--
-- assessment_results.classification: when an Avaliação Física is finalized from now on, each result that a reference table classifies (body fat,
-- BMI, waist-hip ratio, Flexiteste total, and the Cooper 12 min distance on the Cooper speed row) is written with its classification, as JSON:
-- the table, its version (e.g. "ref-2026-11-03"), the status (in_range, gap, overlap, out_of_table, no_age, no_reference), the level(s), the
-- value compared at the table's precision, the column (reference and age) and the source. It is written in the same statement as the result and
-- freezes with it (the triggers of 0033 already refuse any write to a recorded assessment's results).
--
-- A column and not the existing flags: flags is a list of words read by every screen as such; the classification is a record of its own.
--
-- Existing rows: stay NULL. A result recorded before this migration is not classified afterwards (handoff 6: no retroactive recalculation);
-- the screens say "registrada antes das tabelas de referência".

ALTER TABLE assessment_results ADD COLUMN classification TEXT CHECK (classification IS NULL OR (json_valid(classification) AND length(classification) <= 2000));

INSERT INTO app_schema_versions(version) VALUES ('0040_result_classifications');
