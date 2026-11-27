import type { Patient } from '@/lib/supabase';

type DirectoryIdentity = Pick<Patient, 'first_name' | 'last_name' | 'phone' | 'national_id' | 'notes' | 'insurance_number'>;

/** Only explicitly recorded file references; never derive a patient identifier from order, insurance or national ID. */
export function getRecordedPatientFileNo(patient: DirectoryIdentity): string | null {
  const match = patient.notes?.match(/\[پرونده:\s*([^\]]+)\]/);
  return match?.[1]?.trim() || null;
}

/** Normalize search copies only. Never modify stored identity data. */
export function normalizePatientQuery(value: string): string {
  return value.normalize('NFKC')
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
    .replace(/ي|ى/g, 'ی').replace(/ك/g, 'ک')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u200c\u200d\s]+/g, ' ')
    .trim().toLowerCase();
}

export function matchesPatientDirectoryQuery(patient: DirectoryIdentity, query: string): boolean {
  const normalized = normalizePatientQuery(query);
  if (!normalized) return true;
  const fields = [
    [patient.first_name, patient.last_name].filter(Boolean).join(' '),
    [patient.last_name, patient.first_name].filter(Boolean).join(' '),
    patient.phone, patient.national_id, getRecordedPatientFileNo(patient),
  ].filter((field): field is string => typeof field === 'string' && field.length > 0)
    .map(normalizePatientQuery);
  const tokens = normalized.split(' ');
  if (tokens.every(token => fields.some(field => field.includes(token)))) return true;
  // Formatted phone numbers and national identifiers can be searched using either digit script.
  if (!/^[+0-9\s()\-]+$/.test(normalized)) return false;
  const compact = normalized.replace(/[^0-9]/g, '');
  if (!compact) return false;
  return [patient.phone, patient.national_id].some(field => field && normalizePatientQuery(field).replace(/[^0-9]/g, '').includes(compact));
}

/** Legacy notes-tag storage until a verified dedicated server identity contract exists. */
export function preparePatientFileNotes(fileNo: string, notes: string): { ok: true; notes: string | null } | { ok: false; message: string } {
  const reference = fileNo.trim();
  if (/[\[\]\r\n]/.test(reference) || /\[پرونده\s*:/.test(notes)) {
    return { ok: false, message: 'شماره پرونده را فقط در کادر اختصاصی وارد کنید.' };
  }
  const value = (reference ? `[پرونده: ${reference}] ${notes.trim()}` : notes.trim()).trim();
  return { ok: true, notes: value || null };
}

/** Best-effort check of visible records only; not a server uniqueness guarantee. */
export function findVisiblePatientIdentityConflict(
  records: readonly (DirectoryIdentity & { id: string })[],
  candidate: { fileNo?: string | null; nationalId?: string | null },
  editingId?: string
): 'file' | 'national_id' | null {
  const file = normalizePatientQuery(candidate.fileNo ?? '');
  const national = normalizePatientQuery(candidate.nationalId ?? '').replace(/\s|-/g, '');
  for (const record of records) {
    if (record.id === editingId) continue;
    if (file && normalizePatientQuery(getRecordedPatientFileNo(record) ?? '') === file) return 'file';
    if (national && normalizePatientQuery(record.national_id ?? '').replace(/\s|-/g, '') === national) return 'national_id';
  }
  return null;
}
