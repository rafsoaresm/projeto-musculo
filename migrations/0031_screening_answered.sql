-- Additive migration: every screening question is answered Yes or No (handoff V4, decision D4 of the user, 01/11/2026). 0001..0030 stay untouched.
--
-- assessments.screening_answered: the screening questions of this assessment that were answered, as a JSON array of their keys. The six
-- columns of the questions are 0/1 with a default of 0, so "No" and "not asked" were the same value: this column is what tells them apart.
-- A draft started from now on begins with '[]' and is recorded only when all six are in it. The assessments made before stay NULL, the
-- earlier format, where only a "yes" is a recorded answer; nothing is converted.

ALTER TABLE assessments ADD COLUMN screening_answered TEXT CHECK (screening_answered IS NULL OR json_valid(screening_answered));

INSERT INTO app_schema_versions(version) VALUES ('0031_screening_answered');
