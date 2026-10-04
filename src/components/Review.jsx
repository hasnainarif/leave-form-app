import { tr } from '../lib/strings.js';

const FIELD_LABELS = [
  ['ecode', 'Ecode'],
  ['name', 'Name'],
  ['father', 'Father'],
  ['designation', 'Designation'],
  ['department', 'Department'],
  ['date', 'Date'],
  ['reason', 'Reason'],
];

const REQUIRED = ['name', 'date'];

const inputCls =
  'font-urdu mt-1 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none';

export default function Review({
  lang = 'en',
  headers,
  rows,
  mapping,
  onMappingChange,
  onRowsChange,
  onBack,
  onContinue,
  apiKeys,
  onManageKeys = () => {},
  smartFixOn,
  onSmartFix,
  onRerunSmartFix,
  busy,
}) {
  const t = (p, ...a) => tr(lang, p, ...a);
  const changeMapping = (field) => (e) => {
    onMappingChange({ ...(mapping || {}), [field]: e.target.value || null });
  };

  const patchRow = (id, patch) =>
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const dropRow = (id) => onRowsChange(rows.filter((r) => r.id !== id));

  const keyList = Array.isArray(apiKeys) ? apiKeys : [];

  const canContinue =
    !!mapping && REQUIRED.every((f) => mapping[f]) && rows.length > 0;

  return (
    <div className="space-y-6">
      {/* Gemini Smart Urdu Fix — keys are managed in the API Keys view;
          here we only run the fix with the configured keys. */}
      <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800 sm:p-6">
        <h2 className="text-base font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
          ✨ {t('review.smartTitle')}
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t('review.smartSub')}</p>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-zinc-600 dark:text-slate-300">
              🔑 {t('review.keysConfigured', keyList.length)}
            </span>
            <button
              onClick={onManageKeys}
              className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-slate-800 dark:text-slate-200"
            >
              {t('review.manageKeys')}
            </button>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
              <input
                type="checkbox"
                checked={!!smartFixOn}
                onChange={(e) => onSmartFix && onSmartFix(e.target.checked)}
                className="h-5 w-5 accent-emerald-600"
              />
              {t('review.smartOn')}
            </label>
            <button
              onClick={onRerunSmartFix}
              disabled={busy || !keyList.length}
              className="rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? t('review.running') : t('review.runFix')}
            </button>
          </div>
          {!keyList.length && (
            <p className="text-xs text-zinc-500 dark:text-slate-400">
              {lang === 'ur'
                ? 'Pehle API Keys wale section me kam az kam ek key add karein.'
                : 'Add at least one key in the API Keys section first.'}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">{t('review.mapTitle')}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t('review.mapSub')}
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_LABELS.map(([field, label]) => (
            <label key={field} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
                {label}
                {REQUIRED.includes(field) && <span className="text-red-600"> *</span>}
              </span>
              <select
                value={(mapping && mapping[field]) || ''}
                onChange={changeMapping(field)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
              >
                <option value="">None</option>
                {(headers || []).map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">{t('review.rowsTitle', (rows || []).length)}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t('review.rowsSub')}
        </p>

        {rows.length === 0 && (
          <p className="mt-4 rounded bg-slate-50 dark:bg-slate-800 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('review.noRows')}
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((r) => (
            <article key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Name *</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.name || ''}
                    onChange={(e) => patchRow(r.id, { name: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Father</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.father || ''}
                    onChange={(e) => patchRow(r.id, { father: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Ecode</span>
                  <input
                    value={r.ecode || ''}
                    onChange={(e) => patchRow(r.id, { ecode: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Date *</span>
                  <input
                    type="date"
                    value={r.date || ''}
                    onChange={(e) => patchRow(r.id, { date: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Designation</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.designation || ''}
                    onChange={(e) => patchRow(r.id, { designation: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Department</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.department || ''}
                    onChange={(e) => patchRow(r.id, { department: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Reason</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.reason || ''}
                    onChange={(e) => patchRow(r.id, { reason: e.target.value })}
                    className={inputCls}
                  />
                </label>
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => dropRow(r.id)}
                  className="text-xs font-medium text-red-600 hover:underline"
                >
                  {t('review.removeRow')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          onClick={onBack}
          className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          {t('back')}
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('continue')}
        </button>
      </div>
      {!canContinue && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('review.needMapping')}
        </p>
      )}
    </div>
  );
}
