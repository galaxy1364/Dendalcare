import { useState, useEffect } from 'react';
import { CheckCircle2, FileEdit, Lock } from 'lucide-react';
import {
  hydratePatientClinicalRecordFromServer,
  persistClinicalNoteDraftCommand,
  persistSignClinicalNoteCommand,
  persistAmendClinicalNoteCommand,
  getPatientClinicalNotes,
  type ClinicalNoteRecord,
} from '@/features/clinical-record/clinicalRecordService';
import { Input } from '@/components/ui/Form';

export function ClinicalNotesPanel({
  patientId,
  effectiveRole,
}: {
  patientId: string;
  effectiveRole: string;
}) {
  const [notesList, setNotesList] = useState<ClinicalNoteRecord[]>(() => getPatientClinicalNotes(patientId));
  const [noteDiagnosis, setNoteDiagnosis] = useState('');
  const [noteNarrative, setNoteNarrative] = useState('');
  const [noteTooth, setNoteTooth] = useState('');
  const [noteFeedback, setNoteFeedback] = useState<string | null>(null);

  useEffect(() => {
    hydratePatientClinicalRecordFromServer(patientId).then(() => {
      setNotesList(getPatientClinicalNotes(patientId));
    });
  }, [patientId]);

  const handleCreateDraftNote = async () => {
    const res = await persistClinicalNoteDraftCommand({
      patientId,
      activeContextPatientId: patientId,
      assessmentDiagnosis: noteDiagnosis.trim() || 'ارزیابی بالینی دندانپزشکی',
      procedureNarrative: noteNarrative.trim(),
      fdiTeethScope: noteTooth.trim() || null,
      authoredBy: 'دکتر مهدی امیری',
      authoredRole: effectiveRole,
    });
    if (res.ok && res.note) {
      setNotesList(getPatientClinicalNotes(patientId));
      setNoteDiagnosis('');
      setNoteNarrative('');
      setNoteTooth('');
      setNoteFeedback(
        res.persistenceStatus === 'persisted_server'
          ? 'پیش‌نویس یادداشت بالینی در سرور ذخیره شد.'
          : 'پیش‌نویس یادداشت بالینی به‌صورت محلی ذخیره شد.'
      );
    } else {
      setNoteFeedback(res.errorMessageFa || 'خطا در ذخیره پیش‌نویس یادداشت.');
    }
  };

  const handleSignNote = async (note: ClinicalNoteRecord) => {
    const res = await persistSignClinicalNoteCommand({
      patientId,
      noteId: note.id,
      signerName: 'دکتر مهدی امیری',
      signerRole: effectiveRole,
    });
    if (res.ok) {
      setNotesList(getPatientClinicalNotes(patientId));
      setNoteFeedback('یادداشت بالینی با تأیید سرور امضا و قفل قانونی شد.');
    } else {
      setNoteFeedback(res.errorMessageFa || 'خطا در امضای یادداشت.');
    }
  };

  const handleAmendNote = async (note: ClinicalNoteRecord) => {
    const res = await persistAmendClinicalNoteCommand({
      patientId,
      parentNoteId: note.id,
      amendedDiagnosis: note.assessmentDiagnosis,
      amendedNarrative: `${note.procedureNarrative}\n[اصلاحیه الحاقی ثبت شد]`,
      amendmentReason: 'تکمیل شرح بالینی پس از امضا بدون بازنویسی نسخه اصلی',
      signerName: 'دکتر مهدی امیری',
      signerRole: effectiveRole,
    });
    if (res.ok) {
      setNotesList(getPatientClinicalNotes(patientId));
      setNoteFeedback('اصلاحیه الحاقی با حفظ نسخه امضاشده اصلی در سرور ثبت شد.');
    } else {
      setNoteFeedback(res.errorMessageFa || 'خطا در ثبت اصلاحیه.');
    }
  };

  return (
    <div className="rounded-2xl border border-violet-200 bg-violet-50/40 p-3 space-y-2.5 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black text-violet-900">یادداشت‌های بالینی امضاشده (Draft → Signed → Amended)</span>
        <span className="text-[10px] font-bold text-violet-700">غیرقابل بازنویسی پس از امضا</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <Input value={noteTooth} onChange={(e) => setNoteTooth(e.target.value)} placeholder="کد FDI (مثلاً 16)" className="text-xs" />
        <Input value={noteDiagnosis} onChange={(e) => setNoteDiagnosis(e.target.value)} placeholder="تشخیص بالینی..." className="text-xs" />
        <div className="sm:col-span-2">
          <Input value={noteNarrative} onChange={(e) => setNoteNarrative(e.target.value)} placeholder="شرح اقدام درمانی جلسه..." className="text-xs" />
        </div>
      </div>
      <button type="button" onClick={handleCreateDraftNote} className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-extrabold">
        ذخیره پیش‌نویس یادداشت بالینی
      </button>
      {noteFeedback && <p className="text-[10.5px] font-bold text-violet-800">{noteFeedback}</p>}

      {notesList.map((n) => (
        <div key={n.id} className="bg-white rounded-xl p-2.5 border border-violet-200 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-extrabold text-slate-800">
              {n.authoredBy} • {n.assessmentDiagnosis} {n.fdiTeethScope ? `• دندان ${n.fdiTeethScope}` : ''}
            </span>
            <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-violet-100 text-violet-800">
              {n.status === 'draft' ? 'پیش‌نویس (Draft)' : n.status === 'signed' ? 'امضاشده و قفل (Signed)' : `اصلاحیه v${n.version} (Amended)`}
            </span>
          </div>
          <p className="text-slate-600 whitespace-pre-wrap">{n.procedureNarrative}</p>
          <div className="flex items-center gap-2 pt-1">
            {n.status === 'draft' && (
              <button type="button" onClick={() => handleSignNote(n)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[10.5px] font-bold">
                <CheckCircle2 size={12} /> امضا و قفل قانونی
              </button>
            )}
            {n.status === 'signed' && (
              <>
                <button type="button" onClick={() => handleAmendNote(n)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white text-[10.5px] font-bold">
                  <FileEdit size={12} /> ثبت اصلاحیه الحاقی
                </button>
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-bold">
                  <Lock size={11} /> قفل در برابر ویرایش درجا
                </span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
