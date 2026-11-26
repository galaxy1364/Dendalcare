import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, type ToothCondition } from '@/lib/supabase';
import { Check, X, Baby, User, AlertTriangle, History } from 'lucide-react';
import {
  DECIDUOUS_QUADRANT_TEETH,
  FINDING_MAP,
  ODONTOGRAM_FINDING_CATALOG,
  PERMANENT_QUADRANT_TEETH,
  TOOTH_SURFACE_LABELS_FA,
  hydratePatientOdontogramFromServer,
  persistOdontogramObservationToServer,
  projectOdontogramCurrentState,
  reconcileAmbiguousLegacyToothCommand,
  type CanonicalToothCoordinate,
  type DentitionType,
  type DerivedToothStateProjection,
  type OdontogramFindingCode,
  type ToothSurfaceKey,
} from '@/features/clinical-record/odontogramDomain';
import { getRuntimeAuthStatus, getRuntimeServerVerifiedRole } from '@/services/authentication/authService';
import { resolveEffectiveRole } from '@/services/permissions/accessControl';
import { loadActiveUser } from '@/lib/cloudSyncEngine';

export type ToothMeta = CanonicalToothCoordinate;

type Props = {
  patientId: string;
  actorRole?: string;
  actorName?: string;
};

export function PalmerChart({ patientId, actorRole, actorName }: Props) {
  const [legacyRows, setLegacyRows] = useState<ToothCondition[]>([]);
  const [ledgerTick, setLedgerTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedFdi, setSelectedFdi] = useState<number | null>(null);
  const [surfMode, setSurfMode] = useState(false);
  const [activeSurf, setActiveSurf] = useState<ToothSurfaceKey | null>(null);
  const [dentition, setDentition] = useState<DentitionType>('permanent');
  const [notation, setNotation] = useState<'palmer' | 'fdi'>('palmer');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const effectiveRole =
    actorRole ||
    resolveEffectiveRole({
      sessionStatus: getRuntimeAuthStatus(),
      serverVerifiedRole: getRuntimeServerVerifiedRole(),
      localRole: loadActiveUser().role,
    });
  const effectiveAuthor = actorName || 'دکتر مهدی امیری';

  const fetchLegacyRows = useCallback(async () => {
    const [{ data }] = await Promise.all([
      supabase.from('tooth_conditions').select('*').eq('patient_id', patientId),
      hydratePatientOdontogramFromServer(patientId),
    ]);
    setLegacyRows((data as ToothCondition[] | null) ?? []);
    setLedgerTick((t) => t + 1);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    fetchLegacyRows();
    const ch = supabase
      .channel(`palmer-${patientId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tooth_conditions', filter: `patient_id=eq.${patientId}` }, fetchLegacyRows)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [patientId, fetchLegacyRows]);

  const projection = useMemo(
    () => projectOdontogramCurrentState({ patientId, legacyRows }),
    [patientId, legacyRows, ledgerTick]
  );

  const selectedProjection: DerivedToothStateProjection | null =
    selectedFdi !== null ? projection.teethByFdi[selectedFdi] ?? null : null;

  const recordFinding = async (
    tooth: CanonicalToothCoordinate,
    findingCode: OdontogramFindingCode,
    surfaceCode: ToothSurfaceKey | null = null
  ) => {
    setFeedbackError(null);
    const res = await persistOdontogramObservationToServer({
      patientId,
      activeContextPatientId: patientId,
      fdi: tooth.fdi,
      scopeLevel: surfaceCode ? 'surface' : 'whole_tooth',
      surfaceCode,
      findingCode,
      amendmentReason: amendmentReason.trim() || null,
      authoredBy: effectiveAuthor,
      authoredRole: effectiveRole,
    });

    if (!res.ok) {
      setFeedbackError(res.errorMessageFa || 'ثبت مشاهده چارت دندانی انجام نشد.');
      return;
    }

    setAmendmentReason('');
    setLedgerTick((t) => t + 1);

    // Sync compatibility projection to tooth_conditions without destructive DELETE on 'healthy'
    const currentTooth = res.projection;
    const compatSurfaceJson =
      currentTooth && Object.keys(currentTooth.surfaceFindings).length > 0
        ? JSON.stringify(currentTooth.surfaceFindings)
        : null;
    const existingLegacy = legacyRows.find((r) => Number(r.tooth_number) === tooth.fdi);
    if (existingLegacy) {
      const { data } = await supabase
        .from('tooth_conditions')
        .update({ condition: findingCode, surface: compatSurfaceJson })
        .eq('id', existingLegacy.id)
        .select('*');
      if (Array.isArray(data) && data[0]) {
        setLegacyRows((prev) => prev.map((r) => (r.id === existingLegacy.id ? (data[0] as ToothCondition) : r)));
      }
    } else if (findingCode !== 'not_examined') {
      const { data } = await supabase
        .from('tooth_conditions')
        .insert({ patient_id: patientId, tooth_number: tooth.fdi, condition: findingCode, surface: compatSurfaceJson })
        .select('*');
      if (Array.isArray(data) && data[0]) {
        setLegacyRows((prev) => [...prev, data[0] as ToothCondition]);
      }
    }
  };

  const handleReconcileLegacy = (legacyRowId: string, confirmedFdi: number) => {
    const row = legacyRows.find((r) => r.id === legacyRowId);
    if (!row) return;
    const res = reconcileAmbiguousLegacyToothCommand({
      patientId,
      legacyRow: row,
      confirmedFdi,
      authoredBy: effectiveAuthor,
      authoredRole: effectiveRole,
    });
    if (!res.ok) {
      setFeedbackError(res.errorMessageFa || 'تطبیق رکورد قدیمی انجام نشد.');
      return;
    }
    setLegacyRows((prev) => prev.map((r) => (r.id === legacyRowId ? { ...r, tooth_number: confirmedFdi } : r)));
    setLedgerTick((t) => t + 1);
  };

  const quadSet = dentition === 'permanent' ? PERMANENT_QUADRANT_TEETH : DECIDUOUS_QUADRANT_TEETH;

  if (loading) {
    return <div className="text-center py-8 text-gray-500 text-xs">در حال بارگذاری چارت دندانی استاندارد FDI / پالمر...</div>;
  }

  return (
    <div className="space-y-3" data-testid="odontogram_v15_workspace">
      {projection.ambiguousLegacyRecords.length > 0 && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 space-y-2" data-testid="odontogram_ambiguous_reconciliation_banner">
          <div className="flex items-center gap-2 text-amber-900 text-xs font-extrabold">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>نیاز به تطبیق بالینی شماره‌گذاری قدیمی ({projection.ambiguousLegacyRecords.length.toLocaleString('fa-IR')} مورد بدون ربع فکی)</span>
          </div>
          {projection.ambiguousLegacyRecords.map((amb) => (
            <div key={amb.legacyRowId} className="bg-white rounded-xl p-2.5 border border-amber-200 space-y-1.5 text-[11px]">
              <p className="text-amber-950 font-semibold">{amb.reasonFa}</p>
              {amb.candidateFdiTeeth.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-gray-500">انتخاب ربع صحیح FDI:</span>
                  {amb.candidateFdiTeeth.map((candFdi) => {
                    const coord = projection.teethByFdi[candFdi]?.coordinate;
                    return (
                      <button
                        key={candFdi}
                        type="button"
                        onClick={() => handleReconcileLegacy(amb.legacyRowId, candFdi)}
                        className="px-2.5 py-1 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-900 font-bold transition-colors"
                      >
                        FDI #{candFdi} ({coord?.palmerDisplay})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="glass-card p-2.5 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1.5">
          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              type="button"
              onClick={() => { setDentition('permanent'); setSelectedFdi(null); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${dentition === 'permanent' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
            >
              <User size={12} /> دندان دائمی (۳۲)
            </button>
            <button
              type="button"
              onClick={() => { setDentition('deciduous'); setSelectedFdi(null); }}
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${dentition === 'deciduous' ? 'bg-white shadow text-pink-700' : 'text-gray-500'}`}
            >
              <Baby size={12} /> شیری اطفال (۲۰)
            </button>
          </div>

          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              type="button"
              onClick={() => setNotation('palmer')}
              className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${notation === 'palmer' ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
            >
              نمایش پالمر
            </button>
            <button
              type="button"
              onClick={() => setNotation('fdi')}
              className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${notation === 'fdi' ? 'bg-white shadow text-blue-700' : 'text-gray-500'}`}
            >
              FDI (ISO 3950)
            </button>
          </div>

          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              type="button"
              onClick={() => { setSurfMode(false); setActiveSurf(null); }}
              className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${!surfMode ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
            >
              کل دندان
            </button>
            <button
              type="button"
              onClick={() => setSurfMode(true)}
              className={`px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold transition-all ${surfMode ? 'bg-white shadow text-emerald-700' : 'text-gray-500'}`}
            >
              سطوح ۵گانه
            </button>
          </div>
        </div>
      </div>

      {feedbackError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-2.5 text-xs text-red-700 font-bold">{feedbackError}</div>
      )}

      <div className="glass-card p-3 overflow-x-auto" dir="ltr">
        <div className="text-[10px] font-extrabold text-slate-600 text-center mb-1.5" dir="rtl">
          فک بالا (ماگزیلا — Maxilla) • راست بیمار (R) تا چپ بیمار (L)
        </div>
        <div className="flex justify-center items-end gap-0.5 mb-1 min-w-[300px]">
          <span className="text-[9px] font-black text-slate-500 w-5 text-center">R</span>
          {quadSet.UR.map((t) => (
            <ToothNodeButton
              key={`ur-${t.fdi}`}
              projection={projection.teethByFdi[t.fdi]}
              notation={notation}
              selected={selectedFdi === t.fdi}
              onSelect={() => { setSelectedFdi(selectedFdi === t.fdi ? null : t.fdi); setActiveSurf(null); }}
            />
          ))}
          <div className="w-0.5 h-9 bg-slate-300 mx-1 self-center" />
          {quadSet.UL.map((t) => (
            <ToothNodeButton
              key={`ul-${t.fdi}`}
              projection={projection.teethByFdi[t.fdi]}
              notation={notation}
              selected={selectedFdi === t.fdi}
              onSelect={() => { setSelectedFdi(selectedFdi === t.fdi ? null : t.fdi); setActiveSurf(null); }}
            />
          ))}
          <span className="text-[9px] font-black text-slate-500 w-5 text-center">L</span>
        </div>

        <div className="h-px bg-gradient-to-r from-transparent via-slate-300 to-transparent my-2" />

        <div className="flex justify-center items-start gap-0.5 mt-1 min-w-[300px]">
          <span className="text-[9px] font-black text-slate-500 w-5 text-center">R</span>
          {quadSet.LR.map((t) => (
            <ToothNodeButton
              key={`lr-${t.fdi}`}
              projection={projection.teethByFdi[t.fdi]}
              notation={notation}
              selected={selectedFdi === t.fdi}
              onSelect={() => { setSelectedFdi(selectedFdi === t.fdi ? null : t.fdi); setActiveSurf(null); }}
            />
          ))}
          <div className="w-0.5 h-9 bg-slate-300 mx-1 self-center" />
          {quadSet.LL.map((t) => (
            <ToothNodeButton
              key={`ll-${t.fdi}`}
              projection={projection.teethByFdi[t.fdi]}
              notation={notation}
              selected={selectedFdi === t.fdi}
              onSelect={() => { setSelectedFdi(selectedFdi === t.fdi ? null : t.fdi); setActiveSurf(null); }}
            />
          ))}
          <span className="text-[9px] font-black text-slate-500 w-5 text-center">L</span>
        </div>
        <div className="text-[10px] font-extrabold text-slate-600 text-center mt-1.5" dir="rtl">
          فک پایین (مندیبل — Mandible)
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {ODONTOGRAM_FINDING_CATALOG.map((c) => (
          <span key={c.value} className="badge text-[9.5px] py-0.5 px-2 font-bold" style={{ color: c.color, background: c.bg }}>
            {c.iconSymbol} {c.labelFa}
          </span>
        ))}
      </div>

      {selectedProjection && (
        <div className="glass-card p-3 space-y-3 animate-scale-in">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-black text-slate-800">
                دندان FDI #{selectedProjection.fdi} • پالمر {selectedProjection.coordinate.palmerDisplay} ({selectedProjection.coordinate.palmerCode})
              </p>
              <p className="text-[10.5px] text-slate-500 font-semibold">
                {selectedProjection.coordinate.anatomicalNameFa} • وضعیت فعلی:{' '}
                <strong style={{ color: FINDING_MAP[selectedProjection.primaryFinding].color }}>
                  {FINDING_MAP[selectedProjection.primaryFinding].labelFa}
                </strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => { setSelectedFdi(null); setActiveSurf(null); }}
              aria-label="بستن پنل دندان"
              className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500"
            >
              <X size={15} />
            </button>
          </div>

          <input
            type="text"
            value={amendmentReason}
            onChange={(e) => setAmendmentReason(e.target.value)}
            placeholder="علت اصلاح یا توضیح بالینی (اختیاری در ثبت اول، ثبت در تاریخچه Append-Only)..."
            className="w-full rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-800"
          />

          {!surfMode ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {ODONTOGRAM_FINDING_CATALOG.filter((c) => c.value !== 'not_examined').map((c) => {
                const isSelected = selectedProjection.wholeToothFindings.includes(c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => recordFinding(selectedProjection.coordinate, c.value, null)}
                    className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[10px] font-bold haptic transition-all border"
                    style={{ color: c.color, background: c.bg, borderColor: isSelected ? c.color : 'transparent' }}
                  >
                    {isSelected && <Check size={10} />}
                    <span>{c.iconSymbol} {c.labelFa}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-1.5">
                {(['o', 'm', 'd', 'b', 'c'] as ToothSurfaceKey[]).map((sKey) => {
                  const sFind = selectedProjection.surfaceFindings[sKey];
                  const active = activeSurf === sKey;
                  return (
                    <button
                      key={sKey}
                      type="button"
                      onClick={() => setActiveSurf(sKey)}
                      className={`px-2.5 py-1.5 rounded-xl text-[10.5px] font-bold border transition-all ${active ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-50 text-slate-700 border-slate-200'}`}
                    >
                      {TOOTH_SURFACE_LABELS_FA[sKey]}
                      {sFind ? ` (${FINDING_MAP[sFind].labelFa})` : ''}
                    </button>
                  );
                })}
              </div>

              {activeSurf && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                  {ODONTOGRAM_FINDING_CATALOG.filter((c) =>
                    ['healthy', 'caries', 'filled', 'existing_restoration', 'crown', 'fracture', 'root_canal', 'planned_procedure'].includes(c.value)
                  ).map((c) => {
                    const current = selectedProjection.surfaceFindings[activeSurf];
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => recordFinding(selectedProjection.coordinate, c.value, activeSurf)}
                        className="flex items-center justify-center gap-1 py-2 px-2 rounded-xl text-[10px] font-bold haptic"
                        style={{ color: c.color, background: c.bg }}
                      >
                        {current === c.value && <Check size={9} />}
                        {c.iconSymbol} {c.labelFa}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {selectedProjection.historyCount > 0 && (
            <div className="pt-2 border-t border-slate-200/80 space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-extrabold text-slate-600">
                <History size={12} />
                <span>تاریخچه مشاهدات دندان #{selectedProjection.fdi} ({selectedProjection.historyCount.toLocaleString('fa-IR')} رویداد — نسخه v{selectedProjection.latestVersion})</span>
              </div>
              {projection.allObservations
                .filter((o) => o.fdi === selectedProjection.fdi)
                .slice(-3)
                .map((ev) => (
                  <div key={ev.id} className="flex items-center justify-between text-[10px] bg-slate-50 px-2 py-1 rounded-lg border border-slate-200/70">
                    <span>
                      v{ev.version} • {FINDING_MAP[ev.findingCode]?.labelFa || ev.findingCode}
                      {ev.surfaceCode ? ` (سطح ${ev.surfaceCode.toUpperCase()})` : ''}
                      {ev.amendmentReason ? ` — ${ev.amendmentReason}` : ''}
                    </span>
                    <span className="text-slate-500">{ev.clinicalStatus === 'active' ? 'فعال' : 'اصلاح‌شده (Superseded)'}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToothNodeButton({
  projection,
  notation,
  selected,
  onSelect,
}: {
  projection: DerivedToothStateProjection;
  notation: 'palmer' | 'fdi';
  selected: boolean;
  onSelect: () => void;
}) {
  const { coordinate, primaryFinding, examinationState, surfaceFindings } = projection;
  const findingMeta = FINDING_MAP[primaryFinding];
  const isExamined = examinationState === 'examined';
  const displayLabel = notation === 'fdi' ? String(coordinate.fdi) : coordinate.palmerSymbol;
  const surfaceKeys = Object.keys(surfaceFindings) as ToothSurfaceKey[];

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`odontogram_tooth_${coordinate.fdi}`}
      aria-label={`دندان FDI ${coordinate.fdi} پالمر ${coordinate.palmerDisplay} — ${findingMeta.labelFa}`}
      aria-pressed={selected}
      className="tooth-wrap cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-lg p-0.5"
    >
      <span className="text-[8.5px] font-extrabold mb-0.5 block text-center" style={{ color: selected ? '#059669' : '#475569' }}>
        {displayLabel}
      </span>
      <div
        className="tooth-body flex items-center justify-center relative"
        style={{
          background: isExamined ? findingMeta.bg : '#F8FAFC',
          border: `2px solid ${selected ? '#10B981' : isExamined ? findingMeta.color : '#CBD5E1'}`,
          borderRadius: coordinate.isUpper ? '4px 4px 8px 8px' : '8px 8px 4px 4px',
          opacity: isExamined ? 1 : 0.72,
        }}
      >
        <span className="text-[8px] font-black leading-none" style={{ color: isExamined ? findingMeta.color : '#94A3B8' }}>
          {findingMeta.iconSymbol}
        </span>
        {surfaceKeys.length > 0 && <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-600" />}
      </div>
    </button>
  );
}
