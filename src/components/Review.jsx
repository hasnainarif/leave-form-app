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
  'font-urdu mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none';

export default function Review({
  headers,
  rows,
  mapping,
  onMappingChange,
  onRowsChange,
  onBack,
  onContinue,
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
      <section className="rounded-lg bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Column mapping</h2>
        <p className="mt-1 text-sm text-slate-600">
          Har field ke liye sahi column chunein. Name aur Date lazmi hain.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_LABELS.map(([field, label]) => (
            <label key={field} className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">
                {label}
                {REQUIRED.includes(field) && <span className="text-red-600"> *</span>}
              </span>
              <select
                value={(mapping && mapping[field]) || ''}
                onChange={changeMapping(field)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
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

      <section className="rounded-lg bg-white p-4 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Rows ({(rows || []).length})</h2>
        <p className="mt-1 text-sm text-slate-600">
          Urdu text yahan theek kar sakte hain. Print se pehle aik nazar dekh lein.
        </p>

        {rows.length === 0 && (
          <p className="mt-4 rounded bg-slate-50 p-4 text-center text-sm text-slate-500">
            Koi row nahi mili.
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {rows.map((r) => (
            <article key={r.id} className="rounded-lg border border-slate-200 p-3">
              <div className="grid grid-cols-2 gap-2">
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600">Name *</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.name || ''}
                    onChange={(e) => patchRow(r.id, { name: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="col-span-2 block sm:col-span-1">
                  <span className="text-xs font-medium text-slate-600">Father</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.father || ''}
                    onChange={(e) => patchRow(r.id, { father: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Ecode</span>
                  <input
                    value={r.ecode || ''}
                    onChange={(e) => patchRow(r.id, { ecode: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Date *</span>
                  <input
                    type="date"
                    value={r.date || ''}
                    onChange={(e) => patchRow(r.id, { date: e.target.value })}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Designation</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.designation || ''}
                    onChange={(e) => patchRow(r.id, { designation: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-600">Department</span>
                  <input
                    dir="rtl"
                    lang="ur"
                    value={r.department || ''}
                    onChange={(e) => patchRow(r.id, { department: e.target.value })}
                    className={inputCls}
                  />
                </label>
                <label className="col-span-2 block">
                  <span className="text-xs font-medium text-slate-600">Reason</span>
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
          className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </div>
      {!canContinue && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Continue ke liye Name aur Date column ka map hona aur kam az kam aik row
          hona zaroori hai.
        </p>
      )}
    </div>
  );
}
