import { useState } from 'react';
import { verifyPin } from '../lib/pin.js';

/**
 * PinLock — full-screen gate shown when an app PIN is set and this
 * browser session has not unlocked yet.
 */
export default function PinLock({ onUnlock }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const press = (d) => {
    setError('');
    if (pin.length < 8) setPin(pin + d);
  };
  const backspace = () => {
    setError('');
    setPin(pin.slice(0, -1));
  };

  const submit = async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await verifyPin(pin);
      if (ok) {
        onUnlock();
      } else {
        setError('Ghalat PIN. Dobara koshish karein.');
        setPin('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-emerald-950 px-4">
      <div className="w-full max-w-xs rounded-2xl bg-white p-6 text-center shadow-xl dark:bg-slate-900">
        <div className="text-4xl">🔒</div>
        <h1 className="mt-2 text-lg font-bold">Crown Leave Form App</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          PIN darj karein
        </p>

        {/* PIN dots */}
        <div className="mt-4 flex justify-center gap-2" dir="ltr">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 ${
                i < pin.length
                  ? 'border-emerald-600 bg-emerald-600'
                  : 'border-slate-300 dark:border-slate-600'
              }`}
            />
          ))}
        </div>

        {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}

        {/* Numeric pad */}
        <div className="mt-5 grid grid-cols-3 gap-2" dir="ltr">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button
              key={d}
              onClick={() => press(d)}
              className="rounded-xl bg-slate-100 py-3 text-xl font-bold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            >
              {d}
            </button>
          ))}
          <button
            onClick={backspace}
            className="rounded-xl bg-slate-100 py-3 text-lg hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
            aria-label="Backspace"
          >
            ⌫
          </button>
          <button
            onClick={() => press('0')}
            className="rounded-xl bg-slate-100 py-3 text-xl font-bold hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700"
          >
            0
          </button>
          <button
            onClick={submit}
            disabled={pin.length < 4 || busy}
            className="rounded-xl bg-emerald-600 py-3 text-lg font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
            aria-label="Unlock"
          >
            {busy ? '...' : '✓'}
          </button>
        </div>

        <button
          onClick={submit}
          disabled={pin.length < 4 || busy}
          className="mt-4 w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Unlock karein
        </button>
      </div>
    </div>
  );
}
