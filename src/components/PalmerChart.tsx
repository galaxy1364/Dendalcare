import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, type ToothCondition } from '@/lib/supabase';
import { Check, X, Baby, User } from 'lucide-react';

/* ── Condition catalog ── */
const CONDITIONS = [
  { value:'healthy',   label:'سالم',        color:'#22C55E', bg:'#DCFCE7' },
  { value:'caries',    label:'پوسیدگی',    color:'#EF4444', bg:'#FEE2E2' },
  { value:'filled',    label:'پرکردگی',    color:'#3B82F6', bg:'#DBEAFE' },
  { value:'crown',     label:'روکش',        color:'#F59E0B', bg:'#FEF3C7' },
  { value:'bridge',    label:'پل',          color:'#8B5CF6', bg:'#EDE9FE' },
  { value:'implant',   label:'ایمپلنت',    color:'#06B6D4', bg:'#CFFAFE' },
  { value:'extracted', label:'کشیده‌شده',  color:'#6B7280', bg:'#F3F4F6' },
  { value:'missing',   label:'افتاده',      color:'#9CA3AF', bg:'#F9FAFB' },
  { value:'root_canal',label:'عصب‌کشی',    color:'#EC4899', bg:'#FCE7F3' },
  { value:'fracture',  label:'شکستگی',     color:'#F97316', bg:'#FFEDD5' },
  { value:'other',     label:'سایر',        color:'#6366F1', bg:'#E0E7FF' },
];
const CMAP = Object.fromEntries(CONDITIONS.map(c => [c.value, c]));

/* ── Surface keys ── */
type SurfKey = 'o'|'m'|'d'|'b'|'c'; // occlusal, mesial, distal, buccal, central
type SurfMap = Partial<Record<SurfKey, string>>;

const SURFACE_LABELS: Record<SurfKey, string> = {
  o:'اکلوژال', m:'مزیال', d:'دیستال', b:'باکال', c:'مرکزی',
};

function parseSurfaces(raw: string|null): SurfMap {
  if (!raw) return {};
  try { return JSON.parse(raw) as SurfMap; } catch { return {}; }
}

export interface ToothMeta {
  fdi: number;
  palmerNum: number | string;
  quadrant: 'UR' | 'UL' | 'LL' | 'LR';
  quadrantSymbol: string;
}

/* Permanent Teeth (دندان‌های دائمی) */
const PERM_UR: ToothMeta[] = [18,17,16,15,14,13,12,11].map((fdi, idx) => ({
  fdi, palmerNum: 8 - idx, quadrant: 'UR', quadrantSymbol: '┘'
}));
const PERM_UL: ToothMeta[] = [21,22,23,24,25,26,27,28].map((fdi, idx) => ({
  fdi, palmerNum: idx + 1, quadrant: 'UL', quadrantSymbol: '└'
}));
const PERM_LR: ToothMeta[] = [48,47,46,45,44,43,42,41].map((fdi, idx) => ({
  fdi, palmerNum: 8 - idx, quadrant: 'LR', quadrantSymbol: '┐'
}));
const PERM_LL: ToothMeta[] = [31,32,33,34,35,36,37,38].map((fdi, idx) => ({
  fdi, palmerNum: idx + 1, quadrant: 'LL', quadrantSymbol: '┌'
}));

/* Deciduous Teeth (دندان‌های شیری اطفال) */
const DECID_LETTERS = ['E','D','C','B','A'];
const DECID_UR: ToothMeta[] = [55,54,53,52,51].map((fdi, idx) => ({
  fdi, palmerNum: DECID_LETTERS[idx], quadrant: 'UR', quadrantSymbol: '┘'
}));
const DECID_UL: ToothMeta[] = [61,62,63,64,65].map((fdi, idx) => ({
  fdi, palmerNum: ['A','B','C','D','E'][idx], quadrant: 'UL', quadrantSymbol: '└'
}));
const DECID_LR: ToothMeta[] = [85,84,83,82,81].map((fdi, idx) => ({
  fdi, palmerNum: DECID_LETTERS[idx], quadrant: 'LR', quadrantSymbol: '┐'
}));
const DECID_LL: ToothMeta[] = [71,72,73,74,75].map((fdi, idx) => ({
  fdi, palmerNum: ['A','B','C','D','E'][idx], quadrant: 'LL', quadrantSymbol: '┌'
}));

type Props = { patientId: string };

export function PalmerChart({ patientId }: Props) {
  const [conditions, setConditions] = useState<Record<number, ToothCondition>>({});
  const [loading, setLoading] = useState(true);
  const [selectedTooth, setSelectedTooth] = useState<ToothMeta | null>(null);
  const [surfMode, setSurfMode] = useState(false);
  const [activeSurf, setActiveSurf] = useState<SurfKey | null>(null);
  const [dentition, setDentition] = useState<'permanent' | 'deciduous'>('permanent');
  const [notation, setNotation] = useState<'palmer' | 'fdi'>('palmer');

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from('tooth_conditions').select('*').eq('patient_id', patientId);
    const map: Record<number, ToothCondition> = {};
    (data as ToothCondition[] | null)?.forEach(tc => { map[tc.tooth_number] = tc; });
    setConditions(map);
    setLoading(false);
  }, [patientId]);

  useEffect(() => {
    fetch();
    const ch = supabase.channel(`palmer-${patientId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tooth_conditions',
        filter: `patient_id=eq.${patientId}`
      }, fetch)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [patientId, fetch]);

  /* Get condition with FDI/Palmer fallback */
  const getToothCond = (t: ToothMeta): ToothCondition | null => {
    return conditions[t.fdi] || (typeof t.palmerNum === 'number' ? conditions[t.palmerNum] : null) || null;
  };

  /* Set whole-tooth condition */
  const setToothCondition = async (tooth: ToothMeta, cond: string) => {
    const existing = getToothCond(tooth);
    if (existing) {
      if (cond === 'healthy') {
        await supabase.from('tooth_conditions').delete().eq('id', existing.id);
        setConditions(prev => {
          const n = { ...prev };
          delete n[tooth.fdi];
          if (typeof tooth.palmerNum === 'number') delete n[tooth.palmerNum];
          return n;
        });
      } else {
        const { data } = await supabase.from('tooth_conditions')
          .update({ condition: cond }).eq('id', existing.id).select('*').single();
        if (data) setConditions(prev => ({ ...prev, [tooth.fdi]: data as ToothCondition }));
      }
    } else {
      if (cond === 'healthy') return;
      const { data } = await supabase.from('tooth_conditions')
        .insert({ patient_id: patientId, tooth_number: tooth.fdi, condition: cond })
        .select('*').single();
      if (data) setConditions(prev => ({ ...prev, [tooth.fdi]: data as ToothCondition }));
    }
    setSelectedTooth(null);
  };

  /* Set per-surface condition */
  const setSurfaceCondition = async (tooth: ToothMeta, surf: SurfKey, cond: string) => {
    const existing = getToothCond(tooth);
    const surfaces: SurfMap = parseSurfaces(existing?.surface ?? null);
    if (cond === 'healthy') delete surfaces[surf];
    else surfaces[surf] = cond;
    const surfJson = Object.keys(surfaces).length > 0 ? JSON.stringify(surfaces) : null;

    if (existing) {
      const { data } = await supabase.from('tooth_conditions')
        .update({ surface: surfJson }).eq('id', existing.id).select('*').single();
      if (data) setConditions(prev => ({ ...prev, [tooth.fdi]: data as ToothCondition }));
    } else {
      const { data } = await supabase.from('tooth_conditions')
        .insert({ patient_id: patientId, tooth_number: tooth.fdi, condition: 'healthy', surface: surfJson })
        .select('*').single();
      if (data) setConditions(prev => ({ ...prev, [tooth.fdi]: data as ToothCondition }));
    }
  };

  const getSurf = (tooth: ToothMeta, surf: SurfKey) =>
    parseSurfaces(getToothCond(tooth)?.surface ?? null)[surf] ?? null;

  const toothColor = (t: ToothMeta) => {
    const c = getToothCond(t);
    return c ? CMAP[c.condition]?.color ?? '#22C55E' : null;
  };

  const toothBg = (t: ToothMeta) => {
    const c = getToothCond(t);
    return c ? CMAP[c.condition]?.bg ?? '#F9FAFB' : null;
  };

  const currentUR = dentition === 'permanent' ? PERM_UR : DECID_UR;
  const currentUL = dentition === 'permanent' ? PERM_UL : DECID_UL;
  const currentLR = dentition === 'permanent' ? PERM_LR : DECID_LR;
  const currentLL = dentition === 'permanent' ? PERM_LL : DECID_LL;

  if (loading) return (
    <div className="text-center py-8 text-gray-400 text-xs">در حال بارگذاری چارت دندانی...</div>
  );

  return (
    <div className="space-y-3">
      {/* Controls Header: Permanent/Deciduous & FDI/Palmer & Surface Mode */}
      <div className="glass-card p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          {/* Dentition Selector */}
          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              onClick={() => { setDentition('permanent'); setSelectedTooth(null); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${dentition === 'permanent' ? 'bg-white shadow text-emerald-600' : 'text-gray-400'}`}
            >
              <User size={11} /> دندان دائمی
            </button>
            <button
              onClick={() => { setDentition('deciduous'); setSelectedTooth(null); }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${dentition === 'deciduous' ? 'bg-white shadow text-pink-600' : 'text-gray-400'}`}
            >
              <Baby size={11} /> شیری (اطفال)
            </button>
          </div>

          {/* Notation Selector */}
          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              onClick={() => setNotation('palmer')}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${notation === 'palmer' ? 'bg-white shadow text-emerald-600' : 'text-gray-400'}`}
            >
              پالمر
            </button>
            <button
              onClick={() => setNotation('fdi')}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${notation === 'fdi' ? 'bg-white shadow text-blue-600' : 'text-gray-400'}`}
            >
              FDI
            </button>
          </div>

          {/* Mode: Tooth vs Surface */}
          <div className="flex gap-1 p-0.5 rounded-xl bg-gray-100">
            <button
              onClick={() => { setSurfMode(false); setActiveSurf(null); }}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${!surfMode ? 'bg-white shadow text-emerald-600' : 'text-gray-400'}`}
            >دندان</button>
            <button
              onClick={() => setSurfMode(true)}
              className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${surfMode ? 'bg-white shadow text-emerald-600' : 'text-gray-400'}`}
            >سطوح</button>
          </div>
        </div>

        {/* Quick selection toolbar */}
        {dentition === 'permanent' && (
          <div className="flex items-center justify-between text-[10px] pt-1 border-t border-gray-100">
            <span className="text-gray-400">انتخاب سریع:</span>
            <div className="flex gap-1">
              <button
                onClick={() => setSelectedTooth(PERM_UR[7])}
                className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 hover:text-emerald-600"
              >
                قدامی (۱-۳)
              </button>
              <button
                onClick={() => setSelectedTooth(PERM_UR[4])}
                className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 hover:text-emerald-600"
              >
                پره‌مولر (۴-۵)
              </button>
              <button
                onClick={() => setSelectedTooth(PERM_UR[2])}
                className="px-2 py-0.5 rounded-md bg-gray-100 text-gray-600 hover:text-emerald-600"
              >
                مولر (۶-۸)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Interactive 3D Chart Grid */}
      <div className="glass-card p-3 overflow-x-auto">
        {/* Upper Jaw */}
        <div className="text-[9px] font-bold text-gray-400 text-center mb-1">فک بالا (ماگزیلا)</div>
        <div className="flex justify-center items-end gap-px mb-1 min-w-[280px]">
          <span className="text-[8px] text-gray-400 w-4 text-center leading-none">R</span>
          {currentUR.map(t => (
            <Tooth3D
              key={`ur-${t.fdi}`}
              t={t}
              notation={notation}
              color={toothColor(t)}
              bgColor={toothBg(t)}
              surfaces={parseSurfaces(getToothCond(t)?.surface ?? null)}
              selected={selectedTooth?.fdi === t.fdi}
              isUpper
              onClick={() => {
                setSelectedTooth(selectedTooth?.fdi === t.fdi ? null : t);
                setActiveSurf(null);
              }}
            />
          ))}
          <div className="w-px h-8 bg-gray-300 mx-1 self-center" />
          {currentUL.map(t => (
            <Tooth3D
              key={`ul-${t.fdi}`}
              t={t}
              notation={notation}
              color={toothColor(t)}
              bgColor={toothBg(t)}
              surfaces={parseSurfaces(getToothCond(t)?.surface ?? null)}
              selected={selectedTooth?.fdi === t.fdi}
              isUpper
              onClick={() => {
                setSelectedTooth(selectedTooth?.fdi === t.fdi ? null : t);
                setActiveSurf(null);
              }}
            />
          ))}
          <span className="text-[8px] text-gray-400 w-4 text-center leading-none">L</span>
        </div>

        {/* Midline separator */}
        <div className="h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent my-2" />

        {/* Lower Jaw */}
        <div className="flex justify-center items-start gap-px mt-1 min-w-[280px]">
          <span className="text-[8px] text-gray-400 w-4 text-center leading-none">R</span>
          {currentLR.map(t => (
            <Tooth3D
              key={`lr-${t.fdi}`}
              t={t}
              notation={notation}
              color={toothColor(t)}
              bgColor={toothBg(t)}
              surfaces={parseSurfaces(getToothCond(t)?.surface ?? null)}
              selected={selectedTooth?.fdi === t.fdi}
              isUpper={false}
              onClick={() => {
                setSelectedTooth(selectedTooth?.fdi === t.fdi ? null : t);
                setActiveSurf(null);
              }}
            />
          ))}
          <div className="w-px h-8 bg-gray-300 mx-1 self-center" />
          {currentLL.map(t => (
            <Tooth3D
              key={`ll-${t.fdi}`}
              t={t}
              notation={notation}
              color={toothColor(t)}
              bgColor={toothBg(t)}
              surfaces={parseSurfaces(getToothCond(t)?.surface ?? null)}
              selected={selectedTooth?.fdi === t.fdi}
              isUpper={false}
              onClick={() => {
                setSelectedTooth(selectedTooth?.fdi === t.fdi ? null : t);
                setActiveSurf(null);
              }}
            />
          ))}
          <span className="text-[8px] text-gray-400 w-4 text-center leading-none">L</span>
        </div>
        <div className="text-[9px] font-bold text-gray-400 text-center mt-1">فک پایین (مندیبل)</div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1">
        {CONDITIONS.map(c => (
          <span key={c.value} className="badge text-[9px] py-0.5" style={{ color: c.color, background: c.bg }}>
            {c.label}
          </span>
        ))}
      </div>

      {/* Whole-Tooth Condition Picker */}
      {selectedTooth !== null && !surfMode && (
        <div className="glass-card p-3 animate-scale-in">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-bold text-gray-700">
              دندان {notation === 'fdi' ? `FDI #${selectedTooth.fdi}` : `پالمر ${selectedTooth.palmerNum}${selectedTooth.quadrantSymbol}`}
            </p>
            <button onClick={() => setSelectedTooth(null)}><X size={14} className="text-gray-400" /></button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {CONDITIONS.map(c => (
              <button
                key={c.value}
                onClick={() => setToothCondition(selectedTooth, c.value)}
                className="flex items-center gap-1 py-2 px-2 rounded-xl text-[10px] font-semibold haptic transition-all"
                style={{ color: c.color, background: c.bg }}
              >
                {getToothCond(selectedTooth)?.condition === c.value && <Check size={9} />}
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Surface-Mode Picker */}
      {selectedTooth !== null && surfMode && (
        <div className="glass-card p-3 animate-scale-in">
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs font-bold text-gray-700">
              سطح‌بندی دندان {notation === 'fdi' ? `#${selectedTooth.fdi}` : `${selectedTooth.palmerNum}${selectedTooth.quadrantSymbol}`}
            </p>
            <button onClick={() => { setSelectedTooth(null); setActiveSurf(null); }}>
              <X size={14} className="text-gray-400" />
            </button>
          </div>

          <div className="flex justify-center mb-3">
            <ToothSurfaceMap
              toothLabel={notation === 'fdi' ? String(selectedTooth.fdi) : String(selectedTooth.palmerNum)}
              getSurf={(s) => getSurf(selectedTooth, s)}
              activeSurf={activeSurf}
              onSurfClick={setActiveSurf}
            />
          </div>

          {activeSurf && (
            <div className="animate-fade-in">
              <p className="text-[10px] text-gray-400 font-semibold mb-1.5">وضعیت سطح {SURFACE_LABELS[activeSurf]}:</p>
              <div className="grid grid-cols-4 gap-1.5">
                {CONDITIONS.filter(c => ['caries','filled','crown','fracture','healthy','other','root_canal'].includes(c.value)).map(c => {
                  const current = getSurf(selectedTooth, activeSurf);
                  return (
                    <button
                      key={c.value}
                      onClick={() => setSurfaceCondition(selectedTooth, activeSurf, c.value)}
                      className="flex items-center gap-1 py-2 px-2 rounded-xl text-[9px] font-semibold haptic"
                      style={{ color: c.color, background: c.bg }}
                    >
                      {current === c.value && <Check size={8} />}
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 3D Tooth Component ── */
function Tooth3D({
  t, notation, color, bgColor, surfaces, selected, isUpper, onClick,
}: {
  t: ToothMeta; notation: 'palmer' | 'fdi';
  color: string | null; bgColor: string | null;
  surfaces: SurfMap; selected: boolean; isUpper: boolean;
  onClick: () => void;
}) {
  const hasSurfs = Object.keys(surfaces).length > 0;
  const baseBg = bgColor ?? '#F1F5F9';
  const baseBorder = color ?? '#CBD5E1';
  const displayLabel = notation === 'fdi' ? String(t.fdi) : String(t.palmerNum);

  return (
    <div className="tooth-wrap cursor-pointer select-none" onClick={onClick}>
      <span className="text-[8px] font-bold mb-0.5" style={{ color: selected ? '#10B981' : '#64748B' }}>
        {displayLabel}
      </span>
      <div
        className="tooth-body"
        style={{
          background: baseBg,
          border: `2px solid ${selected ? '#10B981' : baseBorder}`,
          borderRadius: isUpper ? '4px 4px 8px 8px' : '8px 8px 4px 4px',
          opacity: color ? 1 : 0.65,
          boxShadow: selected
            ? '0 0 0 2px #10B981, 0 4px 12px rgba(16,185,129,.3)'
            : '0 2px 5px rgba(0,0,0,.1), inset 0 1px 2px rgba(255,255,255,.5)',
        }}
      >
        {/* Surface segments overlay */}
        {hasSurfs && (
          <>
            {(['o','m','d','b','c'] as SurfKey[]).map(s => {
              const sc = surfaces[s];
              if (!sc) return null;
              const ci = CMAP[sc];
              return (
                <div key={s} className={`surf surf-${s}`}
                  style={{ background: ci ? `${ci.color}55` : 'transparent', border: ci ? `1px solid ${ci.color}80` : 'none' }}
                />
              );
            })}
          </>
        )}
        {/* Main condition bar */}
        {!hasSurfs && color && (
          <div style={{
            position:'absolute', left:0, right:0, height:'28%',
            background: color,
            top: isUpper ? 0 : undefined,
            bottom: isUpper ? undefined : 0,
            borderRadius: isUpper ? '2px 2px 0 0' : '0 0 3px 3px',
          }} />
        )}
      </div>
    </div>
  );
}

/* ── Interactive surface map ── */
function ToothSurfaceMap({
  toothLabel, getSurf, activeSurf, onSurfClick,
}: {
  toothLabel: string;
  getSurf: (s: SurfKey) => string | null;
  activeSurf: SurfKey | null;
  onSurfClick: (s: SurfKey) => void;
}) {
  const surfStyle = (s: SurfKey) => {
    const cond = getSurf(s);
    const isActive = activeSurf === s;
    const ci = cond ? CMAP[cond] : null;
    return {
      fill: isActive ? (ci ? ci.color : '#10B981') : (ci ? `${ci.color}80` : '#E5E7EB'),
      stroke: isActive ? '#10B981' : (ci ? ci.color : '#CBD5E1'),
      strokeWidth: isActive ? 2 : 1,
      cursor: 'pointer',
      transition: 'all .2s ease',
    };
  };

  return (
    <svg width={84} height={104} viewBox="0 0 80 100">
      {/* Occlusal (top) */}
      <rect x={18} y={8} width={44} height={25} rx={4} style={surfStyle('o')} onClick={() => onSurfClick('o')} />
      {/* Mesial */}
      <rect x={8}  y={8} width={10} height={84} rx={3} style={surfStyle('m')} onClick={() => onSurfClick('m')} />
      {/* Distal */}
      <rect x={62} y={8} width={10} height={84} rx={3} style={surfStyle('d')} onClick={() => onSurfClick('d')} />
      {/* Buccal/lingual (bottom) */}
      <rect x={18} y={67} width={44} height={25} rx={4} style={surfStyle('b')} onClick={() => onSurfClick('b')} />
      {/* Central */}
      <rect x={24} y={34} width={32} height={32} rx={3} style={surfStyle('c')} onClick={() => onSurfClick('c')} />
      {/* Tooth number label */}
      <text x={40} y={55} textAnchor="middle" dominantBaseline="middle"
        style={{ fontSize: 11, fontWeight: 800, fill: '#374151', fontFamily: 'Vazirmatn,sans-serif' }}>
        {toothLabel}
      </text>
    </svg>
  );
}
