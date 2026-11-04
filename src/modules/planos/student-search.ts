/** Name search of the "Novo plano" student picker: case and accents do not matter, spaces are collapsed. */
export const foldName = (text: string) =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export function matchesName(name: string, query: string): boolean {
  const wanted = foldName(query);
  return wanted === "" || foldName(name).includes(wanted);
}
