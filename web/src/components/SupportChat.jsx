import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, Send, Sprout, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';

// Floating support chat. Polls the thread every 5s while open (fast enough to
// feel live without a socket server) and the unread count every 60s while closed.
const OPEN_POLL_MS = 5000;
const IDLE_POLL_MS = 60000;

function Bubble({ m }) {
  const mine = m.sender === 'user';
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {!mine && (
        <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-brand-700">
          <Sprout size={12} className="text-gold-500" /> Sampada
        </span>
      )}
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
          mine
            ? 'rounded-br-md bg-brand-700 text-white'
            : 'rounded-bl-md border border-[#e8e2d4] bg-white text-slate-800'
        }`}
      >
        {m.body}
      </div>
      <span className="mt-1 text-[10px] text-slate-400">{relativeTime(m.created_at)}</span>
    </div>
  );
}

export default function SupportChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const loadThread = useCallback(async () => {
    try {
      const d = await api('/support/thread');
      setMessages(d.messages);
      setUnread(0);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadUnread = useCallback(async () => {
    try {
      const d = await api('/support/unread');
      setUnread(d.unread);
    } catch {
      /* a failed badge poll shouldn't surface anything */
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (open) loadThread();
      else loadUnread();
    };
    tick();
    const timer = setInterval(tick, open ? OPEN_POLL_MS : IDLE_POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [open, loadThread, loadUnread]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, open]);

  async function send(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const d = await api('/support/thread', { method: 'POST', body: { body } });
      setMessages(d.messages);
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Chat with us"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg ring-1 ring-gold-400/30 transition hover:bg-brand-800"
      >
        <MessageCircle size={22} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gold-400 px-1 text-[11px] font-bold text-brand-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 flex h-[min(560px,calc(100vh-5rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-[#e8e2d4] bg-[#faf9f5] shadow-2xl">
      <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-brand-700 to-brand-900 px-4 py-3.5 text-white">
        <div>
          <p className="font-display text-base font-bold leading-tight">Chat with us</p>
          <p className="text-[11px] text-brand-200">We usually reply within a few hours</p>
        </div>
        <button
          onClick={() => setOpen(false)}
          aria-label="Close chat"
          className="rounded-lg p-1 text-brand-200 transition hover:bg-white/10 hover:text-white"
        >
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-4">
        {messages.length === 0 ? (
          <div className="mt-6 text-center">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
              <MessageCircle size={20} />
            </div>
            <p className="text-sm font-semibold text-slate-700">Ask us anything</p>
            <p className="mx-auto mt-1 max-w-[240px] text-xs text-slate-500">
              Questions about your portfolio, imports, or billing — send a message and we&apos;ll get back to you.
            </p>
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="px-3.5 pb-1 text-xs font-medium text-rose-600">{error}</p>}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-[#e8e2d4] bg-white p-2.5">
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message…"
          className="max-h-28 flex-1 resize-none rounded-xl border border-[#e8e2d4] bg-white px-3 py-2 text-sm outline-none focus:border-gold-300"
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          aria-label="Send message"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
