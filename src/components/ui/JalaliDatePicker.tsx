import { useState, useRef, useEffect } from 'react';
import { Calendar, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import {
  JALALI_MONTHS, JALALI_WEEKDAYS_SHORT, getMonthMatrix,
  toJalaliStr, dateStrToJalali, jalaliToGregorianStr, todayJalali, jalaliToFa,
} from '@/lib/jalali';

type Props = {
  value: string;
  onChange: (gregorian: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
};

export function JalaliDatePicker({ value, onChange, placeholder = 'انتخاب تاریخ...', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const todayJ = todayJalali();
  const initial = value ? dateStrToJalali(value) : todayJ;
  const [viewYear, setViewYear] = useState(initial.jy || todayJ.jy);
  const [viewMonth, setViewMonth] = useState(initial.jm || todayJ.jm);
  const [selectedJd, setSelectedJd] = useState<number | null>(initial.jd || null);

  useEffect(() => {
    if (value) {
      const j = dateStrToJalali(value);
      if (j.jy) { setViewYear(j.jy); setViewMonth(j.jm); setSelectedJd(j.jd); }
    }
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const weeks = getMonthMatrix(viewYear, viewMonth);
  const isToday = (jd: number) => todayJ.jy === viewYear && todayJ.jm === viewMonth && todayJ.jd === jd;
  const isSelected = (jd: number) => selectedJd === jd && value !== '';

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };
  const prevYear = () => setViewYear(viewYear - 1);
  const nextYear = () => setViewYear(viewYear + 1);

  const selectDay = (jd: number) => {
    setSelectedJd(jd);
    const greg = jalaliToGregorianStr(viewYear, viewMonth, jd);
    onChange(greg);
    setOpen(false);
  };

  const goToToday = () => {
    setViewYear(todayJ.jy);
    setViewMonth(todayJ.jm);
    setSelectedJd(todayJ.jd);
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-700 transition-all hover:border-gray-300"
      >
        <Calendar size={16} className="text-gray-400 shrink-0" />
        <span className={value ? 'text-gray-700 font-medium' : 'text-gray-400'}>
          {value ? toJalaliStr(value) : placeholder}
        </span>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 right-0 left-0 min-w-[280px] rounded-2xl bg-white shadow-2xl border border-gray-100 p-3 animate-scale-in origin-top">
          {/* Month navigator */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1">
              <button onClick={prevMonth} className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center haptic">
                <ChevronRight size={16} className="text-gray-600" />
              </button>
              <button onClick={prevYear} className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center haptic text-[10px] text-gray-400 font-bold">
                {'<<'}
              </button>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-gray-800">{JALALI_MONTHS[viewMonth - 1]}</p>
              <p className="text-[10px] text-gray-400">{jalaliToFa(viewYear)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={nextYear} className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center haptic text-[10px] text-gray-400 font-bold">
                {'>>'}
              </button>
              <button onClick={nextMonth} className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center haptic">
                <ChevronLeft size={16} className="text-gray-600" />
              </button>
            </div>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {JALALI_WEEKDAYS_SHORT.map((d, i) => (
              <div key={i} className="text-center text-[10px] font-bold text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Days grid */}
          <div className="space-y-0.5">
            {weeks.map((week, wi) => (
              <div key={wi} className="grid grid-cols-7 gap-0.5">
                {week.map((day, di) => (
                  <button
                    key={di}
                    disabled={!day.jd}
                    onClick={() => day.jd && selectDay(day.jd)}
                    className={`aspect-square rounded-lg text-xs font-semibold transition-all haptic flex items-center justify-center
                      ${!day.jd ? 'opacity-0 pointer-events-none' : ''}
                      ${isSelected(day.jd!) ? 'bg-blue-500 text-white shadow-md scale-105' : ''}
                      ${!isSelected(day.jd!) && isToday(day.jd!) ? 'bg-blue-50 text-blue-600 ring-1 ring-blue-200' : ''}
                      ${!isSelected(day.jd!) && !isToday(day.jd!) ? 'text-gray-600 hover:bg-gray-100' : ''}
                    `}
                  >
                    {day.jd ? jalaliToFa(day.jd) : ''}
                  </button>
                ))}
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-3 pt-2 border-t border-gray-100">
            <button onClick={goToToday} className="text-[11px] font-bold text-blue-500 haptic flex items-center gap-1">
              <Check size={12} /> امروز
            </button>
            {value && (
              <button onClick={() => setOpen(false)} className="text-[11px] font-bold text-gray-400 haptic">
                بستن
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
