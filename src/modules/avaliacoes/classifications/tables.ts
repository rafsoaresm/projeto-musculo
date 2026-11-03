/**
 * The reference tables of the Avaliação Física (slice 0.92), as the user (who decides the product) sent them on 03/11/2026 and homologated them
 * for the tool: the files are in docs/referencias/classificacoes/ (see LEIAME.md there). Each range is transcribed literally, as printed, with the
 * printed text kept next to it; nothing is closed, extended or smoothed. The tables have gaps (men 18–25: "Excelente" ends at 6% and "Bom" starts
 * at 8%; Cooper 2.200 m then 2.210 m; IMC "abaixo de 18,5" then "18,6") and overlaps (men 18–25: "Abaixo da Média" 17–20% and "Ruim" 20–24%):
 * the classifier says so, it never decides for the table.
 *
 * Age columns as printed, with two choices of this slice: "Acima de 65" (body fat) is 66 or more, the column before it ending at 65; "Acima de
 * 60" (Cooper) is 60 or more, the column before it ending at 59. An age without a column (Cooper under 13, body fat under 7, waist-hip ratio
 * under 20 or 70 and over) has no classification, and the reason is said.
 *
 * The version names this set of tables; a corrected table is a new version, and a recorded classification keeps the one it used.
 *
 * Pure data: no screen and no database here.
 */

export const CLASSIFICATION_VERSION = "ref-2026-11-03";

export type TableId = "body_fat" | "bmi" | "cooper_12min" | "waist_hip" | "flexitest";
/** The reference of a table that depends on it: "masculina"/"feminina", never the person's gender (user's decision 2). */
export type TableSex = "male" | "female";

export interface Bound {
  value: number;
  inclusive: boolean;
}
/** One level of a column: its lower and upper bound (null: open), and the range as printed. */
export interface Band {
  level: string;
  min: Bound | null;
  max: Bound | null;
  printed: string;
}
export interface Column {
  /** Null: the same for both references. */
  sex: TableSex | null;
  /** Null on both: every age. */
  ageMin: number | null;
  ageMax: number | null;
  /** "homens, 18 a 25 anos" as the table heads it. */
  label: string | null;
  /** The decimals the table prints: the value is rounded to these before it is compared. */
  decimals: number;
  /** The source printed under this column's table. */
  source: string;
  bands: Band[];
}
export interface ReferenceTable {
  id: TableId;
  title: string;
  /** Unit after the value, as the screens write it ("%", " m", " pontos", or "" for an index). */
  unit: string;
  dependsOnSex: boolean;
  dependsOnAge: boolean;
  /** The file it was transcribed from (docs/referencias/classificacoes/). */
  file: string;
  /** In the order the table lists the levels, which is also the order of the values (lowest first). */
  columns: Column[];
}

const pt = (value: number, decimals: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);

/** "a a b" (both included). */
const between = (level: string, a: number, b: number, decimals: number, unit = ""): Band => ({
  level,
  min: { value: a, inclusive: true },
  max: { value: b, inclusive: true },
  printed: `${pt(a, decimals)}${unit} a ${pt(b, decimals)}${unit}`,
});
/** "menor que x" / "abaixo de x" / "< x" (x not included). */
const below = (level: string, x: number, printed: string): Band => ({ level, min: null, max: { value: x, inclusive: false }, printed });
/** "até x" (x included). */
const upTo = (level: string, x: number, printed: string): Band => ({ level, min: null, max: { value: x, inclusive: true }, printed });
/** "maior que x" / "acima de x" / "> x" (x not included). */
const above = (level: string, x: number, printed: string): Band => ({ level, min: { value: x, inclusive: false }, max: null, printed });

/* ---------- Body fat: Pollock & Wilmore, 1993 (adults); Gaithersburg et al., 1989 (7 to 17) ---------- */

export const BODY_FAT_ADULT_SOURCE = "Pollock & Wilmore, 1993";
export const BODY_FAT_YOUTH_SOURCE = "Gaithersburg et al., 1989";
export const BODY_FAT_AGES: readonly [number, number | null, string][] = [
  [18, 25, "18 a 25 anos"],
  [26, 35, "26 a 35 anos"],
  [36, 45, "36 a 45 anos"],
  [46, 55, "46 a 55 anos"],
  [56, 65, "56 a 65 anos"],
  [66, null, "acima de 65 anos"],
];
export const BODY_FAT_LEVELS = ["Excelente", "Bom", "Acima da Média", "Média", "Abaixo da Média", "Ruim", "Muito Ruim"] as const;
/** [level][age column] = [from, to] in %, as printed (PERCENTUAL DE GORDURA PARA HOMENS). */
export const BODY_FAT_MEN: Record<(typeof BODY_FAT_LEVELS)[number], readonly [number, number][]> = {
  Excelente: [[4, 6], [8, 11], [10, 14], [12, 16], [13, 18], [14, 18]],
  Bom: [[8, 10], [12, 15], [16, 18], [18, 20], [20, 21], [19, 21]],
  "Acima da Média": [[12, 13], [16, 18], [19, 21], [21, 23], [22, 23], [22, 23]],
  Média: [[14, 16], [18, 20], [21, 23], [24, 25], [24, 25], [23, 24]],
  "Abaixo da Média": [[17, 20], [22, 24], [24, 25], [26, 27], [26, 27], [25, 26]],
  Ruim: [[20, 24], [24, 27], [27, 29], [28, 30], [28, 30], [27, 29]],
  "Muito Ruim": [[26, 36], [28, 36], [30, 39], [32, 38], [32, 38], [31, 38]],
};
/** [level][age column] = [from, to] in %, as printed (PERCENTUAL DE GORDURA PARA MULHERES). */
export const BODY_FAT_WOMEN: Record<(typeof BODY_FAT_LEVELS)[number], readonly [number, number][]> = {
  Excelente: [[13, 16], [14, 16], [16, 19], [17, 21], [18, 22], [16, 20]],
  Bom: [[17, 19], [18, 20], [20, 23], [23, 25], [24, 26], [22, 26]],
  "Acima da Média": [[20, 22], [21, 23], [24, 26], [26, 28], [27, 29], [27, 29]],
  Média: [[23, 25], [24, 25], [27, 29], [29, 31], [30, 32], [30, 32]],
  "Abaixo da Média": [[26, 28], [27, 29], [30, 32], [32, 34], [33, 35], [32, 34]],
  Ruim: [[29, 31], [31, 33], [33, 36], [35, 38], [36, 38], [35, 37]],
  "Muito Ruim": [[33, 43], [36, 49], [38, 48], [39, 50], [39, 49], [38, 41]],
};

function adultFatColumns(sex: TableSex): Column[] {
  const data = sex === "male" ? BODY_FAT_MEN : BODY_FAT_WOMEN;
  return BODY_FAT_AGES.map(([ageMin, ageMax, ages], index) => ({
    sex,
    ageMin,
    ageMax,
    label: `${sex === "male" ? "homens" : "mulheres"}, ${ages}`,
    decimals: 0,
    source: BODY_FAT_ADULT_SOURCE,
    bands: BODY_FAT_LEVELS.map((level) => between(level, data[level][index][0], data[level][index][1], 0, "%")),
  }));
}

/** PERCENTUAL DE GORDURA PARA CRIANÇAS E ADOLESCENTES DE 7 A 17 ANOS, as printed (two decimals): "até", four closed ranges, "maior que". */
export const BODY_FAT_YOUTH: Record<TableSex, { upTo: number; ranges: readonly [number, number][]; above: number }> = {
  male: { upTo: 6, ranges: [[6.01, 10], [10.01, 20], [20.01, 25], [25.01, 31]], above: 31.01 },
  female: { upTo: 12, ranges: [[12.01, 15], [15.01, 25], [25.01, 30], [30.01, 36]], above: 36.01 },
};
export const BODY_FAT_YOUTH_LEVELS = ["Excessivamente baixa", "Baixa", "Adequada", "Moderadamente alta", "Alta", "Excessivamente alta"] as const;
function youthFatColumn(sex: TableSex): Column {
  const data = BODY_FAT_YOUTH[sex];
  const pct = (value: number) => `${pt(value, Number.isInteger(value) ? 0 : 2)}%`;
  return {
    sex,
    ageMin: 7,
    ageMax: 17,
    label: `${sex === "male" ? "masculino" : "feminino"}, 7 a 17 anos`,
    decimals: 2,
    source: BODY_FAT_YOUTH_SOURCE,
    bands: [
      upTo(BODY_FAT_YOUTH_LEVELS[0], data.upTo, `até ${pct(data.upTo)}`),
      ...data.ranges.map(([from, to], position) => ({ ...between(BODY_FAT_YOUTH_LEVELS[position + 1], from, to, 2), printed: `${pct(from)} a ${pct(to)}` })),
      above(BODY_FAT_YOUTH_LEVELS[5], data.above, `maior que ${pct(data.above)}`),
    ],
  };
}

export const BODY_FAT_TABLE: ReferenceTable = {
  id: "body_fat",
  title: "Percentual de gordura",
  unit: "%",
  dependsOnSex: true,
  dependsOnAge: true,
  file: "gordura-pollock-wilmore-1993.pdf",
  columns: [youthFatColumn("male"), youthFatColumn("female"), ...adultFatColumns("male"), ...adultFatColumns("female")],
};

/* ---------- BMI (image, no source printed) ---------- */

export const BMI_SOURCE = "tabela enviada pelo usuário em 03/11/2026, sem fonte impressa";
export const BMI_TABLE: ReferenceTable = {
  id: "bmi",
  title: "IMC",
  unit: "",
  dependsOnSex: false,
  dependsOnAge: false,
  file: "imc.png",
  columns: [
    {
      sex: null,
      ageMin: null,
      ageMax: null,
      label: null,
      decimals: 1,
      source: BMI_SOURCE,
      bands: [
        below("abaixo do peso", 18.5, "abaixo de 18,5"),
        { ...between("Peso ideal (parabéns)", 18.6, 24.9, 1), printed: "entre 18,6 e 24,9" },
        { ...between("Levemente acima do peso", 25.0, 29.9, 1), printed: "entre 25,0 e 29,9" },
        { ...between("Obesidade grau I", 30.0, 34.9, 1), printed: "entre 30,0 e 34,9" },
        { ...between("Obesidade grau II (severa)", 35.0, 39.9, 1), printed: "entre 35,0 e 39,9" },
        above("Obesidade III (mórbida)", 40, "acima de 40"),
      ],
    },
  ],
};

/* ---------- Cooper 12 minutes: Cooper, 1982 (metres) ---------- */

export const COOPER_SOURCE = "Cooper, 1982";
export const COOPER_AGES: readonly [number, number | null, string][] = [
  [13, 19, "13 a 19 anos"],
  [20, 29, "20 a 29 anos"],
  [30, 39, "30 a 39 anos"],
  [40, 49, "40 a 49 anos"],
  [50, 59, "50 a 59 anos"],
  [60, null, "acima de 60 anos"],
];
export const COOPER_LEVELS = ["Muito fraca", "Fraca", "Média", "Boa", "Excelente", "Superior"] as const;
/** Per age column: "menor que" (Muito fraca), the four closed ranges (Fraca to Excelente), "maior que" (Superior), in metres, as printed. */
export const COOPER_MEN: readonly { below: number; ranges: readonly [number, number][]; above: number }[] = [
  { below: 2090, ranges: [[2090, 2200], [2210, 2510], [2520, 2770], [2780, 3000]], above: 3000 },
  { below: 1960, ranges: [[1960, 2110], [2120, 2400], [2410, 2640], [2650, 2830]], above: 2830 },
  { below: 1900, ranges: [[1900, 2090], [2100, 2400], [2410, 2510], [2520, 2720]], above: 2720 },
  { below: 1830, ranges: [[1830, 1990], [2000, 2240], [2250, 2460], [2470, 2660]], above: 2660 },
  { below: 1660, ranges: [[1660, 1870], [1880, 2090], [2100, 2320], [2330, 2540]], above: 2540 },
  { below: 1400, ranges: [[1400, 1640], [1650, 1930], [1940, 2120], [2130, 2490]], above: 2490 },
];
export const COOPER_WOMEN: readonly { below: number; ranges: readonly [number, number][]; above: number }[] = [
  { below: 1610, ranges: [[1610, 1900], [1910, 2080], [2090, 2300], [2310, 2430]], above: 2430 },
  { below: 1550, ranges: [[1550, 1790], [1800, 1970], [1980, 2160], [2170, 2330]], above: 2330 },
  { below: 1510, ranges: [[1510, 1690], [1700, 1960], [1970, 2080], [2090, 2240]], above: 2240 },
  { below: 1420, ranges: [[1420, 1580], [1590, 1790], [1800, 2000], [2010, 2160]], above: 2160 },
  { below: 1350, ranges: [[1350, 1500], [1510, 1690], [1700, 1900], [1910, 2090]], above: 2090 },
  { below: 1260, ranges: [[1260, 1390], [1400, 1590], [1600, 1750], [1760, 1900]], above: 1900 },
];
const metres = (value: number) => `${pt(value, 0)} m`;
function cooperColumns(sex: TableSex): Column[] {
  const data = sex === "male" ? COOPER_MEN : COOPER_WOMEN;
  return COOPER_AGES.map(([ageMin, ageMax, ages], index) => {
    const column = data[index];
    return {
      sex,
      ageMin,
      ageMax,
      label: `${sex === "male" ? "homens" : "mulheres"}, ${ages}`,
      decimals: 0,
      source: COOPER_SOURCE,
      bands: [
        below(COOPER_LEVELS[0], column.below, `menor que ${metres(column.below)}`),
        ...column.ranges.map(([from, to], position) => ({ ...between(COOPER_LEVELS[position + 1], from, to, 0), printed: `${metres(from)} a ${metres(to)}` })),
        above(COOPER_LEVELS[5], column.above, `maior que ${metres(column.above)}`),
      ],
    };
  });
}
export const COOPER_TABLE: ReferenceTable = {
  id: "cooper_12min",
  title: "Capacidade cardiorrespiratória, Cooper 12 minutos",
  unit: " m",
  dependsOnSex: true,
  dependsOnAge: true,
  file: "cooper-1982.pdf",
  columns: [...cooperColumns("male"), ...cooperColumns("female")],
};

/* ---------- Waist-hip ratio: adapted from Bray et Gray (1988) ---------- */

export const WAIST_HIP_SOURCE = "Adaptado de Bray et Gray, 1988";
export const WAIST_HIP_AGES: readonly [number, number, string][] = [
  [20, 29, "20 a 29 anos"],
  [30, 39, "30 a 39 anos"],
  [40, 49, "40 a 49 anos"],
  [50, 59, "50 a 59 anos"],
  [60, 69, "60 a 69 anos"],
];
export const WAIST_HIP_LEVELS = ["Baixo", "Moderado", "Alto", "Muito Alto"] as const;
export const WAIST_HIP_MEN: readonly { below: number; ranges: readonly [number, number][]; above: number }[] = [
  { below: 0.83, ranges: [[0.83, 0.88], [0.89, 0.94]], above: 0.94 },
  { below: 0.84, ranges: [[0.84, 0.91], [0.92, 0.96]], above: 0.96 },
  { below: 0.88, ranges: [[0.88, 0.95], [0.96, 1.0]], above: 1.0 },
  { below: 0.9, ranges: [[0.9, 0.96], [0.97, 1.02]], above: 1.02 },
  { below: 0.91, ranges: [[0.91, 0.98], [0.99, 1.03]], above: 1.03 },
];
export const WAIST_HIP_WOMEN: readonly { below: number; ranges: readonly [number, number][]; above: number }[] = [
  { below: 0.71, ranges: [[0.71, 0.77], [0.78, 0.82]], above: 0.82 },
  { below: 0.72, ranges: [[0.72, 0.78], [0.79, 0.84]], above: 0.84 },
  { below: 0.73, ranges: [[0.73, 0.79], [0.8, 0.87]], above: 0.87 },
  { below: 0.74, ranges: [[0.74, 0.81], [0.82, 0.88]], above: 0.88 },
  { below: 0.76, ranges: [[0.76, 0.83], [0.84, 0.9]], above: 0.9 },
];
function waistHipColumns(sex: TableSex): Column[] {
  const data = sex === "male" ? WAIST_HIP_MEN : WAIST_HIP_WOMEN;
  return WAIST_HIP_AGES.map(([ageMin, ageMax, ages], index) => {
    const column = data[index];
    return {
      sex,
      ageMin,
      ageMax,
      label: `${sex === "male" ? "homens" : "mulheres"}, ${ages}`,
      decimals: 2,
      source: WAIST_HIP_SOURCE,
      bands: [
        below(WAIST_HIP_LEVELS[0], column.below, `menor que ${pt(column.below, 2)}`),
        ...column.ranges.map(([from, to], position) => between(WAIST_HIP_LEVELS[position + 1], from, to, 2)),
        above(WAIST_HIP_LEVELS[3], column.above, `maior que ${pt(column.above, 2)}`),
      ],
    };
  });
}
export const WAIST_HIP_TABLE: ReferenceTable = {
  id: "waist_hip",
  title: "Risco para a saúde pelo índice cintura/quadril",
  unit: "",
  dependsOnSex: true,
  dependsOnAge: true,
  file: "cintura-quadril-bray-gray-1988.pdf",
  columns: [...waistHipColumns("male"), ...waistHipColumns("female")],
};

/* ---------- Flexiteste: general classification by the total (Flexíndice) ---------- */

export const FLEXITEST_SOURCE = "tabela enviada pelo usuário em 03/11/2026";
export const FLEXITEST_TABLE: ReferenceTable = {
  id: "flexitest",
  title: "Classificação geral do Flexiteste (Flexíndice)",
  unit: " pontos",
  dependsOnSex: false,
  dependsOnAge: false,
  file: "flexiteste.png",
  columns: [
    {
      sex: null,
      ageMin: null,
      ageMax: null,
      label: null,
      decimals: 0,
      source: FLEXITEST_SOURCE,
      bands: [
        below("Muito pequeno (ancilose)", 20, "< 20"),
        { ...between("Pequeno", 21, 30, 0), printed: "21 – 30" },
        { ...between("Médio negativo", 31, 40, 0), printed: "31 – 40" },
        { ...between("Médio positivo", 41, 50, 0), printed: "41 – 50" },
        { ...between("Grande", 51, 60, 0), printed: "51 – 60" },
        // Kept as printed; the app's version (15 movements of 1 to 4) reaches 60 at most.
        above("Muito grande (hipermobilidade)", 60, "> 60"),
      ],
    },
  ],
};

export const REFERENCE_TABLES: Record<TableId, ReferenceTable> = {
  body_fat: BODY_FAT_TABLE,
  bmi: BMI_TABLE,
  cooper_12min: COOPER_TABLE,
  waist_hip: WAIST_HIP_TABLE,
  flexitest: FLEXITEST_TABLE,
};
