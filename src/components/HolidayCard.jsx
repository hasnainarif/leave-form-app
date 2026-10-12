import { useEffect, useState } from 'react';
import { fetchKarachiHolidays } from '../lib/gemini.js';
import { isConfigured, fetchHolidays, saveHolidays } from '../lib/supabase.js';
import { tr } from '../lib/strings.js';

/**
 * HolidayCard — compact Public Holidays widget for the Upload step.
 *
 * Mirrors the SettingsView holidays logic (same Gemini fetch, same Supabase
 * save, same App-level holidays state) so the two stay in sync. The user
 * kept forgetting to fetch holidays in Settings, so this lives right where
 * the Excel sheet is uploaded.
 *
 * Props: lang, month, year, holidays, onHolidays(list), apiKeys
 */
function normalizeDates(raw) {
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const str = typeof item === 'string' ? item : item && (item.date || item.holiday || item.day);
    if (!str) continue;
    const m = String(str).match(/(\d{4}-\d{2}-\d{2})/);
    if (m) out.push(m[1]);
  }
  return [...new Set(out)].sort();
}

export default function HolidayCard({
  lang = 'en',
  month,
  year,
  holidays = [],
  onHolidays = () => {},
  apiKeys = [],
}) {
  const t = (k, ...a) => tr(lang, k, ...a);
  const holMonth = `${year}-${String(month).padStart(2, '0')}`;

  const [dbList, setDbList] = useState(null);
  const [dbBusy, setDbBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [manualDate, setManualDate] = useState('');
  const [error, setError] = useState('');

  // Load this month's saved holidays (Supabase mode). Local mode uses the
  // holidays prop straight from App state (persisted to this PC).
  useEffect(() => {
    let alive = true;
    setDbList(null);
    setReview(null);
    setError('');
    if (isConfigured()) {
      setDbBusy(true);
      (async () => {
        try {
          const res = await fetchHolidays(holMonth);
          if (alive && res) setDbList(res.holidays || []);
        } catch (e) {
          /* ignore — falls back to holidays prop */
        }
        if (alive) setDbBusy(false);
      })();
    }
    return () => {
      alive = false;
    };
  }, [holMonth]);

  const savedList = dbList || holidays || [];
  const keys = Array.isArray(apiKeys) ? apiKeys.filter(Boolean) : [];

  const loadFromGemini = async () => {
    if (!keys.length || geminiBusy) return;
    setGeminiBusy(true);
    setError('');
    try {
      const dates = await fetchKarachiHolidays(holMonth, keys);
      const list = normalizeDates(dates);
      if (!list.length) setError(t('settings.holNoResult'));
      setReview(list);
    } catch (e) {
      setError(t('settings.holFail'));
    } finally {
      setGeminiBusy(false);
    }
  };

  const openManual = () => {
    setError('');
    setReview([...savedList]);
  };

  const addManualDate = () => {
    if (!manualDate) return;
    setReview((prev) => [...new Set([...(prev || []), manualDate])].sort());
    setManualDate('');
  };

  const removeReviewDate = (d) => {
    setReview((prev) => (prev || []).filter((x) => x !== d));
  };

  const confirmReview = async () => {
    const clean = [...new Set((review || []).map((d) => String(d || '').trim()).filter(Boolean))].sort();
    setDbBusy(true);
    setError('');
    try {
      let ok = true;
      if (isConfigured()) ok = await saveHolidays(holMonth, clean, 'gemini');
      onHolidays(clean);
      setDbList(clean);
      setReview(null);
      if (!ok) setError(t('settings.holSaveFail'));
    } catch (e) {
      setError(t('settings.holSaveFail'));
    } finally {
      setDbBusy(false);
    }
  };

  return (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
      <div className="flex items-center gap-2">
        <span className="text-xl">🎄</span>
        <p className="text-sm font-extrabold text-slate-800 dark:text-slate-100">
          {t('settings.holidays')} · {holMonth}
        </p>
      </div>

      <div className="mt-2">
        {dbBusy && savedList.length === 0 ? (
          <p className="text-sm text-slate-500">…</p>
        ) : savedList.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              ✅ {t('settings.holSavedAs', holMonth, '')}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {savedList.map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-mono text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                >
                  {d}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
            ⚠️ {t('settings.holNone')}
          </p>
        )}
      </div>

      {review === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadFromGemini}
            disabled={!keys.length || geminiBusy}
            className="min-h-[40px] rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {geminiBusy ? t('settings.holFetching') : '🎄 ' + t('settings.holFetch')}
          </button>
          <button
            type="button"
            onClick={openManual}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-emerald-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
          >
            ＋ {t('settings.holManual')}
          </button>
        </div>
      ) : (
        <div className="mt-3 rounded-xl bg-white p-3 dark:bg-slate-900">
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{t('settings.holReview')}</p>
          {review.length === 0 && <p className="mt-1 text-sm text-slate-500">{t('settings.holNone')}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {review.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1.5 font-mono text-xs font-semibold dark:bg-slate-800"
              >
                {d}
                <button
                  type="button"
                  onClick={() => removeReviewDate(d)}
                  className="flex h-4 w-4 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600"
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
            />
            <button
              type="button"
              onClick={addManualDate}
              disabled={!manualDate}
              className="min-h-[40px] rounded-lg border border-slate-300 px-3 text-sm font-bold disabled:opacity-50 dark:border-slate-600"
            >
              ＋
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setReview(null)}
              className="min-h-[40px] flex-1 rounded-lg border border-slate-300 text-sm font-bold dark:border-slate-600"
            >
              {t('cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={confirmReview}
              disabled={dbBusy}
              className="min-h-[40px] flex-1 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {dbBusy ? t('settings.holSaving') : '✓ ' + t('settings.holConfirm')}
            </button>
          </div>
        </div>
      )}

      {!keys.length && review === null && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('settings.holNoKey')}</p>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}
    </div>
  );
}
