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
