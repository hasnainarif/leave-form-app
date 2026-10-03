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
  headers,
  rows,
  mapping,
  onMappingChange,
  onRowsChange,
  onBack,
  onContinue,
  apiKey,
  onApiKey,
  smartFixOn,
  onSmartFix,
  onRerunSmartFix,
  busy,
}) {
  const changeMapping = (field) => (e) => {
    onMappingChange({ ...(mapping || {}), [field]: e.target.value || null });
  };

  const patchRow = (id, patch) =>
    onRowsChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const dropRow = (id) => onRowsChange(rows.filter((r) => r.id !== id));

  const canContinue =
    !!mapping && REQUIRED.every((f) => mapping[f]) && rows.length > 0;

  return (
    <div className="space-y-6">
      {/* Gemini Smart Urdu Fix — naam aur department naam Urdu me theek karein.
          Upload ke BAAD bhi chal sakta hai, dobara file dene ki zaroorat nahi. */}
      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm dark:border-emerald-800 dark:bg-emerald-950 sm:p-6">
        <h2 className="text-lg font-semibold">✨ Gemini se Urdu theek karwain</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Employee ke naam aur department ke naam Gemini se saaf aur durust Urdu me likhwayein.
          Pehle apni Gemini API key dein (sirf is browser me mehfooz rehti hai).
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <input
            type="password"
            value={apiKey || ''}
            onChange={(e) => onApiKey && onApiKey(e.target.value)}
            placeholder="Gemini API key yahan paste karein"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900"
            autoComplete="off"
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={!!smartFixOn}
                onChange={(e) => onSmartFix && onSmartFix(e.target.checked)}
                className="h-5 w-5 accent-emerald-600"
              />
              Smart Urdu fix ON hai
            </label>
            <button
              onClick={onRerunSmartFix}
              disabled={busy || !apiKey}
              className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Gemini kaam kar raha hai...' : 'Gemini se Urdu theek karwain'}
            </button>
          </div>
          {!apiKey && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Key ke baghair button nahi chalega. Key AI Studio se free me milti hai.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">Column mapping</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Har field ke liye sahi column chunein. Name aur Date lazmi hain.
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

      <section className="rounded-lg bg-white p-4 shadow-sm dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">Rows ({(rows || []).length})</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Urdu text yahan theek kar sakte hain. Print se pehle aik nazar dekh lein.
        </p>

        {rows.length === 0 && (
          <p className="mt-4 rounded bg-slate-50 dark:bg-slate-800 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
            Koi row nahi mili.
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
                  Ye row hata dein
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
          Peeche
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Aagay
        </button>
      </div>
      {!canContinue && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Aagay ke liye Name aur Date column ka map hona aur kam az kam aik row
          hona zaroori hai.
        </p>
      )}
    </div>
  );
}
