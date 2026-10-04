import { useEffect, useState } from 'react';
import { fetchKarachiHolidays } from '../lib/gemini.js';
import { isConfigured, fetchHolidays, saveHolidays } from '../lib/supabase.js';
import { hasPin, verifyPin, setPin, clearPin } from '../lib/pin.js';
import { tr } from '../lib/strings.js';

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

/**
 * SettingsView — appearance, language, PIN lock, public holidays.
 * API keys live in ApiKeysView now; signatures in SignaturesView.
 * Props: lang, onLang(l), dark, onDark(b), apiKeys,
 *   holidays, onHolidays(list), sheetMonth, sheetYear, onMonthYear(m, y)
 */
export default function SettingsView({
  lang,
  onLang,
  dark,
  onDark,
  apiKeys = [],
  holidays = [],
  onHolidays = () => {},
  sheetMonth,
  sheetYear,
  onMonthYear = () => {},
}) {
  const t = (p, ...a) => tr(lang, p, ...a);
  const keyList = Array.isArray(apiKeys) ? apiKeys : [];

  // ---- PIN ----
  const [pinSet, setPinSet] = useState(false);
  const [pinOld, setPinOld] = useState('');
  const [pinNew, setPinNew] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  const [pinMsgOk, setPinMsgOk] = useState(false);
  useEffect(() => {
    setPinSet(hasPin());
  }, []);
  const sayPin = (msg, ok) => {
    setPinMsg(msg);
    setPinMsgOk(!!ok);
  };
  const resetPinFields = () => {
    setPinOld('');
    setPinNew('');
    setPinConfirm('');
  };
  const saveNewPin = async () => {
    if (pinNew.length < 4 || pinNew !== pinConfirm) {
      sayPin(t('settings.pinNeed4'), false);
      return;
    }
    setPinBusy(true);
    try {
      await setPin(pinNew);
      setPinSet(true);
      resetPinFields();
      sayPin(t('settings.pinSaved'), true);
    } catch (e) {
      sayPin(t('settings.pinSaveFail'), false);
    } finally {
      setPinBusy(false);
    }
  };
  const changePin = async () => {
    if (pinOld.length < 4 || pinNew.length < 4) {
      sayPin(t('settings.pinNeedBoth'), false);
      return;
    }
    setPinBusy(true);
    try {
      const ok = await verifyPin(pinOld);
      if (!ok) {
        sayPin(t('settings.pinWrong'), false);
        return;
      }
      await setPin(pinNew);
      resetPinFields();
      sayPin(t('settings.pinChanged'), true);
    } finally {
      setPinBusy(false);
    }
  };
  const removePin = async () => {
    if (pinOld.length < 4) {
      sayPin(t('settings.pinNeedOld'), false);
      return;
    }
    setPinBusy(true);
    try {
      const ok = await verifyPin(pinOld);
      if (!ok) {
        sayPin(t('settings.pinWrong'), false);
        return;
      }
      clearPin();
      setPinSet(false);
      resetPinFields();
      sayPin(t('settings.pinRemoved'), true);
    } finally {
      setPinBusy(false);
    }
  };

  // ---- Holidays ----
  const month = `${sheetYear}-${String(sheetMonth).padStart(2, '0')}`;
  const handleMonthInput = (e) => {
    const v = e.target.value;
    if (!v) return;
    const [y, m] = String(v).split('-').map(Number);
    if (y && m >= 1 && m <= 12) onMonthYear(m, y);
  };
  const [review, setReview] = useState(null);
  const [reviewSource, setReviewSource] = useState('manual');
  const [geminiBusy, setGeminiBusy] = useState(false);
  const [dbList, setDbList] = useState(null);
  const [dbSource, setDbSource] = useState('');
  const [dbBusy, setDbBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setDbList(null);
    setDbSource('');
    if (isConfigured()) {
      setDbBusy(true);
      (async () => {
        const res = await fetchHolidays(month);
        if (!alive) return;
        if (res) {
          setDbList(res.holidays || []);
          setDbSource(res.source || '');
        }
        setDbBusy(false);
      })();
    }
    return () => {
      alive = false;
    };
  }, [month]);

  const loadFromGemini = async () => {
    if (!keyList.length || geminiBusy) return;
    setGeminiBusy(true);
    setError('');
    try {
      const dates = await fetchKarachiHolidays(month, keyList);
      const list = normalizeDates(dates);
      if (list.length === 0) setError(t('settings.holNoResult'));
      setReview(list);
      setReviewSource('gemini');
    } catch (e) {
      setError(t('settings.holFail'));
    } finally {
      setGeminiBusy(false);
    }
  };
  const manualAdd = () => {
    setError('');
    setReviewSource('manual');
    setReview((prev) => [...(prev || []), '']);
  };
  const confirmReview = async () => {
    const clean = [...new Set((review || []).map((d) => d.trim()).filter(Boolean))].sort();
    setDbBusy(true);
    setError('');
    try {
      let ok = true;
      if (isConfigured()) ok = await saveHolidays(month, clean, reviewSource);
      onHolidays(clean);
      setDbList(clean);
      setDbSource(reviewSource);
      setReview(null);
      if (!ok) setError(t('settings.holSaveFail'));
    } finally {
      setDbBusy(false);
    }
  };
  const savedList = dbList || holidays || [];
  const savedSource = dbSource;

  const card =
    'rounded-3xl bg-white p-5 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800';
  const h3 = 'text-base font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50';
  const note = 'mt-1 text-sm text-zinc-500 dark:text-slate-400';
  const label = 'mb-1.5 block text-sm font-bold text-zinc-700 dark:text-zinc-200';
  const input =
    'w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800';
  const btn =
    'rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:opacity-40';
  const ghostBtn =
    'rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200';

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('settings.title')}
      </h1>

      <section className={card}>
        <h3 className={h3}>{t('settings.appearance')}</h3>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-600 dark:text-slate-300">
            {t('settings.theme')}
          </span>
          <div className="flex rounded-full bg-zinc-100 p-1 dark:bg-slate-800">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                onClick={() => onDark(v)}
                className={
                  'rounded-full px-4 py-1.5 text-sm font-bold transition ' +
                  (dark === v
                    ? 'bg-white text-zinc-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-zinc-500 dark:text-slate-400')
                }
              >
                {v ? t('settings.dark') : t('settings.light')}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-600 dark:text-slate-300">
            {t('settings.language')}
          </span>
          <div className="flex rounded-full bg-zinc-100 p-1 dark:bg-slate-800">
            {['en', 'ur'].map((v) => (
              <button
                key={v}
                onClick={() => onLang(v)}
                className={
                  'rounded-full px-4 py-1.5 text-sm font-bold transition ' +
                  (lang === v
                    ? 'bg-white text-zinc-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-zinc-500 dark:text-slate-400')
                }
              >
                {v === 'en' ? 'EN' : 'اردو'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className={card}>
        <h3 className={h3}>{t('settings.pinLock')}</h3>
        <p className={note}>{t('settings.pinAbout')}</p>
        {!pinSet ? (
          <div className="mt-3 space-y-3">
            <div>
              <label className={label}>{t('settings.pinNew')}</label>
              <input
                type="password"
                inputMode="numeric"
                className={input}
                placeholder="••••"
                value={pinNew}
                onChange={(e) => setPinNew(e.target.value.replace(/\D/g, '').slice(0, 8))}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={label}>{t('settings.pinConfirm')}</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  className={input}
                  placeholder="••••"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  autoComplete="off"
                />
                <button
                  className={btn + ' shrink-0'}
                  onClick={saveNewPin}
                  disabled={!(pinNew.length >= 4 && pinNew === pinConfirm) || pinBusy}
                >
                  {pinBusy ? '…' : t('settings.pinSetBtn')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className={note}>{t('settings.pinOn')}</p>
            <div>
              <label className={label}>{t('settings.pinOld')}</label>
              <input
                type="password"
                inputMode="numeric"
                className={input}
                placeholder="••••"
                value={pinOld}
                onChange={(e) => setPinOld(e.target.value.replace(/\D/g, '').slice(0, 8))}
                autoComplete="off"
              />
            </div>
            <div>
              <label className={label}>{t('settings.pinChangeNew')}</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  className={input}
                  placeholder="••••"
                  value={pinNew}
                  onChange={(e) => setPinNew(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  autoComplete="off"
                />
                <button
                  className={btn + ' shrink-0'}
                  onClick={changePin}
                  disabled={!(pinOld.length >= 4 && pinNew.length >= 4) || pinBusy}
                >
                  {pinBusy ? '…' : t('settings.pinChangeBtn')}
                </button>
              </div>
            </div>
            <button
              className={ghostBtn + ' w-full'}
              onClick={removePin}
              disabled={pinOld.length < 4 || pinBusy}
            >
              {t('settings.pinRemoveBtn')}
            </button>
          </div>
        )}
        {pinMsg && (
          <p className={'mt-2 text-sm font-semibold ' + (pinMsgOk ? 'text-emerald-600' : 'text-red-600')}>
            {pinMsg}
          </p>
        )}
      </section>

      <section className={card}>
        <h3 className={h3}>{t('settings.holidays')}</h3>
        <div className="mt-3">
          <label className={label}>{t('settings.holMonth')}</label>
          <input type="month" className={input} value={month} onChange={handleMonthInput} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btn} onClick={loadFromGemini} disabled={!keyList.length || geminiBusy}>
            {geminiBusy ? t('settings.holFetching') : t('settings.holFetch')}
          </button>
          <button className={ghostBtn} onClick={manualAdd}>
            {t('settings.holManual')}
          </button>
        </div>
        {!keyList.length && <p className={note + ' mt-2'}>{t('settings.holNoKey')}</p>}
        {error && <p className="mt-2 text-sm font-semibold text-red-600">{error}</p>}

        {review !== null && (
          <div className="mt-3 rounded-2xl bg-zinc-50 p-3 dark:bg-slate-800">
            <p className="mb-2 text-sm font-bold">{t('settings.holReview')}</p>
            {review.length === 0 && <p className={note}>{t('settings.holNone')}</p>}
            {review.map((d, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input
                  type="date"
                  className={input}
                  value={d}
                  onChange={(e) =>
                    setReview((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                  }
                />
                <button
                  className={ghostBtn}
                  onClick={() => setReview((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <button className={ghostBtn + ' flex-1'} onClick={manualAdd}>
                {t('settings.holAddDate')}
              </button>
              <button className={btn + ' flex-1'} onClick={confirmReview} disabled={dbBusy}>
                {dbBusy ? t('settings.holSaving') : t('settings.holConfirm')}
              </button>
            </div>
          </div>
        )}

        <div className="mt-3">
          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-200">
            {t('settings.holSavedAs', month, savedSource)}
          </p>
          {dbBusy && savedList.length === 0 ? (
            <p className={note}>…</p>
          ) : savedList.length === 0 ? (
            <p className={note}>{t('settings.holNone')}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {savedList.map((d) => (
                <span
                  key={d}
                  className="rounded-full bg-emerald-50 px-3 py-1 font-mono text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                >
                  {d}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
