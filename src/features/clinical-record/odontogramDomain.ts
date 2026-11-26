/**
 * MINADENTAL V15 — ISO 3950 (FDI) & PALMER ODONTOGRAM DOMAIN ENGINE
 *
 * Resolves:
 *   - CL-01 (P0): Canonical dentition + ISO 3950 (FDI) tooth identity with explicit
 *     bi-directional Palmer conversion. Rejects invalid tooth numbers and flags
 *     ambiguous legacy bare 1..8 numbers for human clinician reconciliation (zero guessing).
 *   - CL-02 (P0): Append-only odontogram observation ledger with versioned amendments,
 *     optimistic concurrency verification, surface-level merge (no lost concurrent edits
 *     across surfaces), and derived current tooth projection separating 'not_examined'
 *     from explicitly recorded 'healthy'.
 */

import { supabase, type ToothCondition } from '@/lib/supabase';
import { getBackendNamespaceKey } from '@/lib/supabaseCore';
import { getMutationOutcome, hasZeroAffectedRows } from '@/lib/supabaseGuardian';

export type DentitionType = 'permanent' | 'deciduous';
export type PalmerQuadrant = 'UR' | 'UL' | 'LL' | 'LR';
export type ToothSurfaceKey = 'o' | 'm' | 'd' | 'b' | 'l' | 'c';

export type OdontogramFindingCode =
  | 'not_examined'
  | 'healthy'
  | 'caries'
  | 'filled'
  | 'existing_restoration'
  | 'crown'
  | 'bridge'
  | 'implant'
  | 'extracted'
  | 'missing'
  | 'unerupted'
  | 'impacted'
  | 'root_canal'
  | 'fracture'
  | 'planned_procedure'
  | 'other';

export interface CanonicalToothCoordinate {
  fdi: number;
  dentition: DentitionType;
  quadrant: PalmerQuadrant;
  quadrantLabelFa: string;
  quadrantSymbol: '┘' | '└' | '┌' | '┐';
  palmerSymbol: string; // '1'..'8' or 'A'..'E'
  palmerCode: string;   // e.g. 'UR6' or 'ULE'
  palmerDisplay: string; // e.g. '6┘' or '└E'
  anatomicalNameFa: string;
  isUpper: boolean;
}

export interface OdontogramObservationEvent {
  id: string;
  tenantId: string;
  branchId: string;
  patientId: string;
  encounterId: string | null;
  fdi: number;
  dentition: DentitionType;
  palmerQuadrant: PalmerQuadrant;
  palmerCode: string;
  scopeLevel: 'whole_tooth' | 'surface';
  surfaceCode: ToothSurfaceKey | null;
  findingCode: OdontogramFindingCode;
  clinicalStatus: 'active' | 'superseded' | 'entered_in_error';
  version: number;
  supersedesObservationId: string | null;
  amendmentReason: string | null;
  provenanceSource: 'clinician_direct' | 'legacy_reconciled' | 'assistant_draft';
  authoredBy: string;
  authoredRole: string;
  recordedAt: string;
  notes?: string | null;
  persistenceStatus?: 'persisted_server' | 'queued_offline_draft' | 'rejected' | 'unknown';
  serverId?: string | null;
}

export interface AmbiguousLegacyToothRecord {
  legacyRowId: string;
  patientId: string;
  rawToothNumber: number;
  condition: string;
  surfaceRaw: string | null;
  status: 'ambiguous_requires_reconciliation' | 'invalid_out_of_range';
  candidateFdiTeeth: number[];
  reasonFa: string;
}

export interface DerivedToothStateProjection {
  fdi: number;
  coordinate: CanonicalToothCoordinate;
  examinationState: 'not_examined' | 'examined';
  primaryFinding: OdontogramFindingCode;
  wholeToothFindings: OdontogramFindingCode[];
  surfaceFindings: Partial<Record<ToothSurfaceKey, OdontogramFindingCode>>;
  activeObservations: OdontogramObservationEvent[];
  historyCount: number;
  latestVersion: number;
  lastRecordedAt: string | null;
  hasPendingAmendmentHistory: boolean;
}

export interface OdontogramProjectionResult {
  patientId: string;
  teethByFdi: Record<number, DerivedToothStateProjection>;
  allObservations: OdontogramObservationEvent[];
  ambiguousLegacyRecords: AmbiguousLegacyToothRecord[];
}

export const ODONTOGRAM_FINDING_CATALOG: ReadonlyArray<{
  value: OdontogramFindingCode;
  labelFa: string;
  color: string;
  bg: string;
  iconSymbol: string;
}> = [
  { value: 'not_examined', labelFa: 'معاینه نشده', color: '#64748B', bg: '#F1F5F9', iconSymbol: '○' },
  { value: 'healthy', labelFa: 'سالم (معاینه‌شده)', color: '#16A34A', bg: '#DCFCE7', iconSymbol: '✓' },
  { value: 'caries', labelFa: 'پوسیدگی', color: '#DC2626', bg: '#FEE2E2', iconSymbol: '●' },
  { value: 'filled', labelFa: 'ترمیم / پرکردگی', color: '#2563EB', bg: '#DBEAFE', iconSymbol: '■' },
  { value: 'existing_restoration', labelFa: 'ترمیم قبلی', color: '#0284C7', bg: '#E0F2FE', iconSymbol: '▣' },
  { value: 'crown', labelFa: 'روکش', color: '#D97706', bg: '#FEF3C7', iconSymbol: '▲' },
  { value: 'bridge', labelFa: 'بریج / پل', color: '#7C3AED', bg: '#EDE9FE', iconSymbol: '∏' },
  { value: 'implant', labelFa: 'ایمپلنت', color: '#0891B2', bg: '#CFFAFE', iconSymbol: '⚓' },
  { value: 'root_canal', labelFa: 'درمان ریشه (RCT)', color: '#DB2777', bg: '#FCE7F3', iconSymbol: '⋁' },
  { value: 'fracture', labelFa: 'شکستگی', color: '#EA580C', bg: '#FFEDD5', iconSymbol: '⚡' },
  { value: 'extracted', labelFa: 'کشیده‌شده', color: '#4B5563', bg: '#E5E7EB', iconSymbol: '✕' },
  { value: 'missing', labelFa: 'فاقد دندان', color: '#6B7280', bg: '#F3F4F6', iconSymbol: '—' },
  { value: 'unerupted', labelFa: 'رویش‌نیافته', color: '#0D9488', bg: '#CCFBF1', iconSymbol: '↓' },
  { value: 'impacted', labelFa: 'نهفته', color: '#9333EA', bg: '#F3E8FF', iconSymbol: '⊗' },
  { value: 'planned_procedure', labelFa: 'طرح درمان آتی', color: '#4F46E5', bg: '#E0E7FF', iconSymbol: '★' },
  { value: 'other', labelFa: 'سایر یافته‌ها', color: '#475569', bg: '#E2E8F0', iconSymbol: '•' },
];

export const FINDING_MAP: Record<
  OdontogramFindingCode,
  (typeof ODONTOGRAM_FINDING_CATALOG)[number]
> = Object.fromEntries(
  ODONTOGRAM_FINDING_CATALOG.map((item) => [item.value, item])
) as Record<OdontogramFindingCode, (typeof ODONTOGRAM_FINDING_CATALOG)[number]>;

export const TOOTH_SURFACE_LABELS_FA: Record<ToothSurfaceKey, string> = {
  o: 'اکلوژال / انسیزال (O)',
  m: 'مزیال (M)',
  d: 'دیستال (D)',
  b: 'باکال / لبیال (B)',
  l: 'لینگوال / پالاتال (L)',
  c: 'مرکزی / سرویکال (C)',
};

const PERMANENT_ANATOMICAL_NAMES_FA: Record<number, string> = {
  1: 'سانترال (ثنایای مرکزی)',
  2: 'لاترال (ثنایای طرفی)',
  3: 'کانین (نیش)',
  4: 'پره‌مولر اول (آسیای کوچک اول)',
  5: 'پره‌مولر دوم (آسیای کوچک دوم)',
  6: 'مولر اول (آسیای بزرگ اول)',
  7: 'مولر دوم (آسیای بزرگ دوم)',
  8: 'مولر سوم (دندان عقل)',
};

const DECIDUOUS_ANATOMICAL_NAMES_FA: Record<number, string> = {
  1: 'سانترال شیری (A)',
  2: 'لاترال شیری (B)',
  3: 'کانین شیری (C)',
  4: 'مولر اول شیری (D)',
  5: 'مولر دوم شیری (E)',
};

const QUADRANT_META: Record<
  number,
  {
    dentition: DentitionType;
    quadrant: PalmerQuadrant;
    labelFa: string;
    symbol: '┘' | '└' | '┌' | '┐';
    isUpper: boolean;
  }
> = {
  1: { dentition: 'permanent', quadrant: 'UR', labelFa: 'بالا راست بیمار (UR)', symbol: '┘', isUpper: true },
  2: { dentition: 'permanent', quadrant: 'UL', labelFa: 'بالا چپ بیمار (UL)', symbol: '└', isUpper: true },
  3: { dentition: 'permanent', quadrant: 'LL', labelFa: 'پایین چپ بیمار (LL)', symbol: '┌', isUpper: false },
  4: { dentition: 'permanent', quadrant: 'LR', labelFa: 'پایین راست بیمار (LR)', symbol: '┐', isUpper: false },
  5: { dentition: 'deciduous', quadrant: 'UR', labelFa: 'شیری بالا راست (UR)', symbol: '┘', isUpper: true },
  6: { dentition: 'deciduous', quadrant: 'UL', labelFa: 'شیری بالا چپ (UL)', symbol: '└', isUpper: true },
  7: { dentition: 'deciduous', quadrant: 'LL', labelFa: 'شیری پایین چپ (LL)', symbol: '┌', isUpper: false },
  8: { dentition: 'deciduous', quadrant: 'LR', labelFa: 'شیری پایین راست (LR)', symbol: '┐', isUpper: false },
};

const DECIDUOUS_INDEX_TO_LETTER: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
};

const DECIDUOUS_LETTER_TO_INDEX: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
};

/**
 * Validates and converts an ISO 3950 (FDI) two-digit tooth number into its canonical coordinate.
 * Returns null if the number is invalid or ambiguous (e.g. bare 1..8).
 */
export function fdiToToothCoordinate(fdiNumber: number): CanonicalToothCoordinate | null {
  if (!Number.isInteger(fdiNumber)) return null;
  const qDigit = Math.floor(fdiNumber / 10);
  const tDigit = fdiNumber % 10;
  const qMeta = QUADRANT_META[qDigit];
  if (!qMeta) return null;

  if (qMeta.dentition === 'permanent') {
    if (tDigit < 1 || tDigit > 8) return null;
    const palmerSymbol = String(tDigit);
    const palmerDisplay =
      qMeta.quadrant === 'UR' || qMeta.quadrant === 'LR'
        ? `${palmerSymbol}${qMeta.symbol}`
        : `${qMeta.symbol}${palmerSymbol}`;
    return {
      fdi: fdiNumber,
      dentition: 'permanent',
      quadrant: qMeta.quadrant,
      quadrantLabelFa: qMeta.labelFa,
      quadrantSymbol: qMeta.symbol,
      palmerSymbol,
      palmerCode: `${qMeta.quadrant}${palmerSymbol}`,
      palmerDisplay,
      anatomicalNameFa: `${PERMANENT_ANATOMICAL_NAMES_FA[tDigit]} — ${qMeta.labelFa}`,
      isUpper: qMeta.isUpper,
    };
  }

  if (tDigit < 1 || tDigit > 5) return null;
  const letter = DECIDUOUS_INDEX_TO_LETTER[tDigit];
  const palmerDisplay =
    qMeta.quadrant === 'UR' || qMeta.quadrant === 'LR'
      ? `${letter}${qMeta.symbol}`
      : `${qMeta.symbol}${letter}`;
  return {
    fdi: fdiNumber,
    dentition: 'deciduous',
    quadrant: qMeta.quadrant,
    quadrantLabelFa: qMeta.labelFa,
    quadrantSymbol: qMeta.symbol,
    palmerSymbol: letter,
    palmerCode: `${qMeta.quadrant}${letter}`,
    palmerDisplay,
    anatomicalNameFa: `${DECIDUOUS_ANATOMICAL_NAMES_FA[tDigit]} — ${qMeta.labelFa}`,
    isUpper: qMeta.isUpper,
  };
}

export function isValidFdiToothNumber(fdiNumber: number): boolean {
  return fdiToToothCoordinate(fdiNumber) !== null;
}

/**
 * Explicitly converts a qualified Palmer designation (e.g. 'UR6', 'LL7', 'URA', '6┘', '┌7')
 * into a canonical FDI coordinate. Bare numbers ('6') without quadrant are REJECTED as ambiguous.
 */
export function palmerToFdiTooth(palmerInput: string): CanonicalToothCoordinate | null {
  const cleaned = String(palmerInput || '').trim().toUpperCase();
  if (!cleaned) return null;

  // Match explicit UR1..UR8, UL1..UL8, LL1..LL8, LR1..LR8 or URA..URE
  const codeMatch = cleaned.match(/^(UR|UL|LL|LR)\s*([1-8A-E])$/);
  if (codeMatch) {
    const quad = codeMatch[1] as PalmerQuadrant;
    const sym = codeMatch[2];
    return resolveQuadrantAndSymbol(quad, sym);
  }

  // Match Palmer bracket notation e.g. '6┘', '└6', '6┐', '┌6', 'E┘'
  const rightUpperMatch = cleaned.match(/^([1-8A-E])┘$/);
  if (rightUpperMatch) return resolveQuadrantAndSymbol('UR', rightUpperMatch[1]);

  const leftUpperMatch = cleaned.match(/^└([1-8A-E])$/);
  if (leftUpperMatch) return resolveQuadrantAndSymbol('UL', leftUpperMatch[1]);

  const leftLowerMatch = cleaned.match(/^┌([1-8A-E])$/);
  if (leftLowerMatch) return resolveQuadrantAndSymbol('LL', leftLowerMatch[1]);

  const rightLowerMatch = cleaned.match(/^([1-8A-E])┐$/);
  if (rightLowerMatch) return resolveQuadrantAndSymbol('LR', rightLowerMatch[1]);

  return null;
}

function resolveQuadrantAndSymbol(
  quadrant: PalmerQuadrant,
  symbol: string
): CanonicalToothCoordinate | null {
  const isLetter = /^[A-E]$/.test(symbol);
  if (isLetter) {
    const idx = DECIDUOUS_LETTER_TO_INDEX[symbol];
    const qBase = quadrant === 'UR' ? 50 : quadrant === 'UL' ? 60 : quadrant === 'LL' ? 70 : 80;
    return fdiToToothCoordinate(qBase + idx);
  }
  const num = Number(symbol);
  if (!Number.isInteger(num) || num < 1 || num > 8) return null;
  const qBase = quadrant === 'UR' ? 10 : quadrant === 'UL' ? 20 : quadrant === 'LL' ? 30 : 40;
  return fdiToToothCoordinate(qBase + num);
}

export const PERMANENT_QUADRANT_TEETH: Record<PalmerQuadrant, CanonicalToothCoordinate[]> = {
  UR: [18, 17, 16, 15, 14, 13, 12, 11].map((n) => fdiToToothCoordinate(n)!),
  UL: [21, 22, 23, 24, 25, 26, 27, 28].map((n) => fdiToToothCoordinate(n)!),
  LR: [48, 47, 46, 45, 44, 43, 42, 41].map((n) => fdiToToothCoordinate(n)!),
  LL: [31, 32, 33, 34, 35, 36, 37, 38].map((n) => fdiToToothCoordinate(n)!),
};

export const DECIDUOUS_QUADRANT_TEETH: Record<PalmerQuadrant, CanonicalToothCoordinate[]> = {
  UR: [55, 54, 53, 52, 51].map((n) => fdiToToothCoordinate(n)!),
  UL: [61, 62, 63, 64, 65].map((n) => fdiToToothCoordinate(n)!),
  LR: [85, 84, 83, 82, 81].map((n) => fdiToToothCoordinate(n)!),
  LL: [71, 72, 73, 74, 75].map((n) => fdiToToothCoordinate(n)!),
};

export const ALL_CANONICAL_FDI_NUMBERS: readonly number[] = [
  18, 17, 16, 15, 14, 13, 12, 11,
  21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41,
  31, 32, 33, 34, 35, 36, 37, 38,
  55, 54, 53, 52, 51,
  61, 62, 63, 64, 65,
  85, 84, 83, 82, 81,
  71, 72, 73, 74, 75,
];

/**
 * CL-01 Guard: Inspects a legacy `tooth_conditions` row and determines whether its
 * `tooth_number` is a valid canonical FDI code, an ambiguous bare Palmer digit (1..8),
 * or an invalid out-of-range number. NEVER silently guesses a quadrant for 1..8.
 */
export function classifyLegacyToothRecord(row: ToothCondition): {
  validCoordinate: CanonicalToothCoordinate | null;
  ambiguous: AmbiguousLegacyToothRecord | null;
} {
  const num = Number(row.tooth_number);
  const coord = fdiToToothCoordinate(num);
  if (coord) {
    return { validCoordinate: coord, ambiguous: null };
  }

  if (Number.isInteger(num) && num >= 1 && num <= 8) {
    return {
      validCoordinate: null,
      ambiguous: {
        legacyRowId: row.id,
        patientId: row.patient_id || '',
        rawToothNumber: num,
        condition: row.condition,
        surfaceRaw: row.surface,
        status: 'ambiguous_requires_reconciliation',
        candidateFdiTeeth: [10 + num, 20 + num, 30 + num, 40 + num],
        reasonFa: `شماره دندان قدیمی «${num}» فاقد ربع فکی (UR/UL/LL/LR) است و برای پیشگیری از خطای بالینی نیاز به تعیین ربع توسط دندانپزشک دارد.`,
      },
    };
  }

  return {
    validCoordinate: null,
    ambiguous: {
      legacyRowId: row.id,
      patientId: row.patient_id || '',
      rawToothNumber: num,
      condition: row.condition,
      surfaceRaw: row.surface,
      status: 'invalid_out_of_range',
      candidateFdiTeeth: [],
      reasonFa: `شماره دندان «${String(row.tooth_number)}» خارج از استاندارد FDI (ISO 3950) است.`,
    },
  };
}

// ── Append-Only Observation Ledger Storage & Concurrency Engine ──
const MEMORY_ODONTOGRAM_LEDGER = new Map<string, OdontogramObservationEvent[]>();

function getPatientOdontogramStorageKey(patientId: string): string {
  return getBackendNamespaceKey(`minadental_v15_odontogram_${patientId}`);
}

export function loadPatientOdontogramObservations(patientId: string): OdontogramObservationEvent[] {
  const mem = MEMORY_ODONTOGRAM_LEDGER.get(patientId);
  if (mem) return [...mem];
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(getPatientOdontogramStorageKey(patientId));
      if (raw) {
        const parsed = JSON.parse(raw) as OdontogramObservationEvent[];
        if (Array.isArray(parsed)) {
          MEMORY_ODONTOGRAM_LEDGER.set(patientId, parsed);
          return [...parsed];
        }
      }
    } catch {
      // ignore storage read error
    }
  }
  return [];
}

function savePatientOdontogramObservations(
  patientId: string,
  events: OdontogramObservationEvent[]
): void {
  MEMORY_ODONTOGRAM_LEDGER.set(patientId, [...events]);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(
        getPatientOdontogramStorageKey(patientId),
        JSON.stringify(events)
      );
    } catch {
      // ignore quota error
    }
  }
}

export function clearOdontogramLedgerForTesting(patientId?: string): void {
  if (patientId) {
    MEMORY_ODONTOGRAM_LEDGER.delete(patientId);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(getPatientOdontogramStorageKey(patientId));
      } catch {
        // ignore
      }
    }
    return;
  }
  MEMORY_ODONTOGRAM_LEDGER.clear();
}

export interface AppendOdontogramObservationInput {
  patientId: string;
  activeContextPatientId?: string;
  tenantId?: string;
  branchId?: string;
  encounterId?: string | null;
  fdi: number;
  scopeLevel: 'whole_tooth' | 'surface';
  surfaceCode?: ToothSurfaceKey | null;
  findingCode: OdontogramFindingCode;
  supersedesObservationId?: string | null;
  expectedVersion?: number | null;
  amendmentReason?: string | null;
  authoredBy: string;
  authoredRole: string;
  provenanceSource?: 'clinician_direct' | 'legacy_reconciled' | 'assistant_draft';
  notes?: string | null;
}

export interface AppendOdontogramObservationResult {
  ok: boolean;
  errorCode?: string;
  errorMessageFa?: string;
  event?: OdontogramObservationEvent;
  projection?: DerivedToothStateProjection;
}

/**
 * CL-02 Append-Only Clinical Command:
 * - Never executes a destructive delete when recording 'healthy' or amending a finding.
 * - Verifies patient context match (`activeContextPatientId` vs `patientId`).
 * - Verifies ISO 3950 FDI validity.
 * - Enforces optimistic concurrency on surface/whole-tooth observations so two clinicians
 *   editing different surfaces never overwrite each other, while stale edits to the same
 *   observation version fail closed with `MINA_ODONTOGRAM_VERSION_CONFLICT`.
 */
export function appendOdontogramObservationCommand(
  input: AppendOdontogramObservationInput
): AppendOdontogramObservationResult {
  if (
    input.activeContextPatientId &&
    input.activeContextPatientId !== input.patientId
  ) {
    return {
      ok: false,
      errorCode: 'MINA_WRONG_PATIENT_CONTEXT',
      errorMessageFa: 'عدم تطابق شناسه بیمار فعال با پرونده هدف؛ ثبت مشاهده متوقف شد.',
    };
  }

  if (!['manager', 'dentist', 'assistant'].includes(input.authoredRole)) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_UNAUTHORIZED',
      errorMessageFa: 'نقش فعلی مجوز ثبت یا اصلاح چارت دندانی (اودونتوگرام) را ندارد.',
    };
  }

  const coordinate = fdiToToothCoordinate(input.fdi);
  if (!coordinate) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_INVALID_FDI',
      errorMessageFa: `شماره دندان «${String(input.fdi)}» در استاندارد FDI (ISO 3950) معتبر نیست یا مبهم است.`,
    };
  }

  if (input.scopeLevel === 'surface' && !input.surfaceCode) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_SURFACE_REQUIRED',
      errorMessageFa: 'برای ثبت مشاهده سطحی، انتخاب سطح دندان (O/M/D/B/L/C) الزامی است.',
    };
  }

  const existingEvents = loadPatientOdontogramObservations(input.patientId);

  // Locate active observation for the exact same tooth + scope (or explicit supersedesObservationId)
  const targetActive = input.supersedesObservationId
    ? existingEvents.find((e) => e.id === input.supersedesObservationId)
    : existingEvents.find(
        (e) =>
          e.fdi === coordinate.fdi &&
          e.clinicalStatus === 'active' &&
          e.scopeLevel === input.scopeLevel &&
          (input.scopeLevel === 'surface' ? e.surfaceCode === input.surfaceCode : true) &&
          // Allow multiple compatible distinct whole-tooth findings unless superseding or setting healthy/extracted/missing
          (input.scopeLevel === 'surface' ||
            e.findingCode === input.findingCode ||
            input.findingCode === 'healthy' ||
            input.findingCode === 'not_examined' ||
            e.findingCode === 'healthy')
      );

  if (
    input.expectedVersion !== undefined &&
    input.expectedVersion !== null &&
    targetActive &&
    targetActive.version !== input.expectedVersion
  ) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_VERSION_CONFLICT',
      errorMessageFa: `تداخل همزمانی ویرایش روی دندان #${coordinate.fdi}: نسخه فعلی (${targetActive.version}) با نسخه مورد انتظار (${input.expectedVersion}) مغایرت دارد.`,
    };
  }

  if (input.supersedesObservationId && !targetActive) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_SUPERSEDE_TARGET_NOT_FOUND',
      errorMessageFa: 'رکورد مشاهده قبلی جهت اصلاح یافت نشد.',
    };
  }

  const nextVersion = targetActive ? targetActive.version + 1 : 1;
  const nowIso = new Date().toISOString();

  const updatedEvents = existingEvents.map((ev) => {
    if (targetActive && ev.id === targetActive.id) {
      return {
        ...ev,
        clinicalStatus: 'superseded' as const,
      };
    }
    // If recording explicit 'healthy' on whole tooth, supersede prior active whole-tooth pathologies while retaining history
    if (
      input.scopeLevel === 'whole_tooth' &&
      input.findingCode === 'healthy' &&
      ev.fdi === coordinate.fdi &&
      ev.scopeLevel === 'whole_tooth' &&
      ev.clinicalStatus === 'active'
    ) {
      return {
        ...ev,
        clinicalStatus: 'superseded' as const,
      };
    }
    return ev;
  });

  const newEvent: OdontogramObservationEvent = {
    id: `obs_v15_${coordinate.fdi}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    tenantId: input.tenantId || 'minadental_clinic',
    branchId: input.branchId || 'main',
    patientId: input.patientId,
    encounterId: input.encounterId ?? null,
    fdi: coordinate.fdi,
    dentition: coordinate.dentition,
    palmerQuadrant: coordinate.quadrant,
    palmerCode: coordinate.palmerCode,
    scopeLevel: input.scopeLevel,
    surfaceCode: input.scopeLevel === 'surface' ? (input.surfaceCode ?? null) : null,
    findingCode: input.findingCode,
    clinicalStatus: 'active',
    version: nextVersion,
    supersedesObservationId: targetActive?.id ?? input.supersedesObservationId ?? null,
    amendmentReason:
      input.amendmentReason ??
      (targetActive ? `اصلاح از «${FINDING_MAP[targetActive.findingCode]?.labelFa || targetActive.findingCode}»` : null),
    provenanceSource: input.provenanceSource ?? 'clinician_direct',
    authoredBy: input.authoredBy,
    authoredRole: input.authoredRole,
    recordedAt: nowIso,
    notes: input.notes ?? null,
  };

  const allNext = [...updatedEvents, newEvent];
  savePatientOdontogramObservations(input.patientId, allNext);

  const fullProjection = projectOdontogramCurrentState({
    patientId: input.patientId,
    observations: allNext,
    legacyRows: [],
  });

  return {
    ok: true,
    event: newEvent,
    projection: fullProjection.teethByFdi[coordinate.fdi],
  };
}

export async function persistOdontogramObservationToServer(
  input: AppendOdontogramObservationInput & { supabaseClient?: any }
): Promise<
  AppendOdontogramObservationResult & {
    persistenceStatus: 'persisted_server' | 'queued_offline_draft' | 'rejected' | 'unknown';
  }
> {
  const localRes = appendOdontogramObservationCommand(input);
  if (!localRes.ok || !localRes.event) {
    return { ...localRes, persistenceStatus: 'rejected' };
  }

  const db = input.supabaseClient || supabase;
  try {
    const query = db.from('odontogram_observations').insert({
      tenant_id: localRes.event.tenantId,
      branch_id: localRes.event.branchId,
      patient_id: localRes.event.patientId,
      encounter_id: localRes.event.encounterId,
      dentition: localRes.event.dentition,
      fdi_tooth_number: localRes.event.fdi,
      palmer_quadrant: localRes.event.palmerQuadrant,
      palmer_code: localRes.event.palmerCode,
      scope_level: localRes.event.scopeLevel,
      surface_code: localRes.event.surfaceCode,
      finding_code: localRes.event.findingCode,
      clinical_status: 'active',
      version: localRes.event.version,
      amendment_reason: localRes.event.amendmentReason,
      provenance_source: localRes.event.provenanceSource,
      notes: localRes.event.notes ?? null,
      authored_role: localRes.event.authoredRole,
    });
    const res = typeof query?.select === 'function' ? await query.select('*') : await query;
    const outcome = getMutationOutcome(res);
    if (outcome === 'error' || (!res?.queuedOffline && hasZeroAffectedRows(res))) {
      // Revert local pending event on server authorization/constraint rejection
      const reverted = loadPatientOdontogramObservations(input.patientId).filter(
        (ev) => ev.id !== localRes.event!.id
      );
      savePatientOdontogramObservations(input.patientId, reverted);
      return {
        ok: false,
        persistenceStatus: 'rejected',
        errorCode: 'MINA_ODONTOGRAM_SERVER_REJECTED',
        errorMessageFa: 'ثبت مشاهده چارت دندانی توسط سرور تایید نشد.',
      };
    }

    const row = Array.isArray(res?.data) ? res.data[0] : res?.data;
    const persistenceStatus =
      outcome === 'confirmed' ? ('persisted_server' as const) : ('queued_offline_draft' as const);
    const finalized: OdontogramObservationEvent = {
      ...localRes.event,
      id: row?.id ? String(row.id) : localRes.event.id,
      persistenceStatus,
      serverId: row?.id ? String(row.id) : null,
      recordedAt: row?.recorded_at ? String(row.recorded_at) : localRes.event.recordedAt,
    };
    const updatedList = loadPatientOdontogramObservations(input.patientId).map((ev) =>
      ev.id === localRes.event!.id ? finalized : ev
    );
    savePatientOdontogramObservations(input.patientId, updatedList);
    return {
      ok: true,
      persistenceStatus,
      event: finalized,
      projection: projectOdontogramCurrentState({
        patientId: input.patientId,
        observations: updatedList,
        legacyRows: [],
      }).teethByFdi[finalized.fdi],
    };
  } catch {
    return {
      ok: true,
      persistenceStatus: 'unknown',
      event: { ...localRes.event, persistenceStatus: 'unknown' },
      projection: localRes.projection,
    };
  }
}

export async function hydratePatientOdontogramFromServer(
  patientId: string,
  supabaseClient?: any
): Promise<OdontogramObservationEvent[]> {
  const db = supabaseClient || supabase;
  try {
    const res = await db
      .from('odontogram_observations')
      .select('*')
      .eq('patient_id', patientId);
    if (!Array.isArray(res?.data)) {
      return loadPatientOdontogramObservations(patientId);
    }
    const serverEvents: OdontogramObservationEvent[] = res.data.map((r: any) => ({
      id: String(r.id),
      tenantId: String(r.tenant_id || 'minadental_clinic'),
      branchId: String(r.branch_id || 'main'),
      patientId,
      encounterId: r.encounter_id ?? null,
      fdi: Number(r.fdi_tooth_number),
      dentition: r.dentition === 'deciduous' ? 'deciduous' : 'permanent',
      palmerQuadrant: r.palmer_quadrant,
      palmerCode: String(r.palmer_code || ''),
      scopeLevel: r.scope_level === 'surface' ? 'surface' : 'whole_tooth',
      surfaceCode: r.surface_code ?? null,
      findingCode: r.finding_code,
      clinicalStatus: r.clinical_status ?? 'active',
      version: Number(r.version || 1),
      supersedesObservationId: r.supersedes_observation_id ?? null,
      amendmentReason: r.amendment_reason ?? null,
      provenanceSource: r.provenance_source ?? 'clinician_direct',
      authoredBy: String(r.authored_by || 'کادر درمان'),
      authoredRole: String(r.authored_role || 'dentist'),
      recordedAt: String(r.recorded_at || new Date().toISOString()),
      notes: r.notes ?? null,
      persistenceStatus: 'persisted_server',
      serverId: String(r.id),
    }));
    const localDrafts = loadPatientOdontogramObservations(patientId).filter(
      (l) => !l.serverId && !serverEvents.some((s) => s.id === l.id)
    );
    const merged = [...serverEvents, ...localDrafts];
    savePatientOdontogramObservations(patientId, merged);
    return merged;
  } catch {
    return loadPatientOdontogramObservations(patientId);
  }
}

/**
 * Reconciles an ambiguous legacy `tooth_conditions` row (e.g. bare tooth_number = 6)
 * into a clinician-confirmed canonical FDI coordinate (e.g. 16, 26, 36, or 46).
 */
export function reconcileAmbiguousLegacyToothCommand(params: {
  patientId: string;
  legacyRow: ToothCondition;
  confirmedFdi: number;
  authoredBy: string;
  authoredRole: string;
}): AppendOdontogramObservationResult {
  const classification = classifyLegacyToothRecord(params.legacyRow);
  if (
    classification.ambiguous &&
    classification.ambiguous.candidateFdiTeeth.length > 0 &&
    !classification.ambiguous.candidateFdiTeeth.includes(params.confirmedFdi)
  ) {
    return {
      ok: false,
      errorCode: 'MINA_ODONTOGRAM_INVALID_RECONCILIATION_TARGET',
      errorMessageFa: `دندان FDI #${params.confirmedFdi} با شماره قدیمی «${params.legacyRow.tooth_number}» مطابقت ندارد.`,
    };
  }

  const findingCode = (
    params.legacyRow.condition in FINDING_MAP ? params.legacyRow.condition : 'other'
  ) as OdontogramFindingCode;

  return appendOdontogramObservationCommand({
    patientId: params.patientId,
    fdi: params.confirmedFdi,
    scopeLevel: 'whole_tooth',
    findingCode,
    amendmentReason: `تطبیق بالینی رکورد قدیمی دندان شماره ${params.legacyRow.tooth_number} به FDI #${params.confirmedFdi}`,
    authoredBy: params.authoredBy,
    authoredRole: params.authoredRole,
    provenanceSource: 'legacy_reconciled',
  });
}

function parseSurfaceMapSafe(raw: string | null): Partial<Record<ToothSurfaceKey, OdontogramFindingCode>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Partial<Record<ToothSurfaceKey, OdontogramFindingCode>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (['o', 'm', 'd', 'b', 'l', 'c'].includes(k) && v in FINDING_MAP) {
        out[k as ToothSurfaceKey] = v as OdontogramFindingCode;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Projects the current derived odontogram state for all 52 canonical teeth (32 permanent + 20 deciduous)
 * from the append-only observation ledger + valid compatibility rows, while isolating ambiguous
 * legacy records into `ambiguousLegacyRecords` (zero silent guessing).
 *
 * CRITICAL (CL-02): Teeth without any recorded observation remain `examinationState: 'not_examined'`
 * and `primaryFinding: 'not_examined'`, NEVER inferred as `'healthy'`.
 */
export function projectOdontogramCurrentState(params: {
  patientId: string;
  observations?: OdontogramObservationEvent[];
  legacyRows?: ToothCondition[];
}): OdontogramProjectionResult {
  const ledgerEvents = params.observations ?? loadPatientOdontogramObservations(params.patientId);
  const legacyRows = params.legacyRows ?? [];
  const ambiguousLegacyRecords: AmbiguousLegacyToothRecord[] = [];
  const syntheticFromValidLegacy: OdontogramObservationEvent[] = [];

  for (const row of legacyRows) {
    const { validCoordinate, ambiguous } = classifyLegacyToothRecord(row);
    if (ambiguous) {
      ambiguousLegacyRecords.push(ambiguous);
      continue;
    }
    if (validCoordinate) {
      const hasNativeEvents = ledgerEvents.some((e) => e.fdi === validCoordinate.fdi);
      if (!hasNativeEvents) {
        const finding = (
          row.condition in FINDING_MAP ? row.condition : 'other'
        ) as OdontogramFindingCode;
        syntheticFromValidLegacy.push({
          id: `legacy_compat_${row.id}`,
          tenantId: 'minadental_clinic',
          branchId: 'main',
          patientId: row.patient_id || params.patientId,
          encounterId: null,
          fdi: validCoordinate.fdi,
          dentition: validCoordinate.dentition,
          palmerQuadrant: validCoordinate.quadrant,
          palmerCode: validCoordinate.palmerCode,
          scopeLevel: 'whole_tooth',
          surfaceCode: null,
          findingCode: finding,
          clinicalStatus: 'active',
          version: 1,
          supersedesObservationId: null,
          amendmentReason: null,
          provenanceSource: 'clinician_direct',
          authoredBy: 'legacy_table',
          authoredRole: 'dentist',
          recordedAt: row.updated_at || new Date(0).toISOString(),
          notes: row.notes,
        });

        const surfMap = parseSurfaceMapSafe(row.surface);
        for (const [sKey, sCond] of Object.entries(surfMap)) {
          if (sCond) {
            syntheticFromValidLegacy.push({
              id: `legacy_compat_${row.id}_${sKey}`,
              tenantId: 'minadental_clinic',
              branchId: 'main',
              patientId: row.patient_id || params.patientId,
              encounterId: null,
              fdi: validCoordinate.fdi,
              dentition: validCoordinate.dentition,
              palmerQuadrant: validCoordinate.quadrant,
              palmerCode: validCoordinate.palmerCode,
              scopeLevel: 'surface',
              surfaceCode: sKey as ToothSurfaceKey,
              findingCode: sCond,
              clinicalStatus: 'active',
              version: 1,
              supersedesObservationId: null,
              amendmentReason: null,
              provenanceSource: 'clinician_direct',
              authoredBy: 'legacy_table',
              authoredRole: 'dentist',
              recordedAt: row.updated_at || new Date(0).toISOString(),
              notes: row.notes,
            });
          }
        }
      }
    }
  }

  const allObservations = [...syntheticFromValidLegacy, ...ledgerEvents];
  const teethByFdi: Record<number, DerivedToothStateProjection> = {};

  for (const fdi of ALL_CANONICAL_FDI_NUMBERS) {
    const coordinate = fdiToToothCoordinate(fdi)!;
    const toothEvents = allObservations.filter((e) => e.fdi === fdi);
    const activeEvents = toothEvents.filter((e) => e.clinicalStatus === 'active');

    if (toothEvents.length === 0) {
      teethByFdi[fdi] = {
        fdi,
        coordinate,
        examinationState: 'not_examined',
        primaryFinding: 'not_examined',
        wholeToothFindings: [],
        surfaceFindings: {},
        activeObservations: [],
        historyCount: 0,
        latestVersion: 0,
        lastRecordedAt: null,
        hasPendingAmendmentHistory: false,
      };
      continue;
    }

    const wholeToothFindings: OdontogramFindingCode[] = [];
    const surfaceFindings: Partial<Record<ToothSurfaceKey, OdontogramFindingCode>> = {};

    for (const ev of activeEvents) {
      if (ev.scopeLevel === 'whole_tooth') {
        if (!wholeToothFindings.includes(ev.findingCode)) {
          wholeToothFindings.push(ev.findingCode);
        }
      } else if (ev.scopeLevel === 'surface' && ev.surfaceCode) {
        surfaceFindings[ev.surfaceCode] = ev.findingCode;
      }
    }

    const nonHealthyWhole = wholeToothFindings.filter(
      (f) => f !== 'healthy' && f !== 'not_examined'
    );
    const nonHealthySurface = Object.values(surfaceFindings).filter(
      (f): f is OdontogramFindingCode => Boolean(f && f !== 'healthy' && f !== 'not_examined')
    );

    let primaryFinding: OdontogramFindingCode = 'not_examined';
    if (nonHealthyWhole.length > 0) {
      primaryFinding = nonHealthyWhole[nonHealthyWhole.length - 1];
    } else if (nonHealthySurface.length > 0) {
      primaryFinding = nonHealthySurface[nonHealthySurface.length - 1];
    } else if (
      wholeToothFindings.includes('healthy') ||
      Object.values(surfaceFindings).includes('healthy')
    ) {
      primaryFinding = 'healthy';
    }

    const latestVersion = toothEvents.reduce((max, e) => Math.max(max, e.version), 1);
    const lastRecordedAt =
      toothEvents.length > 0 ? toothEvents[toothEvents.length - 1].recordedAt : null;

    teethByFdi[fdi] = {
      fdi,
      coordinate,
      examinationState: primaryFinding === 'not_examined' ? 'not_examined' : 'examined',
      primaryFinding,
      wholeToothFindings,
      surfaceFindings,
      activeObservations: activeEvents,
      historyCount: toothEvents.length,
      latestVersion,
      lastRecordedAt,
      hasPendingAmendmentHistory: toothEvents.some((e) => e.clinicalStatus === 'superseded'),
    };
  }

  return {
    patientId: params.patientId,
    teethByFdi,
    allObservations,
    ambiguousLegacyRecords,
  };
}
