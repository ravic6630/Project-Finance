import { Sprout, TrendingUp, Globe2, Users } from 'lucide-react';

const POINTS = [
  { icon: TrendingUp, text: 'Indian stocks, US stocks & mutual funds — live prices' },
  { icon: Globe2, text: 'See everything in ₹ or $ with live exchange rates' },
  { icon: Users, text: 'Private accounts for you, family & friends' },
];

export default function AuthAside() {
  return (
    <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-700 p-12 text-white lg:flex">
      <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-brand-500/40 blur-3xl" />
      <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-brand-900/50 blur-3xl" />
      <div className="relative flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
          <Sprout size={22} />
        </div>
        <span className="text-xl font-extrabold">Sampada</span>
      </div>
      <div className="relative">
        <h2 className="text-3xl font-extrabold leading-tight">
          All your wealth,
          <br />
          in one place.
        </h2>
        <p className="mt-3 max-w-sm text-brand-100">
          Track every investment and account across India and the US, and always know your true net
          worth.
        </p>
        <ul className="mt-8 space-y-4">
          {POINTS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15">
                <Icon size={18} />
              </div>
              <span className="text-sm font-medium text-brand-50">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-brand-200">Your data stays private to your account.</p>
    </div>
  );
}
