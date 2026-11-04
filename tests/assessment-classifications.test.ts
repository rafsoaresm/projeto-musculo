import { describe, expect, it } from "vitest";
import {
  BEFORE_TABLES,
  CLASSIFICATION_VERSION,
  REFERENCE_TABLES,
  classificationDetail,
  classificationHeading,
  classificationLevel,
  classificationLine,
  classify,
  classifyResult,
  readClassification,
  recordedTableReference,
  roundTo,
  tableReference,
  type Classification,
  type TableSex,
} from "../src/modules/avaliacoes/classifications";
import { reviewDraft } from "../src/modules/avaliacoes/v2/review";
import { compositionSchema, formFromPayload, payloadFromForm } from "../src/modules/avaliacoes/v2/composition";
import { EMPTY_SCREENING } from "../src/modules/avaliacoes/v2/screening";
import { FLEXITEST_CODES, movementSchema } from "../src/modules/avaliacoes/v2/flexitest";
import { testsSchema } from "../src/modules/avaliacoes/v2/physical-tests";

// Slice 0.92: the reference tables the user sent on 03/11/2026 (docs/referencias/classificacoes/), transcribed here a second time, in the form
// they are printed, and checked range by range against the module; then the literal rules: gaps, overlaps, outside the table, age, reference.

/* ---------- The transcription, as printed ---------- */

const FAT_AGES: [number, number | null][] = [[18, 25], [26, 35], [36, 45], [46, 55], [56, 65], [66, null]];
const FAT_LEVELS = ["Excelente", "Bom", "Acima da Média", "Média", "Abaixo da Média", "Ruim", "Muito Ruim"];
// One line per level, one "a–b" per age column (18–25 | 26–35 | 36–45 | 46–55 | 56–65 | Acima de 65).
const FAT_MEN = [
  "4–6 | 8–11 | 10–14 | 12–16 | 13–18 | 14–18",
  "8–10 | 12–15 | 16–18 | 18–20 | 20–21 | 19–21",
  "12–13 | 16–18 | 19–21 | 21–23 | 22–23 | 22–23",
  "14–16 | 18–20 | 21–23 | 24–25 | 24–25 | 23–24",
  "17–20 | 22–24 | 24–25 | 26–27 | 26–27 | 25–26",
  "20–24 | 24–27 | 27–29 | 28–30 | 28–30 | 27–29",
  "26–36 | 28–36 | 30–39 | 32–38 | 32–38 | 31–38",
];
const FAT_WOMEN = [
  "13–16 | 14–16 | 16–19 | 17–21 | 18–22 | 16–20",
  "17–19 | 18–20 | 20–23 | 23–25 | 24–26 | 22–26",
  "20–22 | 21–23 | 24–26 | 26–28 | 27–29 | 27–29",
  "23–25 | 24–25 | 27–29 | 29–31 | 30–32 | 30–32",
  "26–28 | 27–29 | 30–32 | 32–34 | 33–35 | 32–34",
  "29–31 | 31–33 | 33–36 | 35–38 | 36–38 | 35–37",
  "33–43 | 36–49 | 38–48 | 39–50 | 39–49 | 38–41",
];
const COOPER_AGES: [number, number | null][] = [[13, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, null]];
// Muito fraca "menor que", Fraca … Excelente "a a b", Superior "maior que", per age column.
const COOPER_MEN = [
  "<2090 | <1960 | <1900 | <1830 | <1660 | <1400",
  "2090–2200 | 1960–2110 | 1900–2090 | 1830–1990 | 1660–1870 | 1400–1640",
  "2210–2510 | 2120–2400 | 2100–2400 | 2000–2240 | 1880–2090 | 1650–1930",
  "2520–2770 | 2410–2640 | 2410–2510 | 2250–2460 | 2100–2320 | 1940–2120",
  "2780–3000 | 2650–2830 | 2520–2720 | 2470–2660 | 2330–2540 | 2130–2490",
  ">3000 | >2830 | >2720 | >2660 | >2540 | >2490",
];
const COOPER_WOMEN = [
  "<1610 | <1550 | <1510 | <1420 | <1350 | <1260",
  "1610–1900 | 1550–1790 | 1510–1690 | 1420–1580 | 1350–1500 | 1260–1390",
  "1910–2080 | 1800–1970 | 1700–1960 | 1590–1790 | 1510–1690 | 1400–1590",
  "2090–2300 | 1980–2160 | 1970–2080 | 1800–2000 | 1700–1900 | 1600–1750",
  "2310–2430 | 2170–2330 | 2090–2240 | 2010–2160 | 1910–2090 | 1760–1900",
  ">2430 | >2330 | >2240 | >2160 | >2090 | >1900",
];
const COOPER_LEVELS = ["Muito fraca", "Fraca", "Média", "Boa", "Excelente", "Superior"];
const ICQ_AGES: [number, number][] = [[20, 29], [30, 39], [40, 49], [50, 59], [60, 69]];
const ICQ_MEN = ["<0.83 | <0.84 | <0.88 | <0.90 | <0.91", "0.83–0.88 | 0.84–0.91 | 0.88–0.95 | 0.90–0.96 | 0.91–0.98", "0.89–0.94 | 0.92–0.96 | 0.96–1.00 | 0.97–1.02 | 0.99–1.03", ">0.94 | >0.96 | >1.00 | >1.02 | >1.03"];
const ICQ_WOMEN = ["<0.71 | <0.72 | <0.73 | <0.74 | <0.76", "0.71–0.77 | 0.72–0.78 | 0.73–0.79 | 0.74–0.81 | 0.76–0.83", "0.78–0.82 | 0.79–0.84 | 0.80–0.87 | 0.82–0.88 | 0.84–0.90", ">0.82 | >0.84 | >0.87 | >0.88 | >0.90"];
const ICQ_LEVELS = ["Baixo", "Moderado", "Alto", "Muito Alto"];

type Printed = { min: number | null; minIn: boolean; max: number | null; maxIn: boolean };
function parse(cell: string): Printed {
  if (cell.startsWith("<")) return { min: null, minIn: false, max: Number(cell.slice(1)), maxIn: false };
  if (cell.startsWith("≤")) return { min: null, minIn: false, max: Number(cell.slice(1)), maxIn: true };
  if (cell.startsWith(">")) return { min: Number(cell.slice(1)), minIn: false, max: null, maxIn: false };
  const [a, b] = cell.split("–").map(Number);
  return { min: a, minIn: true, max: b, maxIn: true };
}
const cells = (line: string) => line.split("|").map((cell) => parse(cell.trim()));

function expectColumn(tableId: keyof typeof REFERENCE_TABLES, sex: TableSex | null, ages: [number | null, number | null], levels: string[], expected: Printed[]) {
  const table = REFERENCE_TABLES[tableId];
  const column = table.columns.find((item) => item.sex === sex && item.ageMin === ages[0] && item.ageMax === ages[1]);
  expect(column, `${tableId} ${sex} ${ages}`).toBeDefined();
  expect(column!.bands.map((band) => band.level)).toEqual(levels);
  column!.bands.forEach((band, index) => {
    const want = expected[index];
    expect({ min: band.min?.value ?? null, minIn: band.min?.inclusive ?? false, max: band.max?.value ?? null, maxIn: band.max?.inclusive ?? false }, `${tableId} ${sex} ${ages} ${band.level}`).toEqual(want);
  });
}

const fatOf = (value: number, sex: TableSex | null, ageYears: number | null) => classify({ table: "body_fat", value, sex, ageYears, referenceFrom: sex ? "chosen" : null });
const cooperOf = (value: number, sex: TableSex | null, ageYears: number | null) => classify({ table: "cooper_12min", value, sex, ageYears, referenceFrom: "chosen" });
const icqOf = (value: number, sex: TableSex | null, ageYears: number | null) => classify({ table: "waist_hip", value, sex, ageYears, referenceFrom: "chosen" });
const bmiOf = (value: number) => classify({ table: "bmi", value, sex: null, ageYears: null, referenceFrom: null });
const flexOf = (value: number) => classify({ table: "flexitest", value, sex: null, ageYears: null, referenceFrom: null });
const level = (classification: Classification) => classificationLevel(classification);

describe("the tables are the transcription of the files, range by range (version ref-2026-11-03)", () => {
  it("body fat, adults (Pollock & Wilmore, 1993), men and women, every age column", () => {
    for (const [sex, data] of [["male", FAT_MEN], ["female", FAT_WOMEN]] as const)
      FAT_AGES.forEach((ages, column) => expectColumn("body_fat", sex, ages, FAT_LEVELS, data.map((line) => cells(line)[column])));
    const columns = REFERENCE_TABLES.body_fat.columns.filter((column) => column.ageMin !== null && column.ageMin >= 18);
    expect(new Set(columns.map((column) => column.source))).toEqual(new Set(["Pollock & Wilmore, 1993"]));
    expect(columns.every((column) => column.decimals === 0)).toBe(true);
  });
  it("body fat, 7 to 17 years (Gaithersburg et al., 1989): “até”, two decimals, “maior que”", () => {
    const levels = ["Excessivamente baixa", "Baixa", "Adequada", "Moderadamente alta", "Alta", "Excessivamente alta"];
    expectColumn("body_fat", "male", [7, 17], levels, ["≤6", "6.01–10", "10.01–20", "20.01–25", "25.01–31", ">31.01"].map(parse));
    expectColumn("body_fat", "female", [7, 17], levels, ["≤12", "12.01–15", "15.01–25", "25.01–30", "30.01–36", ">36.01"].map(parse));
    const youth = REFERENCE_TABLES.body_fat.columns.filter((column) => column.ageMin === 7);
    expect(youth.map((column) => [column.source, column.decimals])).toEqual([["Gaithersburg et al., 1989", 2], ["Gaithersburg et al., 1989", 2]]);
  });
  it("BMI (no source printed): the labels verbatim, “(parabéns)” included", () => {
    expectColumn("bmi", null, [null, null], ["abaixo do peso", "Peso ideal (parabéns)", "Levemente acima do peso", "Obesidade grau I", "Obesidade grau II (severa)", "Obesidade III (mórbida)"], [
      "<18.5", "18.6–24.9", "25–29.9", "30–34.9", "35–39.9", ">40",
    ].map(parse));
    expect(REFERENCE_TABLES.bmi.columns[0].bands.map((band) => band.printed)).toEqual(["abaixo de 18,5", "entre 18,6 e 24,9", "entre 25,0 e 29,9", "entre 30,0 e 34,9", "entre 35,0 e 39,9", "acima de 40"]);
  });
  it("Cooper 12 min (Cooper, 1982), men and women, every age column (the 2.400 m test is not in the app)", () => {
    for (const [sex, data] of [["male", COOPER_MEN], ["female", COOPER_WOMEN]] as const)
      COOPER_AGES.forEach((ages, column) => expectColumn("cooper_12min", sex, ages, COOPER_LEVELS, data.map((line) => cells(line)[column])));
    expect(REFERENCE_TABLES.cooper_12min.columns.every((column) => column.source === "Cooper, 1982" && column.decimals === 0)).toBe(true);
  });
  it("waist-hip ratio (adapted from Bray et Gray, 1988), men and women, 20 to 69", () => {
    for (const [sex, data] of [["male", ICQ_MEN], ["female", ICQ_WOMEN]] as const)
      ICQ_AGES.forEach((ages, column) => expectColumn("waist_hip", sex, ages, ICQ_LEVELS, data.map((line) => cells(line)[column])));
    expect(REFERENCE_TABLES.waist_hip.columns.every((column) => column.decimals === 2)).toBe(true);
  });
  it("Flexiteste (the user's table): < 20, 21 – 30, …, > 60", () => {
    expectColumn("flexitest", null, [null, null], ["Muito pequeno (ancilose)", "Pequeno", "Médio negativo", "Médio positivo", "Grande", "Muito grande (hipermobilidade)"], [
      "<20", "21–30", "31–40", "41–50", "51–60", ">60",
    ].map(parse));
    expect(REFERENCE_TABLES.flexitest.dependsOnAge || REFERENCE_TABLES.flexitest.dependsOnSex).toBe(false);
  });
});

describe("the literal rules", () => {
  it("rounds to the table's precision before comparing, and says so", () => {
    expect(roundTo(17.3, 0)).toBe(17);
    expect(roundTo(17.5, 0)).toBe(18);
    expect(roundTo(0.645, 2)).toBe(0.65);
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(18.54, 1)).toBe(18.5);
    const fat = fatOf(17.3, "male", 27);
    expect(fat).toMatchObject({ status: "in_range", levels: ["Acima da Média"], comparedValue: 17, column: "homens, 26 a 35 anos", source: "Pollock & Wilmore, 1993" });
    expect(classificationDetail(fat)).toBe("Percentual de gordura, homens, 26 a 35 anos · Pollock & Wilmore, 1993 · 17,3% comparado como 17% · referência masculina · tabela ref-2026-11-03");
    expect(classificationDetail(icqOf(0.6435, "male", 27))).toContain("0,644 comparado como 0,64");
    expect(classificationDetail(cooperOf(2200, "male", 27))).toContain("comparado como 2.200 m");
  });

  it("prints the value at the result's precision with its trailing zero, so the rounding never reads “17% comparado como 17%”", () => {
    expect(classificationDetail(fatOf(16.96, "male", 27))).toContain("17,0% comparado como 17%");
    expect(classificationDetail(icqOf(0.7399, "male", 27))).toContain("0,740 comparado como 0,74");
    expect(classificationDetail(fatOf(17.27, "male", 27))).toContain("17,3% comparado como 17%");
    expect(classificationDetail(fatOf(17, "male", 27))).toContain(" · comparado como 17% · ");
    expect(classificationDetail(cooperOf(1800, "female", 27))).toContain(" · comparado como 1.800 m · ");
  });

  it("without an age, says the assessment has no birth date (taken when it started), not to fill in the profile", () => {
    const detail = classificationDetail(fatOf(17, "male", null));
    expect(detail).toContain("a avaliação não tem data de nascimento (o cadastro não tinha quando ela começou)");
    expect(detail).not.toContain("falta a data de nascimento no cadastro");
  });

  it("the Cooper classification says it is of the distance; the others are plain", () => {
    expect(classificationHeading(cooperOf(1800, "female", 27))).toBe("Classificação da distância (1.800 m)");
    expect(classificationHeading(fatOf(17, "male", 27))).toBe("Classificação");
    expect(classificationHeading(null)).toBe("Classificação");
    expect(classificationLine(fatOf(17, "male", 27))).toMatch(/^Acima da Média — Percentual de gordura/);
  });

  it("the recorded reference of the tables comes from the frozen classifications", () => {
    expect(recordedTableReference([classify({ table: "body_fat", value: 17, ageYears: 27, sex: "male", referenceFrom: "equation" })])).toBe("Masculina, a da equação das dobras");
    expect(recordedTableReference([classify({ table: "bmi", value: 23, ageYears: 27, sex: null, referenceFrom: null }), icqOf(0.8, "female", 27)])).toBe("Feminina, escolhida na Revisão");
    expect(recordedTableReference([classify({ table: "waist_hip", value: 0.8, ageYears: 27, sex: null, referenceFrom: null })])).toBe("Não escolhida");
    expect(recordedTableReference([classify({ table: "bmi", value: 23, ageYears: 27, sex: null, referenceFrom: null }), null, undefined])).toBeNull();
    expect(recordedTableReference([])).toBeNull();
  });

  it("youth body fat: “maior que 31,01” / “maior que 36,01” leave the printed bound itself in a gap (literal reading)", () => {
    expect(level(fatOf(31.01, "male", 12))).toBe("entre Alta e Excessivamente alta (fora das faixas da tabela)");
    expect(level(fatOf(31.005, "male", 12))).toBe("entre Alta e Excessivamente alta (fora das faixas da tabela)");
    expect(level(fatOf(31.02, "male", 12))).toBe("Excessivamente alta");
    expect(level(fatOf(36.01, "female", 12))).toBe("entre Alta e Excessivamente alta (fora das faixas da tabela)");
  });

  it("body fat, men 18–25: every gap and overlap edge as the table prints it", () => {
    const at = (value: number) => level(fatOf(value, "male", 20));
    expect(at(4)).toBe("Excelente");
    expect(at(6)).toBe("Excelente");
    expect(at(7)).toBe("entre Excelente e Bom (fora das faixas da tabela)");
    expect(at(6.6)).toBe("entre Excelente e Bom (fora das faixas da tabela)");
    expect(at(6.4)).toBe("Excelente");
    expect(at(8)).toBe("Bom");
    expect(at(11)).toBe("entre Bom e Acima da Média (fora das faixas da tabela)");
    expect(at(13)).toBe("Acima da Média");
    expect(at(14)).toBe("Média");
    expect(at(17)).toBe("Abaixo da Média");
    expect(at(20)).toBe("Abaixo da Média / Ruim");
    expect(fatOf(20, "male", 20)).toMatchObject({ status: "overlap", levels: ["Abaixo da Média", "Ruim"] });
    expect(at(21)).toBe("Ruim");
    expect(at(25)).toBe("entre Ruim e Muito Ruim (fora das faixas da tabela)");
    expect(fatOf(25, "male", 20)).toMatchObject({ status: "gap", levels: ["Ruim", "Muito Ruim"] });
    expect(at(36)).toBe("Muito Ruim");
    expect(at(37)).toBe("sem faixa na tabela (acima da última faixa da tabela)");
    expect(at(3)).toBe("sem faixa na tabela (abaixo da primeira faixa da tabela)");
    expect(fatOf(3.4, "male", 20)).toMatchObject({ status: "out_of_table", comparedValue: 3 });
  });

  it("every overlap and gap of the adult body fat tables is found where the transcription has it", () => {
    for (const [sex, data] of [["male", FAT_MEN], ["female", FAT_WOMEN]] as const)
      FAT_AGES.forEach((ages, column) => {
        const ranges = data.map((line) => cells(line)[column]);
        const age = ages[0];
        for (let value = 0; value <= 55; value += 1) {
          const holding = FAT_LEVELS.filter((_, index) => value >= ranges[index].min! && value <= ranges[index].max!);
          const result = fatOf(value, sex, age);
          if (holding.length === 1) expect(result.status, `${sex} ${age} ${value}`).toBe("in_range");
          else if (holding.length > 1) expect(result, `${sex} ${age} ${value}`).toMatchObject({ status: "overlap", levels: holding });
          else expect(["gap", "out_of_table"], `${sex} ${age} ${value}`).toContain(result.status);
          if (holding.length === 1) expect(result.levels).toEqual(holding);
        }
      });
    // Two examples from the women's table: 56–65 has 23 between Excelente (18–22) and Bom (24–26); 46–55 has no overlap at 23 (Bom starts at 23).
    expect(level(fatOf(23, "female", 60))).toBe("entre Excelente e Bom (fora das faixas da tabela)");
    expect(level(fatOf(23, "female", 50))).toBe("Bom");
    expect(level(fatOf(21, "female", 50))).toBe("Excelente");
  });

  it("body fat age columns: 7–17 by Gaithersburg, 18–25 … 56–65, “Acima de 65” is 66 or more; under 7 has no column", () => {
    expect(fatOf(15, "male", 17)).toMatchObject({ column: "masculino, 7 a 17 anos", source: "Gaithersburg et al., 1989", levels: ["Adequada"] });
    expect(fatOf(15, "male", 18)).toMatchObject({ column: "homens, 18 a 25 anos", levels: ["Média"] });
    expect(fatOf(15, "male", 25).column).toBe("homens, 18 a 25 anos");
    expect(fatOf(15, "male", 26).column).toBe("homens, 26 a 35 anos");
    expect(fatOf(20, "male", 65).column).toBe("homens, 56 a 65 anos");
    expect(fatOf(20, "male", 66).column).toBe("homens, acima de 65 anos");
    expect(fatOf(20, "male", 90).column).toBe("homens, acima de 65 anos");
    expect(fatOf(15, "male", 7).column).toBe("masculino, 7 a 17 anos");
    expect(fatOf(15, "female", 6)).toMatchObject({ status: "out_of_table", levels: [], comparedValue: null });
    expect(level(fatOf(15, "female", 6))).toBe("sem faixa na tabela (idade de 6 anos; a tabela tem colunas de 7 anos em diante)");
  });

  it("body fat 7–17: two decimals, “até 6%” includes 6, the gap 31,01 between “Alta” and “maior que 31,01%”", () => {
    const at = (value: number) => level(fatOf(value, "male", 12));
    expect(at(6)).toBe("Excessivamente baixa");
    expect(at(6.004)).toBe("Excessivamente baixa");
    expect(at(6.005)).toBe("Baixa");
    expect(at(10)).toBe("Baixa");
    expect(at(10.01)).toBe("Adequada");
    expect(at(31)).toBe("Alta");
    expect(at(31.01)).toBe("entre Alta e Excessivamente alta (fora das faixas da tabela)");
    expect(at(31.02)).toBe("Excessivamente alta");
    expect(level(fatOf(12, "female", 12))).toBe("Excessivamente baixa");
    expect(level(fatOf(36.01, "female", 12))).toBe("entre Alta e Excessivamente alta (fora das faixas da tabela)");
    expect(level(fatOf(36.5, "female", 12))).toBe("Excessivamente alta");
  });

  it("BMI: one decimal; 18,5 and 40,0 are in the table's gaps; no age and no reference needed", () => {
    expect(level(bmiOf(18.44))).toBe("abaixo do peso");
    expect(level(bmiOf(18.5))).toBe("entre abaixo do peso e Peso ideal (parabéns) (fora das faixas da tabela)");
    expect(level(bmiOf(18.54))).toBe("entre abaixo do peso e Peso ideal (parabéns) (fora das faixas da tabela)");
    expect(level(bmiOf(18.55))).toBe("Peso ideal (parabéns)");
    expect(level(bmiOf(23.63))).toBe("Peso ideal (parabéns)");
    expect(level(bmiOf(24.94))).toBe("Peso ideal (parabéns)");
    expect(level(bmiOf(24.95))).toBe("Levemente acima do peso");
    expect(level(bmiOf(29.9))).toBe("Levemente acima do peso");
    expect(level(bmiOf(30))).toBe("Obesidade grau I");
    expect(level(bmiOf(35))).toBe("Obesidade grau II (severa)");
    expect(level(bmiOf(39.9))).toBe("Obesidade grau II (severa)");
    expect(level(bmiOf(40))).toBe("entre Obesidade grau II (severa) e Obesidade III (mórbida) (fora das faixas da tabela)");
    expect(level(bmiOf(40.1))).toBe("Obesidade III (mórbida)");
    expect(bmiOf(23.63)).toMatchObject({ sex: null, ageYears: null, column: null, comparedValue: 23.6 });
  });

  it("Cooper: whole metres; 2.201 to 2.209 between Fraca and Média (men 13–19); “Excelente” ends at 3.000 and “Superior” is more than 3.000", () => {
    const at = (value: number) => level(cooperOf(value, "male", 15));
    expect(at(2089)).toBe("Muito fraca");
    expect(at(2090)).toBe("Fraca");
    expect(at(2200)).toBe("Fraca");
    expect(at(2205)).toBe("entre Fraca e Média (fora das faixas da tabela)");
    expect(at(2209.4)).toBe("entre Fraca e Média (fora das faixas da tabela)");
    expect(at(2209.5)).toBe("Média");
    expect(at(2210)).toBe("Média");
    expect(at(3000)).toBe("Excelente");
    expect(at(3001)).toBe("Superior");
    // "Acima de 60": 60 or more; 13–19 only from 13; no age: no classification.
    expect(cooperOf(1500, "female", 59).column).toBe("mulheres, 50 a 59 anos");
    expect(cooperOf(1500, "female", 60)).toMatchObject({ column: "mulheres, acima de 60 anos", levels: ["Média"] });
    expect(cooperOf(2000, "male", 12)).toMatchObject({ status: "out_of_table" });
    expect(level(cooperOf(2000, "male", 12))).toBe("sem faixa na tabela (idade de 12 anos; a tabela tem colunas de 13 anos em diante)");
    expect(cooperOf(2000, "male", 13).column).toBe("homens, 13 a 19 anos");
    expect(level(cooperOf(2000, "male", null))).toBe("sem idade, sem classificação");
    expect(level(cooperOf(2000, null, 30))).toBe("sem referência escolhida");
  });

  it("waist-hip ratio: two decimals, 20 to 69 only, “menor que” excludes the bound, the reference decides the column", () => {
    expect(level(icqOf(0.8249, "male", 25))).toBe("Baixo");
    expect(level(icqOf(0.825, "male", 25))).toBe("Moderado");
    expect(level(icqOf(0.88, "male", 25))).toBe("Moderado");
    expect(level(icqOf(0.885, "male", 25))).toBe("Alto");
    expect(level(icqOf(0.94, "male", 25))).toBe("Alto");
    expect(level(icqOf(0.95, "male", 25))).toBe("Muito Alto");
    expect(level(icqOf(0.8, "female", 25))).toBe("Alto");
    expect(level(icqOf(0.8, "male", 25))).toBe("Baixo");
    expect(icqOf(0.8, "male", 69).column).toBe("homens, 60 a 69 anos");
    expect(level(icqOf(0.8, "male", 70))).toBe("sem faixa na tabela (idade de 70 anos; a tabela tem colunas de 20 a 69 anos)");
    expect(level(icqOf(0.8, "male", 19))).toBe("sem faixa na tabela (idade de 19 anos; a tabela tem colunas de 20 a 69 anos)");
    expect(icqOf(0.8, null, 30)).toMatchObject({ status: "no_reference", levels: [], comparedValue: null });
    expect(icqOf(0.8, "female", null)).toMatchObject({ status: "no_age" });
  });

  it("Flexiteste: 20 exactly is between “< 20” and “21 – 30”; “> 60” is kept but 15 × 4 never reaches it", () => {
    expect(level(flexOf(15))).toBe("Muito pequeno (ancilose)");
    expect(level(flexOf(19))).toBe("Muito pequeno (ancilose)");
    expect(level(flexOf(20))).toBe("entre Muito pequeno (ancilose) e Pequeno (fora das faixas da tabela)");
    expect(level(flexOf(21))).toBe("Pequeno");
    expect(level(flexOf(30))).toBe("Pequeno");
    expect(level(flexOf(31))).toBe("Médio negativo");
    expect(level(flexOf(50))).toBe("Médio positivo");
    expect(level(flexOf(60))).toBe("Grande");
    expect(level(flexOf(61))).toBe("Muito grande (hipermobilidade)");
    expect(flexOf(32)).toMatchObject({ source: "tabela enviada pelo usuário em 03/11/2026", version: CLASSIFICATION_VERSION });
  });

  it("the reference: the equation's when set, else the one chosen, never anything else", () => {
    expect(tableReference("male", "female")).toEqual({ sex: "male", from: "equation" });
    expect(tableReference("not_selected", "female")).toEqual({ sex: "female", from: "chosen" });
    expect(tableReference("not_selected", null)).toEqual({ sex: null, from: null });
    expect(tableReference(undefined, undefined)).toEqual({ sex: null, from: null });
  });

  it("classifies only the results a table covers; Cooper by its distance; a stored one reads back or is null", () => {
    const context = { ageYears: 27, sex: "male" as const, referenceFrom: "equation" as const };
    expect(classifyResult("body_density", 1.06, null, context)).toBeNull();
    expect(classifyResult("cooper_vo2_estimate", 37.9, { distanceM: 2200 }, context)).toBeNull();
    expect(classifyResult("cooper_speed_kmh", 11, { distanceM: 2200 }, context)).toMatchObject({ table: "cooper_12min", value: 2200, levels: ["Média"], column: "homens, 20 a 29 anos" });
    expect(classifyResult("cooper_speed_kmh", 11, null, context)).toBeNull();
    const stored = classifyResult("bmi", 23.63, null, context)!;
    expect(readClassification(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
    expect(readClassification({ ...stored, status: "maybe" })).toBeNull();
    expect(readClassification(null)).toBeNull();
    expect(BEFORE_TABLES).toBe("registrada antes das tabelas de referência");
  });
});

describe("the review classifies what finalize records", () => {
  const base = { profile: null, screening: EMPTY_SCREENING, assessedOn: "2026-11-03", birthDate: "1999-10-31" };
  const JP7 = { chest: [12], midaxillary: [9], triceps: [24], subscapular: [11], abdominal: [16], suprailiac: [15], thigh: [35] };

  it("the handoff's man (27, JP7 male, 69,1 kg, 1,71 m, waist 69,5, hip 108): body fat “Acima da Média”, BMI “Peso ideal (parabéns)”, RCQ “Baixo”", () => {
    const composition = compositionSchema.parse({
      weightKg: 69.1,
      heightCm: 171,
      protocol: "jackson_pollock_7",
      equation: "male",
      skinfolds: JP7,
      perimetersCm: { waist: 69.5, hip: 108 },
    });
    const review = reviewDraft({ ...base, composition });
    const of = (code: string) => review.results.find((result) => result.code === code)!.classification;
    expect(review.reference).toEqual({ sex: "male", from: "equation" });
    expect(of("body_fat_percent")).toMatchObject({ levels: ["Acima da Média"], comparedValue: 17, referenceFrom: "equation", ageYears: 27 });
    expect(of("bmi")).toMatchObject({ levels: ["Peso ideal (parabéns)"], comparedValue: 23.6 });
    expect(of("waist_hip_ratio")).toMatchObject({ levels: ["Baixo"], comparedValue: 0.64, column: "homens, 20 a 29 anos" });
    expect(of("sum_skinfolds")).toBeNull();
    expect(of("body_density")).toBeNull();
    expect(of("fat_mass_kg")).toBeNull();
  });

  it("without the equation, the sex-dependent tables wait for “Referência das tabelas”; the BMI and the Flexiteste do not", () => {
    const composition = compositionSchema.parse({ weightKg: 53.5, heightCm: 170, perimetersCm: { waist: 70, hip: 95 } });
    // Ten movements at level 1 and five at level 2: a total of 20, exactly between "< 20" and "21 – 30".
    const movement = movementSchema.parse({ flexitest: { levels: Object.fromEntries(FLEXITEST_CODES.map((code, index) => [code, index < 10 ? 1 : 2])) } });
    const tests = testsSchema.parse({ cooper: { distanceM: 1800 } });
    const none = reviewDraft({ ...base, composition, movement, tests });
    const of = (review: typeof none, code: string) => review.results.find((result) => result.code === code)?.classification ?? null;
    expect(of(none, "waist_hip_ratio")).toMatchObject({ status: "no_reference" });
    expect(of(none, "cooper_speed_kmh")).toMatchObject({ status: "no_reference" });
    expect(classificationLevel(of(none, "waist_hip_ratio")!)).toBe("sem referência escolhida");
    // 53,5 ÷ 1,70² = 18,51 → 18,5: between the two first levels of the table.
    expect(of(none, "bmi")).toMatchObject({ status: "gap", comparedValue: 18.5 });
    expect(of(none, "flexitest_total")).toMatchObject({ status: "gap", comparedValue: 20, levels: ["Muito pequeno (ancilose)", "Pequeno"] });
    const chosen = reviewDraft({ ...base, composition: { ...composition, tableReference: "female" }, movement, tests });
    expect(chosen.reference).toEqual({ sex: "female", from: "chosen" });
    expect(of(chosen, "waist_hip_ratio")).toMatchObject({ status: "in_range", levels: ["Moderado"], comparedValue: 0.74, column: "mulheres, 20 a 29 anos", referenceFrom: "chosen" });
    expect(of(chosen, "cooper_speed_kmh")).toMatchObject({ status: "in_range", levels: ["Média"], column: "mulheres, 20 a 29 anos" });
    const noAge = reviewDraft({ ...base, birthDate: null, composition: { ...composition, tableReference: "female" }, tests });
    expect(of(noAge, "waist_hip_ratio")).toMatchObject({ status: "no_age" });
    expect(classificationLevel(of(noAge, "waist_hip_ratio")!)).toBe("sem idade, sem classificação");
    expect(of(noAge, "bmi")).toMatchObject({ status: "gap" });
  });

  it("the chosen reference is stored only when chosen, so what was stored before reads the same", () => {
    const before = compositionSchema.parse({ weightKg: 70 });
    expect("tableReference" in before).toBe(false);
    const form = formFromPayload(before);
    expect(form.tableReference).toBeNull();
    expect("tableReference" in payloadFromForm(form).payload!).toBe(false);
    expect(payloadFromForm({ ...form, tableReference: "male" }).payload).toMatchObject({ tableReference: "male" });
    expect(compositionSchema.safeParse({ tableReference: "other" }).success).toBe(false);
  });
});
