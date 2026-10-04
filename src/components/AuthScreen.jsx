import { useState } from 'react';
import { signIn, signUp, resendConfirmation } from '../lib/supabase.js';
import { tr } from '../lib/strings.js';

/**
 * AuthScreen — full-page sign in / create account / confirm-email gate.
 * WAbot login style: centered card, no modal. The app renders nothing
 * else until the user has a CONFIRMED session.
 * Props: lang, onLang(l), onAuth(user)
 */
export default function AuthScreen({ lang, onLang, onAuth }) {
  const [mode, setMode] = useState('login'); // login | signup | pending
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [errCode, setErrCode] = useState('');
  const [info, setInfo] = useState('');

  const t = (p, ...a) => tr(lang, p, ...a);
  const errMsg = (code) => t(`auth.errors.${code}`) || t('auth.errors.UNKNOWN');

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErrCode('');
    setInfo('');
    const em = email.trim();
    if (!em || !password) {
      setErrCode('NEED_BOTH');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const user = await signIn(em, password);
        onAuth(user);
      } else {
        await signUp(em, password);
        setMode('pending'); // confirmation email gayi — login band, pehle confirm
      }
    } catch (err) {
      const code = err.code === 'UNCONFIRMED' ? 'UNCONFIRMED' : err.code || 'UNKNOWN';
      if (code === 'ALREADY_REGISTERED' && mode === 'signup') {
        setMode('login');
      }
      setErrCode(code);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    const em = email.trim();
    if (!em || busy) return;
    setBusy(true);
    setErrCode('');
    try {
      await resendConfirmation(em);
      setInfo(t('auth.resent'));
    } catch (err) {
      setErrCode(err.code || 'UNKNOWN');
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (m) => {
    setMode(m);
    setErrCode('');
    setInfo('');
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#faf9f7] px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-xl text-white shadow-md shadow-emerald-600/30">
              📋
            </span>
            <span className="text-lg font-extrabold tracking-tight text-zinc-800 dark:text-zinc-100">
              {t('appName')}
            </span>
          </div>
          <button
            onClick={() => onLang(lang === 'en' ? 'ur' : 'en')}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            {lang === 'en' ? 'اردو' : 'EN'}
          </button>
        </div>

        <div className="rounded-3xl bg-white p-7 shadow-xl shadow-zinc-200/60 dark:bg-slate-900 dark:shadow-none dark:ring-1 dark:ring-slate-800">
          {mode === 'pending' ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-900/40">
                ✉️
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t('auth.checkEmail')}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-slate-400">
                {t('auth.checkEmailSub')}
              </p>
              {info && (
                <p className="mt-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {info}
                </p>
              )}
              {errCode && (
                <p className="mt-3 text-sm font-semibold text-red-600">{errMsg(errCode)}</p>
              )}
              <button
                onClick={resend}
                disabled={busy}
                className="mt-5 w-full rounded-full bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {t('auth.resend')}
              </button>
              <button
                onClick={() => switchMode('login')}
                className="mt-3 w-full text-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                {t('auth.toLogin')}
              </button>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
                {mode === 'login' ? t('auth.signIn') : t('auth.create')}
              </h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">
                {mode === 'login' ? t('auth.signInSub') : t('auth.createSub')}
              </p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-zinc-700 dark:text-zinc-200">
                    {t('auth.email')}
                  </label>
                  <input
                    type="email"
                    dir="ltr"
                    required
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-800"
                    placeholder={t('auth.emailPh')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-bold text-zinc-700 dark:text-zinc-200">
                    {t('auth.password')}
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    required
                    minLength={6}
                    className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-base outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-800"
                    placeholder={mode === 'login' ? t('auth.passPhLogin') : t('auth.passPhSignup')}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                </div>

                {errCode === 'NEED_BOTH' && (
                  <p className="text-sm font-semibold text-red-600">{t('auth.needBoth')}</p>
                )}
                {errCode && errCode !== 'NEED_BOTH' && (
                  <div>
                    <p className="text-sm font-semibold text-red-600">{errMsg(errCode)}</p>
                    {(errCode === 'NOT_CONFIRMED' || errCode === 'UNCONFIRMED') &&
                      email.trim() && (
                        <button
                          type="button"
                          onClick={resend}
                          disabled={busy}
                          className="mt-2 text-sm font-bold text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          {t('auth.resend')}
                        </button>
                      )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-full bg-emerald-600 py-3 text-sm font-bold text-white shadow-md shadow-emerald-600/25 transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50"
                >
                  {busy ? '…' : mode === 'login' ? t('auth.signInBtn') : t('auth.signUpBtn')}
                </button>
              </form>

              <button
                onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
                className="mt-4 w-full text-center text-sm font-semibold text-emerald-700 hover:underline dark:text-emerald-400"
              >
                {mode === 'login' ? t('auth.toSignup') : t('auth.toLogin')}
              </button>
            </>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-zinc-400 dark:text-slate-500">
          {t('appTag')}
        </p>
      </div>
    </div>
  );
}
