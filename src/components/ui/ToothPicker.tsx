type Props = {
  value: number | null;
  onChange: (tooth: number | null) => void;
};

const QUADRANTS: { label: string; teeth: number[] }[] = [
  { label: 'بالا راست', teeth: [18, 17, 16, 15, 14, 13, 12, 11] },
  { label: 'بالا چپ', teeth: [21, 22, 23, 24, 25, 26, 27, 28] },
  { label: 'پایین راست', teeth: [48, 47, 46, 45, 44, 43, 42, 41] },
  { label: 'پایین چپ', teeth: [31, 32, 33, 34, 35, 36, 37, 38] },
];

export function ToothPicker({ value, onChange }: Props) {
  return (
    <div className="rounded-2xl bg-white/60 border border-violet-100 p-2.5 space-y-2">
      {QUADRANTS.map(q => (
        <div key={q.label}>
          <p className="text-[10px] text-gray-400 mb-1 px-0.5">{q.label}</p>
          <div className="grid grid-cols-8 gap-1">
            {q.teeth.map(t => {
              const selected = value === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => onChange(selected ? null : t)}
                  className={`h-8 rounded-lg text-[11px] font-bold transition-all haptic ${
                    selected ? 'bg-violet-500 text-white shadow-md' : 'bg-gray-50 text-gray-600 hover:bg-violet-50'
                  }`}
                >
                  {t.toLocaleString('fa-IR')}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-gray-400 pt-0.5 px-0.5">
        {value ? `دندان انتخاب‌شده: ${value.toLocaleString('fa-IR')}` : 'برای خدمت‌های کلی (بدون دندان) انتخابی لازم نیست'}
      </p>
    </div>
  );
}
