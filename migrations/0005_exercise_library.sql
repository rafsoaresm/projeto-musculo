-- Additive migration: exercise library. 0001..0004 stay untouched.
-- Same conventions: server-generated IDs (seed rows use stable sys-NNN IDs), UTC ISO-8601 text.
--
-- organization_id NULL is the system library, read-only for every professional. An exercise of
-- an organization is visible and editable only to that organization's technical members.
-- Rules that may grow (categories, video statuses, sources) are validated in code, not by CHECK,
-- so they need no table rebuild. Editing a library exercise never rewrites a prescription:
-- prescribed exercises keep their own snapshot of the name and the video.
CREATE TABLE exercises (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT REFERENCES organizations(id),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  -- The name in lower case, accents kept and spaces collapsed, computed by the code (SQLite's
  -- lower() only handles ASCII). It decides duplicates and searches.
  name_key TEXT NOT NULL CHECK (length(name_key) BETWEEN 1 AND 120),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  level TEXT CHECK (level IS NULL OR length(trim(level)) BETWEEN 1 AND 40),
  video_url TEXT CHECK (video_url IS NULL OR (length(video_url) <= 500 AND video_url LIKE 'https://%')),
  -- NONE, SEARCH_LINK (a search page, never a reviewed video), UNVERIFIED or VERIFIED by a professional.
  video_status TEXT NOT NULL DEFAULT 'NONE' CHECK (length(video_status) BETWEEN 1 AND 20),
  video_verified_at TEXT,
  video_verified_by_user_id TEXT REFERENCES users(id),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1000),
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  created_by_user_id TEXT REFERENCES users(id),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX exercises_organization_idx ON exercises(organization_id, category);
-- No two active exercises with the same name in one library (a copy of a system exercise may share it).
CREATE UNIQUE INDEX exercises_active_name ON exercises(coalesce(organization_id, ''), name_key) WHERE archived_at IS NULL;

-- Seed: the 64 exercises of the original master document (section 50), with its category,
-- level and initial video link. Those links are search pages, so their status is SEARCH_LINK:
-- they are NOT reviewed videos. No muscle, equipment or progression data is invented here.
INSERT INTO exercises (id, organization_id, name, name_key, category, level, video_url, video_status, source) VALUES
  ('sys-001', NULL, 'Agachamento goblet', 'agachamento goblet', 'Agachar', 'Base', 'https://www.youtube.com/results?search_query=agachamento+goblet+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-002', NULL, 'Leg press 45°', 'leg press 45°', 'Agachar', 'Base', 'https://www.youtube.com/results?search_query=leg+press+45+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-003', NULL, 'Cadeira extensora', 'cadeira extensora', 'Agachar', 'Base', 'https://www.youtube.com/results?search_query=cadeira+extensora+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-004', NULL, 'Agachamento frontal', 'agachamento frontal', 'Agachar', 'Base', 'https://www.youtube.com/results?search_query=agachamento+frontal+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-005', NULL, 'Hack squat', 'hack squat', 'Agachar', 'Base', 'https://www.youtube.com/results?search_query=hack+squat+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-006', NULL, 'Supino com halteres', 'supino com halteres', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=supino+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-007', NULL, 'Supino inclinado com halteres', 'supino inclinado com halteres', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=supino+inclinado+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-008', NULL, 'Desenvolvimento com halteres', 'desenvolvimento com halteres', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=desenvolvimento+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-009', NULL, 'Elevação lateral', 'elevação lateral', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=elevacao+lateral+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-010', NULL, 'Tríceps na polia', 'tríceps na polia', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=triceps+polia+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-011', NULL, 'Supino reto com barra', 'supino reto com barra', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=supino+reto+barra+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-012', NULL, 'Crucifixo com halteres', 'crucifixo com halteres', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=crucifixo+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-013', NULL, 'Crucifixo no cabo', 'crucifixo no cabo', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=crucifixo+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-014', NULL, 'Peck deck', 'peck deck', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=peck+deck+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-015', NULL, 'Flexão de braços', 'flexão de braços', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=flexao+de+bracos+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-016', NULL, 'Chest press máquina', 'chest press máquina', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=chest+press+maquina+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-017', NULL, 'Tríceps francês com halter', 'tríceps francês com halter', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=triceps+frances+halter+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-018', NULL, 'Tríceps testa', 'tríceps testa', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=triceps+testa+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-019', NULL, 'Tríceps corda', 'tríceps corda', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=triceps+corda+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-020', NULL, 'Mergulho no banco', 'mergulho no banco', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=mergulho+banco+triceps+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-021', NULL, 'Elevação frontal', 'elevação frontal', 'Empurrar', 'Base', 'https://www.youtube.com/results?search_query=elevacao+frontal+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-022', NULL, 'Remada sentada no cabo', 'remada sentada no cabo', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=remada+sentada+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-023', NULL, 'Puxada na frente', 'puxada na frente', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=puxada+frente+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-024', NULL, 'Rosca direta', 'rosca direta', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=rosca+direta+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-025', NULL, 'Crucifixo inverso', 'crucifixo inverso', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=crucifixo+inverso+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-026', NULL, 'Face pull', 'face pull', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=face+pull+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-027', NULL, 'Remada curvada com barra', 'remada curvada com barra', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=remada+curvada+barra+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-028', NULL, 'Remada unilateral com halter', 'remada unilateral com halter', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=remada+unilateral+halter+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-029', NULL, 'Pulldown braços estendidos', 'pulldown braços estendidos', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=pulldown+bracos+estendidos+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-030', NULL, 'Barra fixa assistida', 'barra fixa assistida', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=barra+fixa+assistida+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-031', NULL, 'Remada máquina articulada', 'remada máquina articulada', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=remada+maquina+articulada+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-032', NULL, 'Rosca alternada', 'rosca alternada', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=rosca+alternada+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-033', NULL, 'Rosca martelo', 'rosca martelo', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=rosca+martelo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-034', NULL, 'Rosca Scott', 'rosca scott', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=rosca+scott+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-035', NULL, 'Rosca no cabo', 'rosca no cabo', 'Puxar', 'Base', 'https://www.youtube.com/results?search_query=rosca+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-036', NULL, 'Levantamento terra romeno', 'levantamento terra romeno', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=levantamento+terra+romeno+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-037', NULL, 'Mesa flexora', 'mesa flexora', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=mesa+flexora+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-038', NULL, 'Hip thrust', 'hip thrust', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=hip+thrust+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-039', NULL, 'Cadeira flexora', 'cadeira flexora', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=cadeira+flexora+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-040', NULL, 'Good morning', 'good morning', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=good+morning+exercicio+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-041', NULL, 'Stiff com halteres', 'stiff com halteres', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=stiff+halteres+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-042', NULL, 'Pull-through no cabo', 'pull-through no cabo', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=pull+through+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-043', NULL, 'Ponte de glúteos', 'ponte de glúteos', 'Quadril', 'Base', 'https://www.youtube.com/results?search_query=ponte+gluteos+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-044', NULL, 'Afundo reverso', 'afundo reverso', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=afundo+reverso+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-045', NULL, 'Step-up', 'step-up', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=step+up+exercicio+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-046', NULL, 'Elevação de panturrilhas', 'elevação de panturrilhas', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=elevacao+panturrilha+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-047', NULL, 'Agachamento búlgaro', 'agachamento búlgaro', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=agachamento+bulgaro+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-048', NULL, 'Passada caminhando', 'passada caminhando', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=passada+caminhando+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-049', NULL, 'Abdução de quadril', 'abdução de quadril', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=abducao+quadril+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-050', NULL, 'Coice no cabo', 'coice no cabo', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=coice+cabo+gluteo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-051', NULL, 'Panturrilha sentado', 'panturrilha sentado', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=panturrilha+sentado+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-052', NULL, 'Panturrilha no leg press', 'panturrilha no leg press', 'Unilateral', 'Base', 'https://www.youtube.com/results?search_query=panturrilha+leg+press+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-053', NULL, 'Prancha frontal', 'prancha frontal', 'Core', 'Regressão/Base', 'https://www.youtube.com/results?search_query=prancha+frontal+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-054', NULL, 'Pallof press', 'pallof press', 'Core', 'Base', 'https://www.youtube.com/results?search_query=pallof+press+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-055', NULL, 'Farmer walk', 'farmer walk', 'Core', 'Base', 'https://www.youtube.com/results?search_query=farmer+walk+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-056', NULL, 'Prancha lateral', 'prancha lateral', 'Core', 'Base', 'https://www.youtube.com/results?search_query=prancha+lateral+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-057', NULL, 'Dead bug', 'dead bug', 'Core', 'Base', 'https://www.youtube.com/results?search_query=dead+bug+exercicio+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-058', NULL, 'Bird dog', 'bird dog', 'Core', 'Base', 'https://www.youtube.com/results?search_query=bird+dog+exercicio+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-059', NULL, 'Abdominal no cabo', 'abdominal no cabo', 'Core', 'Base', 'https://www.youtube.com/results?search_query=abdominal+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-060', NULL, 'Wood chop no cabo', 'wood chop no cabo', 'Core', 'Base', 'https://www.youtube.com/results?search_query=wood+chop+cabo+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-061', NULL, 'Remo ergométrico', 'remo ergométrico', 'Cardio', 'Base', 'https://www.youtube.com/results?search_query=remo+ergometrico+tecnica', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-062', NULL, 'Escada ergométrica', 'escada ergométrica', 'Cardio', 'Base', 'https://www.youtube.com/results?search_query=escada+ergometrica+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-063', NULL, 'Bike / bicicleta ergométrica', 'bike / bicicleta ergométrica', 'Cardio', 'Base', 'https://www.youtube.com/results?search_query=bicicleta+ergometrica+ajuste+execucao', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED'),
  ('sys-064', NULL, 'Caminhada inclinada', 'caminhada inclinada', 'Cardio', 'Base', 'https://www.youtube.com/results?search_query=caminhada+esteira+inclinada', 'SEARCH_LINK', 'MASTER_DOCUMENT_SEED');

INSERT INTO app_schema_versions(version) VALUES ('0005_exercise_library');
