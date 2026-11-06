/**
 * The role table a stored blueprint's deltas are relative to (`roleFocusRef`): the interim constant or the table of a published ruleset.
 * Pure; shared by the acceptance (server) and the client-safe strategy view.
 */
import { ROLE_FOCUS_INTERIM_TABLE, type RoleFocusTable } from "./role-focus";
import { roleFocusFromRuleSet } from "./rules-mode/ruleset-templates";
import { ROLE_FOCUS_INTERIM } from "./versions";

export function roleTableOf(ref: string): RoleFocusTable | null {
  if (ref === ROLE_FOCUS_INTERIM) return ROLE_FOCUS_INTERIM_TABLE;
  const at = ref.indexOf("@");
  return at > 0 ? roleFocusFromRuleSet({ id: ref.slice(0, at), version: ref.slice(at + 1) }) : null;
}
