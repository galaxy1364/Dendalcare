/**
 * Clinic Definitions Engine for MinaDental
 * Manages Laboratories, Dental Supply Companies (Vendors),
 * Implant Brands & Companies, and Dental Units with local & cloud persistence.
 */

export interface DentalLaboratory {
  id: string;
  name: string;
  manager: string;
  phone: string;
  address?: string;
  services: string[]; // e.g. ["روکش زيركونيا", "دست دندان متحرک", "لمینت", "پروتز ایمپلنت"]
  turnaroundDays: number;
  active: boolean;
}

export interface SupplyCompany {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  category: 'consumables' | 'equipment' | 'implants' | 'instruments' | 'general';
  paymentTerms?: string; // e.g. "نقدی / چک ۳۰ روزه"
  address?: string;
  active: boolean;
}

export interface ImplantBrandCompany {
  id: string;
  brandName: string;
  companyName: string;
  country: string; // e.g. "سوئیس", "کره جنوبی", "آلمان", "آمریکا"
  systemType: string; // e.g. "Internal Hex / SLA", "Submerged Conical"
  contactPhone: string;
  warrantyYears: number;
  averageCost: number;
  active: boolean;
}

export interface DentalUnit {
  id: string;
  name: string;
  colorName: string; // e.g. "آبی", "زرد", "سبز", "بنفش"
  colorHex: string;
  assignedDoctor?: string;
  status: 'active' | 'maintenance';
}

const STORAGE_KEY_LABS = 'minadental_defs_labs_v1';
const STORAGE_KEY_SUPPLIERS = 'minadental_defs_suppliers_v1';
const STORAGE_KEY_IMPLANTS = 'minadental_defs_implants_v1';
const STORAGE_KEY_UNITS = 'minadental_defs_units_v1';

export const DEFAULT_LABS: DentalLaboratory[] = [
  {
    id: 'lab_1',
    name: 'لابراتوار تخصصی آریانا',
    manager: 'مهندس رضایی',
    phone: '02188881122',
    address: 'تهران، خیابان ولیعصر، بالاتر از ونک',
    services: ['روکش زیرکونیا', 'لمینت سرامیکی', 'پروتز متکی بر ایمپلنت'],
    turnaroundDays: 5,
    active: true,
  },
  {
    id: 'lab_2',
    name: 'لابراتوار مدرن دیجیتال',
    manager: 'دکتر صادقی',
    phone: '02122664455',
    address: 'تهران، شریعتی، نبش خیابان ميرداماد',
    services: ['پلاک ارتودنسی', 'نایت گارد', 'روکش PFM'],
    turnaroundDays: 4,
    active: true,
  },
  {
    id: 'lab_3',
    name: 'لابراتوار متحرک دنتال پارس',
    manager: 'استاد احمدی',
    phone: '02144009988',
    address: 'تهران، صادقیه، بلوار فردوس',
    services: ['دست دندان اکریلی', 'پارسیل کروم کبالت'],
    turnaroundDays: 7,
    active: true,
  },
];

export const DEFAULT_SUPPLIERS: SupplyCompany[] = [
  {
    id: 'sup_1',
    name: 'شرکت تجهیز طب نگین (تأمین کالا)',
    contactPerson: 'آقای مرادی',
    phone: '02188776655',
    category: 'consumables',
    paymentTerms: 'چک ۴۵ روزه یا نقدی ۵٪ تخفیف',
    address: 'تهران، خیابان آزادی، پلاک ۱۲۰',
    active: true,
  },
  {
    id: 'sup_2',
    name: 'شرکت پیشرو دنتال (تجهیزات سنگین و یونیت)',
    contactPerson: 'مهندس حسینی',
    phone: '02166993322',
    category: 'equipment',
    paymentTerms: 'اقساط ۶ ماهه با ضمانت چک',
    address: 'تهران، میدان انقلاب، ساختمان کالای پزشکی',
    active: true,
  },
  {
    id: 'sup_3',
    name: 'شرکت تامین ایمپلنت پارس دنت',
    contactPerson: 'خانم شریفی',
    phone: '02188442200',
    category: 'implants',
    paymentTerms: 'تحویل با فاکتور رسمی',
    address: 'تهران، خیابان گاندی، کوچه سوم',
    active: true,
  },
];

export const DEFAULT_IMPLANTS: ImplantBrandCompany[] = [
  {
    id: 'imp_1',
    brandName: 'Dentium (Superline)',
    companyName: 'شرکت پارس ایمپلنت دنتیوم',
    country: 'کره جنوبی',
    systemType: 'Internal Hex SLA Surface',
    contactPhone: '02188990011',
    warrantyYears: 10,
    averageCost: 4500000,
    active: true,
  },
  {
    id: 'imp_2',
    brandName: 'Straumann (ITI / Roxolid)',
    companyName: 'شرکت نوآوران طب اشترومن',
    country: 'سوئیس',
    systemType: 'SLActive / Bone Level Tapered',
    contactPhone: '02122334455',
    warrantyYears: 20,
    averageCost: 12500000,
    active: true,
  },
  {
    id: 'imp_3',
    brandName: 'Megagen (AnyOne)',
    companyName: 'شرکت کیا دنتال مگاجن',
    country: 'کره جنوبی',
    systemType: 'Knife Thread Conical Connection',
    contactPhone: '02144556677',
    warrantyYears: 10,
    averageCost: 5500000,
    active: true,
  },
  {
    id: 'imp_4',
    brandName: 'Bego (Semados)',
    companyName: 'شرکت بگو دنتال آلمان',
    country: 'آلمان',
    systemType: 'Internal Tapered Beveled',
    contactPhone: '02188112233',
    warrantyYears: 15,
    averageCost: 8500000,
    active: true,
  },
];

export const DEFAULT_UNITS: DentalUnit[] = [
  {
    id: 'unit_blue',
    name: 'یونیت ۱ (آبی 🟦)',
    colorName: 'آبی',
    colorHex: '#3B82F6',
    assignedDoctor: 'دکتر مهدی امیری',
    status: 'active',
  },
  {
    id: 'unit_yellow',
    name: 'یونیت ۲ (زرد 🟨)',
    colorName: 'زرد',
    colorHex: '#EAB308',
    assignedDoctor: 'دکتر مینا مازندرانی',
    status: 'active',
  },
  {
    id: 'unit_green',
    name: 'یونیت ۳ (سبز 🟩)',
    colorName: 'سبز',
    colorHex: '#10B981',
    assignedDoctor: 'دندانپزشک شیفت',
    status: 'active',
  },
  {
    id: 'unit_purple',
    name: 'یونیت ۴ (بنفش 🟪)',
    colorName: 'بنفش',
    colorHex: '#A855F7',
    assignedDoctor: 'اتاق جراحی و ایمپلنت',
    status: 'active',
  },
];

// Loaders and Savers
export function loadLaboratories(): DentalLaboratory[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LABS);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error(e); }
  return DEFAULT_LABS;
}

export function saveLaboratories(labs: DentalLaboratory[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_LABS, JSON.stringify(labs));
  } catch (e) { console.error(e); }
}

export function loadSupplyCompanies(): SupplyCompany[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SUPPLIERS);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error(e); }
  return DEFAULT_SUPPLIERS;
}

export function saveSupplyCompanies(suppliers: SupplyCompany[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_SUPPLIERS, JSON.stringify(suppliers));
  } catch (e) { console.error(e); }
}

export function loadImplantBrands(): ImplantBrandCompany[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_IMPLANTS);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error(e); }
  return DEFAULT_IMPLANTS;
}

export function saveImplantBrands(brands: ImplantBrandCompany[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_IMPLANTS, JSON.stringify(brands));
  } catch (e) { console.error(e); }
}

export function loadDentalUnits(): DentalUnit[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_UNITS);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.error(e); }
  return DEFAULT_UNITS;
}

export function saveDentalUnits(units: DentalUnit[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_UNITS, JSON.stringify(units));
  } catch (e) { console.error(e); }
}
