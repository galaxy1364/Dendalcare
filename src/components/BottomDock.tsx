import { useState } from 'react';
import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { MoreHorizontal, X, ArrowUpLeft } from 'lucide-react';

type Props = { active: SectionId; onChange: (id: SectionId) => void };

// 5 core clinical modules for the primary dock
const PRIMARY_SECTION_IDS: SectionId[] = ['dashboard', 'patients', 'appointments', 'treatments', 'finance'];

// Unique non-repeating QBank pastel/vivid gradients for every module in the "More" sheet
const MORE_TILE_GRADIENTS: Record<string, { bg: string; iconBg: string; textColor: string; sub: string }> = {
  calendar:  { bg: 'linear-gradient(135deg, #FAE8FF 0%, #E879F9 100%)', iconBg: '#FFFFFF', textColor: '#701A75', sub: 'شمسی • قمری • میلادی' },
  lab:       { bg: 'linear-gradient(135deg, #FCE7F3 0%, #F472B6 100%)', iconBg: '#FFFFFF', textColor: '#831843', sub: 'ارسال و دریافت پروتز' },
  implants:  { bg: 'linear-gradient(135deg, #CFFAFE 0%, #22D3EE 100%)', iconBg: '#FFFFFF', textColor: '#164E63', sub: 'جراحی، هیلینگ و روکش' },
  inventory: { bg: 'linear-gradient(135deg, #FFEDD5 0%, #FB923C 100%)', iconBg: '#FFFFFF', textColor: '#7C2D12', sub: 'موجودی مواد و آلارم' },
  reminders: { bg: 'linear-gradient(135deg, #FEE2E2 0%, #F87171 100%)', iconBg: '#FFFFFF', textColor: '#7F1D1D', sub: 'رادار هوشمند پیگیری' },
  staff:     { bg: 'linear-gradient(135deg, #E0E7FF 0%, #818CF8 100%)', iconBg: '#FFFFFF', textColor: '#312E81', sub: 'پرسنل، پزشکان و سهم' },
  messages:  { bg: 'linear-gradient(135deg, #E0F2FE 0%, #38BDF8 100%)', iconBg: '#FFFFFF', textColor: '#0C4A6E', sub: 'پیامک، نوبت و تبلیغات' },
  settings:  { bg: 'linear-gradient(135deg, #F1F5F9 0%, #94A3B8 100%)', iconBg: '#FFFFFF', textColor: '#1E293B', sub: 'تعاریف، تعرفه و بک‌آپ' },
};

export function BottomDock({ active, onChange }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  const isPrimaryActive = PRIMARY_SECTION_IDS.includes(active);
  const activeSection = getSection(active);
  const moreSections = SECTIONS.filter((s) => !PRIMARY_SECTION_IDS.includes(s.id));

  const handleSelect = (id: SectionId) => {
    onChange(id);
    setMoreOpen(false);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom">
        <div className="max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto px-2 pb-1.5 pt-1">
          <div
            className="bottom-dock rounded-[26px] flex items-center justify-between px-1.5 py-1"
            style={{
              boxShadow: '0 10px 36px rgba(0,0,0,0.45), 0 4px 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.16)',
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
              onClick={() => setMoreOpen(!moreOpen)}
              className={`dock-item no-select ${!isPrimaryActive || moreOpen ? 'active' : ''}`}
              style={{
                color: !isPrimaryActive ? activeSection.color : '#CBD5E1',
                minWidth: '54px',
                minHeight: '50px',
              }}
              aria-label="سایر بخش‌ها"
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

      {/* Overflow "More Sections" Modal Sheet — 2-Column Edge-to-Edge QBank Curved Tiles */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onClick={() => setMoreOpen(false)}
        >
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-xl md:max-w-3xl max-h-[86vh] overflow-y-auto glass-dark rounded-t-[32px] px-3 pt-4 pb-6 border-t border-white/20 sheet-enter safe-bottom"
            onClick={(e) => e.stopPropagation()}
            style={{
              boxShadow: '0 -12px 45px rgba(0,0,0,0.6)',
            }}
          >
            <div className="w-12 h-1.5 rounded-full bg-white/25 mx-auto mb-3" />

            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 px-1">
              <div>
                <h3 className="text-base font-black text-white">سایر ماژول‌های تخصصی مینادنتال</h3>
                <p className="text-[11px] text-purple-200/75">کاشی‌های منحنی کیوبانک با رنگ اختصاصی هر بخش</p>
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/80 hover:bg-white/20 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* 2-Column Stretched QBank Curved Tiles */}
            <div className="grid grid-cols-2 gap-2.5">
              {moreSections.map((sec) => {
                const Icon = sec.icon;
                const isCurrent = active === sec.id;
                const styleCfg = MORE_TILE_GRADIENTS[sec.id] || {
                  bg: `linear-gradient(135deg, #EDE9FE 0%, ${sec.color} 100%)`,
                  iconBg: '#FFFFFF',
                  textColor: '#1E1B4B',
                  sub: 'ماژول تخصصی مطب',
                };
                return (
                  <div
                    key={sec.id}
                    onClick={() => handleSelect(sec.id)}
                    className="qbank-tile text-right"
                    style={{
                      background: styleCfg.bg,
                      outline: isCurrent ? `2.5px solid #FFFFFF` : 'none',
                      minHeight: '108px',
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div
                        className="w-10 h-10 rounded-2xl flex items-center justify-center shadow-md shrink-0"
                        style={{
                          background: styleCfg.iconBg,
                          color: sec.color,
                        }}
                      >
                        <Icon size={21} strokeWidth={2.3} />
                      </div>
                      {isCurrent && (
                        <span className="text-[9px] font-black px-2 py-0.5 rounded-full bg-white/90 text-slate-900 shadow-sm">
                          فعال
                        </span>
                      )}
                    </div>
                    <div className="pr-0.5 pl-7">
                      <div className="text-sm font-black truncate" style={{ color: styleCfg.textColor }}>
                        {sec.label}
                      </div>
                      <div className="text-[10px] font-bold opacity-80 truncate mt-0.5" style={{ color: styleCfg.textColor }}>
                        {styleCfg.sub}
                      </div>
                    </div>
                    {/* QBank Spring Corner Key */}
                    <div className="qbank-corner-key" style={{ color: sec.color }}>
                      <ArrowUpLeft size={15} strokeWidth={2.6} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
