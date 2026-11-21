import React, { useState } from 'react';
import { 
  FileCode, 
  Copy, 
  Check, 
  Download, 
  Layers, 
  Terminal, 
  Cpu, 
  Globe, 
  Database,
  ExternalLink,
  Code
} from 'lucide-react';
import { PythonFileItem } from '../types';

const PYTHON_CODEBASE_FILES: PythonFileItem[] = [
  {
    filename: 'main.py',
    path: 'backend/main.py',
    category: 'Backend',
    description: 'FastAPI asosiy serveri, REST API endpointlar va CORS sozlamalari.',
    content: `from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import UzbekAIAgent

app = FastAPI(title="UZUNITED AI Backend", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = UzbekAIAgent()

class ChatRequest(BaseModel):
    session_id: str
    message: str
    use_web_search: bool = False

@app.get("/api/health")
def health_check():
    return {"status": "ok", "engine": "FastAPI + Ollama"}

@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    try:
        result = await agent.run(
            session_id=req.session_id,
            query=req.message,
            search_web=req.use_web_search,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
`,
  },
  {
    filename: 'agent.py',
    path: 'backend/agent.py',
    category: 'Agent Core',
    description: 'Muloqot kontekstini boshqaruvchi va Ollama modeliga murojaat qiluvchi yadro.',
    content: `import httpx
from database import load_history, save_message
from web_search import search_duckduckgo

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL_NAME = "qwen2.5:7b"

class UzbekAIAgent:
    SYSTEM_PROMPT = (
        "Siz UZUNITED AI — o'zbek tilidagi aqlli, aniq va do'stona yordamchisiz. "
        "Javoblarni tushunarli, mantiqiy va foydali tarzda bering."
    )

    async def run(self, session_id: str, query: str, search_web: bool = False):
        history = load_history(session_id)
        sources = []

        context_note = ""
        if search_web:
            sources = await search_duckduckgo(query)
            if sources:
                context_note = "\\n\\nInternet manbalari:\\n" + "\\n".join(
                    f"- {s['title']}: {s['snippet']} ({s['url']})" for s in sources
                )

        messages = [{"role": "system", "content": self.SYSTEM_PROMPT}]
        messages.extend(history[-10:])
        messages.append({"role": "user", "content": query + context_note})

        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                OLLAMA_URL,
                json={"model": MODEL_NAME, "messages": messages, "stream": False},
            )
            resp.raise_for_status()
            answer = resp.json()["message"]["content"]

        save_message(session_id, "user", query)
        save_message(session_id, "assistant", answer)
        return {"answer": answer, "sources": sources}
`,
  },
  {
    filename: 'web_search.py',
    path: 'backend/web_search.py',
    category: 'Web Search',
    description: 'DuckDuckGo orqali tezkor va bepul real-vaqt veb-qidiruv moduli.',
    content: `from duckduckgo_search import DDGS

async def search_duckduckgo(query: str, max_results: int = 4):
    results = []
    with DDGS() as ddgs:
        for idx, item in enumerate(ddgs.text(query, max_results=max_results), start=1):
            results.append({
                "id": idx,
                "title": item.get("title", ""),
                "url": item.get("href", ""),
                "snippet": item.get("body", ""),
            })
    return results
`,
  },
  {
    filename: 'database.py',
    path: 'backend/database.py',
    category: 'Database',
    description: 'SQLite yordamida foydalanuvchi suhbatlari va uzoq muddatli xotirani saqlash.',
    content: `import sqlite3
from pathlib import Path

DB_PATH = Path("uzunited_memory.db")

def init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

def save_message(session_id: str, role: str, content: str):
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            (session_id, role, content),
        )

def load_history(session_id: str):
    init_db()
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    return [{"role": r, "content": c} for r, c in rows]
`,
  },
  {
    filename: 'requirements.txt',
    path: 'backend/requirements.txt',
    category: 'Config',
    description: 'Python muhiti uchun kerakli kutubxonalar ro‘yxati.',
    content: `fastapi==0.115.0
uvicorn[standard]==0.30.6
httpx==0.27.2
pydantic==2.9.2
duckduckgo-search==6.2.13
`,
  },
  {
    filename: 'docker-compose.yml',
    path: 'docker-compose.yml',
    category: 'Config',
    description: 'Backend va lokal Ollama xizmatini Docker orqali birga ishga tushirish.',
    content: `services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama

  api:
    build: ./backend
    ports:
      - "8000:8000"
    depends_on:
      - ollama

volumes:
  ollama_data:
`,
  },
];

export const CodebaseExplorer: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<PythonFileItem>(PYTHON_CODEBASE_FILES[0]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getCategoryBadge = (cat: string) => {
    switch (cat) {
      case 'Backend': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'Agent Core': return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'Web Search': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'Database': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'Frontend': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-semibold mb-2">
            <Code className="w-3.5 h-3.5" />
            <span>To‘liq Python + FastAPI MVP Loyihasi</span>
          </div>
          <h2 className="text-2xl font-extrabold text-white">
            UZUNITED AI — Ishchi Kodlar To‘plami
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Har bir modul 100% mustaqil, toza va o‘zbek tilidagi izohlarga ega. Hech qanday tashqi pullik API talab qilmaydi.
          </p>
        </div>

        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs sm:text-sm shadow-md transition-all self-start md:self-auto"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
          <span>{copied ? 'Nusxalandi!' : `Nusxa olish (${selectedFile.filename})`}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Files List */}
        <div className="lg:col-span-4 space-y-2">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
            Loyiha Fayllari ({PYTHON_CODEBASE_FILES.length})
          </div>

          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-1 scrollbar-thin">
            {PYTHON_CODEBASE_FILES.map((file) => {
              const isSelected = selectedFile.path === file.path;
              return (
                <button
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left p-3 rounded-xl border transition-all flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-slate-900 border-blue-500/50 shadow-md shadow-blue-500/5'
                      : 'bg-slate-950/60 hover:bg-slate-900/60 border-slate-800/80 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 font-mono text-xs font-bold text-white">
                      <FileCode className={`w-4 h-4 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
                      <span>{file.filename}</span>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${getCategoryBadge(file.category)}`}>
                      {file.category}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-1">
                    {file.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Code Viewer */}
        <div className="lg:col-span-8 flex flex-col bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {/* File Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950/90 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 font-mono text-sm font-bold text-slate-200">
                <span className="text-blue-400">📄</span>
                <span>{selectedFile.path}</span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedFile.description}
              </p>
            </div>

            <button
              onClick={handleCopy}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Kodni nusxalash"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          {/* Code content */}
          <div className="p-4 bg-slate-950 overflow-x-auto max-h-[600px] font-mono text-xs text-slate-200 leading-relaxed scrollbar-thin">
            <pre>
              <code>{selectedFile.content}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
