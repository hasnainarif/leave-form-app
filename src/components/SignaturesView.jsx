import SignatureManager from './SignatureManager.jsx';
import { tr } from '../lib/strings.js';

/**
 * SignaturesView — its own screen now, not buried in Settings.
 * Props: lang, signatures, onChange(signatures), userId
 */
export default function SignaturesView({ lang, signatures, onChange, userId, defaultHrSignUrl, hrDefaultOff, onRemoveDefaultHr, onRestoreDefaultHr }) {
  const t = (p, ...a) => tr(lang, p, ...a);
  return (
    <div className="mx-auto w-full max-w-2xl">
      <h1 className="text-xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-50">
        {t('signs.title')}
      </h1>
      <p className="mb-5 mt-1 text-sm text-zinc-500 dark:text-slate-400">{t('signs.sub')}</p>
      <SignatureManager
        lang={lang}
        signatures={signatures}
        onChange={onChange}
        userId={userId}
        defaultHrSignUrl={defaultHrSignUrl}
        hrDefaultOff={hrDefaultOff}
        onRemoveDefaultHr={onRemoveDefaultHr}
        onRestoreDefaultHr={onRestoreDefaultHr}
      />
    </div>
  );
}
