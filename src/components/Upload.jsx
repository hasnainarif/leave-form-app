import { useRef, useState } from 'react';
import { parseFile, detectColumns } from '../lib/excel.js';

const ACCEPT = '.xlsx,.xls,.csv';

export default function Upload({ onParsed }) {
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

  return (
    <section className="rounded-lg bg-white p-4 shadow-sm sm:p-8">
      <h2 className="text-lg font-semibold">Excel file upload karein</h2>
      <p className="mt-1 text-sm text-slate-600">
        Sick leave register wali file yahan dein. .xlsx, .xls ya .csv sab chalenge.
      </p>

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
          'mt-4 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition sm:p-12 ' +
          (dragOver
            ? 'border-emerald-600 bg-emerald-50'
            : 'border-slate-300 bg-slate-50 hover:border-emerald-500 hover:bg-emerald-50/50')
        }
      >
        <p className="text-lg font-semibold text-slate-700">File chunein ya yahan drop karein</p>
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

      <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 sm:text-sm">
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
