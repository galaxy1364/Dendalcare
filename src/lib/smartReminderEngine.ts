import {
  supabase,
  type Patient,
  type Appointment,
  type Treatment,
  type LabOrder,
  type Implant,
  type InventoryItem,
  type Reminder,
  type Installment,
  type Check,
  type Safteh,
} from '@/lib/supabase';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';

export interface SmartReminderRules {
  checkLeadDays: number;
  installmentLeadDays: number;
  appointmentLeadDays: number;
  labLeadDays: number;
  implantLeadDays: number;
  inventoryExpiryLeadDays: number;
  includeOpenDebts: boolean;
  autoPilotEnabled: boolean;
}

export const DEFAULT_REMINDER_RULES: SmartReminderRules = {
  checkLeadDays: 3,
  installmentLeadDays: 3,
  appointmentLeadDays: 1,
  labLeadDays: 2,
  implantLeadDays: 3,
  inventoryExpiryLeadDays: 14,
  includeOpenDebts: true,
  autoPilotEnabled: true,
};

const STORAGE_KEY = 'dentalcare_smart_reminder_rules_v1';

export function loadSmartReminderRules(): SmartReminderRules {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_REMINDER_RULES;
    return { ...DEFAULT_REMINDER_RULES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_REMINDER_RULES;
  }
}

export function saveSmartReminderRules(rules: SmartReminderRules): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // ignore storage errors
  }
}

export function addDaysIso(dateStr: string, offsetDays: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return todayGregorian();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export function daysDiffFromToday(targetDateStr: string): number {
  const today = todayGregorian();
  const t0 = new Date(today).getTime();
  const t1 = new Date(targetDateStr).getTime();
  if (isNaN(t1)) return 999;
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

export type SmartAlertDomain =
  | 'check'
  | 'safteh'
  | 'installment'
  | 'debt'
  | 'implant'
  | 'lab'
  | 'appointment'
  | 'inventory'
  | 'treatment';

export interface LiveSmartAlert {
  id: string;
  domain: SmartAlertDomain;
  targetSection: 'finance' | 'implants' | 'lab' | 'appointments' | 'inventory' | 'treatments' | 'patients';
  patientId: string | null;
  patientName: string;
  patientPhone: string | null;
  title: string;
  subtitle: string;
  dueDate: string;
  daysRemaining: number;
  urgency: 'critical' | 'today' | 'upcoming' | 'normal';
  amount?: number;
  toothNumber?: string | number | null;
  stageCurrent?: string;
  stageEntityId?: string;
  smsTemplate: string;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

const IMPLANT_STAGE_LABELS: Record<string, string> = {
  planning: 'برنامه‌ریزی جراحی',
  extraction_and_graft: 'کشیدن و پیوند استخوان',
  implant_placement: 'جراحی کاشت فیکسچر',
  osseointegration: 'بستن هیلینگ (ادغام استخوان)',
  abutment_placement: 'قالب‌گیری و اباتمان',
  crown_fitting: 'تحویل و نصب روکش',
  completed: 'تکمیل‌شده',
};

const LAB_STATUS_LABELS: Record<string, string> = {
  sent: 'ارسال‌شده به لابراتوار',
  in_progress: 'در حال ساخت در لابراتوار',
  received: 'دریافت‌شده در مطب (آماده تحویل به بیمار)',
  delivered_to_patient: 'تحویل‌شده به بیمار',
};

export function computeLiveSmartAlerts(params: {
  patients: Patient[];
  appointments: Appointment[];
  treatments: Treatment[];
  labOrders: LabOrder[];
  implants: Implant[];
  inventory: InventoryItem[];
  installments: Installment[];
  checks: Check[];
  safteh: Safteh[];
  rules: SmartReminderRules;
}): LiveSmartAlert[] {
  const {
    patients,
    appointments,
    treatments,
    labOrders,
    implants,
    inventory,
    installments,
    checks,
    safteh,
    rules,
  } = params;

  const today = todayGregorian();
  const alerts: LiveSmartAlert[] = [];
  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  // 1. CHECKS (چک‌های صیادی)
  for (const ch of checks) {
    if (ch.status !== 'pending' && ch.status !== 'bounced') continue;
    const diff = daysDiffFromToday(ch.due_date);
    if (ch.status === 'bounced' || diff <= rules.checkLeadDays) {
      const p = getPatient(ch.patient_id);
      const pName = p ? `${p.first_name} ${p.last_name}` : 'بیمار';
      const urgency = ch.status === 'bounced' || diff < 0 ? 'critical' : diff === 0 ? 'today' : 'upcoming';
      alerts.push({
        id: `chk_${ch.id}`,
        domain: 'check',
        targetSection: 'finance',
        patientId: ch.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title:
          ch.status === 'bounced'
            ? `چک برگشتی صیادی: ${pName}`
            : diff < 0
            ? `چک سررسید گذشته (${Math.abs(diff).toLocaleString('fa-IR')} روز تأخیر): ${pName}`
            : diff === 0
            ? `سررسید چک صیادی امروز: ${pName}`
            : `یادآوری چک صیادی (${diff.toLocaleString('fa-IR')} روز مانده): ${pName}`,
        subtitle: `بانک ${ch.bank_name || '-'} • چک #${ch.check_number || '-'} • مبلغ: ${fmt(ch.amount)} تومان • سررسید: ${toJalaliStr(ch.due_date)}`,
        dueDate: ch.due_date,
        daysRemaining: diff,
        urgency,
        amount: Number(ch.amount),
        stageEntityId: ch.id,
        smsTemplate: `مراجعه‌کننده گرامی ${pName}، ضمن آرزوی سلامتی، یادآوری می‌شود چک صیادی شماره ${ch.check_number || '-'} به مبلغ ${fmt(ch.amount)} تومان در تاریخ ${toJalaliStr(ch.due_date)} سررسید می‌گردد. کلینیک دندانپزشکی مینادنتال`,
      });
    }
  }

  // 2. SAFTEH (سفته و ضمانت)
  for (const sf of safteh) {
    if (sf.status !== 'pending' && sf.status !== 'bounced') continue;
    const diff = daysDiffFromToday(sf.due_date);
    if (sf.status === 'bounced' || diff <= rules.checkLeadDays) {
      const p = getPatient(sf.patient_id);
      const pName = p ? `${p.first_name} ${p.last_name}` : 'بیمار';
      const urgency = sf.status === 'bounced' || diff < 0 ? 'critical' : diff === 0 ? 'today' : 'upcoming';
      alerts.push({
        id: `sft_${sf.id}`,
        domain: 'safteh',
        targetSection: 'finance',
        patientId: sf.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title:
          diff < 0
            ? `سفته سررسید گذشته: ${pName}`
            : diff === 0
            ? `سررسید سفته امروز: ${pName}`
            : `یادآوری سررسید سفته (${diff.toLocaleString('fa-IR')} روز مانده): ${pName}`,
        subtitle: `شماره سفته: ${sf.safteh_number || '-'} • ضامن: ${sf.guarantor_name || '-'} • مبلغ: ${fmt(sf.amount)} تومان`,
        dueDate: sf.due_date,
        daysRemaining: diff,
        urgency,
        amount: Number(sf.amount),
        stageEntityId: sf.id,
        smsTemplate: `مراجعه‌کننده گرامی ${pName}، یادآوری می‌شود سررسید سفته ضمانت شما به مبلغ ${fmt(sf.amount)} تومان در تاریخ ${toJalaliStr(sf.due_date)} می‌باشد. کلینیک مینادنتال`,
      });
    }
  }

  // 3. INSTALLMENTS (اقساط ماهانه)
  for (const ins of installments) {
    if (ins.status !== 'active' || !ins.next_due_date) continue;
    const diff = daysDiffFromToday(ins.next_due_date);
    if (diff <= rules.installmentLeadDays) {
      const p = getPatient(ins.patient_id);
      const pName = p ? `${p.first_name} ${p.last_name}` : 'بیمار';
      const urgency = diff < 0 ? 'critical' : diff === 0 ? 'today' : 'upcoming';
      alerts.push({
        id: `ins_${ins.id}`,
        domain: 'installment',
        targetSection: 'finance',
        patientId: ins.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title:
          diff < 0
            ? `قسط معوق (${Math.abs(diff).toLocaleString('fa-IR')} روز تأخیر): ${pName}`
            : diff === 0
            ? `سررسید قسط ماهانه امروز: ${pName}`
            : `یادآوری قسط ماهانه (${diff.toLocaleString('fa-IR')} روز مانده): ${pName}`,
        subtitle: `قسط ${ins.paid_months + 1} از ${ins.total_months} • مبلغ قسط: ${fmt(ins.monthly_amount)} تومان • مانده کل: ${fmt(Number(ins.total_amount) - Number(ins.paid_amount))} تومان`,
        dueDate: ins.next_due_date,
        daysRemaining: diff,
        urgency,
        amount: Number(ins.monthly_amount),
        stageEntityId: ins.id,
        smsTemplate: `مراجعه‌کننده گرامی ${pName}، موعد پرداخت قسط ماهانه شما به مبلغ ${fmt(ins.monthly_amount)} تومان در تاریخ ${toJalaliStr(ins.next_due_date)} می‌باشد. با تشکر، کلینیک مینادنتال`,
      });
    }
  }

  // 4. OPEN PATIENT DEBTS TO CLINIC (بدهکاران باز مطب بدون پوشش چک/قسط)
  if (rules.includeOpenDebts) {
    for (const p of patients) {
      const pTreatments = treatments.filter(t => t.patient_id === p.id && t.status !== 'cancelled');
      const totalCost = pTreatments.reduce((s, t) => s + Number(t.total_cost || 0), 0);
      const totalPaid = pTreatments.reduce((s, t) => s + Number(t.paid_amount || 0), 0);
      const totalDebt = Math.max(0, totalCost - totalPaid);
      if (totalDebt <= 0) continue;

      const coveredInst = installments
        .filter(i => i.patient_id === p.id && i.status === 'active')
        .reduce((s, i) => s + Math.max(0, Number(i.total_amount) - Number(i.paid_amount)), 0);
      const coveredChk = checks
        .filter(c => c.patient_id === p.id && c.status === 'pending')
        .reduce((s, c) => s + Number(c.amount), 0);
      const uncovered = Math.max(0, totalDebt - coveredInst - coveredChk);

      if (uncovered > 0) {
        const pName = `${p.first_name} ${p.last_name}`;
        alerts.push({
          id: `debt_${p.id}`,
          domain: 'debt',
          targetSection: 'finance',
          patientId: p.id,
          patientName: pName,
          patientPhone: p.phone || null,
          title: `بدهی باز تسویه‌نشده به مطب: ${pName}`,
          subtitle: `مانده بدهی بدون چک/قسط: ${fmt(uncovered)} تومان (از کل کارکرد ${fmt(totalCost)} تومان در ${pTreatments.length.toLocaleString('fa-IR')} درمان)`,
          dueDate: today,
          daysRemaining: 0,
          urgency: 'today',
          amount: uncovered,
          smsTemplate: `مراجعه‌کننده گرامی ${pName}، مانده حساب پرونده درمانی شما در کلینیک دندانپزشکی مینادنتال مبلغ ${fmt(uncovered)} تومان می‌باشد. لطفاً جهت تسویه یا تعیین تکلیف با پذیرش مطب هماهنگ فرمایید.`,
        });
      }
    }
  }

  // 5. IMPLANT STAGES (جراحی، هیلینگ، قالب‌گیری، سفارش لابراتوار، نصب روکش)
  for (const imp of implants) {
    if (imp.stage === 'completed' || imp.stage === 'failed') continue;
    const p = getPatient(imp.patient_id);
    const pName = p ? `${p.first_name} ${p.last_name}` : 'بیمار';
    const targetDate =
      imp.crown_date || imp.abutment_date || imp.osseointegration_date || imp.placement_date || today;
    const diff = daysDiffFromToday(targetDate);
    if (diff <= rules.implantLeadDays) {
      const stageLabel = IMPLANT_STAGE_LABELS[imp.stage] || imp.stage;
      const urgency = diff < 0 ? 'critical' : diff === 0 ? 'today' : 'upcoming';
      alerts.push({
        id: `imp_${imp.id}`,
        domain: 'implant',
        targetSection: 'implants',
        patientId: imp.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title: `مرحله ایمپلنت (${stageLabel}): ${pName}`,
        subtitle: `دندان ${imp.tooth_number || '-'} • برند ${imp.brand || '-'} (${imp.implant_size || '-'}) • تاریخ مرحله: ${toJalaliStr(targetDate)}`,
        dueDate: targetDate,
        daysRemaining: diff,
        urgency,
        toothNumber: imp.tooth_number,
        stageCurrent: imp.stage,
        stageEntityId: imp.id,
        smsTemplate: `مراجعه‌کننده گرامی ${pName}، نوبت پیگیری مرحله «${stageLabel}» ایمپلنت دندان شماره ${imp.tooth_number || ''} شما در تاریخ ${toJalaliStr(targetDate)} فرارسیده است. کلینیک مینادنتال`,
      });
    }
  }

  // 6. LAB ORDERS (ارسال و دریافت لابراتوار و تحویل به بیمار)
  for (const lab of labOrders) {
    if (lab.status === 'delivered_to_patient' || lab.status === 'cancelled') continue;
    const p = getPatient(lab.patient_id);
    const pName = p ? `${p.first_name} ${p.last_name}` : 'بیمار';
    const targetDate = lab.due_date || lab.received_date || lab.sent_date;
    const diff = daysDiffFromToday(targetDate);

    if (lab.status === 'received' || diff <= rules.labLeadDays) {
      const statusLabel = LAB_STATUS_LABELS[lab.status] || lab.status;
      const urgency =
        lab.status !== 'received' && diff < 0
          ? 'critical'
          : lab.status === 'received' || diff === 0
          ? 'today'
          : 'upcoming';

      alerts.push({
        id: `lab_${lab.id}`,
        domain: 'lab',
        targetSection: 'lab',
        patientId: lab.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title:
          lab.status === 'received'
            ? `پروتز دریافت‌شده از لابراتوار (آماده تحویل به ${pName})`
            : diff < 0
            ? `تأخیر لابراتوار (${Math.abs(diff).toLocaleString('fa-IR')} روز گذشته): ${pName}`
            : `پیگیری سفارش لابراتوار: ${pName}`,
        subtitle: `لابراتوار: ${lab.lab_name || '-'} • دندان: ${lab.tooth_numbers || '-'} • رنگ: ${lab.shade || '-'} • وضعیت: ${statusLabel}`,
        dueDate: targetDate,
        daysRemaining: diff,
        urgency,
        toothNumber: lab.tooth_numbers,
        stageCurrent: lab.status,
        stageEntityId: lab.id,
        smsTemplate:
          lab.status === 'received'
            ? `مراجعه‌کننده گرامی ${pName}، پروتز/روکش دندانی شما از لابراتوار تحویل مطب گردیده و آماده نصب می‌باشد. لطفاً جهت هماهنگی وقت تحویل تماس حاصل فرمایید. کلینیک مینادنتال`
            : `یادآوری پیگیری سفارش لابراتوار ${lab.lab_name || ''} برای بیمار ${pName} (دندان ${lab.tooth_numbers || '-'}) با موعد ${toJalaliStr(targetDate)}.`,
      });
    }
  }

  // 7. APPOINTMENTS (نوبت‌های امروز و روزهای آینده)
  for (const apt of appointments) {
    if (apt.status !== 'scheduled' && apt.status !== 'confirmed') continue;
    const diff = daysDiffFromToday(apt.appointment_date);
    if (diff >= 0 && diff <= rules.appointmentLeadDays) {
      const p = getPatient(apt.patient_id);
      const pName = p ? `${p.first_name} ${p.last_name}` : apt.title || 'بیمار';
      alerts.push({
        id: `apt_${apt.id}`,
        domain: 'appointment',
        targetSection: 'appointments',
        patientId: apt.patient_id,
        patientName: pName,
        patientPhone: p?.phone || null,
        title:
          diff === 0
            ? `نوبت امروز ساعت ${apt.appointment_time.slice(0, 5)}: ${pName}`
            : `یادآوری نوبت فردا (${apt.appointment_time.slice(0, 5)}): ${pName}`,
        subtitle: `نوع ویزیت: ${apt.type || 'درمان'} • تاریخ: ${toJalaliStr(apt.appointment_date)} • ساعت: ${apt.appointment_time.slice(0, 5)}`,
        dueDate: apt.appointment_date,
        daysRemaining: diff,
        urgency: diff === 0 ? 'today' : 'upcoming',
        stageEntityId: apt.id,
        smsTemplate: `مراجعه‌کننده گرامی ${pName}، نوبت دندانپزشکی شما در کلینیک مینادنتال برای تاریخ ${toJalaliStr(apt.appointment_date)} ساعت ${apt.appointment_time.slice(0, 5)} ثبت شده است. لطفاً ۱۵ دقیقه زودتر در مطب حضور یابید.`,
      });
    }
  }

  // 8. INVENTORY LOW STOCK & EXPIRY ALERTS (کمبود موجودی و تاریخ انقضای انبار)
  for (const item of inventory) {
    const isLow = Number(item.quantity) <= Number(item.min_quantity) && Number(item.min_quantity) > 0;
    const expDiff = item.expiry_date ? daysDiffFromToday(item.expiry_date) : 999;
    const isExpiring = item.expiry_date && expDiff <= rules.inventoryExpiryLeadDays;

    if (isLow || isExpiring) {
      const isOut = Number(item.quantity) <= 0 || expDiff < 0;
      alerts.push({
        id: `inv_${item.id}`,
        domain: 'inventory',
        targetSection: 'inventory',
        patientId: null,
        patientName: item.name,
        patientPhone: null,
        title:
          isLow && isExpiring
            ? `هشدار همزمان کمبود و انقضای کالا: ${item.name}`
            : isLow
            ? `هشدار کمبود موجودی انبار: ${item.name}`
            : expDiff < 0
            ? `کالای منقضی‌شده در انبار: ${item.name}`
            : `نزدیک به انقضا (${expDiff.toLocaleString('fa-IR')} روز مانده): ${item.name}`,
        subtitle: `موجودی فعلی: ${fmt(item.quantity)} ${item.unit} (حداقل مجاز: ${fmt(item.min_quantity)}) ${
          item.expiry_date ? `• تاریخ انقضا: ${toJalaliStr(item.expiry_date)}` : ''
        }`,
        dueDate: item.expiry_date || today,
        daysRemaining: isLow ? -1 : expDiff,
        urgency: isOut || isLow ? 'critical' : 'upcoming',
        stageEntityId: item.id,
        smsTemplate: `سفارش خرید انبار کلینیک مینادنتال: کالای «${item.name}» به موجودی ${item.quantity} ${item.unit} رسیده است. تعداد سفارش مجدد پیشنهادی: ${item.reorder_quantity || 10} ${item.unit}.`,
      });
    }
  }

  const rank = { critical: 0, today: 1, upcoming: 2, normal: 3 };
  return alerts.sort((a, b) => {
    if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
    return a.daysRemaining - b.daysRemaining;
  });
}

export async function syncLiveAlertsToDatabaseReminders(
  liveAlerts: LiveSmartAlert[],
  existingReminders: Reminder[]
): Promise<number> {
  const today = todayGregorian();
  let insertedCount = 0;

  for (const alert of liveAlerts) {
    const exists = existingReminders.some(
      r => r.title === alert.title && r.status === 'pending'
    );
    if (exists) continue;

    const categoryMap: Record<SmartAlertDomain, string> = {
      check: 'payment',
      safteh: 'payment',
      installment: 'payment',
      debt: 'payment',
      implant: 'implant',
      lab: 'lab',
      appointment: 'appointment',
      inventory: 'inventory',
      treatment: 'treatment',
    };

    const priorityMap: Record<LiveSmartAlert['urgency'], string> = {
      critical: 'urgent',
      today: 'high',
      upcoming: 'medium',
      normal: 'low',
    };

    const targetDate = alert.dueDate < today ? today : alert.dueDate;

    const { error } = await supabase.from('reminders').insert({
      patient_id: alert.patientId,
      title: alert.title,
      description: alert.subtitle,
      reminder_date: targetDate,
      reminder_time: '09:30',
      category: categoryMap[alert.domain] || 'other',
      priority: priorityMap[alert.urgency] || 'high',
      status: 'pending',
    });

    if (!error) insertedCount++;
  }

  return insertedCount;
}
