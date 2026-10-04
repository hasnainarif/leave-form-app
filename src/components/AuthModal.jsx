import { useState } from 'react';
import { signIn, signUp } from '../lib/supabase.js';

/**
 * AuthModal — login / signup dialog.
 * Props: onClose(), onAuth(user) — called after successful login/signup.
 */
export default function AuthModal({ onClose, onAuth }) {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setInfo('');
    const em = email.trim();
    if (!em || !password) {
      setError('Email aur password dono likhein.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const user = await signIn(em, password);
        onAuth(user);
        onClose();
      } else {
        const { needsConfirm } = await signUp(em, password);
        if (needsConfirm) {
          setInfo('Account ban gaya. Email me aaye link par click kar ke confirm karein, phir login karein.');
          setMode('login');
        } else {
          const user = await signIn(em, password);
          onAuth(user);
          onClose();
        }
      }
    } catch (err) {
      setError(err.message || 'Kuch ghalat ho gaya.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {mode === 'login' ? 'Login' : 'Naya account'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Band karein"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Login karne par aap ke signatures aur chhuttiyan aap ke account se sync hon gi.
        </p>

        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="email"
              dir="ltr"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800"
              placeholder="aap@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Password</label>
            <input
              type="password"
              dir="ltr"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-800"
              placeholder={mode === 'signup' ? 'Kam az kam 6 harf' : '••••••••'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          {info && <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{info}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? '...' : mode === 'login' ? 'Login karein' : 'Account banayein'}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'login' ? 'signup' : 'login');
            setError('');
            setInfo('');
          }}
          className="mt-3 w-full text-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
        >
          {mode === 'login' ? 'Naya account banana hai? Signup karein' : 'Pehle se account hai? Login karein'}
        </button>
      </div>
    </div>
  );
}
