import { useState, useMemo } from 'react';
import {
  MessageSquare, Plus, Search, X, Send, MailOpen, Mail, Trash2,
  Clock, User, Smartphone, Megaphone, Sparkles, CheckCircle2, PhoneCall,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase, type Message, type Staff, type Patient, type Appointment, type InstallmentPlan,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState } from '@/components/ui/Form';
import { toJalaliStr } from '@/lib/jalali';

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  low: { label: 'کم', color: '#9CA3AF', bg: '#F3F4F6' },
  normal: { label: 'عادی', color: '#3B82F6', bg: '#DBEAFE' },
  high: { label: 'مهم', color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { label: 'فوری', color: '#EF4444', bg: '#FEE2E2' },
};

const SMS_TEMPLATES = [
  {
    id: 'tpl_appt',
    title: 'یادآوری نوبت دندانپزشکی',
    category: 'نوبت‌دهی',
    body: 'مراجعه‌کننده گرامی {نام}، نوبت دندانپزشکی شما در کلینیک مینادنتال (دکتر مهدی امیری) برای تاریخ {تاریخ} ثبت شده است. لطفاً ۱۵ دقیقه زودتر حضور فرمایید.',
  },
  {
    id: 'tpl_implant_care',
    title: 'مراقبت‌های پس از جراحی ایمپلنت',
    category: 'ایمپلنت و جراحی',
    body: 'بیمار گرامی {نام}، پس از جراحی ایمپلنت تا ۲۴ ساعت از کمپرس سرد استفاده نموده و از مصرف غذای داغ خودداری فرمایید. کلینیک تخصصی مینادنتال',
  },
  {
    id: 'tpl_installment',
    title: 'یادآوری سررسید قسط / چک',
    category: 'مالی',
    body: 'مراجعه‌کننده گرامی {نام}، سررسید قسط درمان دندانپزشکی شما در کلینیک مینادنتال نزدیک است. از همراهی و خوش‌حسابی شما سپاسگزاریم.',
  },
  {
    id: 'tpl_campaign',
    title: 'جشنواره چکاپ و جرم‌گیری تخصصی',
    category: 'تبلیغات',
    body: 'همراه گرامی {نام}، کلینیک دندانپزشکی مینادنتال به مناسبت فصل جدید، ویزیت و مشاوره تخصصی طرح درمان و ایمپلنت را با شرایط ویژه ارائه می‌دهد.',
  },
];

type MessageChipTab = 'all' | 'unread' | 'smart_sms' | 'campaigns' | 'templates';

export function Messages() {
  const { data: messages } = useRealtimeTable<Message>('messages');
  const { data: staff } = useRealtimeTable<Staff>('staff');
  const { data: patients } = useRealtimeTable<Patient>('patients');
  const { data: appointments } = useRealtimeTable<Appointment>('appointments');
  const { data: installments } = useRealtimeTable<InstallmentPlan>('installment_plans');

  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeChip, setActiveChip] = useState<MessageChipTab>('all');
  const [composeOpen, setComposeOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(SMS_TEMPLATES[0].id);
  const [customCampaignText, setCustomCampaignText] = useState(SMS_TEMPLATES[3].body);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const [form, setForm] = useState({ to_staff_id: '', subject: '', body: '', priority: 'normal' });

  const currentStaffId = staff[0]?.id ?? null;

  const filtered = useMemo(() => {
    let list = messages;
    if (activeChip === 'unread') list = list.filter(m => !m.is_read);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(m => m.subject.toLowerCase().includes(q) || m.body?.toLowerCase().includes(q));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [messages, search, activeChip]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter(p =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
      p.phone?.includes(q)
    );
  }, [patients, search]);

  const unreadCount = messages.filter(m => !m.is_read).length;
  const getStaff = (id: string | null) => staff.find(s => s.id === id);

  const send = async () => {
    if (!form.to_staff_id || !form.subject.trim()) return;
    setSaving(true);
    await supabase.from('messages').insert({
      from_staff_id: currentStaffId,
      to_staff_id: form.to_staff_id,
      subject: form.subject,
      body: form.body || null,
      priority: form.priority,
      is_read: false,
    });
    setSaving(false);
    setComposeOpen(false);
    setForm({ to_staff_id: '', subject: '', body: '', priority: 'normal' });
  };

  const markRead = async (id: string) => {
    await supabase.from('messages').update({ is_read: true }).eq('id', id);
  };
  const del = async (id: string) => {
    await supabase.from('messages').delete().eq('id', id);
  };

  const triggerPatientSms = async (patient: Patient, templateBody: string, channel: 'sms' | 'whatsapp') => {
    const pAppt = appointments.find(a => a.patient_id === patient.id);
    const dateText = pAppt ? toJalaliStr(pAppt.appointment_date) : 'فردا';
    const personalized = templateBody
      .replace(/\{نام\}/g, `${patient.first_name} ${patient.last_name}`)
      .replace(/\{تاریخ\}/g, dateText);

    // Log in internal messages as audit trail
    await supabase.from('messages').insert({
      from_staff_id: currentStaffId,
      to_staff_id: currentStaffId,
      subject: `ارسال ${channel === 'sms' ? 'پیامک' : 'واتساپ'} به ${patient.first_name} ${patient.last_name}`,
      body: personalized,
      priority: 'normal',
      is_read: true,
    });

    setSentNotice(`پیام برای ${patient.first_name} ${patient.last_name} آماده ارسال شد`);
    setTimeout(() => setSentNotice(null), 3500);

    const cleanPhone = (patient.phone || '').replace(/\s+/g, '');
    if (channel === 'sms' && cleanPhone) {
      window.open(`sms:${cleanPhone}?body=${encodeURIComponent(personalized)}`, '_self');
    } else if (channel === 'whatsapp' && cleanPhone) {
      const intl = cleanPhone.startsWith('0') ? `98${cleanPhone.slice(1)}` : cleanPhone;
      window.open(`https://wa.me/${intl}?text=${encodeURIComponent(personalized)}`, '_blank');
    }
  };

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* QBank Top Bar: Sliding Horizontal Chip Bar + Animated Magnifying Glass Search */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen || search
                ? 'bg-sky-500 text-white shadow-md'
                : 'bg-sky-50 text-sky-600 hover:bg-sky-100'
            }`}
            title="جستجو در پیام‌ها و بیماران"
            data-testid="messages_search_toggle"
          >
            {searchOpen ? <X size={17} /> : <Search size={17} />}
          </button>

          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar flex-1 py-0.5">
            {[
              { key: 'all' as const, label: `همه پیام‌ها (${messages.length.toLocaleString('fa-IR')})` },
              { key: 'unread' as const, label: `خوانده‌نشده (${unreadCount.toLocaleString('fa-IR')})` },
              { key: 'smart_sms' as const, label: `پیامک هوشمند نوبت و اقساط (${patients.length.toLocaleString('fa-IR')})` },
              { key: 'campaigns' as const, label: 'کمپین تبلیغات و تبریک' },
              { key: 'templates' as const, label: `قالب‌های آماده (${SMS_TEMPLATES.length.toLocaleString('fa-IR')})` },
            ].map(ch => (
              <button
                key={ch.key}
                onClick={() => setActiveChip(ch.key)}
                className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 ${
                  activeChip === ch.key
                    ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-sm'
                    : 'bg-gray-100/90 text-gray-600'
                }`}
              >
                {ch.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setComposeOpen(true)}
            className="w-9 h-9 rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 text-white flex items-center justify-center shadow-md shrink-0 haptic"
            title="ارسال پیام داخلی جدید"
          >
            <Plus size={19} />
          </button>
        </div>

        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-fade-in">
            <div className="relative">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-sky-500" />
              <Input
                autoFocus
                placeholder="جستجوی عنوان پیام، متن یا نام و شماره بیمار..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pr-9 pl-8 text-xs"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {sentNotice && (
        <div className="rounded-2xl bg-emerald-600 text-white px-3.5 py-2.5 text-xs font-black flex items-center gap-2 shadow-md animate-fade-in">
          <CheckCircle2 size={16} />
          <span>{sentNotice}</span>
        </div>
      )}

      {/* TAB 1 & 2: Internal Staff & Audit Messages */}
      {(activeChip === 'all' || activeChip === 'unread') && (
        filtered.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={28} />}
            title="پیامی یافت نشد"
            subtitle="برای ارسال پیام به پرسنل روی + بزنید یا از تب پیامک هوشمند استفاده کنید"
            color="#0EA5E9"
          />
        ) : (
          <div className="space-y-2 stagger">
            {filtered.map(msg => {
              const fromStaff = getStaff(msg.from_staff_id);
              const priority = PRIORITY_CONFIG[msg.priority] ?? PRIORITY_CONFIG.normal;
              return (
                <div
                  key={msg.id}
                  className="glass-card p-3.5"
                  style={{ borderRight: !msg.is_read ? '4px solid #0EA5E9' : '4px solid #E2E8F0' }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: fromStaff?.color ? `${fromStaff.color}15` : '#E0F2FE', color: fromStaff?.color ?? '#0EA5E9' }}
                    >
                      {msg.is_read ? <MailOpen size={18} /> : <Mail size={18} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-black text-gray-800 truncate">{msg.subject}</p>
                        <Badge color={priority.color} bg={priority.bg}>{priority.label}</Badge>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{msg.body}</p>
                      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-400">
                        <span className="flex items-center gap-1">
                          <User size={10} />
                          {fromStaff ? `${fromStaff.first_name} ${fromStaff.last_name}` : 'سیستم هوشمند مینادنتال'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(msg.created_at).toLocaleString('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {!msg.is_read && (
                        <button
                          onClick={() => markRead(msg.id)}
                          className="w-7 h-7 rounded-xl bg-sky-50 flex items-center justify-center text-sky-600 haptic"
                        >
                          <MailOpen size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => setDeleteId(msg.id)}
                        className="w-7 h-7 rounded-xl bg-rose-50 flex items-center justify-center text-rose-500 haptic"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* TAB 3: Smart Patient SMS & WhatsApp Dispatch */}
      {activeChip === 'smart_sms' && (
        <div className="space-y-2.5 animate-fade-in">
          <div className="glass-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black text-sky-900 flex items-center gap-1.5">
                <Smartphone size={15} className="text-sky-600" /> انتخاب قالب پیامک هوشمند بیمار:
              </p>
              <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-lg">
                جایگذاری خودکار نام و تاریخ
              </span>
            </div>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {SMS_TEMPLATES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                    selectedTemplateId === t.id
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'bg-sky-50 text-sky-700'
                  }`}
                >
                  {t.title}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-600 bg-slate-50 rounded-2xl p-2.5 border border-slate-200 leading-relaxed">
              {SMS_TEMPLATES.find(t => t.id === selectedTemplateId)?.body}
            </p>
          </div>

          {filteredPatients.length === 0 ? (
            <EmptyState icon={<Smartphone size={28} />} title="بیماری یافت نشد" color="#0EA5E9" />
          ) : (
            <div className="space-y-2">
              {filteredPatients.map(p => {
                const activeTpl = SMS_TEMPLATES.find(t => t.id === selectedTemplateId) || SMS_TEMPLATES[0];
                const hasInstallment = installments.some(i => i.patient_id === p.id && i.status === 'active');
                return (
                  <div key={p.id} className="glass-card p-3 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-black text-slate-800 truncate">
                          {p.first_name} {p.last_name}
                        </p>
                        {hasInstallment && (
                          <span className="text-[9.5px] font-bold bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-md">
                            دارای قسط
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-500 font-mono mt-0.5" dir="ltr">
                        {p.phone || 'شماره ثبت نشده'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => triggerPatientSms(p, activeTpl.body, 'sms')}
                        className="px-2.5 py-1.5 rounded-xl bg-sky-500 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-sm haptic"
                      >
                        <Send size={12} /> پیامک
                      </button>
                      <button
                        onClick={() => triggerPatientSms(p, activeTpl.body, 'whatsapp')}
                        className="px-2.5 py-1.5 rounded-xl bg-emerald-500 text-white text-[11px] font-extrabold flex items-center gap-1 shadow-sm haptic"
                      >
                        <PhoneCall size={12} /> واتساپ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Promotional Campaigns */}
      {activeChip === 'campaigns' && (
        <div className="glass-card p-4 space-y-3 animate-fade-in">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center shadow-md">
              <Megaphone size={19} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800">کمپین تبلیغاتی و اطلاع‌رسانی گروهی مطب</h3>
              <p className="text-[11px] text-gray-500">
                ارسال پیام جشنواره، چکاپ دوره‌ای و تبریک به {patients.length.toLocaleString('fa-IR')} بیمار پرونده‌دار
              </p>
            </div>
          </div>

          <Field label="متن کمپین تبلیغاتی (از طرف کلینیک مینادنتال)">
            <Textarea
              rows={3}
              value={customCampaignText}
              onChange={e => setCustomCampaignText(e.target.value)}
            />
          </Field>

          <Button
            color="#0EA5E9"
            className="w-full"
            onClick={async () => {
              await supabase.from('messages').insert({
                from_staff_id: currentStaffId,
                to_staff_id: currentStaffId,
                subject: `ثبت کمپین تبلیغاتی (${patients.length.toLocaleString('fa-IR')} مخاطب)`,
                body: customCampaignText,
                priority: 'high',
                is_read: false,
              });
              setSentNotice(`کمپین تبلیغاتی برای ${patients.length.toLocaleString('fa-IR')} بیمار ثبت و آماده ارسال شد`);
              setTimeout(() => setSentNotice(null), 3500);
              setActiveChip('all');
            }}
          >
            ثبت و اجرای کمپین برای همه بیماران
          </Button>
        </div>
      )}

      {/* TAB 5: Ready Templates */}
      {activeChip === 'templates' && (
        <div className="space-y-2 animate-fade-in">
          {SMS_TEMPLATES.map(tpl => (
            <div key={tpl.id} className="glass-card p-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-sky-500" /> {tpl.title}
                </span>
                <Badge color="#0284C7" bg="#E0F2FE">{tpl.category}</Badge>
              </div>
              <p className="text-xs text-gray-600 leading-relaxed">{tpl.body}</p>
              <div className="pt-1 flex justify-end">
                <button
                  onClick={() => {
                    setSelectedTemplateId(tpl.id);
                    setActiveChip('smart_sms');
                  }}
                  className="text-[11px] font-extrabold text-sky-600 bg-sky-50 px-3 py-1 rounded-xl haptic"
                >
                  استفاده برای ارسال به بیمار ←
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Sheet open={composeOpen} onClose={() => setComposeOpen(false)} title="پیام جدید به پرسنل" icon={<Send size={20} />} color="#0EA5E9">
        <div className="space-y-4">
          <Field label="گیرنده">
            <Select
              value={form.to_staff_id}
              onChange={e => setForm({ ...form, to_staff_id: e.target.value })}
              options={[
                { value: '', label: 'انتخاب گیرنده...' },
                ...staff.map(s => ({ value: s.id, label: `${s.first_name} ${s.last_name}` })),
              ]}
            />
          </Field>
          <Field label="عنوان">
            <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="عنوان پیام" />
          </Field>
          <Field label="متن پیام">
            <Textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} rows={4} placeholder="متن پیام..." />
          </Field>
          <Field label="اولویت">
            <Select
              value={form.priority}
              onChange={e => setForm({ ...form, priority: e.target.value })}
              options={Object.entries(PRIORITY_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))}
            />
          </Field>
          <Button color="#0EA5E9" disabled={saving || !form.to_staff_id || !form.subject.trim()} className="w-full" onClick={send}>
            {saving ? 'در حال ارسال...' : 'ارسال پیام'}
          </Button>
        </div>
      </Sheet>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && del(deleteId)}
        title="حذف پیام"
        message="آیا از حذف این پیام اطمینان دارید؟"
        confirmLabel="حذف"
      />
    </div>
  );
}
