import { useEffect, useMemo, useRef, useState } from 'react';
import { renderForm, buildPrintableDocument, formStyles } from '../lib/printForm.js';
import { tr } from '../lib/strings.js';

// Shape handed to renderForm. The app form (see App.jsx) carries Urdu text
// fields + pre-formatted leaveDate/toDate; renderForm expects the paper-form
// field names (workerNo, upperDateStr, leaveDateStr, quantity, leaveType),
// so the adaptation happens here in one place.
// upperDateStr is the NEXT WORKING DAY after the leave date (f.toDate),
// falling back to the leave date itself when unavailable.
function toFormData(f) {
  const leaveDateStr = f.leaveDate || '';
  return {
    workerNo: f.ecode || '',
    name: f.name || '',
    father: f.father || '',
    designation: f.designation || '',
    department: f.department || '',
    upperDateStr: f.toDate || leaveDateStr,
    leaveDateStr,
    quantity: '1',
    reason: f.reason || '',
    leaveType: 'sick',
  };
}

function safeRenderForm(data, placements, logoDataUrl) {
  try {
    return renderForm(data, placements, logoDataUrl);
  } catch (e) {
    return '<div style="padding:24px;font-family:sans-serif;color:#b91c1c">Ye form render nahi ho saka.</div>';
  }
}

// Crown logo (public/crown-logo.png, cleaned from the user's paper form).
// Fetched respecting the vite base path and turned into a data URL so the
// downloaded printable file stays self-contained. On any failure it stays
// null and renderForm renders the styled Urdu text fallback instead.
function useLogoDataUrl() {
  const [logoDataUrl, setLogoDataUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(import.meta.env.BASE_URL + 'crown-logo.png');
        if (!res.ok) return;
        const blob = await res.blob();
        const url = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        if (alive && typeof url === 'string') setLogoDataUrl(url);
      } catch (e) {
        // keep null; the Urdu text fallback renders
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return logoDataUrl;
}

function safeBuildDocument(formsHTML) {
  try {
    return buildPrintableDocument(formsHTML);
  } catch (e) {
    return (
      '<!doctype html><html><head><meta charset="utf-8"><title>Leave Forms</title></head>' +
      '<body>' +
      formsHTML.join('<hr>') +
      '</body></html>'
    );
  }
}

// Renders sibling HTML at natural size, then scales it down only if it is
// wider than the container. No assumptions about the form's pixel size.
function ScaledPreview({ html }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [boxH, setBoxH] = useState(0);

  useEffect(() => {
    const measure = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const naturalW = inner.scrollWidth || 1;
      const s = Math.min(1, outer.clientWidth / naturalW);
      setScale(s);
      setBoxH(inner.scrollHeight * s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (outerRef.current) ro.observe(outerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [html]);

  return (
    <div
      ref={outerRef}
      className="clf-preview relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      style={{ height: boxH || undefined }}
    >
      <div
        ref={innerRef}
        className="absolute left-0 top-0 w-full"
        style={{ transform: 'scale(' + scale + ')', transformOrigin: 'top left' }}
      >
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

export default function Generate({ lang = 'en', forms, signatures, onPrint, onDownload, onBack, onNewBatch = () => {} }) {
  const t = (k, ...a) => tr(lang, k, ...a);
  const logoDataUrl = useLogoDataUrl();
  const valid = useMemo(() => (forms || []).filter((f) => f._valid), [forms]);
  const skipped = (forms || []).length - valid.length;
  const signedCount = useMemo(
    () => valid.filter((f) => (f.sigPlacements || []).length > 0).length,
    [valid]
  );
  const ruleCount = (signatures || []).length;

  const formsHTML = useMemo(
    () => valid.map((f) => safeRenderForm(toFormData(f), f.sigPlacements || [], logoDataUrl)),
    [valid, logoDataUrl]
  );
  const docHTML = useMemo(() => safeBuildDocument(formsHTML), [formsHTML]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">{t('generate.preview')}</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t('generate.ready', valid.length)}
          {signedCount > 0 && ruleCount > 0 ? ' ' + t('generate.signed', signedCount) : ''}
        </p>
        {skipped > 0 && (
          <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t('generate.skipped', skipped)}
          </p>
        )}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            onClick={() => onPrint(docHTML)}
            disabled={valid.length === 0}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('generate.print')}
          </button>
          <button
            onClick={() => onDownload(docHTML)}
            disabled={valid.length === 0}
            className="rounded-lg border border-emerald-600 bg-white px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-900 dark:text-emerald-300 dark:hover:bg-emerald-950"
          >
            {t('generate.download')}
          </button>
          <button
            onClick={onBack}
            className="rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('back')}
          </button>
          <button
            onClick={onNewBatch}
            className="rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('generate.newBatch')}
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {t('generate.printNote')}
        </p>
      </section>

      {valid.length === 0 ? (
        <p className="rounded-3xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          {t('generate.empty')}
        </p>
      ) : (
        <div className="space-y-4">
          <style>{formStyles()}</style>
          {formsHTML.map((html, i) => (
            <ScaledPreview key={(valid[i] && valid[i].id) || i} html={html} />
          ))}
        </div>
      )}
    </div>
  );
}
