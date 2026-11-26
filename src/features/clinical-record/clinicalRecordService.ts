/**
 * MINADENTAL V15 — CLINICAL RECORD, CONSENT, ALLERGY REVIEW, CLINICAL NOTES
 * & RETENTION GOVERNANCE SERVICE (DURABLE BACKEND-NAMESPACED + SERVER HYDRATION)
 *
 * V16 Release-Hold Remediation (V15 P0):
 *   - Eliminates ephemeral Map-only storage: allergy reviews, versioned consents,
 *     and clinical notes are persisted in backend-namespaced storage (`getBackendNamespaceKey`)
 *     AND synchronized with PostgreSQL (`patient_allergy_reviews`, `patient_consents`,
 *     `clinical_notes`) via fail-closed async commands + server hydration.
 *   - Distinguishes `'persisted_server' | 'queued_offline_draft' | 'rejected' | 'unknown'`
 *     so unconfirmed offline/local operations are never mislabeled as server-signed.
 */

import { supabase, type Patient, type Treatment, type Appointment, type Payment } from '@/lib/supabase';
import { getBackendNamespaceKey } from '@/lib/supabaseCore';
import { getMutationOutcome, hasZeroAffectedRows } from '@/lib/supabaseGuardian';
import { getRuntimeAuthStatus } from '@/services/authentication/authService';
import { detectMedicalAlerts, type MedicalAlert } from '@/lib/medicalAlerts';

export type ClinicalPersistenceStatus =
  | 'persisted_server'
  | 'queued_offline_draft'
  | 'rejected'
  | 'unknown';

function readNamespacedArray<T>(key: string): T[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

function writeNamespacedArray<T>(key: string, value: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

function removeNamespacedKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

// ── 1. Structured 4-State Allergy Verification (CL-06) ──
export type AllergyVerificationStatus = 'not_asked' | 'unknown' | 'no_known' | 'present';

export interface StructuredAllergyReview {
  id: string;
  patientId: string;
  encounterId: string | null;
  status: AllergyVerificationStatus;
  substanceAgent: string | null;
  reactionDescription: string | null;
  severity: 'mild' | 'moderate' | 'life_threatening' | null;
  certainty: 'unconfirmed' | 'suspected' | 'confirmed_by_clinician';
  sourceStatement: string | null;
  reviewedBy: string;
  reviewerRole: string;
  reviewedAt: string;
  persistenceStatus?: ClinicalPersistenceStatus;
  serverId?: string | null;
  serverTimestamp?: string | null;
}

export interface PatientAllergySafetyAssessment {
  patientId: string;
  verificationStatus: AllergyVerificationStatus;
  verificationLabelFa: string;
  isClinicianVerified: boolean;
  requiresClinicalInquiry: boolean;
  structuredReviews: StructuredAllergyReview[];
  assistiveFreeTextAlerts: MedicalAlert[];
  assistiveDisclaimerFa: string | null;
}

const ALLERGY_REVIEW_LEDGER = new Map<string, StructuredAllergyReview[]>();
const ALLERGY_INDEX_KEY = () => getBackendNamespaceKey('minadental_v15_allergy_patients');
const allergyPatientKey = (patientId: string) =>
  getBackendNamespaceKey(`minadental_v15_allergy_${patientId}`);

function trackPatientIndex(indexKeyFn: () => string, patientId: string): void {
  const existing = readNamespacedArray<string>(indexKeyFn()) ?? [];
  if (!existing.includes(patientId)) {
    writeNamespacedArray(indexKeyFn(), [...existing, patientId]);
  }
}

export function getPatientAllergyReviews(patientId: string): StructuredAllergyReview[] {
  const mem = ALLERGY_REVIEW_LEDGER.get(patientId);
  if (mem) return [...mem];
  const stored = readNamespacedArray<StructuredAllergyReview>(allergyPatientKey(patientId));
  if (stored) {
    ALLERGY_REVIEW_LEDGER.set(patientId, stored);
    return [...stored];
  }
  return [];
}

function savePatientAllergyReviews(patientId: string, reviews: StructuredAllergyReview[]): void {
  ALLERGY_REVIEW_LEDGER.set(patientId, [...reviews]);
  writeNamespacedArray(allergyPatientKey(patientId), reviews);
  trackPatientIndex(ALLERGY_INDEX_KEY, patientId);
}

export const ALLERGY_STATUS_META: Record<
  AllergyVerificationStatus,
  { labelFa: string; badgeColor: string; badgeBg: string }
> = {
  not_asked: {
    labelFa: 'حساسیت دارویی سؤال/بررسی نشده',
    badgeColor: '#B45309',
    badgeBg: '#FEF3C7',
  },
  unknown: {
    labelFa: 'وضعیت حساسیت نامشخص (نیازمند بررسی)',
    badgeColor: '#D97706',
    badgeBg: '#FFEDD5',
  },
  no_known: {
    labelFa: 'فاقد حساسیت دارویی شناخته‌شده (تأییدشده)',
    badgeColor: '#15803D',
    badgeBg: '#DCFCE7',
  },
  present: {
    labelFa: 'دارای حساسیت دارویی / غذایی ثبت‌شده',
    badgeColor: '#B91C1C',
    badgeBg: '#FEE2E2',
  },
};

export function assessPatientAllergySafety(
  patient: Pick<Patient, 'id' | 'allergies' | 'medical_history' | 'medications'>,
  explicitReviews?: StructuredAllergyReview[]
): PatientAllergySafetyAssessment {
  const reviews = explicitReviews ?? getPatientAllergyReviews(patient.id);
  const latestReview = reviews.length > 0 ? reviews[reviews.length - 1] : null;
  const rawFreeText = `${patient.allergies || ''} ${patient.medical_history || ''} ${patient.medications || ''}`.trim();
  const assistiveAlerts = detectMedicalAlerts(rawFreeText);

  if (!latestReview) {
    return {
      patientId: patient.id,
      verificationStatus: 'not_asked',
      verificationLabelFa:
        assistiveAlerts.length > 0
          ? 'کلیدواژه حساسیت/ریسک در متن پرونده یافت شد (نیازمند تأیید ساختاریافته پزشک)'
          : ALLERGY_STATUS_META.not_asked.labelFa,
      isClinicianVerified: false,
      requiresClinicalInquiry: true,
      structuredReviews: [],
      assistiveFreeTextAlerts: assistiveAlerts,
      assistiveDisclaimerFa:
        assistiveAlerts.length > 0
          ? 'هشدار استخراج‌شده از متن آزاد صرفاً کمک‌تصمیم است و جایگزین بررسی ساختاریافته پزشک نیست.'
          : 'فیلد حساسیت دارویی هنوز به‌صورت ساختاریافته توسط کادر درمان تأیید نشده است.',
    };
  }

  return {
    patientId: patient.id,
    verificationStatus: latestReview.status,
    verificationLabelFa: ALLERGY_STATUS_META[latestReview.status].labelFa,
    isClinicianVerified: latestReview.certainty === 'confirmed_by_clinician',
    requiresClinicalInquiry:
      latestReview.status === 'not_asked' || latestReview.status === 'unknown',
    structuredReviews: reviews,
    assistiveFreeTextAlerts: assistiveAlerts,
    assistiveDisclaimerFa:
      latestReview.certainty !== 'confirmed_by_clinician'
        ? 'ثبت اولیه انجام شده؛ در انتظار تأیید نهایی دندانپزشک معالج.'
        : null,
  };
}

export function recordStructuredAllergyReviewCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  encounterId?: string | null;
  status: AllergyVerificationStatus;
  substanceAgent?: string | null;
  reactionDescription?: string | null;
  severity?: 'mild' | 'moderate' | 'life_threatening' | null;
  certainty?: 'unconfirmed' | 'suspected' | 'confirmed_by_clinician';
  sourceStatement?: string | null;
  reviewedBy: string;
  reviewerRole: string;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  review?: StructuredAllergyReview;
} {
  if (
    params.activeContextPatientId &&
    params.activeContextPatientId !== params.patientId
  ) {
    return {
      ok: false,
      errorCode: 'MINA_WRONG_PATIENT_CONTEXT',
      errorMessageFa: 'عدم تطابق پرونده بیمار فعال؛ ثبت بررسی حساسیت متوقف شد.',
    };
  }

  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist', 'secretary'].includes(params.reviewerRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_ALLERGY_REVIEW_UNAUTHORIZED',
      errorMessageFa: 'نقش فعلی مجوز ثبت بررسی حساسیت دارویی را ندارد.',
    };
  }

  if (
    params.certainty === 'confirmed_by_clinician' &&
    !['manager', 'dentist'].includes(params.reviewerRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_ALLERGY_CLINICIAN_CONFIRM_ONLY',
      errorMessageFa: 'تأیید نهایی بالینی حساسیت دارویی صرفاً توسط دندانپزشک یا مدیر بالینی مجاز است.',
    };
  }

  if (params.status === 'present' && !String(params.substanceAgent || '').trim()) {
    return {
      ok: false,
      errorCode: 'MINA_ALLERGY_AGENT_REQUIRED',
      errorMessageFa: 'در صورت وجود حساسیت، ثبت نام دارو یا ماده حساسیت‌زا الزامی است.',
    };
  }

  const review: StructuredAllergyReview = {
    id: `alg_v15_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patientId: params.patientId,
    encounterId: params.encounterId ?? null,
    status: params.status,
    substanceAgent: params.substanceAgent?.trim() || null,
    reactionDescription: params.reactionDescription?.trim() || null,
    severity: params.severity ?? null,
    certainty:
      params.certainty ??
      (['manager', 'dentist'].includes(params.reviewerRole)
        ? 'confirmed_by_clinician'
        : 'unconfirmed'),
    sourceStatement: params.sourceStatement?.trim() || null,
    reviewedBy: params.reviewedBy,
    reviewerRole: params.reviewerRole,
    reviewedAt: new Date().toISOString(),
    persistenceStatus: 'queued_offline_draft',
    serverId: null,
    serverTimestamp: null,
  };

  const current = getPatientAllergyReviews(params.patientId);
  savePatientAllergyReviews(params.patientId, [...current, review]);

  return { ok: true, review };
}

export async function persistStructuredAllergyReviewCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  tenantId?: string;
  branchId?: string;
  encounterId?: string | null;
  status: AllergyVerificationStatus;
  substanceAgent?: string | null;
  reactionDescription?: string | null;
  severity?: 'mild' | 'moderate' | 'life_threatening' | null;
  certainty?: 'unconfirmed' | 'suspected' | 'confirmed_by_clinician';
  sourceStatement?: string | null;
  reviewedBy: string;
  reviewerRole: string;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  review?: StructuredAllergyReview;
}> {
  const localRes = recordStructuredAllergyReviewCommand(params);
  if (!localRes.ok || !localRes.review) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localRes.errorCode,
      errorMessageFa: localRes.errorMessageFa,
    };
  }

  const db = params.supabaseClient || supabase;
  try {
    const query = db
      .from('patient_allergy_reviews')
      .insert({
        tenant_id: params.tenantId || 'minadental_clinic',
        branch_id: params.branchId || 'main',
        patient_id: params.patientId,
        encounter_id: params.encounterId ?? null,
        allergy_status: localRes.review.status,
        substance_agent: localRes.review.substanceAgent,
        reaction_description: localRes.review.reactionDescription,
        severity: localRes.review.severity,
        certainty: localRes.review.certainty,
        source_statement: localRes.review.sourceStatement,
        reviewer_role: params.reviewerRole,
      });
    const res = typeof query?.select === 'function' ? await query.select('*') : await query;
    const outcome = getMutationOutcome(res);
    if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
      // Roll back the unconfirmed local entry on authoritative rejection
      const existing = getPatientAllergyReviews(params.patientId).filter(
        (r) => r.id !== localRes.review!.id
      );
      savePatientAllergyReviews(params.patientId, existing);
      return {
        ok: false,
        persistenceStatus: 'rejected',
        errorCode: 'MINA_ALLERGY_SERVER_REJECTED',
        errorMessageFa: 'ثبت وضعیت حساسیت دارویی توسط سرور رد شد یا دسترسی عضویت منقضی است.',
      };
    }

    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const persistenceStatus: ClinicalPersistenceStatus =
      outcome === 'confirmed' ? 'persisted_server' : 'queued_offline_draft';
    const finalized: StructuredAllergyReview = {
      ...localRes.review,
      id: row?.id ? String(row.id) : localRes.review.id,
      persistenceStatus,
      serverId: row?.id ? String(row.id) : null,
      serverTimestamp: row?.reviewed_at ? String(row.reviewed_at) : null,
      reviewedAt: row?.reviewed_at ? String(row.reviewed_at) : localRes.review.reviewedAt,
    };
    const updatedList = getPatientAllergyReviews(params.patientId).map((r) =>
      r.id === localRes.review!.id ? finalized : r
    );
    savePatientAllergyReviews(params.patientId, updatedList);
    return { ok: true, persistenceStatus, review: finalized };
  } catch {
    return {
      ok: false,
      persistenceStatus: 'unknown',
      errorCode: 'MINA_ALLERGY_PERSIST_UNKNOWN',
      errorMessageFa: 'وضعیت تایید سرور برای حساسیت دارویی نامشخص است؛ پیش‌نویس محلی حفظ شد.',
      review: localRes.review,
    };
  }
}

// ── 2. Persisted Versioned Informed Consent Lifecycle (CL-03) ──
export type ConsentRecordStatus =
  | 'draft'
  | 'printed_unsigned'
  | 'signed'
  | 'withdrawn'
  | 'superseded_by_plan_change';

export type ConsentSignatureMethod =
  | 'none'
  | 'printed_paper_pending'
  | 'scanned_signed_attachment'
  | 'in_person_witnessed_electronic';

export interface ClinicalConsentRecord {
  id: string;
  patientId: string;
  encounterId: string | null;
  treatmentId: string | null;
  consentType: 'implant' | 'endo' | 'surgery' | 'prostho' | 'general';
  templateVersion: string;
  procedureScope: string;
  fdiTeethScope: string | null;
  risksDiscussed: boolean;
  alternativesDiscussed: boolean;
  status: ConsentRecordStatus;
  signatureMethod: ConsentSignatureMethod;
  signerFullName: string | null;
  signerRelationship: 'self' | 'legal_guardian';
  witnessFullName: string | null;
  attendingClinicianName: string | null;
  createdBy: string;
  createdRole: string;
  createdAt: string;
  signedAt: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  persistenceStatus?: ClinicalPersistenceStatus;
  serverId?: string | null;
}

const CONSENT_LEDGER = new Map<string, ClinicalConsentRecord[]>();
const CONSENT_INDEX_KEY = () => getBackendNamespaceKey('minadental_v15_consent_patients');
const consentPatientKey = (patientId: string) =>
  getBackendNamespaceKey(`minadental_v15_consent_${patientId}`);

export function getPatientConsentRecords(patientId: string): ClinicalConsentRecord[] {
  const mem = CONSENT_LEDGER.get(patientId);
  if (mem) return [...mem];
  const stored = readNamespacedArray<ClinicalConsentRecord>(consentPatientKey(patientId));
  if (stored) {
    CONSENT_LEDGER.set(patientId, stored);
    return [...stored];
  }
  return [];
}

function savePatientConsentRecords(patientId: string, list: ClinicalConsentRecord[]): void {
  CONSENT_LEDGER.set(patientId, [...list]);
  writeNamespacedArray(consentPatientKey(patientId), list);
  trackPatientIndex(CONSENT_INDEX_KEY, patientId);
}

export function recordPrintedUnsignedConsentCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  consentType: 'implant' | 'endo' | 'surgery' | 'prostho' | 'general';
  procedureScope: string;
  fdiTeethScope?: string | null;
  actorName: string;
  actorRole: string;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
} {
  if (
    params.activeContextPatientId &&
    params.activeContextPatientId !== params.patientId
  ) {
    return {
      ok: false,
      errorCode: 'MINA_WRONG_PATIENT_CONTEXT',
      errorMessageFa: 'عدم تطابق بیمار فعال؛ ثبت چاپ رضایت‌نامه متوقف شد.',
    };
  }

  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist', 'secretary'].includes(params.actorRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_UNAUTHORIZED',
      errorMessageFa: 'نقش فعلی مجوز صدور برگه رضایت‌نامه را ندارد.',
    };
  }

  const record: ClinicalConsentRecord = {
    id: `cns_v15_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patientId: params.patientId,
    encounterId: null,
    treatmentId: null,
    consentType: params.consentType,
    templateVersion: 'v15.1-fa',
    procedureScope: params.procedureScope.trim(),
    fdiTeethScope: params.fdiTeethScope?.trim() || null,
    risksDiscussed: false,
    alternativesDiscussed: false,
    status: 'printed_unsigned',
    signatureMethod: 'printed_paper_pending',
    signerFullName: null,
    signerRelationship: 'self',
    witnessFullName: null,
    attendingClinicianName: null,
    createdBy: params.actorName,
    createdRole: params.actorRole,
    createdAt: new Date().toISOString(),
    signedAt: null,
    withdrawnAt: null,
    withdrawalReason: null,
    persistenceStatus: 'queued_offline_draft',
    serverId: null,
  };

  const list = getPatientConsentRecords(params.patientId);
  savePatientConsentRecords(params.patientId, [...list, record]);
  return { ok: true, record };
}

export function signPatientConsentCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  consentType: 'implant' | 'endo' | 'surgery' | 'prostho' | 'general';
  procedureScope: string;
  fdiTeethScope?: string | null;
  risksDiscussed: boolean;
  alternativesDiscussed: boolean;
  signatureMethod: ConsentSignatureMethod;
  signerFullName: string;
  signerRelationship?: 'self' | 'legal_guardian';
  witnessFullName?: string | null;
  attendingClinicianName: string;
  actorName: string;
  actorRole: string;
  isOffline?: boolean;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
} {
  if (
    params.activeContextPatientId &&
    params.activeContextPatientId !== params.patientId
  ) {
    return {
      ok: false,
      errorCode: 'MINA_WRONG_PATIENT_CONTEXT',
      errorMessageFa: 'عدم تطابق پرونده بیمار فعال؛ ثبت رضایت‌نامه متوقف شد.',
    };
  }

  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist'].includes(params.actorRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_SIGN_FORBIDDEN',
      errorMessageFa: 'ثبت نهایی رضایت‌نامه امضاشده صرفاً توسط دندانپزشک معالج یا مدیر بالینی مجاز است.',
    };
  }

  const offline =
    params.isOffline ?? (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (offline) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_ONLINE_REQUIRED',
      errorMessageFa: 'تأیید نهایی رضایت‌نامه امضاشده نیازمند ارتباط آنلاین با سرور است (در حالت آفلاین فقط ذخیره پیش‌نویس مجاز است).',
    };
  }

  if (
    params.signatureMethod === 'none' ||
    params.signatureMethod === 'printed_paper_pending'
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_UNSIGNED_METHOD',
      errorMessageFa: 'صرفاً چاپ کاغذی بدون ثبت مستند امضاشده یا امضای حضوری با شاهد، به‌عنوان رضایت‌نامه امضاشده پذیرفته نمی‌شود.',
    };
  }

  if (!params.risksDiscussed || !params.alternativesDiscussed) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_DISCLOSURE_INCOMPLETE',
      errorMessageFa: 'تأیید توضیح کامل عوارض احتمالی و درمان‌های جایگزین به بیمار الزامی است.',
    };
  }

  if (!String(params.signerFullName || '').trim() || !String(params.attendingClinicianName || '').trim()) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_SIGNER_REQUIRED',
      errorMessageFa: 'نام کامل امضاکننده (بیمار/ولی قانونی) و دندانپزشک معالج الزامی است.',
    };
  }

  const nowIso = new Date().toISOString();
  const record: ClinicalConsentRecord = {
    id: `cns_v15_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patientId: params.patientId,
    encounterId: null,
    treatmentId: null,
    consentType: params.consentType,
    templateVersion: 'v15.1-fa',
    procedureScope: params.procedureScope.trim(),
    fdiTeethScope: params.fdiTeethScope?.trim() || null,
    risksDiscussed: true,
    alternativesDiscussed: true,
    status: 'signed',
    signatureMethod: params.signatureMethod,
    signerFullName: params.signerFullName.trim(),
    signerRelationship: params.signerRelationship ?? 'self',
    witnessFullName: params.witnessFullName?.trim() || null,
    attendingClinicianName: params.attendingClinicianName.trim(),
    createdBy: params.actorName,
    createdRole: params.actorRole,
    createdAt: nowIso,
    signedAt: nowIso,
    withdrawnAt: null,
    withdrawalReason: null,
    persistenceStatus: 'queued_offline_draft',
    serverId: null,
  };

  const list = getPatientConsentRecords(params.patientId);
  savePatientConsentRecords(params.patientId, [...list, record]);
  return { ok: true, record };
}

/**
 * Authoritative async consent signing: refuses offline or zero-row confirmation and
 * promotes `persistenceStatus: 'persisted_server'` ONLY on verified PostgreSQL write.
 */
export async function persistSignedPatientConsentCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  tenantId?: string;
  branchId?: string;
  encounterId?: string | null;
  treatmentId?: string | null;
  consentType: 'implant' | 'endo' | 'surgery' | 'prostho' | 'general';
  procedureScope: string;
  fdiTeethScope?: string | null;
  risksDiscussed: boolean;
  alternativesDiscussed: boolean;
  signatureMethod: ConsentSignatureMethod;
  signerFullName: string;
  signerRelationship?: 'self' | 'legal_guardian';
  witnessFullName?: string | null;
  attendingClinicianName: string;
  actorName: string;
  actorRole: string;
  isOffline?: boolean;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
}> {
  const localCheck = signPatientConsentCommand(params);
  if (!localCheck.ok || !localCheck.record) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localCheck.errorCode,
      errorMessageFa: localCheck.errorMessageFa,
    };
  }

  const db = params.supabaseClient || supabase;
  try {
    const query = db.from('patient_consents').insert({
      tenant_id: params.tenantId || 'minadental_clinic',
      branch_id: params.branchId || 'main',
      patient_id: params.patientId,
      encounter_id: params.encounterId ?? null,
      treatment_id: params.treatmentId ?? null,
      consent_type: localCheck.record.consentType,
      template_version: localCheck.record.templateVersion,
      procedure_scope: localCheck.record.procedureScope,
      fdi_teeth_scope: localCheck.record.fdiTeethScope,
      risks_discussed: true,
      alternatives_discussed: true,
      consent_status: 'signed',
      signature_method: localCheck.record.signatureMethod,
      signer_full_name: localCheck.record.signerFullName,
      signer_relationship: localCheck.record.signerRelationship,
      witness_full_name: localCheck.record.witnessFullName,
    });
    const res = typeof query?.select === 'function' ? await query.select('*') : await query;
    const outcome = getMutationOutcome(res);
    if (outcome !== 'confirmed' || hasZeroAffectedRows(res)) {
      // Signed consent MUST NOT remain persisted locally as 'signed' if server did not confirm!
      const rollbackList = getPatientConsentRecords(params.patientId).filter(
        (c) => c.id !== localCheck.record!.id
      );
      savePatientConsentRecords(params.patientId, rollbackList);
      return {
        ok: false,
        persistenceStatus: outcome === 'queued_offline' ? 'rejected' : 'rejected',
        errorCode:
          outcome === 'queued_offline'
            ? 'MINA_CONSENT_ONLINE_REQUIRED'
            : 'MINA_CONSENT_SERVER_REJECTED',
        errorMessageFa:
          outcome === 'queued_offline'
            ? 'امضای رضایت‌نامه بدون تأیید آنلاین سرور مجاز نیست.'
            : 'ثبت رضایت‌نامه توسط سرور تایید نشد (عدم دسترسی یا خطای پایگاه داده).',
      };
    }

    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const confirmedRecord: ClinicalConsentRecord = {
      ...localCheck.record,
      id: row?.id ? String(row.id) : localCheck.record.id,
      signedAt: row?.signed_at ? String(row.signed_at) : localCheck.record.signedAt,
      persistenceStatus: 'persisted_server',
      serverId: row?.id ? String(row.id) : null,
    };
    const nextList = getPatientConsentRecords(params.patientId).map((c) =>
      c.id === localCheck.record!.id ? confirmedRecord : c
    );
    savePatientConsentRecords(params.patientId, nextList);
    return { ok: true, persistenceStatus: 'persisted_server', record: confirmedRecord };
  } catch {
    const rollbackList = getPatientConsentRecords(params.patientId).filter(
      (c) => c.id !== localCheck.record!.id
    );
    savePatientConsentRecords(params.patientId, rollbackList);
    return {
      ok: false,
      persistenceStatus: 'unknown',
      errorCode: 'MINA_CONSENT_PERSIST_UNKNOWN',
      errorMessageFa: 'پاسخ قطعی سرور برای امضای رضایت‌نامه دریافت نشد؛ امضا نهایی نشد.',
    };
  }
}

export async function persistPrintedUnsignedConsentCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  tenantId?: string;
  branchId?: string;
  consentType: 'implant' | 'endo' | 'surgery' | 'prostho' | 'general';
  procedureScope: string;
  fdiTeethScope?: string | null;
  actorName: string;
  actorRole: string;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
}> {
  const localRes = recordPrintedUnsignedConsentCommand(params);
  if (!localRes.ok || !localRes.record) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localRes.errorCode,
      errorMessageFa: localRes.errorMessageFa,
    };
  }
  const db = params.supabaseClient || supabase;
  try {
    const query = db.from('patient_consents').insert({
      tenant_id: params.tenantId || 'minadental_clinic',
      branch_id: params.branchId || 'main',
      patient_id: params.patientId,
      consent_type: localRes.record.consentType,
      template_version: localRes.record.templateVersion,
      procedure_scope: localRes.record.procedureScope,
      fdi_teeth_scope: localRes.record.fdiTeethScope,
      risks_discussed: false,
      alternatives_discussed: false,
      consent_status: 'printed_unsigned',
      signature_method: 'printed_paper_pending',
    });
    const res = typeof query?.select === 'function' ? await query.select('*') : await query;
    const outcome = getMutationOutcome(res);
    if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
      return {
        ok: true,
        persistenceStatus: 'queued_offline_draft',
        record: localRes.record,
      };
    }
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const persisted: ClinicalConsentRecord = {
      ...localRes.record,
      id: row?.id ? String(row.id) : localRes.record.id,
      persistenceStatus: outcome === 'confirmed' ? 'persisted_server' : 'queued_offline_draft',
      serverId: row?.id ? String(row.id) : null,
    };
    const nextList = getPatientConsentRecords(params.patientId).map((c) =>
      c.id === localRes.record!.id ? persisted : c
    );
    savePatientConsentRecords(params.patientId, nextList);
    return {
      ok: true,
      persistenceStatus: persisted.persistenceStatus ?? 'queued_offline_draft',
      record: persisted,
    };
  } catch {
    return { ok: true, persistenceStatus: 'queued_offline_draft', record: localRes.record };
  }
}

export function attemptInPlaceConsentEditCommand(params: {
  patientId: string;
  consentId: string;
  newProcedureScope: string;
}): { ok: boolean; errorCode: string; errorMessageFa: string } {
  const list = getPatientConsentRecords(params.patientId);
  const target = list.find((c) => c.id === params.consentId);
  if (target && target.status === 'signed') {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_LOCKED_IMMUTABLE',
      errorMessageFa: 'رضایت‌نامه امضاشده قابل ویرایش درجا نیست؛ در صورت تغییر طرح درمان، رضایت‌نامه جدید صادر شود.',
    };
  }
  return {
    ok: false,
    errorCode: 'MINA_CONSENT_NOT_FOUND',
    errorMessageFa: 'رکورد رضایت‌نامه یافت نشد.',
  };
}

export function withdrawPatientConsentCommand(params: {
  patientId: string;
  consentId: string;
  reason: string;
  actorRole: string;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
} {
  if (!['manager', 'dentist'].includes(params.actorRole)) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_WITHDRAW_UNAUTHORIZED',
      errorMessageFa: 'ثبت لغو رضایت‌نامه صرفاً با دسترسی دندانپزشک یا مدیر بالینی مجاز است.',
    };
  }
  if (!String(params.reason || '').trim()) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_WITHDRAW_REASON_REQUIRED',
      errorMessageFa: 'ثبت علت لغو یا ابطال رضایت‌نامه الزامی است.',
    };
  }

  const list = getPatientConsentRecords(params.patientId);
  const idx = list.findIndex((c) => c.id === params.consentId);
  if (idx < 0) {
    return {
      ok: false,
      errorCode: 'MINA_CONSENT_NOT_FOUND',
      errorMessageFa: 'رضایت‌نامه مورد نظر یافت نشد.',
    };
  }

  const updated: ClinicalConsentRecord = {
    ...list[idx],
    status: 'withdrawn',
    withdrawnAt: new Date().toISOString(),
    withdrawalReason: params.reason.trim(),
  };
  const next = [...list];
  next[idx] = updated;
  savePatientConsentRecords(params.patientId, next);
  return { ok: true, record: updated };
}

export async function persistWithdrawPatientConsentCommand(params: {
  patientId: string;
  consentId: string;
  reason: string;
  actorRole: string;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  record?: ClinicalConsentRecord;
}> {
  const localRes = withdrawPatientConsentCommand(params);
  if (!localRes.ok || !localRes.record) return localRes;

  const db = params.supabaseClient || supabase;
  if (localRes.record.serverId) {
    try {
      const q = db
        .from('patient_consents')
        .update({
          consent_status: 'withdrawn',
          withdrawn_at: localRes.record.withdrawnAt,
          withdrawal_reason: localRes.record.withdrawalReason,
        })
        .eq('id', localRes.record.serverId);
      await (typeof q?.select === 'function' ? q.select('*') : q);
    } catch {
      // keep local audit status; will reconcile on sync
    }
  }
  return localRes;
}

export function invalidateConsentOnPlanChangeCommand(params: {
  patientId: string;
  consentId: string;
  planChangeReason: string;
}): {
  ok: boolean;
  record?: ClinicalConsentRecord;
} {
  const list = getPatientConsentRecords(params.patientId);
  const idx = list.findIndex((c) => c.id === params.consentId);
  if (idx < 0) return { ok: false };

  const updated: ClinicalConsentRecord = {
    ...list[idx],
    status: 'superseded_by_plan_change',
    withdrawalReason: params.planChangeReason.trim() || 'تغییر طرح درمان و نیاز به اخذ مجدد رضایت‌نامه',
  };
  const next = [...list];
  next[idx] = updated;
  savePatientConsentRecords(params.patientId, next);
  return { ok: true, record: updated };
}

// ── 3. Clinical Notes Lifecycle: Draft -> Signed -> Amended ──
export interface ClinicalNoteRecord {
  id: string;
  patientId: string;
  encounterId: string | null;
  status: 'draft' | 'signed' | 'amended';
  assessmentDiagnosis: string;
  procedureNarrative: string;
  fdiTeethScope: string | null;
  version: number;
  parentNoteId: string | null;
  amendmentReason: string | null;
  authoredBy: string;
  authoredRole: string;
  signedBy: string | null;
  signerRole: string | null;
  createdAt: string;
  signedAt: string | null;
  persistenceStatus?: ClinicalPersistenceStatus;
  serverId?: string | null;
}

const CLINICAL_NOTES_LEDGER = new Map<string, ClinicalNoteRecord[]>();
const NOTES_INDEX_KEY = () => getBackendNamespaceKey('minadental_v15_notes_patients');
const notesPatientKey = (patientId: string) =>
  getBackendNamespaceKey(`minadental_v15_notes_${patientId}`);

export function getPatientClinicalNotes(patientId: string): ClinicalNoteRecord[] {
  const mem = CLINICAL_NOTES_LEDGER.get(patientId);
  if (mem) return [...mem];
  const stored = readNamespacedArray<ClinicalNoteRecord>(notesPatientKey(patientId));
  if (stored) {
    CLINICAL_NOTES_LEDGER.set(patientId, stored);
    return [...stored];
  }
  return [];
}

function savePatientClinicalNotes(patientId: string, notes: ClinicalNoteRecord[]): void {
  CLINICAL_NOTES_LEDGER.set(patientId, [...notes]);
  writeNamespacedArray(notesPatientKey(patientId), notes);
  trackPatientIndex(NOTES_INDEX_KEY, patientId);
}

export function createClinicalNoteDraftCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  encounterId?: string | null;
  assessmentDiagnosis: string;
  procedureNarrative: string;
  fdiTeethScope?: string | null;
  authoredBy: string;
  authoredRole: string;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  note?: ClinicalNoteRecord;
} {
  if (
    params.activeContextPatientId &&
    params.activeContextPatientId !== params.patientId
  ) {
    return {
      ok: false,
      errorCode: 'MINA_WRONG_PATIENT_CONTEXT',
      errorMessageFa: 'عدم تطابق بیمار فعال؛ ثبت یادداشت بالینی متوقف شد.',
    };
  }

  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist', 'assistant'].includes(params.authoredRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_UNAUTHORIZED',
      errorMessageFa: 'نقش فعلی مجوز ثبت پیش‌نویس یادداشت بالینی را ندارد.',
    };
  }

  if (!String(params.assessmentDiagnosis || '').trim()) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_EMPTY_DIAGNOSIS',
      errorMessageFa: 'ثبت تشخیص یا ارزیابی بالینی الزامی است.',
    };
  }

  const note: ClinicalNoteRecord = {
    id: `note_v15_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patientId: params.patientId,
    encounterId: params.encounterId ?? null,
    status: 'draft',
    assessmentDiagnosis: params.assessmentDiagnosis.trim(),
    procedureNarrative: params.procedureNarrative.trim(),
    fdiTeethScope: params.fdiTeethScope?.trim() || null,
    version: 1,
    parentNoteId: null,
    amendmentReason: null,
    authoredBy: params.authoredBy,
    authoredRole: params.authoredRole,
    signedBy: null,
    signerRole: null,
    createdAt: new Date().toISOString(),
    signedAt: null,
    persistenceStatus: 'queued_offline_draft',
    serverId: null,
  };

  const list = getPatientClinicalNotes(params.patientId);
  savePatientClinicalNotes(params.patientId, [...list, note]);
  return { ok: true, note };
}

export async function persistClinicalNoteDraftCommand(params: {
  patientId: string;
  activeContextPatientId?: string;
  tenantId?: string;
  branchId?: string;
  encounterId?: string | null;
  assessmentDiagnosis: string;
  procedureNarrative: string;
  fdiTeethScope?: string | null;
  authoredBy: string;
  authoredRole: string;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  note?: ClinicalNoteRecord;
}> {
  const localRes = createClinicalNoteDraftCommand(params);
  if (!localRes.ok || !localRes.note) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localRes.errorCode,
      errorMessageFa: localRes.errorMessageFa,
    };
  }

  const db = params.supabaseClient || supabase;
  try {
    const q = db.from('clinical_notes').insert({
      tenant_id: params.tenantId || 'minadental_clinic',
      branch_id: params.branchId || 'main',
      patient_id: params.patientId,
      encounter_id: params.encounterId ?? null,
      note_status: 'draft',
      assessment_diagnosis: localRes.note.assessmentDiagnosis,
      procedure_narrative: localRes.note.procedureNarrative,
      fdi_teeth_scope: localRes.note.fdiTeethScope,
      version: 1,
    });
    const res = typeof q?.select === 'function' ? await q.select('*') : await q;
    const outcome = getMutationOutcome(res);
    if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
      return {
        ok: true,
        persistenceStatus: 'queued_offline_draft',
        note: localRes.note,
      };
    }
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const persisted: ClinicalNoteRecord = {
      ...localRes.note,
      id: row?.id ? String(row.id) : localRes.note.id,
      persistenceStatus: outcome === 'confirmed' ? 'persisted_server' : 'queued_offline_draft',
      serverId: row?.id ? String(row.id) : null,
    };
    const next = getPatientClinicalNotes(params.patientId).map((n) =>
      n.id === localRes.note!.id ? persisted : n
    );
    savePatientClinicalNotes(params.patientId, next);
    return {
      ok: true,
      persistenceStatus: persisted.persistenceStatus ?? 'queued_offline_draft',
      note: persisted,
    };
  } catch {
    return { ok: true, persistenceStatus: 'queued_offline_draft', note: localRes.note };
  }
}

export function signClinicalNoteCommand(params: {
  patientId: string;
  noteId: string;
  signerName: string;
  signerRole: string;
  isOffline?: boolean;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  note?: ClinicalNoteRecord;
} {
  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist'].includes(params.signerRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_SIGN_FORBIDDEN',
      errorMessageFa: 'امضا و نهایی‌سازی یادداشت بالینی و تشخیص صرفاً توسط دندانپزشک یا مدیر بالینی مجاز است.',
    };
  }

  const offline =
    params.isOffline ?? (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (offline) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_SIGN_ONLINE_REQUIRED',
      errorMessageFa: 'امضای نهایی یادداشت بالینی در حالت آفلاین مجاز نیست و نیازمند تأیید آنلاین سرور است.',
    };
  }

  const list = getPatientClinicalNotes(params.patientId);
  const idx = list.findIndex((n) => n.id === params.noteId);
  if (idx < 0) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_NOT_FOUND',
      errorMessageFa: 'پیش‌نویس یادداشت بالینی یافت نشد.',
    };
  }

  if (list[idx].status !== 'draft') {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_ALREADY_FINALIZED',
      errorMessageFa: 'این یادداشت بالینی قبلاً امضا و قفل شده است.',
    };
  }

  const signed: ClinicalNoteRecord = {
    ...list[idx],
    status: 'signed',
    signedBy: params.signerName,
    signerRole: params.signerRole,
    signedAt: new Date().toISOString(),
  };
  const next = [...list];
  next[idx] = signed;
  savePatientClinicalNotes(params.patientId, next);
  return { ok: true, note: signed };
}

export async function persistSignClinicalNoteCommand(params: {
  patientId: string;
  noteId: string;
  tenantId?: string;
  branchId?: string;
  signerName: string;
  signerRole: string;
  isOffline?: boolean;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  note?: ClinicalNoteRecord;
}> {
  const prevList = getPatientClinicalNotes(params.patientId);
  const prevNote = prevList.find((n) => n.id === params.noteId);
  const localRes = signClinicalNoteCommand(params);
  if (!localRes.ok || !localRes.note) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localRes.errorCode,
      errorMessageFa: localRes.errorMessageFa,
    };
  }

  const db = params.supabaseClient || supabase;
  try {
    const query = localRes.note.serverId
      ? db
          .from('clinical_notes')
          .update({
            note_status: 'signed',
            signer_role: params.signerRole,
            signed_at: localRes.note.signedAt,
          })
          .eq('id', localRes.note.serverId)
      : db.from('clinical_notes').insert({
          tenant_id: params.tenantId || 'minadental_clinic',
          branch_id: params.branchId || 'main',
          patient_id: params.patientId,
          encounter_id: localRes.note.encounterId,
          note_status: 'signed',
          assessment_diagnosis: localRes.note.assessmentDiagnosis,
          procedure_narrative: localRes.note.procedureNarrative,
          fdi_teeth_scope: localRes.note.fdiTeethScope,
          version: localRes.note.version,
          signer_role: params.signerRole,
          signed_at: localRes.note.signedAt,
        });
    const res = typeof query?.select === 'function' ? await query.select('*') : await query;
    const outcome = getMutationOutcome(res);
    if (outcome !== 'confirmed' || hasZeroAffectedRows(res)) {
      if (prevNote) {
        savePatientClinicalNotes(
          params.patientId,
          getPatientClinicalNotes(params.patientId).map((n) =>
            n.id === params.noteId ? prevNote : n
          )
        );
      }
      return {
        ok: false,
        persistenceStatus: 'rejected',
        errorCode:
          outcome === 'queued_offline'
            ? 'MINA_CLINICAL_SIGN_ONLINE_REQUIRED'
            : 'MINA_CLINICAL_SIGN_SERVER_REJECTED',
        errorMessageFa: 'امضای یادداشت بالینی بدون تأیید آنلاین سرور انجام نمی‌شود.',
      };
    }
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const confirmed: ClinicalNoteRecord = {
      ...localRes.note,
      id: row?.id ? String(row.id) : localRes.note.id,
      persistenceStatus: 'persisted_server',
      serverId: row?.id ? String(row.id) : localRes.note.serverId ?? null,
    };
    savePatientClinicalNotes(
      params.patientId,
      getPatientClinicalNotes(params.patientId).map((n) =>
        n.id === params.noteId ? confirmed : n
      )
    );
    return { ok: true, persistenceStatus: 'persisted_server', note: confirmed };
  } catch {
    if (prevNote) {
      savePatientClinicalNotes(
        params.patientId,
        getPatientClinicalNotes(params.patientId).map((n) =>
          n.id === params.noteId ? prevNote : n
        )
      );
    }
    return {
      ok: false,
      persistenceStatus: 'unknown',
      errorCode: 'MINA_CLINICAL_SIGN_UNKNOWN',
      errorMessageFa: 'پاسخ سرور برای امضای یادداشت بالینی نامشخص است؛ پیش‌نویس بدون امضا باقی ماند.',
    };
  }
}

export function amendSignedClinicalNoteCommand(params: {
  patientId: string;
  parentNoteId: string;
  amendedDiagnosis: string;
  amendedNarrative: string;
  amendmentReason: string;
  signerName: string;
  signerRole: string;
  isOffline?: boolean;
}): {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  originalNote?: ClinicalNoteRecord;
  amendmentNote?: ClinicalNoteRecord;
} {
  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !['manager', 'dentist'].includes(params.signerRole)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_SIGN_FORBIDDEN',
      errorMessageFa: 'ثبت اصلاحیه (Addendum) روی یادداشت امضاشده صرفاً توسط دندانپزشک مجاز است.',
    };
  }

  const offline =
    params.isOffline ?? (typeof navigator !== 'undefined' && navigator.onLine === false);
  if (offline) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_SIGN_ONLINE_REQUIRED',
      errorMessageFa: 'ثبت اصلاحیه روی یادداشت امضاشده نیازمند ارتباط آنلاین با سرور است.',
    };
  }

  if (!String(params.amendmentReason || '').trim()) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_AMEND_REASON_REQUIRED',
      errorMessageFa: 'درج علت اصلاحیه بالینی (Amendment Reason) الزامی است.',
    };
  }

  const list = getPatientClinicalNotes(params.patientId);
  const parent = list.find((n) => n.id === params.parentNoteId);
  if (!parent) {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_NOT_FOUND',
      errorMessageFa: 'یادداشت بالینی اصلی یافت نشد.',
    };
  }

  if (parent.status === 'draft') {
    return {
      ok: false,
      errorCode: 'MINA_CLINICAL_NOTE_NOT_SIGNED',
      errorMessageFa: 'یادداشت پیش‌نویس هنوز امضا نشده است؛ ابتدا آن را امضا یا ویرایش کنید.',
    };
  }

  const nowIso = new Date().toISOString();
  const amendmentNote: ClinicalNoteRecord = {
    id: `note_v15_amd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    patientId: params.patientId,
    encounterId: parent.encounterId,
    status: 'amended',
    assessmentDiagnosis: params.amendedDiagnosis.trim(),
    procedureNarrative: params.amendedNarrative.trim(),
    fdiTeethScope: parent.fdiTeethScope,
    version: parent.version + 1,
    parentNoteId: parent.id,
    amendmentReason: params.amendmentReason.trim(),
    authoredBy: params.signerName,
    authoredRole: params.signerRole,
    signedBy: params.signerName,
    signerRole: params.signerRole,
    createdAt: nowIso,
    signedAt: nowIso,
    persistenceStatus: 'queued_offline_draft',
    serverId: null,
  };

  savePatientClinicalNotes(params.patientId, [...list, amendmentNote]);
  return {
    ok: true,
    originalNote: parent,
    amendmentNote,
  };
}

export async function persistAmendClinicalNoteCommand(params: {
  patientId: string;
  parentNoteId: string;
  tenantId?: string;
  branchId?: string;
  amendedDiagnosis: string;
  amendedNarrative: string;
  amendmentReason: string;
  signerName: string;
  signerRole: string;
  isOffline?: boolean;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  persistenceStatus: ClinicalPersistenceStatus;
  errorCode?: string;
  errorMessageFa?: string;
  originalNote?: ClinicalNoteRecord;
  amendmentNote?: ClinicalNoteRecord;
}> {
  const localRes = amendSignedClinicalNoteCommand(params);
  if (!localRes.ok || !localRes.amendmentNote) {
    return {
      ok: false,
      persistenceStatus: 'rejected',
      errorCode: localRes.errorCode,
      errorMessageFa: localRes.errorMessageFa,
    };
  }
  const db = params.supabaseClient || supabase;
  try {
    const q = db.from('clinical_notes').insert({
      tenant_id: params.tenantId || 'minadental_clinic',
      branch_id: params.branchId || 'main',
      patient_id: params.patientId,
      encounter_id: localRes.amendmentNote.encounterId,
      note_status: 'amended',
      assessment_diagnosis: localRes.amendmentNote.assessmentDiagnosis,
      procedure_narrative: localRes.amendmentNote.procedureNarrative,
      fdi_teeth_scope: localRes.amendmentNote.fdiTeethScope,
      version: localRes.amendmentNote.version,
      parent_note_id: localRes.originalNote?.serverId ?? null,
      amendment_reason: localRes.amendmentNote.amendmentReason,
      signer_role: params.signerRole,
      signed_at: localRes.amendmentNote.signedAt,
    });
    const res = typeof q?.select === 'function' ? await q.select('*') : await q;
    const outcome = getMutationOutcome(res);
    if (outcome !== 'confirmed' || hasZeroAffectedRows(res)) {
      savePatientClinicalNotes(
        params.patientId,
        getPatientClinicalNotes(params.patientId).filter((n) => n.id !== localRes.amendmentNote!.id)
      );
      return {
        ok: false,
        persistenceStatus: 'rejected',
        errorCode: 'MINA_CLINICAL_AMEND_SERVER_REJECTED',
        errorMessageFa: 'ثبت اصلاحیه بالینی توسط سرور تایید نشد.',
      };
    }
    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const confirmed: ClinicalNoteRecord = {
      ...localRes.amendmentNote,
      id: row?.id ? String(row.id) : localRes.amendmentNote.id,
      persistenceStatus: 'persisted_server',
      serverId: row?.id ? String(row.id) : null,
    };
    savePatientClinicalNotes(
      params.patientId,
      getPatientClinicalNotes(params.patientId).map((n) =>
        n.id === localRes.amendmentNote!.id ? confirmed : n
      )
    );
    return {
      ok: true,
      persistenceStatus: 'persisted_server',
      originalNote: localRes.originalNote,
      amendmentNote: confirmed,
    };
  } catch {
    savePatientClinicalNotes(
      params.patientId,
      getPatientClinicalNotes(params.patientId).filter((n) => n.id !== localRes.amendmentNote!.id)
    );
    return {
      ok: false,
      persistenceStatus: 'unknown',
      errorCode: 'MINA_CLINICAL_AMEND_UNKNOWN',
      errorMessageFa: 'وضعیت تایید سرور برای اصلاحیه نامشخص است.',
    };
  }
}

/**
 * Hydrates structured allergy reviews, consents, and clinical notes for a patient from PostgreSQL
 * while preserving unconfirmed local drafts.
 */
export async function hydratePatientClinicalRecordFromServer(
  patientId: string,
  options?: { supabaseClient?: any }
): Promise<{
  hydrated: boolean;
  allergiesCount: number;
  consentsCount: number;
  notesCount: number;
}> {
  const db = options?.supabaseClient || supabase;
  let allergiesCount = 0;
  let consentsCount = 0;
  let notesCount = 0;

  try {
    const [algRes, cnsRes, notesRes] = await Promise.all([
      db.from('patient_allergy_reviews').select('*').eq('patient_id', patientId),
      db.from('patient_consents').select('*').eq('patient_id', patientId),
      db.from('clinical_notes').select('*').eq('patient_id', patientId),
    ]);

    if (Array.isArray(algRes?.data)) {
      const serverReviews: StructuredAllergyReview[] = algRes.data.map((r: any) => ({
        id: String(r.id),
        patientId,
        encounterId: r.encounter_id ?? null,
        status: r.allergy_status,
        substanceAgent: r.substance_agent ?? null,
        reactionDescription: r.reaction_description ?? null,
        severity: r.severity ?? null,
        certainty: r.certainty ?? 'unconfirmed',
        sourceStatement: r.source_statement ?? null,
        reviewedBy: String(r.reviewed_by || 'کادر درمان'),
        reviewerRole: String(r.reviewer_role || 'dentist'),
        reviewedAt: String(r.reviewed_at || new Date().toISOString()),
        persistenceStatus: 'persisted_server',
        serverId: String(r.id),
        serverTimestamp: String(r.reviewed_at || ''),
      }));
      const localDrafts = getPatientAllergyReviews(patientId).filter(
        (l) => !l.serverId && !serverReviews.some((s) => s.id === l.id)
      );
      const merged = [...serverReviews, ...localDrafts];
      savePatientAllergyReviews(patientId, merged);
      allergiesCount = merged.length;
    }

    if (Array.isArray(cnsRes?.data)) {
      const serverConsents: ClinicalConsentRecord[] = cnsRes.data.map((r: any) => ({
        id: String(r.id),
        patientId,
        encounterId: r.encounter_id ?? null,
        treatmentId: r.treatment_id ?? null,
        consentType: r.consent_type ?? 'general',
        templateVersion: r.template_version ?? 'v15.1-fa',
        procedureScope: String(r.procedure_scope || ''),
        fdiTeethScope: r.fdi_teeth_scope ?? null,
        risksDiscussed: Boolean(r.risks_discussed),
        alternativesDiscussed: Boolean(r.alternatives_discussed),
        status: r.consent_status ?? 'draft',
        signatureMethod: r.signature_method ?? 'none',
        signerFullName: r.signer_full_name ?? null,
        signerRelationship: r.signer_relationship ?? 'self',
        witnessFullName: r.witness_full_name ?? null,
        attendingClinicianName: null,
        createdBy: String(r.created_by || 'پزشک'),
        createdRole: 'dentist',
        createdAt: String(r.created_at || new Date().toISOString()),
        signedAt: r.signed_at ?? null,
        withdrawnAt: r.withdrawn_at ?? null,
        withdrawalReason: r.withdrawal_reason ?? null,
        persistenceStatus: 'persisted_server',
        serverId: String(r.id),
      }));
      const localDrafts = getPatientConsentRecords(patientId).filter(
        (l) => !l.serverId && !serverConsents.some((s) => s.id === l.id)
      );
      const merged = [...serverConsents, ...localDrafts];
      savePatientConsentRecords(patientId, merged);
      consentsCount = merged.length;
    }

    if (Array.isArray(notesRes?.data)) {
      const serverNotes: ClinicalNoteRecord[] = notesRes.data.map((r: any) => ({
        id: String(r.id),
        patientId,
        encounterId: r.encounter_id ?? null,
        status: r.note_status ?? 'draft',
        assessmentDiagnosis: String(r.assessment_diagnosis || ''),
        procedureNarrative: String(r.procedure_narrative || ''),
        fdiTeethScope: r.fdi_teeth_scope ?? null,
        version: Number(r.version || 1),
        parentNoteId: r.parent_note_id ?? null,
        amendmentReason: r.amendment_reason ?? null,
        authoredBy: String(r.authored_by || 'کادر درمان'),
        authoredRole: 'dentist',
        signedBy: r.signed_by ? String(r.signed_by) : null,
        signerRole: r.signer_role ?? null,
        createdAt: String(r.created_at || new Date().toISOString()),
        signedAt: r.signed_at ?? null,
        persistenceStatus: 'persisted_server',
        serverId: String(r.id),
      }));
      const localDrafts = getPatientClinicalNotes(patientId).filter(
        (l) => !l.serverId && !serverNotes.some((s) => s.id === l.id)
      );
      const merged = [...serverNotes, ...localDrafts];
      savePatientClinicalNotes(patientId, merged);
      notesCount = merged.length;
    }

    return { hydrated: true, allergiesCount, consentsCount, notesCount };
  } catch {
    return {
      hydrated: false,
      allergiesCount: getPatientAllergyReviews(patientId).length,
      consentsCount: getPatientConsentRecords(patientId).length,
      notesCount: getPatientClinicalNotes(patientId).length,
    };
  }
}

// ── 4. Governed Patient Archival & Retention Protection (CL-05) ──
export async function archiveOrDeletePatientCommand(params: {
  actorRole: string | undefined;
  patientId: string;
  treatments: Treatment[];
  appointments: Appointment[];
  payments: Payment[];
  toothConditionsCount?: number;
  supabaseClient?: any;
}): Promise<{
  ok: boolean;
  actionTaken: 'archived' | 'deleted' | 'rejected';
  outcome: 'confirmed' | 'queued_offline' | 'error';
  errorCode?: string;
  messageFa: string;
}> {
  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    params.actorRole !== 'manager'
  ) {
    return {
      ok: false,
      actionTaken: 'rejected',
      outcome: 'error',
      errorCode: 'MINA_PATIENT_ARCHIVE_UNAUTHORIZED',
      messageFa: 'بایگانی یا حذف پرونده بیمار صرفاً با دسترسی مدیر کلینیک مجاز است.',
    };
  }

  const hasClinicalHistory =
    params.treatments.some((t) => t.patient_id === params.patientId) ||
    params.appointments.some((a) => a.patient_id === params.patientId && a.status === 'completed') ||
    params.payments.some((p) => p.patient_id === params.patientId) ||
    (params.toothConditionsCount ?? 0) > 0 ||
    getPatientClinicalNotes(params.patientId).length > 0 ||
    getPatientConsentRecords(params.patientId).length > 0;

  const db = params.supabaseClient || supabase;

  if (hasClinicalHistory) {
    const query = db
      .from('patients')
      .update({ status: 'inactive' })
      .eq('id', params.patientId);
    const res = typeof query?.select === 'function' ? await query.select() : await query;
    const outcome = getMutationOutcome(res);
    if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
      return {
        ok: false,
        actionTaken: 'rejected',
        outcome: 'error',
        errorCode: 'MINA_PATIENT_ARCHIVE_FAILED',
        messageFa: 'بایگانی پرونده بیمار در سرور انجام نشد.',
      };
    }
    return {
      ok: true,
      actionTaken: 'archived',
      outcome,
      errorCode: 'MINA_PATIENT_RETENTION_ARCHIVED',
      messageFa:
        outcome === 'confirmed'
          ? 'به‌دلیل وجود سابقه بالینی/مالی، طبق سیاست نگهداری مدارک پزشکی پرونده حذف فیزیکی نشد و با حفظ کامل سوابق به حالت «بایگانی (غیرفعال)» منتقل گردید.'
          : 'درخواست بایگانی پرونده در صف آفلاین ثبت شد.',
    };
  }

  const delQuery = db.from('patients').delete().eq('id', params.patientId);
  const res = typeof delQuery?.select === 'function' ? await delQuery.select() : await delQuery;
  const outcome = getMutationOutcome(res);
  if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
    return {
      ok: false,
      actionTaken: 'rejected',
      outcome: 'error',
      errorCode: 'MINA_PATIENT_DELETE_FAILED',
      messageFa: 'حذف پرونده خالی انجام نشد (ردیف یافت نشد یا دسترسی محدود است).',
    };
  }

  return {
    ok: true,
    actionTaken: 'deleted',
    outcome,
    messageFa:
      outcome === 'confirmed'
        ? 'پرونده فاقد سابقه بالینی با موفقیت حذف شد.'
        : 'درخواست حذف در صف آفلاین ثبت شد.',
  };
}

/**
 * Clears in-memory Map caches ONLY — leaves durable backend-namespaced storage intact
 * so module resets / process reloads can be tested realistically.
 */
export function resetClinicalRecordMemoryCacheForReloadTest(): void {
  ALLERGY_REVIEW_LEDGER.clear();
  CONSENT_LEDGER.clear();
  CLINICAL_NOTES_LEDGER.clear();
}

export function clearClinicalRecordLedgersForTesting(): void {
  ALLERGY_REVIEW_LEDGER.clear();
  CONSENT_LEDGER.clear();
  CLINICAL_NOTES_LEDGER.clear();

  for (const pid of readNamespacedArray<string>(ALLERGY_INDEX_KEY()) ?? []) {
    removeNamespacedKey(allergyPatientKey(pid));
  }
  removeNamespacedKey(ALLERGY_INDEX_KEY());

  for (const pid of readNamespacedArray<string>(CONSENT_INDEX_KEY()) ?? []) {
    removeNamespacedKey(consentPatientKey(pid));
  }
  removeNamespacedKey(CONSENT_INDEX_KEY());

  for (const pid of readNamespacedArray<string>(NOTES_INDEX_KEY()) ?? []) {
    removeNamespacedKey(notesPatientKey(pid));
  }
  removeNamespacedKey(NOTES_INDEX_KEY());
}
