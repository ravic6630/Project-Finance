import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Inbox, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { relativeTime } from '../lib/format.js';
import { ErrorBanner } from './ui.jsx';

const THREADS_POLL_MS = 15000;
const CHAT_POLL_MS = 5000;

// Admin-side support inbox: every customer conversation, with replies.
// Mirrors the customer widget — the admin's own messages sit on the right.
export default function AdminSupport() {
  const [threads, setThreads] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [chat, setChat] = useState(null); // { user, messages }
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const d = await api('/support/admin/threads');
      setThreads(d.threads);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadChat = useCallback(async (userId) => {
    if (!userId) return;
    try {
      setChat(await api(`/support/admin/threads/${userId}`));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      loadThreads();
      if (openId) loadChat(openId);
    };
    tick();
    const timer = setInterval(tick, openId ? CHAT_POLL_MS : THREADS_POLL_MS);
    return () => clearInterval(timer);
  }, [openId, loadThreads, loadChat]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat]);

  async function reply(e) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending || !openId) return;
    setSending(true);
    setError('');
    try {
      setChat(await api(`/support/admin/threads/${openId}`, { method: 'POST', body: { body } }));
      setText('');
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const totalUnread = threads.reduce((s, t) => s + t.unread, 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="flex items-center gap-2 font-bold text-slate-900">
          <Inbox size={16} className="text-brand-700" /> Support inbox
        </h3>
        {totalUnread > 0 && (
          <span className="rounded-full bg-gold-400 px-2 py-0.5 text-xs font-bold text-brand-900">
            {totalUnread} new
          </span>
        )}
      </div>

      <ErrorBanner message={error} />

      {threads.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-slate-400">
          No customer messages yet. When someone writes in, their conversation appears here.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[260px_1fr]">
          {/* Thread list */}
          <div className={`max-h-[420px] overflow-y-auto border-slate-100 md:border-r ${openId ? 'hidden md:block' : ''}`}>
            {threads.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setOpenId(t.id);
                  setChat(null);
                  loadChat(t.id);
                }}
                className={`flex w-full flex-col items-start gap-0.5 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50 ${
                  openId === t.id ? 'bg-brand-50/60' : ''
                }`}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800">{t.name || t.email}</span>
                  {t.unread > 0 && (
                    <span className="shrink-0 rounded-full bg-gold-400 px-1.5 text-[11px] font-bold text-brand-900">
                      {t.unread}
                    </span>
                  )}
                </div>
                <span className="w-full truncate text-xs text-slate-500">
                  {t.last_sender === 'admin' ? 'You: ' : ''}
                  {t.last_body}
                </span>
                <span className="text-[10px] text-slate-400">{relativeTime(t.last_at)}</span>
              </button>
            ))}
          </div>

          {/* Conversation */}
          <div className={`flex min-h-[420px] flex-col ${openId ? '' : 'hidden md:flex'}`}>
            {!chat ? (
              <p className="flex flex-1 items-center justify-center px-4 text-sm text-slate-400">
                Pick a conversation to reply.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
                  <button
                    onClick={() => setOpenId(null)}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 md:hidden"
                    aria-label="Back to conversations"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{chat.user.name || 'Customer'}</p>
                    <p className="truncate text-xs text-slate-400">{chat.user.email}</p>
                  </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto bg-[#faf9f5] px-4 py-4">
                  {chat.messages.map((m) => {
                    const mine = m.sender === 'admin';
                    return (
                      <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
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
                  })}
                  <div ref={endRef} />
                </div>

                <form onSubmit={reply} className="flex items-end gap-2 border-t border-slate-100 p-2.5">
                  <textarea
                    rows={1}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        reply();
                      }
                    }}
                    placeholder="Write a reply…"
                    className="max-h-28 flex-1 resize-none rounded-xl border border-[#e8e2d4] px-3 py-2 text-sm outline-none focus:border-gold-300"
                  />
                  <button
                    type="submit"
                    disabled={!text.trim() || sending}
                    aria-label="Send reply"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white transition hover:bg-brand-800 disabled:opacity-40"
                  >
                    <Send size={16} />
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
