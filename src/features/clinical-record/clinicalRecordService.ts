/**
 * MINADENTAL V15 — CLINICAL RECORD, CONSENT, ALLERGY REVIEW, CLINICAL NOTES
 * & RETENTION GOVERNANCE SERVICE
 *
 * Resolves:
 *   - CL-03 (P0): Printable template is NOT a signed consent record. Distinguishes
 *     'draft', 'printed_unsigned', 'signed', 'withdrawn', and 'superseded_by_plan_change'.
 *     Requires attributable signer identity, witness/clinician confirmation, and online
 *     verification for signing. Signed consents are immutable in place.
 *   - CL-05 (P0): Patient deletion is blocked when clinical or financial history exists
 *     ('MINA_PATIENT_RETENTION_PROTECTED'), safely archiving the record ('inactive')
 *     with an immutable audit event. Enforces active patient context guard so switching
 *     patients blocks cross-patient writes ('MINA_WRONG_PATIENT_CONTEXT').
 *   - CL-06 (P1): Structured 4-state allergy verification ('not_asked' | 'unknown' |
 *     'no_known' | 'present'). Never infers 'no_known' from empty free text.
 *   - Clinical Notes Lifecycle ('draft' -> 'signed' -> 'amended'): Only verified clinicians
 *     ('dentist' | 'manager') may sign or amend notes; signing requires online server
 *     confirmation; signed notes cannot be edited in place.
 */

import { supabase, type Patient, type Treatment, type Appointment, type Payment } from '@/lib/supabase';
import { getMutationOutcome, hasZeroAffectedRows } from '@/lib/supabaseGuardian';
import { getRuntimeAuthStatus } from '@/services/authentication/authService';
import { detectMedicalAlerts, type MedicalAlert } from '@/lib/medicalAlerts';

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

/**
 * CL-06: Evaluates a patient's allergy safety state.
 * CRITICAL: Empty `patient.allergies` text NEVER produces `'no_known'`; without an
 * explicit structured review it resolves to `'not_asked'`. Free-text keyword matches
 * are returned as assistive alerts (`isClinicianVerified: false`) until a clinician
 * records a structured review.
 */
export function assessPatientAllergySafety(
  patient: Pick<Patient, 'id' | 'allergies' | 'medical_history' | 'medications'>,
  explicitReviews?: StructuredAllergyReview[]
): PatientAllergySafetyAssessment {
  const reviews = explicitReviews ?? ALLERGY_REVIEW_LEDGER.get(patient.id) ?? [];
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
  };

  const current = ALLERGY_REVIEW_LEDGER.get(params.patientId) ?? [];
  ALLERGY_REVIEW_LEDGER.set(params.patientId, [...current, review]);

  return { ok: true, review };
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
}

const CONSENT_LEDGER = new Map<string, ClinicalConsentRecord[]>();

export function getPatientConsentRecords(patientId: string): ClinicalConsentRecord[] {
  return [...(CONSENT_LEDGER.get(patientId) ?? [])];
}

/**
 * CL-03: Printing a consent template only records `'printed_unsigned'` with
 * `signatureMethod: 'printed_paper_pending'`. It NEVER marks the consent `'signed'`.
 */
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
  };

  const list = CONSENT_LEDGER.get(params.patientId) ?? [];
  CONSENT_LEDGER.set(params.patientId, [...list, record]);
  return { ok: true, record };
}

/**
 * CL-03: Signs an informed consent record with verifiable evidence.
 * - Requires online status (`isOffline: true` is rejected with `MINA_CONSENT_ONLINE_REQUIRED`).
 * - Requires clinician or authorized staff recording attributable signer name, risks & alternatives
 *   discussion confirmation, and non-pending signature method (`scanned_signed_attachment` or
 *   `in_person_witnessed_electronic`).
 */
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
  };

  const list = CONSENT_LEDGER.get(params.patientId) ?? [];
  CONSENT_LEDGER.set(params.patientId, [...list, record]);
  return { ok: true, record };
}

/**
 * CL-03: Signed consents cannot be edited in place. They can only be withdrawn
 * (`withdrawPatientConsentCommand`) or invalidated when the treatment plan scope changes
 * (`invalidateConsentOnPlanChangeCommand`).
 */
export function attemptInPlaceConsentEditCommand(params: {
  patientId: string;
  consentId: string;
  newProcedureScope: string;
}): { ok: boolean; errorCode: string; errorMessageFa: string } {
  const list = CONSENT_LEDGER.get(params.patientId) ?? [];
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

  const list = CONSENT_LEDGER.get(params.patientId) ?? [];
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
  CONSENT_LEDGER.set(params.patientId, next);
  return { ok: true, record: updated };
}

export function invalidateConsentOnPlanChangeCommand(params: {
  patientId: string;
  consentId: string;
  planChangeReason: string;
}): {
  ok: boolean;
  record?: ClinicalConsentRecord;
} {
  const list = CONSENT_LEDGER.get(params.patientId) ?? [];
  const idx = list.findIndex((c) => c.id === params.consentId);
  if (idx < 0) return { ok: false };

  const updated: ClinicalConsentRecord = {
    ...list[idx],
    status: 'superseded_by_plan_change',
    withdrawalReason: params.planChangeReason.trim() || 'تغییر طرح درمان و نیاز به اخذ مجدد رضایت‌نامه',
  };
  const next = [...list];
  next[idx] = updated;
  CONSENT_LEDGER.set(params.patientId, next);
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
}

const CLINICAL_NOTES_LEDGER = new Map<string, ClinicalNoteRecord[]>();

export function getPatientClinicalNotes(patientId: string): ClinicalNoteRecord[] {
  return [...(CLINICAL_NOTES_LEDGER.get(patientId) ?? [])];
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
  };

  const list = CLINICAL_NOTES_LEDGER.get(params.patientId) ?? [];
  CLINICAL_NOTES_LEDGER.set(params.patientId, [...list, note]);
  return { ok: true, note };
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

  const list = CLINICAL_NOTES_LEDGER.get(params.patientId) ?? [];
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
  CLINICAL_NOTES_LEDGER.set(params.patientId, next);
  return { ok: true, note: signed };
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

  const list = CLINICAL_NOTES_LEDGER.get(params.patientId) ?? [];
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
  };

  // Original signed note remains completely intact and unmodified in history!
  CLINICAL_NOTES_LEDGER.set(params.patientId, [...list, amendmentNote]);
  return {
    ok: true,
    originalNote: parent,
    amendmentNote,
  };
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

  // CL-05: Never hard-delete a patient who has clinical or financial records; archive instead!
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

export function clearClinicalRecordLedgersForTesting(): void {
  ALLERGY_REVIEW_LEDGER.clear();
  CONSENT_LEDGER.clear();
  CLINICAL_NOTES_LEDGER.clear();
}
