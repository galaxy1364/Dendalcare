import React, { useState } from 'react';
import {
  Building2, FlaskConical, Truck, Anchor, Layers, Plus, Trash2, Edit, Check, X, ShieldCheck
} from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge } from '@/components/ui/Form';
import {
  loadLaboratories, saveLaboratories, type DentalLaboratory,
  loadSupplyCompanies, saveSupplyCompanies, type SupplyCompany,
  loadImplantBrands, saveImplantBrands, type ImplantBrandCompany,
  loadDentalUnits, saveDentalUnits, type DentalUnit,
} from '@/lib/clinicDefinitions';

interface ClinicDefinitionsModalProps {
  open: boolean;
  onClose: () => void;
  defaultTab?: 'labs' | 'suppliers' | 'implants' | 'units';
}

export const ClinicDefinitionsModal: React.FC<ClinicDefinitionsModalProps> = ({
  open,
  onClose,
  defaultTab = 'labs',
}) => {
  const [activeTab, setActiveTab] = useState<'labs' | 'suppliers' | 'implants' | 'units'>(defaultTab);

  // Lists state
  const [labs, setLabs] = useState<DentalLaboratory[]>(() => loadLaboratories());
  const [suppliers, setSuppliers] = useState<SupplyCompany[]>(() => loadSupplyCompanies());
  const [implants, setImplants] = useState<ImplantBrandCompany[]>(() => loadImplantBrands());
  const [units, setUnits] = useState<DentalUnit[]>(() => loadDentalUnits());

  // Edit / Form states
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isAdding, setIsAdding] = useState(false);

  // LAB FORM STATE
  const [labForm, setLabForm] = useState<Partial<DentalLaboratory>>({
    name: '', manager: '', phone: '', address: '', turnaroundDays: 5, services: ['روکش زیرکونیا'], active: true
  });

  // SUPPLIER FORM STATE
  const [supForm, setSupForm] = useState<Partial<SupplyCompany>>({
    name: '', contactPerson: '', phone: '', category: 'consumables', paymentTerms: 'چک ۳۰ روزه', address: '', active: true
  });

  // IMPLANT FORM STATE
  const [impForm, setImpForm] = useState<Partial<ImplantBrandCompany>>({
    brandName: '', companyName: '', country: 'کره جنوبی', systemType: 'Internal Hex SLA', contactPhone: '', warrantyYears: 10, averageCost: 4500000, active: true
  });

  // UNIT FORM STATE
  const [unitForm, setUnitForm] = useState<Partial<DentalUnit>>({
    name: '', colorName: 'آبی', colorHex: '#3B82F6', assignedDoctor: 'دکتر مهدی امیری', status: 'active'
  });

  const handleSaveLab = () => {
    if (!labForm.name) return;
    let updated: DentalLaboratory[];
    if (editingItem) {
      updated = labs.map(l => l.id === editingItem.id ? { ...l, ...labForm } as DentalLaboratory : l);
    } else {
      const newLab: DentalLaboratory = {
        id: `lab_${Date.now()}`,
        name: labForm.name!,
        manager: labForm.manager || 'مسئول لابراتوار',
        phone: labForm.phone || '',
        address: labForm.address || '',
        services: labForm.services || ['روکش'],
        turnaroundDays: labForm.turnaroundDays || 5,
        active: labForm.active ?? true,
      };
      updated = [...labs, newLab];
    }
    setLabs(updated);
    saveLaboratories(updated);
    setIsAdding(false);
    setEditingItem(null);
  };

  const handleSaveSupplier = () => {
    if (!supForm.name) return;
    let updated: SupplyCompany[];
    if (editingItem) {
      updated = suppliers.map(s => s.id === editingItem.id ? { ...s, ...supForm } as SupplyCompany : s);
    } else {
      const newSup: SupplyCompany = {
        id: `sup_${Date.now()}`,
        name: supForm.name!,
        contactPerson: supForm.contactPerson || 'مسئول فروش',
        phone: supForm.phone || '',
        category: supForm.category || 'consumables',
        paymentTerms: supForm.paymentTerms || '',
        address: supForm.address || '',
        active: supForm.active ?? true,
      };
      updated = [...suppliers, newSup];
    }
    setSuppliers(updated);
    saveSupplyCompanies(updated);
    setIsAdding(false);
    setEditingItem(null);
  };

  const handleSaveImplant = () => {
    if (!impForm.brandName) return;
    let updated: ImplantBrandCompany[];
    if (editingItem) {
      updated = implants.map(i => i.id === editingItem.id ? { ...i, ...impForm } as ImplantBrandCompany : i);
    } else {
      const newImp: ImplantBrandCompany = {
        id: `imp_${Date.now()}`,
        brandName: impForm.brandName!,
        companyName: impForm.companyName || impForm.brandName!,
        country: impForm.country || 'کره جنوبی',
        systemType: impForm.systemType || 'Internal Hex',
        contactPhone: impForm.contactPhone || '',
        warrantyYears: impForm.warrantyYears || 10,
        averageCost: impForm.averageCost || 5000000,
        active: impForm.active ?? true,
      };
      updated = [...implants, newImp];
    }
    setImplants(updated);
    saveImplantBrands(updated);
    setIsAdding(false);
    setEditingItem(null);
  };

  const handleSaveUnit = () => {
    if (!unitForm.name) return;
    let updated: DentalUnit[];
    if (editingItem) {
      updated = units.map(u => u.id === editingItem.id ? { ...u, ...unitForm } as DentalUnit : u);
    } else {
      const newUnit: DentalUnit = {
        id: `unit_${Date.now()}`,
        name: unitForm.name!,
        colorName: unitForm.colorName || 'آبی',
        colorHex: unitForm.colorHex || '#3B82F6',
        assignedDoctor: unitForm.assignedDoctor || 'پزشک مطب',
        status: unitForm.status || 'active',
      };
      updated = [...units, newUnit];
    }
    setUnits(updated);
    saveDentalUnits(updated);
    setIsAdding(false);
    setEditingItem(null);
  };

  const handleDeleteLab = (id: string) => {
    const updated = labs.filter(l => l.id !== id);
    setLabs(updated);
    saveLaboratories(updated);
  };
  const handleDeleteSupplier = (id: string) => {
    const updated = suppliers.filter(s => s.id !== id);
    setSuppliers(updated);
    saveSupplyCompanies(updated);
  };
  const handleDeleteImplant = (id: string) => {
    const updated = implants.filter(i => i.id !== id);
    setImplants(updated);
    saveImplantBrands(updated);
  };
  const handleDeleteUnit = (id: string) => {
    const updated = units.filter(u => u.id !== id);
    setUnits(updated);
    saveDentalUnits(updated);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="تعریف و مدیریت پایه کلینیک (لابراتوار، تامین‌کننده، ایمپلنت، یونیت)"
      icon={<Building2 size={20} />}
      color="#8B5CF6"
    >
      <div className="space-y-4">
        {/* Nav Tabs */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-gray-100 rounded-2xl">
          <button
            onClick={() => { setActiveTab('labs'); setIsAdding(false); setEditingItem(null); }}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'labs' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            <FlaskConical size={14} />
            لابراتوارها
          </button>
          <button
            onClick={() => { setActiveTab('suppliers'); setIsAdding(false); setEditingItem(null); }}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'suppliers' ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Truck size={14} />
            تأمین کالا
          </button>
          <button
            onClick={() => { setActiveTab('implants'); setIsAdding(false); setEditingItem(null); }}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'implants' ? 'bg-white text-cyan-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Anchor size={14} />
            ایمپلنت
          </button>
          <button
            onClick={() => { setActiveTab('units'); setIsAdding(false); setEditingItem(null); }}
            className={`flex items-center justify-center gap-1 py-2 text-xs font-bold rounded-xl transition-all ${
              activeTab === 'units' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
            }`}
          >
            <Layers size={14} />
            یونیت‌ها
          </button>
        </div>

        {/* Action Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">
            {activeTab === 'labs' && `لیست ${labs.length} لابراتوار طرف قرارداد`}
            {activeTab === 'suppliers' && `لیست ${suppliers.length} شرکت تأمین‌کننده کالا`}
            {activeTab === 'implants' && `لیست ${implants.length} برند ایمپلنت معتبر`}
            {activeTab === 'units' && `لیست ${units.length} یونیت کلینیک`}
          </span>
          {!isAdding && !editingItem && (
            <button
              onClick={() => {
                setIsAdding(true);
                setEditingItem(null);
                if (activeTab === 'labs') setLabForm({ name: '', manager: '', phone: '', address: '', turnaroundDays: 5, active: true });
                if (activeTab === 'suppliers') setSupForm({ name: '', contactPerson: '', phone: '', category: 'consumables', paymentTerms: '', active: true });
                if (activeTab === 'implants') setImpForm({ brandName: '', companyName: '', country: 'کره جنوبی', systemType: 'Internal Hex', contactPhone: '', warrantyYears: 10, averageCost: 4500000, active: true });
                if (activeTab === 'units') setUnitForm({ name: '', colorName: 'آبی', colorHex: '#3B82F6', assignedDoctor: 'دکتر مهدی امیری', status: 'active' });
              }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-600 text-white text-xs font-bold shadow haptic"
            >
              <Plus size={14} />
              افزودن مورد جدید
            </button>
          )}
        </div>

        {/* LABS TAB */}
        {activeTab === 'labs' && (
          <div className="space-y-3">
            {(isAdding || editingItem) && (
              <div className="p-3.5 rounded-2xl bg-purple-50/80 border border-purple-200 space-y-3 animate-fade-in">
                <h4 className="text-xs font-bold text-purple-900">{editingItem ? 'ویرایش اطلاعات لابراتوار' : 'افزودن لابراتوار جدید'}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="نام لابراتوار"><Input value={labForm.name} onChange={e => setLabForm({ ...labForm, name: e.target.value })} placeholder="مثلاً لابراتوار آریانا" /></Field>
                  <Field label="مدیر / مسئول"><Input value={labForm.manager} onChange={e => setLabForm({ ...labForm, manager: e.target.value })} placeholder="مثلاً مهندس رضایی" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="شماره تماس"><Input value={labForm.phone} onChange={e => setLabForm({ ...labForm, phone: e.target.value })} placeholder="021..." /></Field>
                  <Field label="زمان تحویل (روز)"><Input type="number" value={labForm.turnaroundDays} onChange={e => setLabForm({ ...labForm, turnaroundDays: Number(e.target.value) })} /></Field>
                </div>
                <Field label="آدرس"><Input value={labForm.address} onChange={e => setLabForm({ ...labForm, address: e.target.value })} placeholder="آدرس دقیق لابراتوار" /></Field>
                <div className="flex gap-2">
                  <Button onClick={handleSaveLab} color="#8B5CF6" className="flex-1">ذخیره لابراتوار</Button>
                  <Button onClick={() => { setIsAdding(false); setEditingItem(null); }} color="#9CA3AF" variant="secondary">انصراف</Button>
                </div>
              </div>
            )}

            {!isAdding && !editingItem && labs.map(lab => (
              <div key={lab.id} className="p-3 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-800">{lab.name}</h4>
                    <Badge color="#8B5CF6" bg="#F3E8FF">{lab.turnaroundDays} روزه</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">مسئول: {lab.manager} • تلفن: {lab.phone || 'ثبت نشده'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingItem(lab); setLabForm(lab); }} className="p-2 rounded-xl text-gray-400 hover:text-purple-600 hover:bg-purple-50"><Edit size={16} /></button>
                  <button onClick={() => handleDeleteLab(lab.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SUPPLIERS TAB */}
        {activeTab === 'suppliers' && (
          <div className="space-y-3">
            {(isAdding || editingItem) && (
              <div className="p-3.5 rounded-2xl bg-orange-50/80 border border-orange-200 space-y-3 animate-fade-in">
                <h4 className="text-xs font-bold text-orange-900">{editingItem ? 'ویرایش شرکت تأمین کالا' : 'افزودن شرکت جدید'}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="نام شرکت"><Input value={supForm.name} onChange={e => setSupForm({ ...supForm, name: e.target.value })} placeholder="نام شرکت" /></Field>
                  <Field label="مسئول فروش"><Input value={supForm.contactPerson} onChange={e => setSupForm({ ...supForm, contactPerson: e.target.value })} placeholder="نام مسئول" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="شماره تماس"><Input value={supForm.phone} onChange={e => setSupForm({ ...supForm, phone: e.target.value })} placeholder="شماره تماس" /></Field>
                  <Field label="شرایط تسویه"><Input value={supForm.paymentTerms} onChange={e => setSupForm({ ...supForm, paymentTerms: e.target.value })} placeholder="مثلاً چک ۴۵ روزه" /></Field>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveSupplier} color="#F97316" className="flex-1">ذخیره شرکت</Button>
                  <Button onClick={() => { setIsAdding(false); setEditingItem(null); }} color="#9CA3AF" variant="secondary">انصراف</Button>
                </div>
              </div>
            )}

            {!isAdding && !editingItem && suppliers.map(sup => (
              <div key={sup.id} className="p-3 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-gray-800">{sup.name}</h4>
                  <p className="text-xs text-gray-500 mt-1">مسئول: {sup.contactPerson} • {sup.phone} ({sup.paymentTerms})</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingItem(sup); setSupForm(sup); }} className="p-2 rounded-xl text-gray-400 hover:text-orange-600 hover:bg-orange-50"><Edit size={16} /></button>
                  <button onClick={() => handleDeleteSupplier(sup.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* IMPLANTS TAB */}
        {activeTab === 'implants' && (
          <div className="space-y-3">
            {(isAdding || editingItem) && (
              <div className="p-3.5 rounded-2xl bg-cyan-50/80 border border-cyan-200 space-y-3 animate-fade-in">
                <h4 className="text-xs font-bold text-cyan-900">{editingItem ? 'ویرایش برند ایمپلنت' : 'افزودن برند جدید'}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="نام برند (Brand)"><Input value={impForm.brandName} onChange={e => setImpForm({ ...impForm, brandName: e.target.value })} placeholder="مثلاً Straumann" /></Field>
                  <Field label="کشور سازنده"><Input value={impForm.country} onChange={e => setImpForm({ ...impForm, country: e.target.value })} placeholder="سوئیس، کره..." /></Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="سیستم و کانکشن"><Input value={impForm.systemType} onChange={e => setImpForm({ ...impForm, systemType: e.target.value })} placeholder="Internal Hex / SLA" /></Field>
                  <Field label="میانگین قیمت (تومان)"><Input type="number" value={impForm.averageCost} onChange={e => setImpForm({ ...impForm, averageCost: Number(e.target.value) })} /></Field>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleSaveImplant} color="#06B6D4" className="flex-1">ذخیره برند ایمپلنت</Button>
                  <Button onClick={() => { setIsAdding(false); setEditingItem(null); }} color="#9CA3AF" variant="secondary">انصراف</Button>
                </div>
              </div>
            )}

            {!isAdding && !editingItem && implants.map(imp => (
              <div key={imp.id} className="p-3 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-800">{imp.brandName}</h4>
                    <Badge color="#06B6D4" bg="#ECFEFF">{imp.country}</Badge>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{imp.systemType} • میانگین: {imp.averageCost?.toLocaleString('fa-IR')} تومان</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingItem(imp); setImpForm(imp); }} className="p-2 rounded-xl text-gray-400 hover:text-cyan-600 hover:bg-cyan-50"><Edit size={16} /></button>
                  <button onClick={() => handleDeleteImplant(imp.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* UNITS TAB */}
        {activeTab === 'units' && (
          <div className="space-y-3">
            {(isAdding || editingItem) && (
              <div className="p-3.5 rounded-2xl bg-blue-50/80 border border-blue-200 space-y-3 animate-fade-in">
                <h4 className="text-xs font-bold text-blue-900">{editingItem ? 'ویرایش یونیت' : 'افزودن یونیت جدید'}</h4>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="نام یونیت"><Input value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} placeholder="یونیت ۱ (آبی 🟦)" /></Field>
                  <Field label="رنگ شاخص"><Input value={unitForm.colorName} onChange={e => setUnitForm({ ...unitForm, colorName: e.target.value })} placeholder="آبی، زرد، سبز..." /></Field>
                </div>
                <Field label="پزشک / اتاق تخصصی"><Input value={unitForm.assignedDoctor} onChange={e => setUnitForm({ ...unitForm, assignedDoctor: e.target.value })} placeholder="دکتر مهدی امیری" /></Field>
                <div className="flex gap-2">
                  <Button onClick={handleSaveUnit} color="#3B82F6" className="flex-1">ذخیره یونیت</Button>
                  <Button onClick={() => { setIsAdding(false); setEditingItem(null); }} color="#9CA3AF" variant="secondary">انصراف</Button>
                </div>
              </div>
            )}

            {!isAdding && !editingItem && units.map(u => (
              <div key={u.id} className="p-3 rounded-2xl bg-white border border-gray-100 shadow-sm flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full" style={{ backgroundColor: u.colorHex }} />
                  <div>
                    <h4 className="text-sm font-bold text-gray-800">{u.name}</h4>
                    <p className="text-xs text-gray-500">{u.assignedDoctor || 'بدون پزشک ثابت'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setEditingItem(u); setUnitForm(u); }} className="p-2 rounded-xl text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit size={16} /></button>
                  <button onClick={() => handleDeleteUnit(u.id)} className="p-2 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={16} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
};
