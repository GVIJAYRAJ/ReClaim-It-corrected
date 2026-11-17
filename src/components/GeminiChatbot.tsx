import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import type { ChatTurn } from '../types';

const QUICK_PROMPTS = [
  'How do I report a lost item with photos?',
  'Are there any laptops or headphones found recently?',
  'How does ownership claim verification work?',
];

export function GeminiChatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      role: 'model',
      text: 'Hello! I am the Reclaim It Campus Assistant. Ask me to help search lost or found items, guide your report submission, or explain claim verification steps.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, open]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    const priorHistory = [...messages];
    const nextMessages: ChatTurn[] = [...priorHistory, { role: 'user', text: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setError('');
    setSending(true);

    try {
      const data = await apiFetch<{ reply: string }>('/api/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          history: priorHistory,
          message: trimmed,
        }),
      });
      setMessages((prev) => [...prev, { role: 'model', text: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Gemini assistant.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium shadow-lg transition-transform duration-150 hover:-translate-y-0.5 whitespace-nowrap"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Campus Assistant</span>
        </button>
      )}

      {open && (
        <aside
          className="fixed bottom-5 right-5 z-40 w-[calc(100vw-2.5rem)] sm:w-[400px] h-[540px] max-h-[82vh] bg-white border border-slate-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
          aria-label="Reclaim It Campus Assistant Chat"
        >
          <div className="px-4 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
            <div>
              <h3 className="text-sm font-semibold">Reclaim It Assistant</h3>
              <p className="text-[11px] text-slate-300">
                Guided reporting, search &amp; claim support
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant chat"
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-800 text-white'
                      : 'bg-white border border-slate-200 text-slate-800'
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-500">
                  Searching campus catalog...
                </div>
              </div>
            )}
            {error && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}
          </div>

          {messages.length <= 2 && (
            <div className="px-4 py-2 bg-white border-t border-slate-100 flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendMessage(q)}
                  className="text-[11px] text-left px-2.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about lost items, claims, or reporting..."
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-800/20 focus:border-blue-800"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className="p-2.5 rounded-lg bg-blue-800 hover:bg-blue-900 text-white disabled:opacity-50 transition-colors shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
