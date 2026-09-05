import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/* A password box you can look inside.

   Typing a password blind is the single commonest reason a sign-in fails, and
   on a phone keyboard it is close to a coin toss. So every password field in
   the app gets the same reveal control, in the same place, with the same words.

   Three things that are easy to get wrong and matter here:
   - type="button". Inside a <form>, a bare <button> submits it, so tapping the
     eye would try to sign you in with a half-typed password.
   - The control is a real button in the tab order, labelled for screen readers,
     and carries aria-pressed so its state is announced rather than implied by
     an icon swap.
   - Revealed text must never be offered to a password manager or an autofill
     heuristic as a plain field, so autoComplete stays whatever the caller set
     and only `type` changes.

   It stays uncontrolled about visibility on purpose: revealing one field must
   not reveal the one next to it, so each instance owns its own state. */
export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  minLength,
  required = false,
  autoFocus = false,
  hint = null,
  id,
}) {
  const [shown, setShown] = useState(false);
  const auto = useId();
  const inputId = id || auto;

  return (
    <div>
      {label && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          // pr-11 keeps the longest password clear of the button rather than
          // running underneath it.
          className="input pr-11"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          minLength={minLength}
          required={required}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          aria-controls={inputId}
          // -translate-y-1/2 with top-1/2 centres it whatever the field height,
          // including when a validation message grows the row.
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
        >
          {shown ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
