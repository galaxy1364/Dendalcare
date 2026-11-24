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
      <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom md:hidden">
        <div className="max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto px-2 pb-1.5 pt-1">
          <div
            className="bottom-dock rounded-[26px] flex items-center justify-between px-1.5 py-1"
            style={{
              boxShadow: '0 10px 36px rgba(0,0,0,0.35), 0 4px 0 rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.16)',
            }}
          >
            {/* Primary 5 Sections */}
            {PRIMARY_SECTION_IDS.map((id) => {
              const section = getSection(id);
              const Icon = section.icon;
              const isActive = active === id;
              return (
                <button
                  key={section.id}
                  onClick={() => handleSelect(section.id)}
                  className={`dock-item no-select ${isActive ? 'active' : ''}`}
                  style={{
                    color: isActive ? section.color : '#CBD5E1',
                    minWidth: '54px',
                    minHeight: '50px',
                  }}
                  aria-label={section.label}
                >
                  <div
                    className="dock-icon"
                    style={{
                      background: isActive ? `${section.color}28` : 'rgba(255,255,255,0.04)',
                      border: isActive ? `1px solid ${section.color}65` : '1px solid rgba(255,255,255,0.06)',
                      boxShadow: isActive
                        ? `0 3px 0 ${section.color}55, 0 6px 14px ${section.color}35`
                        : '0 2px 0 rgba(0,0,0,0.35)',
                    }}
                  >
                    <Icon
                      size={isActive ? 21 : 19}
                      strokeWidth={isActive ? 2.5 : 2}
                      style={isActive ? { filter: `drop-shadow(0 2px 6px ${section.color}75)` } : undefined}
                    />
                  </div>
                  <span
                    className="dock-label"
                    style={{
                      color: isActive ? section.color : '#CBD5E1',
                      fontWeight: isActive ? 800 : 600,
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
                color: !isPrimaryActive ? activeSection.color : '#CBD5E1',
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
                    ? `${activeSection.color}28`
                    : moreOpen
                    ? 'rgba(168,85,247,0.28)'
                    : 'rgba(255,255,255,0.04)',
                  border: !isPrimaryActive
                    ? `1px solid ${activeSection.color}65`
                    : '1px solid rgba(255,255,255,0.06)',
                  boxShadow: !isPrimaryActive
                    ? `0 3px 0 ${activeSection.color}55, 0 6px 14px ${activeSection.color}35`
                    : '0 2px 0 rgba(0,0,0,0.35)',
                }}
              >
                {!isPrimaryActive ? (
                  <activeSection.icon
                    size={21}
                    strokeWidth={2.5}
                    style={{ filter: `drop-shadow(0 2px 6px ${activeSection.color}75)` }}
                  />
                ) : (
                  <MoreHorizontal size={20} strokeWidth={2.3} />
                )}
              </div>
              <span
                className="dock-label"
                style={{
                  color: !isPrimaryActive ? activeSection.color : '#CBD5E1',
                  fontWeight: !isPrimaryActive ? 800 : 600,
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
