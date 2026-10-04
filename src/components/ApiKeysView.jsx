import { useState } from 'react';
import { testKey } from '../lib/gemini.js';
import { tr } from '../lib/strings.js';

/**
 * ApiKeysView — Gemini API key management, its own screen.
 * Props: lang, apiKeys, onApiKeys(keys)
 */
export default function ApiKeysView({ lang, apiKeys, onApiKeys }) {
  const t = (p, ...a) => tr(lang, p, ...a);
  const keyList = Array.isArray(apiKeys) ? apiKeys : [];
  const [keyInput, setKeyInput] = useState('');
  const [bulkKeys, setBulkKeys] = useState('');
  const [keyStatus, setKeyStatus] = useState({});
  const [flash, setFlash] = useState('');

  const maskKey = (k) => {
    const s = String(k || '');
    return s.length > 10 ? `${s.slice(0, 5)}...${s.slice(-4)}` : s;
  };

  const runKeyTest = async (k) => {
    setKeyStatus((m) => ({ ...m, [k]: { st: 'testing' } }));
    const r = await testKey(k);
    setKeyStatus((m) => ({
      ...m,
      [k]: r.ok ? { st: 'ok', ms: r.ms } : { st: 'bad', error: r.error },
    }));
  };

  const testAll = () => keyList.forEach((k) => runKeyTest(k));

  const flashMsg = (m) => {
    setFlash(m);
    setTimeout(() => setFlash(''), 2500);
  };

  const addKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    if (!keyList.includes(k)) {
      onApiKeys([...keyList, k]);
      runKeyTest(k);
    }
    setKeyInput('');
    flashMsg('✓');
  };

  const importBulk = () => {
    const parts = String(bulkKeys)
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const merged = [...keyList];
    parts.forEach((k) => {
      if (!merged.includes(k)) merged.push(k);
    });
    if (merged.length !== keyList.length) {
      onApiKeys(merged);
      merged.filter((k) => !keyList.includes(k)).forEach((k) => runKeyTest(k));
    }
    setBulkKeys('');
    flashMsg('✓');
  };

  const removeKey = (k) => onApiKeys(keyList.filter((x) => x !== k));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t('keys.title')}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t('keys.sub')}</p>
        </div>
        {keyList.length > 0 && (
          <button
            onClick={testAll}
            className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            {t('keys.testAll')}
          </button>
        )}
      </div>

      {flash && (
        <p className="mb-3 text-sm font-bold text-emerald-600 dark:text-emerald-400">{flash}</p>
      )}

      <div className="space-y-3">
        {keyList.map((k) => {
          const st = keyStatus[k] || {};
          return (
            <div
              key={k}
              className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    'h-2.5 w-2.5 shrink-0 rounded-full ' +
                    (st.st === 'ok'
                      ? 'bg-emerald-500'
                      : st.st === 'bad'
                        ? 'bg-red-500'
                        : st.st === 'testing'
                          ? 'animate-pulse bg-amber-400'
                          : 'bg-zinc-300 dark:bg-slate-600')
                  }
                />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-700 dark:text-slate-200">
                  {maskKey(k)}
                  {st.st === 'ok' && st.ms != null && (
                    <span className="ml-1 text-xs text-emerald-600">
                      ({(st.ms / 1000).toFixed(1)}s)
                    </span>
                  )}
                </span>
                <button
                  onClick={() => runKeyTest(k)}
                  className="rounded-full bg-zinc-100 px-3.5 py-1.5 text-xs font-bold text-zinc-700 transition hover:bg-zinc-200 dark:bg-slate-800 dark:text-slate-200"
                >
                  {t('test')}
                </button>
                <button
                  onClick={() => removeKey(k)}
                  className="rounded-full bg-red-50 px-3.5 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400"
                >
                  {t('remove')}
                </button>
              </div>
              {st.st === 'bad' && st.error && (
                <p className="mt-2 text-xs font-medium text-red-600">{st.error}</p>
              )}
              {st.st === 'ok' && (
                <p className="mt-2 text-xs font-medium text-emerald-600">
                  ✓ {t('keys.working')}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-3xl bg-white p-4 shadow-sm ring-1 ring-zinc-100 dark:bg-slate-900 dark:ring-slate-800">
        <div className="flex gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addKey();
            }}
            placeholder={t('keys.addPh')}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            onClick={addKey}
            disabled={!keyInput.trim()}
            className="shrink-0 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:opacity-40"
          >
            {t('keys.addBtn')}
          </button>
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-zinc-600 dark:text-slate-300">
            {t('keys.bulkTitle')}
          </summary>
          <textarea
            value={bulkKeys}
            onChange={(e) => setBulkKeys(e.target.value)}
            placeholder={t('keys.bulkPh')}
            autoComplete="off"
            className="mt-2 min-h-20 w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 font-mono text-sm outline-none focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800"
          />
          <button
            onClick={importBulk}
            disabled={!bulkKeys.trim()}
            className="mt-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:opacity-40"
          >
            {t('keys.importBtn')}
          </button>
        </details>

        <p className="mt-3 text-xs leading-relaxed text-zinc-400 dark:text-slate-500">
          {t('keys.secureNote')}
        </p>
      </div>
    </div>
  );
}
