import { useEffect, useState } from 'react';
import { Check, Copy, Gift } from 'lucide-react';
import { api } from '../lib/api.js';
import { haptic, isNative, shareContent } from '../lib/native.js';

// "Give a month, get a month" — share link + a live tally. The code is minted
// server-side on first load, so this card always has something to show.
export default function ReferralCard() {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api('/billing/referral').then(setData).catch(() => {});
  }, []);

  if (!data?.code) return null;

  async function copyLink() {
    // On a phone the share sheet is the natural gesture (WhatsApp, Messages…);
    // on the web, copying the link is.
    if (isNative) {
      await shareContent({
        title: 'Join me on Sampada',
        text: 'I track my whole net worth on Sampada — join with my link and I get a free month of Premium.',
        url: data.link,
      });
      haptic('success');
      return;
    }
    try {
      await navigator.clipboard.writeText(data.link);
    } catch {
      const el = document.createElement('textarea');
      el.value = data.link;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="card p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700">
          <Gift size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-900">Invite friends, earn Premium</h3>
          <p className="mt-1 text-sm text-slate-500">
            Share your link. Every friend who joins and goes Premium earns you{' '}
            <span className="font-semibold text-slate-700">a free month</span> of Sampada Premium.
          </p>

          <div className="mt-4 flex items-stretch gap-2">
            <input
              className="input min-w-0 flex-1 font-mono text-xs sm:text-sm"
              value={data.link}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button className="btn-primary shrink-0" onClick={copyLink}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : isNative ? 'Share' : 'Copy'}
            </button>
          </div>

          <p className="mt-3 text-xs font-medium text-slate-500">
            <span className="text-slate-700">{data.referred}</span> friend{data.referred === 1 ? '' : 's'} joined
            <span className="mx-1.5 text-slate-300">·</span>
            <span className="text-slate-700">{data.rewarded}</span> went Premium
            {data.rewarded > 0 && (
              <span className="ml-1.5 text-gold-700">
                → {data.rewarded} free month{data.rewarded === 1 ? '' : 's'} earned 🎉
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
