import { useState } from 'react';
import { Camera, Image as ImageIcon, X, Plus, Eye, Trash2, Tag } from 'lucide-react';
import type { Patient } from '@/lib/supabase';

type Props = {
  open: boolean;
  onClose: () => void;
  patient: Patient | null;
};

type DentalImage = {
  id: string;
  url: string;
  category: 'opg' | 'periapical' | 'before' | 'after' | 'cbct';
  title: string;
  date: string;
};

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  opg: { label: 'رادیولوژی OPG', color: '#3B82F6' },
  periapical: { label: 'تک‌دندان PA', color: '#10B981' },
  before: { label: 'قبل درمان', color: '#F59E0B' },
  after: { label: 'بعد درمان', color: '#8B5CF6' },
  cbct: { label: 'سی‌تی‌اسکن CBCT', color: '#EC4899' },
};

export function PatientGalleryModal({ open, onClose, patient }: Props) {
  const [images, setImages] = useState<DentalImage[]>(() => {
    if (!patient) return [];
    try {
      const saved = localStorage.getItem(`dental_images_${patient.id}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [selectedPreview, setSelectedPreview] = useState<DentalImage | null>(null);

  if (!open || !patient) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, category: DentalImage['category']) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const url = event.target?.result as string;
      const newImg: DentalImage = {
        id: Math.random().toString(36).slice(2, 9),
        url,
        category,
        title: file.name.replace(/\.[^/.]+$/, ''),
        date: new Date().toISOString().slice(0, 10),
      };

      const updated = [newImg, ...images];
      setImages(updated);
      try {
        localStorage.setItem(`dental_images_${patient.id}`, JSON.stringify(updated));
      } catch {}
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = (id: string) => {
    const updated = images.filter((img) => img.id !== id);
    setImages(updated);
    try {
      localStorage.setItem(`dental_images_${patient.id}`, JSON.stringify(updated));
    } catch {}
  };

  const filtered = activeCategory === 'all' ? images : images.filter((img) => img.category === activeCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl p-6 text-white animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <Camera size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">گالری رادیولوژی و تصاویر بالینی</h3>
              <p className="text-xs text-slate-400">بیمار: {patient.first_name} {patient.last_name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 flex items-center justify-center text-slate-400 transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Category Filters & Upload Button */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${activeCategory === 'all' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-800 text-slate-400'}`}
            >
              همه ({images.length})
            </button>
            {Object.entries(CATEGORY_LABELS).map(([cat, cfg]) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-2.5 py-1 rounded-xl text-xs font-bold transition-all ${activeCategory === cat ? 'text-white' : 'bg-slate-800 text-slate-400'}`}
                style={activeCategory === cat ? { background: cfg.color } : undefined}
              >
                {cfg.label}
              </button>
            ))}
          </div>

          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-600/30 transition-all active:scale-95">
            <Plus size={14} />
            افزودن تصویر / OPG
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFileUpload(e, 'opg')}
            />
          </label>
        </div>

        {/* Image Grid */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-slate-800 rounded-2xl">
            <ImageIcon size={40} className="text-slate-600 mb-2" />
            <p className="text-sm font-semibold text-slate-400">تصویری در این دسته ثبت نشده است</p>
            <p className="text-xs text-slate-500 mt-1">جهت ثبت عکس رادیولوژی یا عکس بالینی روی دکمه افزودن کلیک کنید</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {filtered.map((img) => {
              const cfg = CATEGORY_LABELS[img.category] || CATEGORY_LABELS.opg;
              return (
                <div
                  key={img.id}
                  className="group relative rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 aspect-square flex flex-col justify-end"
                >
                  <img
                    src={img.url}
                    alt={img.title}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Actions overlay */}
                  <div className="relative z-10 p-2.5 flex items-center justify-between">
                    <span
                      className="px-2 py-0.5 rounded-md text-[9px] font-bold text-white shadow-sm"
                      style={{ background: cfg.color }}
                    >
                      {cfg.label}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setSelectedPreview(img)}
                        className="w-7 h-7 rounded-lg bg-white/20 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/30"
                      >
                        <Eye size={12} />
                      </button>
                      <button
                        onClick={() => handleDelete(img.id)}
                        className="w-7 h-7 rounded-lg bg-red-500/30 backdrop-blur-md flex items-center justify-center text-red-300 hover:bg-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Fullscreen image viewer */}
        {selectedPreview && (
          <div
            className="fixed inset-0 z-60 bg-black/90 flex flex-col items-center justify-center p-4 animate-fade-in"
            onClick={() => setSelectedPreview(null)}
          >
            <button
              onClick={() => setSelectedPreview(null)}
              className="absolute top-4 left-4 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-white"
            >
              <X size={20} />
            </button>
            <img
              src={selectedPreview.url}
              alt={selectedPreview.title}
              className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <p className="mt-4 text-sm font-bold text-white">{selectedPreview.title}</p>
          </div>
        )}
      </div>
    </div>
  );
}
