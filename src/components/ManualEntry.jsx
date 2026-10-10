import { useState } from 'react';
import { tr } from '../lib/strings.js';

const QUICK_REASONS = ['SICK', 'FEVER', 'CASUAL', 'ANNUAL'];

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const inputCls =
  'min-h-[48px] w-full rounded-xl border border-slate-300 bg-white px-3.5 text-[16px] text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/25 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const labelCls =
  'mb-1.5 block text-sm font-bold text-slate-700 dark:text-slate-200';

export default function ManualEntry({
  lang = 'en',
  leaveType = 'sick',
  onLeaveType,
  onSubmit,
  busy = false,
}) {
  const t = (k, ...a) => tr(lang, k, ...a);
  const [ecode, setEcode] = useState('');
  const [name, setName] = useState('');
  const [father, setFather] = useState('');
  const [designation, setDesignation] = useState('');
  const [department, setDepartment] = useState('');
  const [date, setDate] = useState(todayIso);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!name.trim() || !date) {
      setError(t('manual.needNameDate'));
      return;
    }
    onSubmit({
      ecode: ecode.trim(),
      name: name.trim(),
      father: father.trim(),
      designation: designation.trim(),
      department: department.trim(),
      date,
      reason: reason.trim(),
    });
  };

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-2xl dark:bg-emerald-900/50">
          ✍️
        </div>
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">{t('manual.title')}</h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{t('manual.sub')}</p>
        </div>
      </div>

      {/* Leave type */}
      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t('manual.leaveType')}
        </p>
        <div className="mt-2 flex gap-2">
          {[
            ['sick', t('upload.leaveTypeSick')],
            ['casual', t('upload.leaveTypeCasual')],
            ['annual', t('upload.leaveTypeAnnual')],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => onLeaveType && onLeaveType(id)}
              className={
                'min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-semibold transition ' +
                (leaveType === id
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="me-date">{t('manual.leaveDate')}</label>
          <input
            id="me-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="me-ecode">{t('manual.ecode')}</label>
          <input
            id="me-ecode"
            type="text"
            inputMode="numeric"
            value={ecode}
            onChange={(e) => setEcode(e.target.value)}
            placeholder={t('manual.ecodePh')}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="me-name">{t('manual.name')}</label>
          <input
            id="me-name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('manual.namePh')}
            className={inputCls + ' uppercase'}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="me-father">{t('manual.father')}</label>
          <input
            id="me-father"
            type="text"
            autoComplete="off"
            value={father}
            onChange={(e) => setFather(e.target.value)}
            placeholder={t('manual.fatherPh')}
            className={inputCls + ' uppercase'}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="me-desig">{t('manual.designation')}</label>
          <input
            id="me-desig"
            type="text"
            autoComplete="off"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            placeholder={t('manual.designationPh')}
            className={inputCls + ' uppercase'}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="me-dept">{t('manual.department')}</label>
          <input
            id="me-dept"
            type="text"
            autoComplete="off"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder={t('manual.departmentPh')}
            className={inputCls + ' uppercase'}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls} htmlFor="me-reason">{t('manual.reason')}</label>
          <input
            id="me-reason"
            type="text"
            autoComplete="off"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('manual.reasonPh')}
            className={inputCls + ' uppercase'}
          />
          <p className="mb-1.5 mt-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t('manual.quickReasons')}
          </p>
          <div className="flex flex-wrap gap-2">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={
                  'min-h-[40px] rounded-full border px-4 text-sm font-semibold transition ' +
                  (reason.toUpperCase() === r
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300')
                }
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="mt-6 min-h-[52px] w-full rounded-2xl bg-emerald-600 text-base font-extrabold text-white shadow-lg shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:opacity-60"
      >
        {busy ? t('busy.working') : '🖨️ ' + t('manual.submit')}
      </button>
    </section>
  );
}
