import { useState } from 'react';
import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/lib/designTokens';
import { MoreHorizontal, X } from 'lucide-react';
import { QBankTile } from '@/components/ui/QBankTile';
import { playTactileFeedback } from '@/lib/hapticsAudio';

type Props = { active: SectionId; onChange: (id: SectionId) => void };

// 5 core clinical modules for the primary dock
const PRIMARY_SECTION_IDS: SectionId[] = ['dashboard', 'patients', 'appointments', 'treatments', 'finance'];

const MORE_SUBTITLES: Record<string, string> = {
  calendar:  'شمسی • قمری • میلادی',
  lab:       'ارسال و دریافت پروتز',
  implants:  'جراحی، هیلینگ و روکش',
  inventory: 'موجودی مواد و آلارم',
  reminders: 'رادار هوشمند پیگیری',
  staff:     'پرسنل، پزشکان و سهم',
  messages:  'پیامک، نوبت و تبلیغات',
  settings:  'تعاریف، تعرفه و بک‌آپ',
};

export function BottomDock({ active, onChange }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isPrimaryActive = PRIMARY_SECTION_IDS.includes(active);
  const activeSection = getSection(active);
  const moreSections = SECTIONS.filter((s) => !PRIMARY_SECTION_IDS.includes(s.id));

  const handleSelect = (id: SectionId) => {
    playTactileFeedback('dock');
    onChange(id);
    setMoreOpen(false);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom md:hidden bg-gradient-to-t from-[#F3F6FB] via-[#F3F6FB]/90 to-transparent">
        <div className="max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto px-2 pb-1.5 pt-1">
          <div
            className="bottom-dock rounded-[26px] flex items-center justify-between px-1.5 py-1"
            style={{
              boxShadow: '0 -2px 20px rgba(15,23,42,0.08), 0 8px 24px rgba(15,23,42,0.10)',
            }}
          >
            {/* Primary 5 Sections */}
            {PRIMARY_SECTION_IDS.map((id) => {
              const section = getSection(id);
              const tok = getModuleToken(id);
              const Icon = section.icon;
              const isActive = active === id;
              return (
                <button
                  key={section.id}
                  onClick={() => handleSelect(section.id)}
                  className={`dock-item no-select ${isActive ? 'active' : ''}`}
                  style={{
                    color: isActive ? tok.primary : '#475569',
                    minWidth: '54px',
                    minHeight: '50px',
                  }}
                  aria-label={section.label}
                >
                  <div
                    className="dock-icon"
                    style={{
                      background: isActive ? tok.surfaceTintEnd : '#F8FAFC',
                      border: isActive ? `1.5px solid ${tok.surfaceBorder}` : '1px solid #E2E8F0',
                      boxShadow: isActive
                        ? `0 3px 0 ${tok.surfaceBorder}, 0 6px 12px ${tok.primary}22`
                        : '0 2px 0 #E2E8F0',
                    }}
                  >
                    <Icon
                      size={isActive ? 21 : 19}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  </div>
                  <span
                    className="dock-label"
                    style={{
                      color: isActive ? tok.primaryDark : '#475569',
                      fontWeight: isActive ? 800 : 700,
                    }}
                  >
                    {section.label}
                  </span>
                </button>
              );
            })}

            {/* 6th "More / Overflow" Tab */}
            <button
              onClick={() => {
                playTactileFeedback('dock');
                setMoreOpen(!moreOpen);
              }}
              className={`dock-item no-select ${!isPrimaryActive || moreOpen ? 'active' : ''}`}
              style={{
                color: !isPrimaryActive ? activeSection.color : '#475569',
                minWidth: '54px',
                minHeight: '50px',
              }}
              aria-label="سایر بخش‌ها"
              data-testid="dock_more_button"
            >
              <div
                className="dock-icon"
                style={{
                  background: !isPrimaryActive
                    ? activeSection.surfaceTintEnd
                    : moreOpen
                    ? '#F3E8FF'
                    : '#F8FAFC',
                  border: !isPrimaryActive
                    ? `1.5px solid ${activeSection.surfaceBorder}`
                    : '1px solid #E2E8F0',
                  boxShadow: !isPrimaryActive
                    ? `0 3px 0 ${activeSection.surfaceBorder}, 0 6px 12px ${activeSection.color}22`
                    : '0 2px 0 #E2E8F0',
                }}
              >
                {!isPrimaryActive ? (
                  <activeSection.icon
                    size={21}
                    strokeWidth={2.5}
                  />
                ) : (
                  <MoreHorizontal size={20} strokeWidth={2.3} />
                )}
              </div>
              <span
                className="dock-label"
                style={{
                  color: !isPrimaryActive ? activeSection.darkColor : '#475569',
                  fontWeight: !isPrimaryActive ? 800 : 700,
                }}
              >
                {!isPrimaryActive ? activeSection.label : 'سایر'}
              </span>
            </button>
          </div>
        </div>
      </nav>

      {/* Overflow "More Sections" Sheet — 2-Column 100% Authentic QBank Curved-Notch Tiles */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-xl md:max-w-3xl max-h-[86vh] overflow-y-auto bg-[#F4F5F9]/98 backdrop-blur-2xl rounded-t-[32px] px-3 pt-4 pb-6 border-t border-white shadow-2xl sheet-enter safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-12 h-1.5 rounded-full bg-slate-300 mx-auto mb-3" />

            <div className="flex items-center justify-between pb-3 border-b border-slate-200/80 mb-3 px-1">
              <div>
                <h3 className="text-base font-black text-slate-800">سایر بخش‌های تخصصی مینادنتال</h3>
                <p className="text-[11px] text-slate-500">دسترسی سریع به تمام بخش‌های کلینیک</p>
              </div>
              <button
                onClick={() => {
                  playTactileFeedback('soft');
                  setMoreOpen(false);
                }}
                aria-label="بستن"
                className="w-9 h-9 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 shadow-sm hover:bg-slate-50 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* 2-Column Authentic QBank Curved-Notch Tiles */}
            <div className="grid grid-cols-2 gap-2.5">
              {moreSections.map((sec) => {
                const Icon = sec.icon;
                const isCurrent = active === sec.id;
                const tok = getModuleToken(sec.id);
                const subLabel = MORE_SUBTITLES[sec.id] || 'ماژول تخصصی مطب';
                return (
                  <QBankTile
                    key={sec.id}
                    color={tok.primary}
                    darkColor={tok.primaryDark}
                    surfaceBg={tok.surfaceTintStart}
                    surfaceBgEnd={tok.surfaceTintEnd}
                    borderColor={tok.surfaceBorder}
                    icon={<Icon size={20} strokeWidth={2.3} />}
                    label={sec.label}
                    sub={subLabel}
                    badge={isCurrent ? 'فعال' : undefined}
                    selected={isCurrent}
                    testId={`more_tile_${sec.id}`}
                    onClick={() => handleSelect(sec.id)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
