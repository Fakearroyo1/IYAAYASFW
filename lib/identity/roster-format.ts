// Shared display/serialization contract. No server bindings or identity secrets.
export type ImportMode = 'create' | 'update';
export const NEW_MEMBER_HEADERS = ['display_name', 'email', 'contact_email', 'google_bootstrap_email', 'access_enabled'];
export const UPDATE_MEMBER_HEADERS = ['member_id', 'display_name', 'contact_email', 'google_bootstrap_email', 'microsoft_bootstrap_email', 'access_enabled'];
export const rosterHeaders = (mode: ImportMode) => mode === 'create' ? NEW_MEMBER_HEADERS : UPDATE_MEMBER_HEADERS;
export const MAX_ROSTER_BYTES = 65536;
export const MAX_ROSTER_ROWS = 100;
// Always quote cells; neutralize spreadsheet formulas in reports containing user text.
export function csvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
export function csvFile(rows: unknown[][]) {
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
