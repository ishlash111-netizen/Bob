import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Layers, 
  MessageSquare, 
  Clock, 
  User, 
  Bot, 
  Globe, 
  Sparkles, 
  Trash2,
  Table,
  ArrowRight,
  Plus,
  BookmarkCheck,
  CheckCircle2,
  HardDrive
} from 'lucide-react';
import { ChatMessage, ChatSession } from '../types';

interface MemoryInspectorProps {
  sessions: ChatSession[];
  currentSessionId: string;
  messages: ChatMessage[];
  onClearSession: () => void;
}

interface MemoryFact {
  id: string;
  fact: string;
  category: string;
  createdAt: string;
}

export const MemoryInspector: React.FC<MemoryInspectorProps> = ({
  sessions,
  currentSessionId,
  messages,
  onClearSession,
}) => {
  const [testQuery, setTestQuery] = useState('u qachon tug‘ilgan?');
  const [testResult, setTestResult] = useState('');
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [newFact, setNewFact] = useState('');
  const [isLoadingFacts, setIsLoadingFacts] = useState(false);

  const fetchFacts = async () => {
    try {
      setIsLoadingFacts(true);
      const res = await fetch('/api/memory/facts');
      if (res.ok) {
        const data = await res.json();
        setFacts(data.facts || []);
      }
    } catch (e) {
      console.warn('Could not fetch facts', e);
    } finally {
      setIsLoadingFacts(false);
    }
  };

  useEffect(() => {
    fetchFacts();
  }, []);

  const handleAddFact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFact.trim()) return;
    try {
      const res = await fetch('/api/memory/facts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fact: newFact.trim(), category: 'fact' }),
      });
      if (res.ok) {
        const data = await res.json();
        setFacts(data.facts || []);
        setNewFact('');
      }
    } catch (e) {
      console.warn('Failed to add fact', e);
    }
  };

  const handleDeleteFact = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/facts/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        setFacts(data.facts || []);
      }
    } catch (e) {
      console.warn('Failed to delete fact', e);
    }
  };

  const runTestResolution = () => {
    let lastEntity = 'Sam Altman';
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        const cleaned = messages[i].content.replace(/haqida gapir|kim u|nima bu|\?|!/gi, '').trim();
        if (cleaned.length > 2 && cleaned.length < 50) {
          lastEntity = cleaned;
          break;
        }
      }
    }

    const resolved = `${lastEntity} ${testQuery}`;
    setTestResult(`Natija: «${testQuery}» ➔ «${resolved}» (Asosiy subyekt: «${lastEntity}»)`);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-semibold mb-2">
            <HardDrive className="w-3.5 h-3.5" />
            <span>Backend Doimiy Xotira & Suhbat Tarixi</span>
          </div>
          <h2 className="text-2xl font-extrabold text-white">
            UZUNITED AI Xotira & Disk Persistence Tizimi
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Barcha suhbatlar tarixi va foydalanuvchi bilimlari backend serverda doimiy saqlanadi.
          </p>
        </div>

        <button
          onClick={onClearSession}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-xs sm:text-sm font-medium transition-all"
        >
          <Trash2 className="w-4 h-4" />
          <span>Faol suhbatni tozalash</span>
        </button>
      </div>

      {/* Backend Long-term Memory Facts Section */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BookmarkCheck className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-slate-200">
              AI Doimiy Xotirasi (Long-Term Facts)
            </h3>
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-bold border border-emerald-500/20">
              {facts.length} ta fakt
            </span>
          </div>
          <span className="text-xs text-slate-400">
            Fayl: <code className="text-emerald-400 font-mono">data/ai_memory.json</code>
          </span>
        </div>

        <p className="text-xs text-slate-400">
          Bu ma'lumotlarni AI doimo eslab yuradi va savol berganda (masalan, <em>«men haqimda nima bilasan?»</em>) kontekst sifatida ishlatadi.
        </p>

        {/* Add new fact manually */}
        <form onSubmit={handleAddFact} className="flex gap-2">
          <input
            type="text"
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            placeholder="Yangi fakt qo'shish (masalan: 'Foydalanuvchi Python va React dasturchisi')"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-sans text-slate-200 focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Fakt Qo'shish</span>
          </button>
        </form>

        {/* Facts List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
          {facts.length === 0 ? (
            <div className="col-span-full p-4 text-center rounded-xl bg-slate-950 border border-slate-800/80 text-xs text-slate-500">
              Hozircha xotirada hech qanday fakt saqlanmagan. Suhbatda <em>«Shuni eslab qol: ...»</em> deb yozing yoki yuqoridagi maydondan kiriting.
            </div>
          ) : (
            facts.map((f) => (
              <div 
                key={f.id}
                className="flex items-start justify-between gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800 hover:border-slate-700 text-xs transition-colors"
              >
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-slate-300 font-medium leading-relaxed">{f.fact}</span>
                </div>
                <button
                  onClick={() => handleDeleteFact(f.id)}
                  title="O'chirish"
                  className="text-slate-500 hover:text-red-400 p-1 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Coreference Resolution Live Simulator */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl">
        <h3 className="text-base font-bold text-slate-200 mb-2 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          «U», «Bu», «Birinchisi» (Coreference Resolver) Sinov Maydoni
        </h3>
        <p className="text-xs text-slate-400 mb-3">
          Foydalanuvchi qisqa so‘z yoki olmosh ishlatganda, tizim oldingi suhbat subyektini avtomatik ulaydi:
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => setTestQuery(e.target.value)}
            placeholder="Masalan: 'u qayerda yashaydi?' yoki 'narxi qancha?'"
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={runTestResolution}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5"
          >
            <span>Kontekstni Tekshirish</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {testResult && (
          <div className="mt-3 p-3 bg-slate-950 rounded-xl border border-blue-500/30 font-mono text-xs text-cyan-300">
            {testResult}
          </div>
        )}
      </div>

      {/* Tables & Active Session Messages */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Active Messages */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
              <Table className="w-4 h-4 text-emerald-400" />
              <span>Joriy Suhbatdagi Xabarlar ({messages.length} ta)</span>
            </h3>
            <span className="text-[11px] font-mono text-emerald-400">
              ID: {currentSessionId}
            </span>
          </div>

          <div className="space-y-3 max-h-[450px] overflow-y-auto pr-1 scrollbar-thin">
            {messages.map((m, idx) => (
              <div
                key={m.id || idx}
                className="p-3 bg-slate-950 rounded-xl border border-slate-800/90 text-xs space-y-1.5"
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className={`font-bold ${m.role === 'user' ? 'text-blue-400' : 'text-emerald-400'}`}>
                    role: {m.role}
                  </span>
                  <span className="text-slate-500">{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="text-slate-300 leading-relaxed line-clamp-3">
                  {m.content}
                </p>
                {m.resolvedQuery && (
                  <div className="text-[10px] text-cyan-400 font-mono">
                    ↳ resolved_query: "{m.resolvedQuery}"
                  </div>
                )}
                {m.sources && m.sources.length > 0 && (
                  <div className="text-[10px] text-amber-400 font-mono">
                    ↳ sources: {m.sources.length} ta manba saqlangan
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Right: Saved Sessions from Server Disk */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h3 className="font-bold text-slate-200 text-sm flex items-center gap-2">
            <Database className="w-4 h-4 text-blue-400" />
            <span>Saqlangan Suhbatlar Ro'yxati ({sessions.length} ta)</span>
          </h3>

          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`p-3 rounded-xl border transition-all text-xs ${
                  s.id === currentSessionId
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-200'
                    : 'bg-slate-950 border-slate-800/80 text-slate-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 truncate">{s.title}</span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {s.messageCount} xabar
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-1">
                  Yangilandi: {new Date(s.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-slate-400 space-y-2 leading-relaxed pt-2 border-t border-slate-800">
            <p>
              💾 <strong>Doimiy Disk Saqlash:</strong> Har bir suhbat <code className="text-emerald-400 font-mono">data/chat_sessions.json</code> faylida saqlanadi va server o‘chib yonganda ham yo‘qolmaydi.
            </p>
            <p>
              👤 <strong>Foydalanuvchi Profili:</strong> Ro'yxatdan o'tgan akkountlar va parollar <code className="text-emerald-400 font-mono">data/users_db.json</code> bazasida saqlanadi.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

