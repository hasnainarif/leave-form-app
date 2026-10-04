import { useRef, useState } from 'react';
import { parseFile, detectColumns } from '../lib/excel.js';

const ACCEPT = '.xlsx,.xls,.csv';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Upload({ onParsed, month, year, onMonthYear }) {
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    setError('');
    if (!file) return;
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError('Sirf Excel ya CSV file chalay gi (.xlsx, .xls, .csv).');
      return;
    }
    setBusy(true);
    setFileName(file.name);
    try {
      const parsed = await parseFile(file);
      const headers = (parsed && parsed.headers) || [];
      const rows = (parsed && parsed.rows) || [];
      if (!headers.length) {
        setError('File khaali lag rahi hai. Koi column nahi mila.');
        return;
      }
      if (!rows.length) {
        setError('File mein koi row nahi mili.');
        return;
      }
      const mapping = detectColumns(headers) || {};
      await onParsed({ headers, rows, mapping });
    } catch (e) {
      setError('File parhne mein masla hua. File dobara check karke upload karein.');
    } finally {
      setBusy(false);
    }
  };

  const years = [];
  const thisYear = new Date().getFullYear();
  for (let y = thisYear - 2; y <= thisYear + 2; y++) years.push(y);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-2xl dark:bg-emerald-900/50">
          📤
        </div>
        <div>
          <h2 className="text-lg font-extrabold tracking-tight">Excel file upload karein</h2>
          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
            Sick leave register wali file yahan dein. .xlsx, .xls ya .csv sab chalenge.
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Ye register kis month ka hai?
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Date column me sirf din likha ho (jaise 18, 19, 20) to usi month ka samjha jayega.
        </p>
        <div className="mt-2 flex gap-2">
          <select
            value={month}
            onChange={(e) => onMonthYear && onMonthYear(Number(e.target.value), year)}
            className="min-h-[44px] flex-1 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            aria-label="Register ka month"
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>{name}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => onMonthYear && onMonthYear(month, Number(e.target.value))}
            className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-600 dark:bg-slate-900"
            aria-label="Register ka saal"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (inputRef.current) inputRef.current.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          handleFile(f);
        }}
        onClick={() => {
          if (inputRef.current) inputRef.current.click();
        }}
        className={
          'mt-5 cursor-pointer rounded-3xl border-2 border-dashed p-8 text-center transition sm:p-12 ' +
          (dragOver
            ? 'scale-[1.01] border-emerald-600 bg-emerald-50 dark:bg-emerald-950'
            : 'border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/50 dark:border-slate-600 dark:bg-slate-800/60 dark:hover:bg-emerald-950/40')
        }
      >
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-3xl dark:bg-emerald-900/50">
          📁
        </div>
        <p className="text-base font-bold text-slate-800 dark:text-slate-100">File chunein ya yahan drop karein</p>
        <p className="mt-1 text-sm text-slate-500">Phone se bhi file select ho jayegi.</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            e.target.value = '';
            handleFile(f);
          }}
        />
      </div>

      {fileName && <p className="mt-2 truncate text-sm text-slate-600">File: {fileName}</p>}
      {busy && <p className="mt-2 text-sm font-medium text-emerald-700">File parhi ja rahi hai...</p>}
      {error && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-400 sm:text-sm">
        <p className="font-semibold">File mein ye columns hone chahiye:</p>
        <p className="mt-1">
          Ecode, Name, Father, Designation, Department, Date, Reason. Naam thore
          mukhtalif bhi hon to app khud pehchanne ki koshish karegi, aur agle step
          mein aap mapping khud theek kar sakte hain.
        </p>
      </div>
    </section>
  );
}
