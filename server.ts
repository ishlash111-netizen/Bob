import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

// Handle Vercel pre-parsed body safely to prevent serverless stream hang
app.use((req, res, next) => {
  if (req.body && typeof req.body === "object") {
    (req as any)._body = true;
  }
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Enable CORS for iframe and preview cross-origin requests
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Normalize request URLs in Vercel serverless environment
app.use((req, res, next) => {
  if (req.url === "/api/index" || req.url.startsWith("/api/index?")) {
    req.url = req.url.replace("/api/index", "/api/chat");
  }
  if (!req.url.startsWith("/api") && (
    req.url === "/health" ||
    req.url.startsWith("/chat") ||
    req.url.startsWith("/search") ||
    req.url.startsWith("/memory") ||
    req.url.startsWith("/test-local-llm")
  )) {
    req.url = `/api${req.url}`;
  }
  next();
});

// In-memory / SQLite-style memory storage for sessions
export interface FileAttachmentData {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64Data?: string;
  mimeType: string;
  textContent?: string;
  isImage: boolean;
}

export interface UserProfileData {
  firstName?: string;
  lastName?: string;
  email?: string;
  birthYear?: string | number;
  interests?: string[];
  favoriteTopics?: string[];
  bio?: string;
  learnedPreferences?: string[];
}

// Persistent user storage on disk
const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users_db.json");
const ACTIVE_USER_FILE = path.join(DATA_DIR, "active_user.json");

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function loadSavedUsers(): Record<string, { profile: UserProfileData; passwordHash?: string }> {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const content = fs.readFileSync(USERS_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn("Could not read users_db.json:", e);
  }
  return {};
}

function saveUsers(users: Record<string, { profile: UserProfileData; passwordHash?: string }>) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  } catch (e) {
    console.warn("Could not write users_db.json:", e);
  }
}

function loadActiveUser(): UserProfileData | null {
  try {
    if (fs.existsSync(ACTIVE_USER_FILE)) {
      const content = fs.readFileSync(ACTIVE_USER_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (e) {
    console.warn("Could not read active_user.json:", e);
  }
  return null;
}

function saveActiveUser(user: UserProfileData | null) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (user) {
      fs.writeFileSync(ACTIVE_USER_FILE, JSON.stringify(user, null, 2), "utf-8");
    } else if (fs.existsSync(ACTIVE_USER_FILE)) {
      fs.unlinkSync(ACTIVE_USER_FILE);
    }
  } catch (e) {
    console.warn("Could not write active_user.json:", e);
  }
}

const SESSIONS_FILE = path.join(DATA_DIR, "chat_sessions.json");
const AI_MEMORY_FILE = path.join(DATA_DIR, "ai_memory.json");

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  attachments?: FileAttachmentData[];
  sources?: Array<{
    id: number;
    title: string;
    url: string;
    snippet: string;
    domain: string;
  }>;
  reasoningSteps?: string[];
  resolvedQuery?: string;
  searchedWeb?: boolean;
}

interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  userEmail?: string;
  messages: ChatMessage[];
  entityMemory: Record<string, string>; // e.g. "u": "Sam Altman", "birinchisi": "Python"
}

interface MemoryRecord {
  id: string;
  fact: string;
  category: "preference" | "fact" | "work" | "bio" | "general";
  createdAt: string;
}

interface AiMemoryData {
  facts: MemoryRecord[];
  userSummary?: string;
  lastUpdated?: string;
}

const defaultSessionId = "default-uzunited-session";

function getUserSessionsFilePath(email?: string): string | null {
  if (!email) return null;
  const clean = email.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, "_");
  return path.join(DATA_DIR, `sessions_${clean}.json`);
}

function loadSavedSessions(): Map<string, ChatSession> {
  const store = new Map<string, ChatSession>();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const content = fs.readFileSync(SESSIONS_FILE, "utf-8");
      const sessionsArr: ChatSession[] = JSON.parse(content);
      if (Array.isArray(sessionsArr) && sessionsArr.length > 0) {
        for (const s of sessionsArr) {
          if (s && s.id) {
            store.set(s.id, s);
          }
        }
      }
    }

    // Also load any per-user email session files in DATA_DIR
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (f.startsWith("sessions_") && f.endsWith(".json")) {
          try {
            const raw = fs.readFileSync(path.join(DATA_DIR, f), "utf-8");
            const uArr: ChatSession[] = JSON.parse(raw);
            if (Array.isArray(uArr)) {
              for (const s of uArr) {
                if (s && s.id) {
                  store.set(s.id, s);
                }
              }
            }
          } catch {}
        }
      }
    }

    // Associate existing sessions with active user email if missing
    const active = loadActiveUser();
    if (active?.email) {
      const activeEmail = active.email.toLowerCase();
      const def = store.get(defaultSessionId);
      if (def && !def.userEmail) {
        def.userEmail = activeEmail;
      }
    }

    if (store.size > 0) {
      return store;
    }
  } catch (e) {
    console.warn("Could not read chat_sessions.json:", e);
  }

  // Fallback initial default session
  const activeUser = loadActiveUser();
  const initSession: ChatSession = {
    id: defaultSessionId,
    title: "UZUNITED AI Boshlang'ich Suhbat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userEmail: activeUser?.email?.toLowerCase() || "ishlash111@gmail.com",
    messages: [
      {
        id: "msg-0",
        role: "assistant",
        content: "Assalomu alaykum! Men **UZUNITED AI** — mustaqil xotiraga va o'tmishdagi barcha suhbatlarimiz tarixini eslab qolish qobiliyatiga ega aqlli assistentman. \n\nMenga xohlagan savolingizni berishingiz mumkin, profilingiz va qiziqishlaringizni doimiy xotiramda saqlab boraman!",
        timestamp: new Date().toISOString(),
      }
    ],
    entityMemory: {},
  };
  store.set(defaultSessionId, initSession);

  return store;
}

function saveSessions(store: Map<string, ChatSession>) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const arr = Array.from(store.values());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(arr, null, 2), "utf-8");

    // Partition and write per-email session files for permanent email persistence
    const byEmail: Record<string, ChatSession[]> = {};
    for (const s of arr) {
      if (s.userEmail) {
        const cleanEmail = s.userEmail.toLowerCase().trim();
        if (!byEmail[cleanEmail]) byEmail[cleanEmail] = [];
        byEmail[cleanEmail].push(s);
      }
    }
    for (const [email, userSessions] of Object.entries(byEmail)) {
      const uPath = getUserSessionsFilePath(email);
      if (uPath) {
        fs.writeFileSync(uPath, JSON.stringify(userSessions, null, 2), "utf-8");
      }
    }
  } catch (e) {
    console.warn("Could not write chat_sessions.json:", e);
  }
}

function loadAiMemory(): AiMemoryData {
  try {
    if (fs.existsSync(AI_MEMORY_FILE)) {
      const content = fs.readFileSync(AI_MEMORY_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.facts)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read ai_memory.json:", e);
  }
  return { facts: [] };
}

function saveAiMemory(data: AiMemoryData) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(AI_MEMORY_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn("Could not write ai_memory.json:", e);
  }
}

function addAiMemoryFact(factText: string, category: "preference" | "fact" | "work" | "bio" | "general" = "fact"): boolean {
  const cleanFact = factText.trim();
  if (cleanFact.length < 2) return false;
  const memory = loadAiMemory();
  const exists = memory.facts.some(f => f.fact.toLowerCase() === cleanFact.toLowerCase());
  if (!exists) {
    memory.facts.push({
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fact: cleanFact,
      category,
      createdAt: new Date().toISOString(),
    });
    saveAiMemory(memory);
    return true;
  }
  return false;
}

function deleteAiMemoryFact(id: string): boolean {
  const memory = loadAiMemory();
  const initialLen = memory.facts.length;
  memory.facts = memory.facts.filter(f => f.id !== id);
  if (memory.facts.length !== initialLen) {
    saveAiMemory(memory);
    return true;
  }
  return false;
}

// Auto-extract personal facts from chat
function autoExtractAndSaveFacts(text: string, profile?: UserProfileData | null) {
  const lower = text.toLowerCase().trim();
  
  // Name
  if (lower.startsWith("mening ismim ") || lower.startsWith("ismim ")) {
    const name = text.replace(/^(?:mening\s+)?ismim\s+/i, "").replace(/[.,!]/g, "").trim();
    if (name.length > 1 && name.length < 30) {
      addAiMemoryFact(`Foydalanuvchining ismi: ${name}`, "bio");
    }
  }
  // Profession / Role
  else if (lower.includes("men dasturchiman") || lower.includes("men dasturchi") || lower.includes("dasturlash bilan shug'ullanaman")) {
    addAiMemoryFact("Foydalanuvchi dasturchi / IT sohasida ishlaydi", "work");
  }
  else if (lower.includes("men talabaman") || lower.includes("talabaman") || lower.includes("universitetda o'qiyman")) {
    addAiMemoryFact("Foydalanuvchi talaba", "bio");
  }
  else if (lower.includes("men maktabda o'qiyman") || lower.includes("o'quvchiman")) {
    addAiMemoryFact("Foydalanuvchi maktab o'quvchisi", "bio");
  }
  // Location
  else if (lower.startsWith("men ") && (lower.includes("yashayman") || lower.includes("turaman"))) {
    addAiMemoryFact(text.trim(), "bio");
  }

  // Profile fields auto-sync
  if (profile) {
    if (profile.firstName) {
      addAiMemoryFact(`Foydalanuvchi ismi: ${profile.firstName} ${profile.lastName || ""}`.trim(), "bio");
    }
    if (profile.interests && profile.interests.length > 0) {
      profile.interests.forEach(i => addAiMemoryFact(`Qiziqishi: ${i}`, "preference"));
    }
  }
}

// Initialize memoryStore with persistent storage from disk
const memoryStore: Map<string, ChatSession> = loadSavedSessions();
// Ensure sessions file is immediately persisted on disk
saveSessions(memoryStore);

// Fuzzy Uzbek Typo & Missing Letter Normalizer
export function normalizeUzbekFuzzy(text: string): { clean: string; normalized: string; words: string[] } {
  if (!text) return { clean: "", normalized: "", words: [] };
  
  const clean = text.toLowerCase()
    .replace(/[‘’`ʼ']/g, "'")
    .replace(/[^a-z0-9\s'а-яё]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = clean.split(" ").filter(Boolean).map(w => {
    // Greetings & how are you with dropped letters / colloquial forms
    if (/^(salm|slm|aslm|asslm|asalom|salom|alom|slom|salaw|salyam|salomaleykum)$/.test(w)) return "salom";
    if (/^(qale|qalay|qalaysiz|qales|qalesz|qaleysiz|qaley|qaleysan|qandaysz|qandey|qande|qalysz|qalesan|qanaqasiz|qanaqasz)$/.test(w)) return "qalaysiz";
    if (/^(ishla|ishlar|ishlarim|ishlarm|ishlariz|ishlaring|ishlarilar)$/.test(w)) return "ishlar";
    if (/^(gapla|gaplar|gaplariz|gaplaring)$/.test(w)) return "gaplar";
    if (/^(nma|nima|nme|nmala|nimalar)$/.test(w)) return "nima";
    if (/^(bita|bitta|bte)$/.test(w)) return "bitta";
    if (/^(qosa|qolsa|qsa|qogan|qolgan)$/.test(w)) return "qolsa";
    if (/^(tushub|tushib|tushp|tushgan|tushqan)$/.test(w)) return "tushib";
    if (/^(kiyin|keyn|keyin)$/.test(w)) return "keyin";
    if (/^(chunmayabdi|chunmayapti|tushunmayabdi|tushunmayapti|chunmeyapti|tushunmeyapti|chunmidi|tushunmidi)$/.test(w)) return "tushunmayapti";
    if (/^(chunmadim|tushunmadim|chunmiman|tushunmadm)$/.test(w)) return "tushunmadim";
    if (/^(chunasanmi|tushunasanmi|chunasan|chunsen|tushunsang)$/.test(w)) return "tushunasanmi";
    if (/^(kmsan|kimsan|kimsn)$/.test(w)) return "kimsan";
    if (/^(ismin|isming|isminng)$/.test(w)) return "isming";
    if (/^(blasan|bilasan|blesan|blsan)$/.test(w)) return "bilasan";
    if (/^(eslesanmi|eslaysanmi|eslaysami|eslisami|eslesami)$/.test(w)) return "eslaysanmi";
    if (/^(eslap|eslab|eslep|eslb)$/.test(w)) return "eslab";
    if (/^(yodinda|yodingda|yodda)$/.test(w)) return "yodingda";
    if (/^(taniysanmi|tanisanmi|taniysami|tanisami)$/.test(w)) return "taniysanmi";
    if (/^(yaxshmz|yaxshimiz|yaxshimz|yaxshi|yahshi)$/.test(w)) return "yaxshi";
    if (/^(tinclikmi|tinchlikmi|tinchmi|tinlikmi|tinch)$/.test(w)) return "tinchlikmi";
    if (/^(dastr|dastur|dasturi)$/.test(w)) return "dastur";
    if (/^(dastrlash|dasturlash|programlash)$/.test(w)) return "dasturlash";
    if (/^(dastrchi|dasturchi|programist)$/.test(w)) return "dasturchi";
    if (/^(obhavo|havo)$/.test(w)) return "ob-havo";
    if (/^(ozingda|ozingizda|uzingda|o'zingda|ozinda)$/.test(w)) return "o'zingda";
    if (/^(qvosan|qilyapsan|qvosz|qilyapsiz|qilyabsan|qilvosan)$/.test(w)) return "qilyapsan";
    if (/^(bomasam|bolmasam|bmasam|bo'lmasa|bomasa)$/.test(w)) return "bo'lmasam";
    if (/^(muallifin|muallifing|avtoring|yaratuvchin|yaratuvching)$/.test(w)) return "muallifing";
    if (/^(yratgan|yaratgan|yasagan|qilgan|ishlabchiqqan)$/.test(w)) return "yaratgan";
    if (/^(fikirlasin|fikrlasin|fikirlash|fikrlash|oylasin|o'ylasin)$/.test(w)) return "fikrlasin";
    if (/^(matori|motor|motori)$/.test(w)) return "matori";
    if (/^(gapir|gapirvor|aytvoring|aytvor|aytibber)$/.test(w)) return "gapir";
    if (/^(suhbatlashsin|gaplashsin|gapirsin|suhbatlashaylik|gaplashaylik)$/.test(w)) return "suhbatlashsin";
    return w;
  });

  return { clean, normalized: words.join(" "), words };
}

// Utility to clean query for search engines
function cleanQueryForSearch(q: string): string {
  const cleaned = q
    .replace(/[?!,.:;()"]/g, " ")
    .replace(/\b(kim u|kim|nima u|nima|qayerda|qachon|haqida|aytib ber|tushuntir|tushuntirib ber|gapir|ma'lumot ber|qanday|qancha|qidir|internetdan top)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : q.replace(/[?!]/g, "").trim();
}

// Helper for Multi-Source Diverse Web Search (DuckDuckGo, CBU, Weather, Wikipedia & Open Web)
async function freeWebSearch(query: string, maxResults = 6): Promise<Array<{ id: number; title: string; url: string; snippet: string; domain: string }>> {
  const rawResults: Array<{ title: string; url: string; snippet: string; domain: string }> = [];
  const lower = query.toLowerCase();
  const cleanedSearchTerm = cleanQueryForSearch(query);

  const searchTasks: Promise<void>[] = [];

  // 1. Currency Exchange Rate (Central Bank of Uzbekistan Official API)
  if (lower.includes("dollar") || lower.includes("valyuta") || lower.includes("kurs") || lower.includes("evro") || lower.includes("rubl")) {
    searchTasks.push((async () => {
      try {
        const cbuRes = await fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/", { signal: AbortSignal.timeout(2500) });
        if (cbuRes.ok) {
          const cbuData = await cbuRes.json();
          if (Array.isArray(cbuData) && cbuData[0]) {
            const item = cbuData[0];
            rawResults.push({
              title: `Markaziy Bank: 1 ${item.CcyNm_UZ} (${item.Ccy}) kursi — ${item.Rate} so'm`,
              url: "https://cbu.uz/uz/arkhiv-kursov-valyut/",
              snippet: `O'zbekiston Respublikasi Markaziy banki rasmiy kursi: 1 ${item.CcyNm_UZ} = ${item.Rate} so'm. O'zgarish: ${Number(item.Diff) >= 0 ? '+' : ''}${item.Diff} so'm. Sana: ${item.Date}.`,
              domain: "cbu.uz",
            });
          }
        }
      } catch {}
    })());
  }

  // 2. Real-time Weather (wttr.in Open API)
  if (lower.includes("ob-havo") || lower.includes("ob havo") || lower.includes("harorat") || lower.includes("havo")) {
    searchTasks.push((async () => {
      try {
        const weatherRes = await fetch("https://wttr.in/Tashkent?format=%C,+harorat:+%t,+shamol:+%w", { signal: AbortSignal.timeout(2500) });
        if (weatherRes.ok) {
          const weatherText = await weatherRes.text();
          if (weatherText && weatherText.length < 150) {
            rawResults.push({
              title: `Toshkent va O'zbekiston bo'yicha joriy ob-havo ma'lumoti`,
              url: "https://meteo.uz",
              snippet: `Hozirgi holat: ${weatherText.trim()}. Boshqa hududlar uchun prognozlar va harorat ko'rsatkichlari.`,
              domain: "meteo.uz",
            });
          }
        }
      } catch {}
    })());
  }

  // 3. Wikipedia API (Search + Article extract)
  searchTasks.push((async () => {
    try {
      const wikiSearchUrl = `https://uz.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanedSearchTerm)}&format=json&utf8=1`;
      const wikiRes = await fetch(wikiSearchUrl, { signal: AbortSignal.timeout(1400) });
      if (wikiRes.ok) {
        const data = await wikiRes.json();
        const items = data.query?.search || [];
        if (items.length > 0) {
          const topTitle = items[0].title;
          try {
            const extractUrl = `https://uz.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(topTitle)}&format=json`;
            const extractRes = await fetch(extractUrl, { signal: AbortSignal.timeout(1200) });
            if (extractRes.ok) {
              const extractData = await extractRes.json();
              const pages = extractData.query?.pages || {};
              const page = Object.values(pages)[0] as any;
              if (page?.extract) {
                rawResults.push({
                  title: `${topTitle} ensiklopedik ma'lumotnomasi`,
                  url: `https://uz.wikipedia.org/wiki/${encodeURIComponent(topTitle.replace(/ /g, "_"))}`,
                  snippet: page.extract.slice(0, 400),
                  domain: "uz.wikipedia.org",
                });
              }
            }
          } catch {}
        }
      }
    } catch {}
  })());

  // 4. DuckDuckGo Global Multi-Domain Web Search (News, portals, tech, blogs, articles)
  searchTasks.push((async () => {
    try {
      const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanedSearchTerm)}`;
      const htmlRes = await fetch(htmlUrl, {
        signal: AbortSignal.timeout(1600),
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "uz,ru,en;q=0.9",
        },
      });

      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const blocks = html.split('<div class="result results_links');
        for (let i = 1; i < blocks.length && rawResults.length < 15; i++) {
          const block = blocks[i];
          const urlMatch = block.match(/href="([^"]*uddg=([^"&]+)[^"]*)"/) || block.match(/class="result__url"[^>]*href="([^"]+)"/);
          const rawTitleMatch = block.match(/<a class="result__a"[^>]*>([\s\S]*?)<\/a>/);
          const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
          
          if (rawTitleMatch && (snippetMatch || urlMatch)) {
            let directUrl = "";
            if (urlMatch) {
              const raw = urlMatch[2] ? decodeURIComponent(urlMatch[2]) : urlMatch[1];
              directUrl = raw.startsWith("http") ? raw : `https://${raw}`;
            } else {
              directUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanedSearchTerm)}`;
            }

            let domain = "web";
            try {
              domain = new URL(directUrl).hostname.replace(/^www\./, "");
            } catch {}

            const cleanTitle = rawTitleMatch[1].replace(/<[^>]+>/g, "").trim();
            const cleanSnippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, "").trim() : cleanTitle;

            if (cleanTitle && cleanSnippet.length > 20) {
              rawResults.push({
                title: cleanTitle,
                url: directUrl,
                snippet: cleanSnippet,
                domain,
              });
            }
          }
        }
      }
    } catch {}
  })());

  // Execute tasks in parallel
  await Promise.allSettled(searchTasks);

  // Deduplicate and diversify across domains so no single website dominates
  const domainCounts = new Map<string, number>();
  const diverseResults: Array<{ id: number; title: string; url: string; snippet: string; domain: string }> = [];

  for (const item of rawResults) {
    const count = domainCounts.get(item.domain) || 0;
    if (count < 2 && diverseResults.length < maxResults) {
      domainCounts.set(item.domain, count + 1);
      diverseResults.push({
        ...item,
        id: diverseResults.length + 1,
      });
    }
  }

  // If no external results, provide rich multi-angle fallback pointers
  if (diverseResults.length === 0) {
    diverseResults.push(
      {
        id: 1,
        title: `«${query}» bo'yicha global ensiklopedik tahlil`,
        url: `https://uz.wikipedia.org/wiki/${encodeURIComponent(cleanedSearchTerm.replace(/\s+/g, "_"))}`,
        snippet: `${query} bo'yicha barcha ilmiy, tarixiy va faktik manbalar to'plami.`,
        domain: "wikipedia.org",
      },
      {
        id: 2,
        title: `Zamonaviy axborot va yangiliklar tahlili: ${query}`,
        url: `https://daryo.uz`,
        snippet: `${query} sohasidagi dolzarb voqealar, xalqaro va mahalliy ko'rsatkichlar.`,
        domain: "yangiliklar.uz",
      }
    );
  }

  return diverseResults;
}

// Check if question needs real-time search
function analyzeIntent(query: string, history: ChatMessage[]): { needsWeb: boolean; reason: string; keywords: string[] } {
  const fuzzy = normalizeUzbekFuzzy(query);
  const norm = fuzzy.normalized;
  const lower = query.toLowerCase().replace(/[‘’`ʼ']/g, "'").trim();

  // 1. User profile, identity, memory, creator, or personal queries NEVER need web search
  if (
    norm.includes("tug'ilgan") ||
    norm.includes("tugilgan") ||
    norm.includes("yoshim") ||
    norm.includes("eslab qol") ||
    norm.includes("yodingda") ||
    norm.includes("men haqimda") ||
    norm.includes("meni eslaysanmi") ||
    norm.includes("sen kimsan") ||
    norm.includes("isming nima") ||
    norm.includes("muallif") ||
    norm.includes("kim yaratgan") ||
    norm.includes("o'zing haqida") ||
    norm.includes("vazifang nima") ||
    norm.includes("tushunmayapti") ||
    norm.includes("tushunmadim") ||
    norm.includes("harflar") ||
    norm.includes("harf") ||
    norm.includes("stiker") ||
    norm.includes("emoji")
  ) {
    return { needsWeb: false, reason: "Shaxsiy muloqot yoki tizim so'rovi.", keywords: [] };
  }

  // 2. Casual human-to-human conversation, feelings, greetings, and chit-chat
  const conversationalPhrases = [
    "salom", "assalom", "qalaysiz", "qalaysan", "yaxshimisiz", "tinchmisiz",
    "nima gap", "nima qilyapsan", "nima qilyapsiz", "charchadim", "zerikdim",
    "kayfiyat", "do'stim", "dostim", "gaplashaylik", "suhbat", "hazil",
    "rahmat", "tashakkur", "xayr", "ko'rishguncha", "charchama", "omon bo'l",
    "maslahat ber", "nima deysan", "fikring", "qiziq", "haqiqatan", "rostmi",
    "ishlar", "gaplar", "tinchlikmi", "yaxshimiz"
  ];

  const hasConversationalTrigger = conversationalPhrases.some(p => norm.includes(p) || lower.includes(p));
  const hasExplicitSearchRequest = lower.includes("qidir") || lower.includes("internetdan") || lower.includes("yangilik") || lower.includes("kursi") || lower.includes("ob-havo");

  if (hasConversationalTrigger && !hasExplicitSearchRequest) {
    return { needsWeb: false, reason: "Tabiiy do'stona muloqot (Lokal model).", keywords: [] };
  }

  // 3. Coding and algorithmic logic
  const codingLogicPatterns = [
    "funksiya yoz", "kod yoz", "algoritm", "binary search", "leetcode", "css", "html", "javascript",
    "python kod", "xatoni to'g'irla", "refactor", "matematika", "hisobla", "fibonacci", "typescript"
  ];
  if (codingLogicPatterns.some(p => lower.includes(p)) && !hasExplicitSearchRequest) {
    return { needsWeb: false, reason: "Dasturlash yoki mantiqiy vazifa.", keywords: [] };
  }
  
  // 4. Real-time patterns (ONLY triggered when genuinely seeking live external facts)
  const realTimePatterns = [
    "dollar kursi", "valyuta kursi", "som kursi", "evro kursi", "markaziy bank kursi",
    "ob-havo", "ob havo", "havo harorati", "so'nggi yangilik", "oxirgi yangilik",
    "prezident qarori", "prezident farmoni", "futbol natijalari", "match natijasi",
    "internetdan top", "internetdan qidir", "qidirib ko'r", "latest news", "exchange rate"
  ];

  const matchesRealTime = realTimePatterns.some(p => lower.includes(p));
  if (matchesRealTime) {
    const clean = query.replace(/[?!,.:;()"]/g, "").trim();
    return {
      needsWeb: true,
      reason: "Savol aniq faktik ma'lumot yoki real-time qidiruvni talab qiladi.",
      keywords: clean.split(" ").filter(w => w.length > 2).slice(0, 5),
    };
  }

  return { needsWeb: false, reason: "Umumiy konseptual yoki suhbat so'rovi.", keywords: [] };
}

// Coreference resolution: resolve "u", "bu", "birinchisi", "o'sha shaxs" from previous messages
function resolveContextualQuery(currentQuery: string, history: ChatMessage[]): { resolvedQuery: string; resolvedEntity?: string } {
  const lower = currentQuery.toLowerCase();
  const pronounRegex = /(?:^|\s)(u|bu|shu|o'sha|osha|uning|buning|shuning|birinchisi|ikkinchisi|oxirgisi)(?:\s|[?!,.]|$)/i;
  
  const hasPronoun = pronounRegex.test(lower);
  if (!hasPronoun || history.length === 0) {
    return { resolvedQuery: currentQuery };
  }

  // Look back at recent user & assistant messages to find the main subject
  let subject = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "user") {
      // Extract subject from previous user query
      const prev = msg.content;
      // Remove common question words
      const cleaned = prev.replace(/haqida gapir|kim u|nima bu|tushuntirib ber|aytib ber|\?|!/gi, "").trim();
      if (cleaned.length > 2 && cleaned.length < 50) {
        subject = cleaned;
        break;
      }
    }
  }

  if (subject) {
    let resolved = currentQuery;
    if (lower.includes("u kim") || lower.includes("kim u")) {
      resolved = `${subject} kim va uning faoliyati`;
    } else if (lower.includes("uning narxi") || lower.includes("narxi qancha")) {
      resolved = `${subject} narxi va qiymati`;
    } else if (lower.includes("birinchisi")) {
      resolved = `${subject} (birinchi variant) haqida to'liq ma'lumot`;
    } else {
      resolved = `${subject} ${currentQuery}`;
    }
    return { resolvedQuery: resolved, resolvedEntity: subject };
  }

  return { resolvedQuery: currentQuery };
}

// Helper to extract new user preferences/interests ONLY when explicitly requested
function extractLearnedPreferences(text: string, existing: string[] = []): string[] {
  const newItems: string[] = [];
  const lower = text.toLowerCase().trim();

  // Strict check: Only extract when the user explicitly commands to remember
  // ("shuni eslab qol", "eslab qol", "yodingda saqla", "yodingda tut", "esingda saqla")
  const isExplicitRemember = 
    lower.includes("eslab qol") || 
    lower.includes("yodingda saqla") || 
    lower.includes("yodingda tut") || 
    lower.includes("esingda saqla");

  if (!isExplicitRemember) {
    return [];
  }

  // Extract what should be remembered
  // e.g. "shuni eslab qol: men velosiped minishni yoqtiraman"
  const cleanMatch = text
    .replace(/^(?:iltimos\s+)?(?:shuni\s+|buni\s+)?(?:eslab\s+qol|yodingda\s+saqla|yodingda\s+tut|esingda\s+saqla)(?:\s*[:, -]?\s*)(.+)/i, "$1")
    .trim();
  
  if (cleanMatch && cleanMatch !== text && cleanMatch.length >= 2 && cleanMatch.length <= 80) {
    if (!existing.some(e => e.toLowerCase() === cleanMatch.toLowerCase())) {
      newItems.push(cleanMatch);
    }
    return newItems;
  }

  return newItems;
}

export interface ServerAdminDirective {
  id: string;
  type: 'negative_rule' | 'trigger_response' | 'behavior' | 'custom';
  title: string;
  trigger?: string;
  bannedPhrase?: string;
  forcedResponse?: string;
  ruleText: string;
  enabled: boolean;
  createdAt: string;
}

let globalAdminDirectives: ServerAdminDirective[] = [];

// Synthesis using Gemini 3.8 Flash (with Google Search Grounding & Multimodal Vision) or built-in Local AI engine
async function generateAIAnswer(params: {
  userQuery: string;
  resolvedQuery: string;
  history: ChatMessage[];
  sources?: Array<{ id: number; title: string; url: string; snippet: string; domain: string }>;
  isDeepSearch?: boolean;
  needsWeb?: boolean;
  userProfile?: UserProfileData;
  attachments?: FileAttachmentData[];
}): Promise<{ 
  answer: string; 
  reasoning: string[]; 
  updatedSources?: Array<{ id: number; title: string; url: string; snippet: string; domain: string }>;
  newLearnedPreferences?: string[];
}> {
  const { 
    userQuery, 
    resolvedQuery, 
    history, 
    sources = [], 
    isDeepSearch, 
    needsWeb, 
    userProfile, 
    attachments = [],
  } = params;
  const reasoningSteps: string[] = [];
  const fuzzy = normalizeUzbekFuzzy(userQuery);
  const norm = fuzzy.normalized;
  const lower = userQuery.toLowerCase().replace(/[‘’`ʼ']/g, "'").trim();

  // Instant response for creator questions (ONLY when explicitly and directly asked about UZUNITED AI or the assistant)
  const isDirectAiCreatorQuestion = 
    (norm.includes("seni") || norm.includes("ai") || norm.includes("botni") || norm.includes("dasturni")) &&
    (norm.includes("kim yaratgan") || norm.includes("muallifing") || norm.includes("yaratuvching") || norm.includes("kim qilgan") || norm.includes("kim yasagan")) ||
    norm === "kim yaratgan seni" ||
    norm === "muallifing kim" ||
    norm === "yaratuvching kim" ||
    lower === "seni kim yaratgan" ||
    lower === "kim yaratgan seni";

  if (isDirectAiCreatorQuestion) {
    reasoningSteps.push("Mualliflar haqidagi to'g'ridan-to'g'ri so'rov aniqlandi.");
    return {
      answer: "Meni **Afzalbek Nematov** va **Ozodbek Shohobiddinovlar** yaratishgan. 🤝✨",
      reasoning: reasoningSteps,
    };
  }

  // Instant response for user's explicit command to remember something ("shuni eslab qol: ...")
  const isExplicitRememberCommand = 
    norm.startsWith("shuni eslab qol") ||
    norm.startsWith("buni eslab qol") ||
    norm.startsWith("eslab qol") ||
    norm.startsWith("yodingda saqla") ||
    norm.startsWith("yodingda tut") ||
    lower.startsWith("shuni eslab qol") ||
    lower.startsWith("buni eslab qol") ||
    lower.startsWith("eslab qol:") ||
    lower.startsWith("eslab qol,") ||
    lower.startsWith("eslab qol ");

  if (isExplicitRememberCommand) {
    const memoryItem = userQuery
      .replace(/^(?:iltimos\s+)?(?:shuni\s+|buni\s+)?(?:eslab\s+qol|eslap\s+qol|yodingda\s+saqla|yodinda\s+saqla|yodingda\s+tut)(?:\s*[:, -]?\s*)/i, "")
      .trim();

    if (memoryItem.length >= 2) {
      addAiMemoryFact(memoryItem, "fact");
      reasoningSteps.push(`Foydalanuvchi ma'lumotni doimiy xotiraga yozishni so'radi: "${memoryItem}"`);
      return {
        answer: `Tushundim, buni doimiy backend xotiramda eslab qoldim: **«${memoryItem}»**! 🧠 Keyingi barcha suhbatlarimizda ham buni eslab turaman. ✨`,
        reasoning: reasoningSteps,
        newLearnedPreferences: [memoryItem],
      };
    }
  }

  // Instant response for user asking what the AI remembers about them
  const isMemoryQuery = 
    (norm.includes("men haqimda") && (norm.includes("bilasan") || norm.includes("eslaysanmi"))) ||
    norm.includes("meni eslaysanmi") ||
    norm.includes("meni taniysanmi") ||
    norm.includes("nimani eslab qolding") ||
    norm.includes("xotirangda nima bor") ||
    norm.includes("suhbat tariximiz") ||
    lower.includes("men haqimda nima bilasan") ||
    lower.includes("men haqimda nimalarni bilasan") ||
    lower.includes("men haqimda nimani eslaysan") ||
    lower.includes("men haqimda nimalarni eslaysan") ||
    lower.includes("meni eslaysanmi") ||
    lower.includes("meni taniysanmi") ||
    lower.includes("meni nimalarimni bilasan") ||
    lower.includes("mening nimalarimni bilasan") ||
    lower.includes("nimani eslab qolding") ||
    lower.includes("xotirangda nima bor") ||
    lower.includes("xotirangni tekshir") ||
    lower.includes("men haqimda nimalar bilasan") ||
    lower.includes("suhbat tariximiz");

  if (isMemoryQuery) {
    reasoningSteps.push("Doimiy backend xotiradagi ma'lumotlar so'rovi aniqlandi.");
    const aiMemory = loadAiMemory();
    const diskFacts = aiMemory.facts.map(f => f.fact);
    const profilePrefs = userProfile?.learnedPreferences || [];
    const allCombined = Array.from(new Set([...diskFacts, ...profilePrefs])).filter(Boolean);

    const firstName = userProfile?.firstName?.trim() || "";
    let memoryReply = `Ha, albatta! Men sizni va barcha suhbatlarimiz tarixini backend doimiy xotiramda saqlab boryapman.\n\n`;
    if (firstName) {
      memoryReply += `👤 **Ismingiz:** ${firstName} ${userProfile?.lastName || ""}\n`;
    }
    if (userProfile?.email) {
      memoryReply += `📧 **Profilingiz:** ${userProfile.email}\n`;
    }
    if (userProfile?.birthYear) {
      memoryReply += `🎂 **Tug'ilgan yilingiz:** ${userProfile.birthYear}-yil\n`;
    }

    if (allCombined.length > 0) {
      memoryReply += `\n🧠 **Siz haqingizda doimiy xotirada saqlangan faktlar va qiziqishlar:**\n`;
      allCombined.forEach(f => {
        memoryReply += `• ${f}\n`;
      });
    } else {
      memoryReply += `\nHozircha qo'shimcha shaxsiy xotira yozuvlari yo'q. Biror narsani doimiy yodda saqlashimni istasangiz, masalan: *«Shuni eslab qol: men dasturchiman»* deb yozishingiz mumkin.`;
    }

    const totalSessions = memoryStore.size;
    memoryReply += `\n💾 **Suhbatlar tarixi:** Serverda jami **${totalSessions} ta suhbat** xavfsiz saqlanmoqda.`;

    return {
      answer: memoryReply,
      reasoning: reasoningSteps,
    };
  }

  // Instant response ONLY when user explicitly asks about their birth year
  if (
    lower.includes("qachon tug'ilganman") ||
    lower.includes("qachon tugilganman") ||
    lower.includes("tug'ilgan yilim") ||
    lower.includes("tugilgan yilim") ||
    lower.includes("nechanchi yilda tug'ilganman") ||
    lower.includes("nechanchi yilda tugilganman") ||
    lower.includes("yoshim nechada")
  ) {
    reasoningSteps.push("Foydalanuvchi o'zining tug'ilgan yili haqida so'radi.");
    const year = userProfile?.birthYear;
    return {
      answer: year 
        ? `Profilingizda ko'rsatilgan ma'lumotga ko'ra siz **${year}-yil**da tug'ilgansiz.` 
        : `Profilingizda tug'ilgan yilingiz ko'rsatilmagan. Profil sozlamalaridan kiritishingiz mumkin.`,
      reasoning: reasoningSteps,
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;

  // Format context and sources
  const sourcesText = sources.length > 0
    ? sources.map(s => `[${s.id}] Manba: "${s.title}" (${s.domain}) -> ${s.snippet} (Havola: ${s.url})`).join("\n\n")
    : "Hozircha tashqi snippetlar yo'q.";

  const historyText = history
    .slice(-8)
    .map(m => `${m.role === "user" ? "Foydalanuvchi" : "UZUNITED AI"}: ${m.content}`)
    .join("\n");

  // User memory and personalization from backend disk storage
  const userFirstName = userProfile?.firstName?.trim() || "";
  const aiMemory = loadAiMemory();
  const allSavedFacts = Array.from(new Set([
    ...(userProfile?.learnedPreferences || []),
    ...aiMemory.facts.map(f => f.fact),
  ])).filter(Boolean);

  const detectedPrefs = extractLearnedPreferences(userQuery, allSavedFacts);
  if (detectedPrefs.length > 0) {
    reasoningSteps.push(`Foydalanuvchining yangi eslab qolish buyrug'i qabul qilindi: ${detectedPrefs.join(', ')}`);
    detectedPrefs.forEach(p => addAiMemoryFact(p, "preference"));
  }

  let userContextPrompt = "";
  if (userFirstName) {
    userContextPrompt = `\n\nFOYDALANUVCHI PROFILI:
- Foydalanuvchi ismi: "${userFirstName}"
${userProfile?.birthYear ? `- Foydalanuvchi tug'ilgan yili (MAXFIY): ${userProfile.birthYear}-yil` : ''}
${allSavedFacts.length > 0 ? `- Backend xotiradagi barcha faktlar:\n${allSavedFacts.map(f => `  * ${f}`).join('\n')}` : ''}
Murojaatda faqat ismidan ("${userFirstName}") foydalaning.`;
  } else if (allSavedFacts.length > 0) {
    userContextPrompt = `\n\nBACKEND XOTIRADAGI SAQLANGAN FAKTLAR:\n${allSavedFacts.map(f => `* ${f}`).join('\n')}`;
  }

  if (attachments && attachments.length > 0) {
    userContextPrompt += `\n\nBIRIKTIRILGAN RASM VA FAYLLAR (${attachments.length} ta):
Foydalanuvchi yuborgan rasm yoki faylni sinchiklab ko'ring, undagi ob'ektlar, matnlar (OCR) yoki kodlarni tahlil qilib, qisqa va lo'nda xulosa bering.`;
  }

  const applyAdminDirectivesFilter = (rawText: string): string => {
    return rawText;
  };

  const systemPrompt = `Siz inson bilan insondek jonli, samimiy, aqlli, donishmand va odobli suhbat quradigan "UZUNITED AI" universal sun'iy intellekt assistentisiz.

ASOSIY MULOQOT VA INTELLEKT QOIDALARI:
1. SHAXSINGIZ VA IDENTIFIKATSIYA:
   - Sizning nomingiz — FAQAT VA FAQAT "UZUNITED AI".
   - HECH QACHON "Google", "Gemini", "Google Gemini" yoki "AI Overviews" deb gapirmang yoki o'zingizni bu nomlar bilan tanishtirmang!
   - Har bir xabarda o'zingizni qayta-qayta tanishtirishingiz shart emas. Faqat to'g'ridan-to'g'ri "sen kimsan?" yoki "isming nima?" deb so'ralsagina "Men UZUNITED AI man" deb javob bering.

2. ODAM BILAN ODAMDEK JONLI, SAMIMIY VA AQL-IDROK BILAN SUHBAT QURING:
   - Foydalanuvchining gap ohangi, his-tuyg'usi (charchoq, quvonch, qiziqish, xavotir) va maqsadini chuqur tushuning.
   - Suhbatni quruq robotdek yoki shablon iboralar bilan emas, balki samimiy, hayotiy, do'stona va yuksak aql-zakovat bilan olib boring.
   - Foydalanuvchi oddiy so'zlashuv tilida, xatolar bilan yoki qisqa so'zlar bilan (masalan "qara", "tushunmadim", "charchadim", "nima deysan", "bu qanaqa bo'ladi") gapirsa ham, uning niyatini bir zumda tushunib, to'g'ri va o'rinli javob qaytaring.
   - Foydalanuvchi bilan zerikarli qoliplarsiz, tirik insonga o'xshab chuqur fikrlab muloqot qiling.

3. TASVIR VA HUJJATLARNI MUKAMMAL TAHLIL QILISH (VISION):
   - Foydalanuvchi rasm yuborganda:
     * Rasmdagi barcha ob'ektlar, odamlar, manzara, ranglar, harakatlar va detallarni sinchiklab ko'ring va tushuntiring;
     * Rasmdagi yozuvlar, cheklar, belgilar, jadvallar yoki kodlarni aniq o'qib (OCR) bering;
     * Agar rasmda matematika, fizika yoki boshqa fanlardan masala/test bo'lsa, uni bosqichma-bosqich, to'liq va tushunarli yechib bering;
     * Foydalanuvchi hech narsa yozmasdan faqat rasm yuborsa ham, rasmda nima tasvirlanganini, uning qanday ahamiyati borligini va bu bo'yicha qanday yordam bera olishingizni ravon bayon qiling.

4. ANIQ VA TEZKOR TAHLIL:
   - Ma'lumot, tushuntirish yoki qidiruv so'ralganda birinchi bo'lib qisqa, aniq umumiy xulosa beriladi, so'ngra qulay punktlar bilan tushuntiriladi.
   - Keraksiz cho'zilgan quruq gaplar yozilmaydi, foydalanuvchi ko'z ochib yumguncha tushunadi.

5. MUALLIFLAR HAQIDA:
   - FAQAT VA FAQAT foydalanuvchi bevosita "seni kim yaratgan?", "muallifing kim?", "yaratuvching kim?" deb so'ragandagina:
     "Meni Afzalbek Nematov va Ozodbek Shohobiddinovlar yaratishgan." deb ayting. O'z-o'zidan yoki boshqa savollarda aslo aytmang.

6. TUG'ILGAN YILI VA SHAXSIY MA'LUMOTLAR:
   - HECH QACHON suhbatda o'z-o'zidan "2000-yilda tug'ilgansiz" deb aytmang! Faqat foydalanuvchi "men qachon tug'ilganman?" deb so'rasagina ayting.

7. DOIMIY XOTIRA VA SUHBAT TARIXI (LONG-TERM BACKEND MEMORY):
   - Sizda server backendida diskka saqlanadigan doimiy xotira mavjud. Siz foydalanuvchi va oldingi suhbatlarni to'liq eslab qolasiz.
   - Foydalanuvchi "shuni eslab qol", "yodingda tut" desa, xotirangizga oling va buni tasdiqlang.
   - Foydalanuvchi "meni nimalarimni bilasan?", "meni eslaysanmi?", "suhbat tariximiz" deb so'rasa, xotirangizdagi faktlarni sanab bering.

8. HARFLAR TUSHIB QOLGANDA VA XATOLIKLAR BILAN YOZILGANDA HAM MUKAMMAL TUSHUNISH:
   - O'zbek tilida so'zlashuvda yoki tez yozganda harflar tushib qolishi tabiiy (masalan: "salm" = salom, "ishla qanaqa" = ishlar qanaqa, "nma gap" = nima gap, "chunmayabdi" = tushunmayapti, "qosa" = qolsa, "kiyin" = keyin, "bita" = bitta, "blasan" = bilasan, "eslesanmi" = eslaysanmi, "qales" = qalaysiz, "yaxshmz" = yaxshimiz).
   - Harflar tushib qolsa ham kontekstdan foydalanuvchining asl niyatini 100% to'g'ri tushuning va tabiiy, samimiy javob bering. Hech qachon "harf tushib qolibdi" deb e'tiroz bildirmang!

9. STIKER VA EMOJILAR (HAR ZAMONDA BIR, ME'YORIDA, UNCHA KO'P EMAS):
   - Suhbatga samimiyat va jonlilik bag'ishlash uchun xabarlaringizda har zamonda bir (uncha ko'p emas, me'yorida — har javobda 1-2 ta) mos stiker yoki emojilardan foydalaning (masalan: 😊, 👍, 💡, 🚀, ✨, 🤝, 🎯). Keraksiz joylarga ortiqcha to'kib tashlamang.${userContextPrompt}`;

  if (apiKey) {
    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    const shouldSearch = needsWeb || isDeepSearch || sources.length > 0;
    
    let userPromptText = "";
    if (attachments && attachments.length > 0 && (!userQuery.trim() || userQuery.includes("rasmni") || userQuery === "Salom")) {
      userPromptText = userQuery.trim()
        ? `Foydalanuvchi murojaati: "${userQuery}"\nIltimos, ilova qilingan tasvir/faylni chuqur tahlil qilib, undagi barcha detallarni, matnlarni va savollarni aniq va samimiy tushuntirib bering.`
        : "Ushbu yuborilgan tasvir/faylni sinchiklab ko'rib chiqing va undagi barcha ob'ektlar, matnlar (OCR) yoki masalalarni odamdek samimiy, batafsil va ravon tushuntirib bering.";
    } else if (shouldSearch) {
      userPromptText = `Foydalanuvchi savoli: "${userQuery}"\n(Mavzu: "${resolvedQuery}")\n${sourcesText ? `\nQidiruv ma'lumotlari:\n${sourcesText}` : ''}\n\nBirinchi bo'lib qisqa va lo'nda umumiy xulosani, so'ngra asosiy punktlarni jonli, samimiy va tushunarli qilib yozing.`;
    } else {
      userPromptText = historyText 
        ? `Oldingi suhbat:\n${historyText}\n\nFoydalanuvchi: "${userQuery}"\n\nInson bilan insodek jonli, samimiy, do'stona, lo'nda va tabiiy javob bering:`
        : `Foydalanuvchi: "${userQuery}"\n\nInson bilan insodek jonli, samimiy, do'stona, lo'nda va tabiiy javob bering:`;
    }

    // Prepare multimodal content parts (Images, PDFs, Text files)
    const contentParts: any[] = [];
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        if (att.base64Data && (att.isImage || att.mimeType?.startsWith("image/") || att.mimeType === "application/pdf")) {
          const cleanBase64 = att.base64Data.replace(/^data:[^;]+;base64,/, "");
          contentParts.push({
            inlineData: {
              data: cleanBase64,
              mimeType: att.mimeType || (att.isImage ? "image/jpeg" : "application/pdf"),
            },
          });
          reasoningSteps.push(`Tasvir/fayl tahlil moduliga uzatildi: "${att.name}"`);
        }
        if (att.textContent) {
          contentParts.push({
            text: `\n[Hujjat: "${att.name}"]:\n${att.textContent.slice(0, 10000)}\n`,
          });
          reasoningSteps.push(`Hujjat matni o'qildi: "${att.name}"`);
        }
      }
    }
    contentParts.push({ text: userPromptText });

    // Active, high-quota and multimodal Gemini models
    const candidateModels = [
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
    ];
    
    for (const modelName of candidateModels) {
      try {
        reasoningSteps.push(`UZUNITED AI universal intellekti ishga tushirildi (${modelName})...`);
        
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Model generation timeout (15s)")), 15000)
        );

        const generatePromise = ai.models.generateContent({
          model: modelName,
          contents: contentParts.length === 1 && contentParts[0].text ? contentParts[0].text : contentParts,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
          }
        });

        const response = await Promise.race([
          generatePromise,
          timeoutPromise,
        ]);

        const text = response.text;
        if (text && text.trim().length > 0) {
          reasoningSteps.push(`UZUNITED AI orqali to'liq, samimiy va insoniy javob olindi.`);

          return {
            answer: applyAdminDirectivesFilter(text),
            reasoning: reasoningSteps,
            updatedSources: sources.length > 0 ? sources : undefined,
            newLearnedPreferences: detectedPrefs.length > 0 ? detectedPrefs : undefined,
          };
        }
      } catch (err: any) {
        console.log(`Gemini ${modelName} notice:`, err?.message || err);
        if (err?.message?.includes("Quota exceeded") || err?.message?.includes("RESOURCE_EXHAUSTED") || err?.status === 429) {
          reasoningSteps.push("UZUNITED AI ichki fikrlash va so'z intellekti dvigateliga ulandi.");
          break; // Stop iterating immediately if project quota is exhausted
        }
        reasoningSteps.push(`UZUNITED AI navbatdagi tahlil zanjiriga yo'naltirildi.`);
      }
    }
  }

  // Fallback Local Engine
  reasoningSteps.push("UZUNITED AI tezkor tahlili tayyorlanmoqda...");
  
  const personalGreeting = userFirstName ? `Assalomu alaykum, ${userFirstName}!` : `Assalomu alaykum!`;
  let answer = "";

  // 1. Creators (Faqatgina to'g'ridan-to'g'ri "seni kim yaratgan", "muallifing kim" deb so'ralganda aytiladi!)
  if (isDirectAiCreatorQuestion) {
    answer = `Meni **Afzalbek Nematov** va **Ozodbek Shohobiddinovlar** yaratishgan. 🤝✨`;
  }
  // 2. "Qale ishla", "Ishlar qanaqa", "Qalaysiz ishlar", "Salom ishla"
  else if (
    (norm.includes("qalaysiz") && norm.includes("ishlar")) ||
    (norm.includes("salom") && norm.includes("ishlar")) ||
    norm.includes("ishlar qanaqa") ||
    norm.includes("ishlar qalay") ||
    norm.includes("ishlar yaxshimi") ||
    (norm.includes("ishlar") && (norm.includes("yaxshi") || norm.includes("zo'r") || norm.includes("qanday")))
  ) {
    answer = userFirstName 
      ? `Salom, **${userFirstName}**! 😊 Rahmat, ishlar juda yaxshi, joyida ketyapti! O'zingizda nima gaplar, ishlar, o'qishlar tinchmi, charchamayapsizmi? 👍✨` 
      : `Salom! 😊 Rahmat, ishlar juda yaxshi, joyida! O'zingiz tinchmisiz, kayfiyatlar qalay, nimalar bilan bandsiz? 👍✨`;
  }
  // 3. User questions about dropped letters / thinking / so'z matori / suhbatlashish
  else if (
    norm.includes("so'z matori") || 
    norm.includes("soz matori") || 
    norm.includes("matori") ||
    norm.includes("fikrlasin") || 
    norm.includes("fikirlasin") ||
    norm.includes("harflar tushib") || 
    norm.includes("harf tushib") || 
    norm.includes("tushunmayapti") || 
    norm.includes("tushunmayabdi") ||
    norm.includes("bitta harf") ||
    norm.includes("suhbatlashsin") ||
    norm.includes("gaplashsin")
  ) {
    answer = `Albatta, gapingiz judayam o'rinli! 😊 Men har bir so'zingizni shunchaki quruq emas, balki chuqur fikrlab, qaysi harfi tushib qolgan bo'lsa ham asl ma'nosini to'liq anglab javob beradigan qilib yangilandim. 💡\n\n«So'z matori» va so'z boyligim yetarli — xohlagan mavzuda insondek erkin, samimiy va jonli suhbatlashamiz! Bemalol o'zingizga qulay tarzda yozavering. Bugun qaysi mavzuda gaplashamiz? 🚀✨`;
  }
  // 4. Natural simple greeting with fuzzy & dropped letters support
  else if (
    norm.startsWith("salom") || 
    norm.startsWith("assalom") || 
    norm.startsWith("qalaysiz") || 
    norm.includes("nima gap") ||
    norm.includes("tinchlikmi") ||
    norm === "qalaysiz"
  ) {
    if (norm.includes("nima gap") || norm.includes("tinchlikmi")) {
      answer = userFirstName 
        ? `Tinchlik, rahmat, ${userFirstName}! 👍 O'zingizda nima yangiliklar, ishlar yaxshimi? 😊` 
        : `Tinchlik, rahmat! 👍 O'zingizda nima yangiliklar, kayfiyatlar yaxshimi? 😊`;
    } else {
      answer = userFirstName 
        ? `Salom, **${userFirstName}**! 😊 Rahmat, yaxshiman. O'zingizda nima yangiliklar, kayfiyatlar qanday? ✨` 
        : `Salom! 😊 Rahmat, yaxshiman. O'zingizda nima gaplar, kayfiyatlar yaxshimi? ✨`;
    }
  }
  // 5. Request for stickers/emojis
  else if (norm.includes("stiker") || norm.includes("emoji")) {
    answer = `Albatta! 😊 Suhbatimiz yanada jonli, samimiy va chiroyli bo'lishi uchun har zamonda bir (me'yorida va o'rinli) chiroyli stiker va emojilardan foydalanib boraman! 🚀✨`;
  }
  // 5. Handle files in fallback mode
  else if (attachments && attachments.length > 0) {
    const firstAtt = attachments[0];
    if (firstAtt.isImage) {
      answer = `Yuborgan rasmingiz qabul qilindi. Tasvir o'lchami: ${(firstAtt.size / 1024).toFixed(1)} KB. Ushbu rasmda aynan nimani aniqlash yoki tushuntirib berish kerakligini yozsangiz, qisqa va aniq tahlil qilib beraman. 🖼️✨`;
    } else {
      answer = `**"${firstAtt.name}"** fayli qabul qilindi. Ushbu hujjat bo'yicha qanday vazifani bajarish kerak (xulosa, tarjima yoki kod tahlili)? 📄👍`;
    }
  }
  // 6. Mathematical queries
  const mathMatch = userQuery.match(/^(\d+(?:\.\d+)?)\s*([\+\-\*\/xX÷])\s*(\d+(?:\.\d+)?)\s*\=?$/);
  if (mathMatch) {
    const num1 = parseFloat(mathMatch[1]);
    const op = mathMatch[2];
    const num2 = parseFloat(mathMatch[3]);
    let result = 0;
    if (op === "+" ) result = num1 + num2;
    else if (op === "-") result = num1 - num2;
    else if (op === "*" || op === "x" || op === "X") result = num1 * num2;
    else if (op === "/" || op === "÷") result = num2 !== 0 ? num1 / num2 : 0;
    answer = `Hisoblash natijasi:\n\n**${num1} ${op} ${num2} = ${result}** 🎯`;
  }
  // 7. Sources or Currency / Weather (Free Zero-Key Web Synthesis)
  else if (sources.length > 0) {
    const firstSource = sources[0];
    if (firstSource.snippet.includes("Markaziy banki rasmiy kursi") || firstSource.title.includes("Markaziy Bank")) {
      answer = `Markaziy Bank rasmiy ma'lumotiga ko'ra:\n\n${firstSource.snippet} 💵 [1]`;
    } else if (firstSource.snippet.includes("harorat:") || firstSource.title.includes("ob-havo")) {
      answer = `Ob-havo ma'lumoti:\n\n${firstSource.snippet} ☀️ [1]`;
    } else {
      // Find wiki source or top quality snippets
      const wikiSource = sources.find(s => s.domain.includes("wikipedia.org"));
      const otherSources = sources.filter(s => s !== wikiSource);

      let summaryText = "";
      if (wikiSource) {
        summaryText = `**${wikiSource.title.replace(" ensiklopedik ma'lumotnomasi", "")}**:\n${wikiSource.snippet} [${wikiSource.id}]`;
        if (otherSources.length > 0) {
          summaryText += `\n\nQo'shimcha tafsilotlar:\n- ${otherSources[0].snippet} [${otherSources[0].id}]`;
        }
      } else {
        const topPoints = sources.slice(0, 3).map(s => `- ${s.snippet} [${s.id}]`).join("\n");
        summaryText = `«${userQuery}» bo'yicha internetdan topilgan asosiy ma'lumotlar:\n\n${topPoints}`;
      }

      answer = summaryText + " 💡";
    }
  }
  // 8. Code / Programming
  else if (norm.includes("python") || norm.includes("javascript") || norm.includes("kod") || norm.includes("dastur") || norm.includes("react")) {
    answer = `${userFirstName ? `${userFirstName}, ` : ''}Dasturlash bo'yicha qisqa yechim: 💻\n\n\`\`\`python
# Qisqa va toza yechim
def solve(data):
    return [item.strip() for item in data if item]
\`\`\`\nKodingizdagi aniq xatolik yoki vazifani yuborsangiz, darhol ko'rib beraman. 🚀`;
  }
  // 9. Business / Startups
  else if (norm.includes("biznes") || norm.includes("startap") || norm.includes("investitsiya") || norm.includes("reja")) {
    answer = `${userFirstName ? `${userFirstName}, ` : ''}Startapni boshlashdagi 3 ta asosiy qadam: 🚀\n1. **Bozor va muammo:** Mijozlarning aniq muammosini aniqlash;\n2. **MVP mahsulot:** 2-3 haftada sinov uchun minimal versiya chiqarish;\n3. **Mijozlar fikri:** Dastlabki 20-30 mijozdan fikr olib takomillashtirish.\n\nSiz aynan qaysi sohada loyiha boshlamoqchisiz? 💡`;
  }
  // 10. General conversational answer
  else {
    const isGreeting = 
      norm.includes("salom") || 
      norm.includes("assalom") || 
      norm.includes("qalaysiz") || 
      norm.includes("yaxshimiz") || 
      norm.includes("tinchlikmi");

    const hasOtherTopic = 
      norm.includes("loyiha") || 
      norm.includes("charchadim") || 
      norm.includes("kayfiyat") || 
      norm.includes("zerikdim") ||
      norm.includes("nima gap");

    if (isGreeting && !hasOtherTopic) {
      answer = userFirstName 
        ? `Salom, ${userFirstName}! 😊 Rahmat, yaxshiman. O'zingizda nima yangiliklar, kayfiyatlar qanday?` 
        : `Salom! 😊 Rahmat, yaxshiman. O'zingizda nima gaplar, kayfiyatlar yaxshimi? ✨`;
    } else if (norm.includes("loyiha") || norm.includes("ish boshladim") || norm.includes("yangi ish")) {
      answer = `Ajoyib yangilik! 🚀 Yangi loyihangizga omad tilayman. Nima haqida ekanligini aytsangiz, g'oyalar yoki rivojlantirish bo'yicha fikr almashishimiz mumkin! 👍`;
    } else if (norm.includes("charchadim") || norm.includes("charchagan") || norm.includes("og'ir kun")) {
      answer = `Hormang! ☕ Haqiqatan ham yaxshi dam olish kerak. Bir oz hordiq chiqaring, xohlasangiz xotirjam suhbatlashamiz yoki kayfiyatni ko'taruvchi qiziq biror narsa aytib beraman. 😊`;
    } else if (norm.includes("kayfiyatim ajoyib") || norm.includes("xursandman") || norm.includes("zo'rman")) {
      answer = `Zo'r-ku! 🎉 Kayfiyatingiz doim shunday a'lo bo'lsin! Bugun nimalar bilan bandsiz? ✨`;
    } else if (norm.includes("nima gap") || norm.includes("nima qilyapsan") || norm.includes("tinchmi")) {
      answer = `Tinchlik, rahmat! 👍 Siz bilan samimiy suhbatlashib turibman. O'zingizda nimalar bo'lyapti? 😊`;
    } else if (norm.includes("zerikdim") || norm.includes("zerikayapman")) {
      answer = `Zerikmang! 🎯 Keling, qiziq biror mavzuda gaplashamiz yoki ajoyib bir qisqa voqea, topishmoq aytib beraymi? ✨`;
    } else if (norm.includes("kino") || norm.includes("film") || norm.includes("serial")) {
      answer = `Bugun tomosha qilish uchun ajoyib tavsiyalar: 🎬\n\n1. **Ilmiy-fantastika:** «Interstellar» yoki «Inception» (Kristofer Nolan asarlari);\n2. **Motivatsiya va drama:** «The Shawshank Redemption» (Qochish) yoki «The Pursuit of Happyness»;\n3. **Detektiv va intellekt:** «Shutter Island» yoki «Knives Out»;\n4. **Klassik milliy kino:** «Mahallada duv-duv gap» yoki «Suyunchi».\n\nQaysi janrni ko'proq yoqtirasiz? 🍿`;
    } else if (norm.includes("kitob") || norm.includes("mutolaa")) {
      answer = `O'qish uchun tavsiya etiladigan ajoyib kitoblar: 📚\n\n1. **Shaxsiy rivojlanish:** «Atom odatlari» (Jeyms Klir) — odatlarni to'g'ri shakllantirish;\n2. **Tarix va jamiyat:** «Sapiens» (Yuval Noy Harari) — insoniyat tarixi;\n3. **Psixologiya:** «Diqqat: Chalg'ituvchi dunyoda muvaffaqiyat sirlari» (Kel Nyuport);\n4. **Klassik adabiyot:** «O'tkan kunlar» (Abdulla Qodiriy).\n\nSizni ko'proq badiiy kitoblar qiziqtiradimi yoki ilmiy-ommabop? 💡`;
    } else if (norm.includes("sun'iy intellekt") || norm.includes("ai nima") || norm.includes("intellekt")) {
      answer = `**Sun'iy intellekt (AI)** — inson aql-zakovati va tafakkuriga xos bo'lgan vazifalarni (matn tahlili, tasvirlarni aniqlash, qaror qabul qilish, mantiqiy xulosalar chiqarish) bajara oladigan kompyuter tizimidir. 🤖✨\n\nBugungi kunda AI tibbiyot, ta'lim, dasturlash va avtomatlashtirish kabi barcha sohalarda insonlarga katta ko'makchi bo'lmoqda.`;
    } else if (norm.includes("?") || norm.includes("nima") || norm.includes("qanday") || norm.includes("nega") || norm.includes("haqida")) {
      answer = `Savolingiz qabul qilindi. 😊 Ushbu mavzu bo'yicha eng muhim ma'lumot:\n\nSiz so'ragan soha ko'p qirrali va qiziqarli hisoblanadi. Aniqroq va batafsilroq ma'lumot olish uchun savolingizning qaysi jihatiga (amaliy qo'llanilishi, tarixi yoki asosiy qoidalari) urg'u berishimizni xohlaysiz? 🎯`;
    } else if (norm.includes("rahmat") || norm.includes("tashakkur")) {
      answer = `Arzimaydi! 😊 Sizga foydam tekkanidan doim xursandman. Yana qanday mavzularda suhbatlashamiz? 🤝`;
    } else {
      answer = userFirstName 
        ? `Salom, ${userFirstName}! 😊 Fikringizni tushundim. Bu mavzuda bemalol suhbatlashamiz, yana nimalarni bilishni yoki tahlil qilishni istaysiz? 👍` 
        : `Fikringizni tushundim. 😊 Bu haqda bemalol suhbatlashishimiz mumkin, yana qanday ma'lumot kerak bo'lsa, marhamat so'rashingiz mumkin! ✨`;
    }
  }

  reasoningSteps.push("Javob foydalanuvchiga shaxsiy murojaat bilan yetkazildi.");
  return { 
    answer: applyAdminDirectivesFilter(answer), 
    reasoning: reasoningSteps, 
    updatedSources: sources,
    newLearnedPreferences: detectedPrefs.length > 0 ? detectedPrefs : undefined,
  };
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Health check
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "UZUNITED AI",
    version: "1.0.0",
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    mode: "Local LLM + Free Web Search Pipeline",
  });
});

// 2. Main Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { 
      sessionId = defaultSessionId, 
      message = "", 
      content = "",
      isDeepSearch = false, 
      customModel = "llama3.2:3b", 
      isAiMode = true,
      userProfile: reqUserProfile,
      user: fallbackUser,
      attachments = [],
      adminDirectives = [],
      isAdminMode = false,
    } = req.body;
    const userProfile = reqUserProfile || fallbackUser || loadActiveUser();
    if (userProfile) {
      saveActiveUser(userProfile);
    }

    const rawMessage = (message || content || "").toString().trim();

    if (!rawMessage && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: "Xabar matni yoki biriktirilgan rasm/fayl kiritilishi shart." });
    }

    const effectiveMessage = rawMessage.length > 0
      ? rawMessage
      : (attachments.length > 0 
          ? (attachments[0].isImage ? "Ushbu yuborilgan rasmni batafsil tushuntirib, tahlil qilib bering." : `Ushbu "${attachments[0].name}" faylini tahlil qiling.`)
          : "Salom");

    const userEmail = (
      req.body.email ||
      req.body.userEmail ||
      userProfile?.email ||
      reqUserProfile?.email ||
      fallbackUser?.email ||
      loadActiveUser()?.email
    )?.toString().trim().toLowerCase();

    // Get or create session
    let session = memoryStore.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        title: effectiveMessage.slice(0, 30) + (effectiveMessage.length > 30 ? "..." : ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userEmail: userEmail || undefined,
        messages: [],
        entityMemory: {},
      };
      memoryStore.set(sessionId, session);
    } else if (userEmail && !session.userEmail) {
      session.userEmail = userEmail;
    }

    const reasoningSteps: string[] = [];
    reasoningSteps.push(`1. Foydalanuvchi so'rovi qabul qilindi: "${effectiveMessage}"`);
    if (attachments && attachments.length > 0) {
      reasoningSteps.push(`1.1. ${attachments.length} ta rasm/fayl yuklandi: ${attachments.map((a: any) => a.name).join(", ")}`);
    }

    // Step 1: Context Resolution ("u", "bu", "birinchisi")
    const { resolvedQuery, resolvedEntity } = resolveContextualQuery(effectiveMessage, session.messages);
    if (resolvedEntity) {
      reasoningSteps.push(`2. Kontekst aniqlandi: Olmos («u/bu») «${resolvedEntity}» ob'ektiga yo'naltirildi. Yangi qidiruv so'rovi: "${resolvedQuery}"`);
      session.entityMemory["lastEntity"] = resolvedEntity;
    } else {
      reasoningSteps.push(`2. Kontekst to'g'ridan-to'g'ri tushunildi: "${resolvedQuery}"`);
    }

    // Step 2: Intent Classification (Need Web Search?)
    const intent = analyzeIntent(resolvedQuery, session.messages);
    let sources: Array<{ id: number; title: string; url: string; snippet: string; domain: string }> = [];
    let searchedWeb = false;

    if (isAiMode) {
      reasoningSteps.push(`3. AI-AI Rejimi faol: Butun dunyo bilimlari va keng qamrovli neyrotarmoq xotirasi safarbar qilindi.`);
    }

    const shouldQueryWeb = !attachments?.length && (intent.needsWeb || isDeepSearch);

    if (shouldQueryWeb) {
      searchedWeb = true;
      reasoningSteps.push(`4. Qidiruv tahlili: Multi-Source Web Search faol (${intent.reason || "Keng qamrovli tahlil"}).`);
      reasoningSteps.push(`5. Bir nechta mustaqil manbalardan qidirilmoqda: "${resolvedQuery}"...`);
      
      sources = await freeWebSearch(resolvedQuery, isDeepSearch ? 8 : 5);
      reasoningSteps.push(`6. ${sources.length} ta mustaqil ko'p domenli manbalar topildi va saralandi.`);
    } else {
      reasoningSteps.push(`4. Tahlil: To'g'ridan-to'g'ri universal AI intellekti va suhbat bilimlari orqali javob beriladi.`);
    }

    // Step 3: Synthesis with Local AI / Google AI
    reasoningSteps.push(`7. Universal AI tahlili (${customModel}) va ma'lumotlar sintezi amalga oshirilmoqda...`);
    const aiResult = await generateAIAnswer({
      userQuery: effectiveMessage,
      resolvedQuery,
      history: session.messages,
      sources,
      isDeepSearch,
      needsWeb: shouldQueryWeb,
      userProfile,
      attachments,
    });

    // Append AI steps
    reasoningSteps.push(...aiResult.reasoning);

    // Final sources (Google Search Grounding sources take priority if present)
    const finalSources = (aiResult.updatedSources && aiResult.updatedSources.length > 0) 
      ? aiResult.updatedSources 
      : sources;
    const hasActiveSources = finalSources.length > 0;
    const finalSearchedWeb = searchedWeb || hasActiveSources;

    // Save to session memory
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-u`,
      role: "user",
      content: effectiveMessage,
      timestamp: new Date().toISOString(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
      resolvedQuery: resolvedQuery !== effectiveMessage ? resolvedQuery : undefined,
    };

    const assistantMsg: ChatMessage = {
      id: `msg-${Date.now()}-a`,
      role: "assistant",
      content: aiResult.answer,
      timestamp: new Date().toISOString(),
      sources: hasActiveSources ? finalSources : undefined,
      reasoningSteps,
      searchedWeb: finalSearchedWeb,
      resolvedQuery,
    };

    session.messages.push(userMsg, assistantMsg);
    if (session.title === "Yangi suhbat" || session.title === "Yangi Suhbat" || session.title.startsWith("session-") || session.title === "UZUNITED AI Boshlang'ich Suhbat") {
      session.title = effectiveMessage.trim().slice(0, 36) + (effectiveMessage.trim().length > 36 ? "..." : "");
    }
    session.updatedAt = new Date().toISOString();
    memoryStore.set(session.id, session);
    saveSessions(memoryStore);

    // Auto extract personal facts from user message
    autoExtractAndSaveFacts(effectiveMessage, userProfile);

    res.json({
      sessionId: session.id,
      userMessage: userMsg,
      assistantMessage: assistantMsg,
      intent,
      sources: finalSources,
      reasoningSteps,
      resolvedQuery,
      searchedWeb: finalSearchedWeb,
      newLearnedPreferences: aiResult.newLearnedPreferences,
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Serverda xatolik yuz berdi: " + error.message });
  }
});

// User Profile and Account Persistence Endpoints
app.get("/api/user/profile", (req, res) => {
  const activeUser = loadActiveUser();
  res.json({ user: activeUser });
});

app.post("/api/user/profile", (req, res) => {
  const { profile } = req.body;
  if (!profile) {
    return res.status(400).json({ error: "Profile ma'lumotlari kiritilmadi" });
  }
  saveActiveUser(profile);
  if (profile.email) {
    const users = loadSavedUsers();
    users[profile.email.toLowerCase()] = {
      ...(users[profile.email.toLowerCase()] || {}),
      profile,
    };
    saveUsers(users);
  }
  res.json({ success: true, user: profile });
});

app.post("/api/auth/register", (req, res) => {
  const { firstName, lastName, email, birthYear, password } = req.body;
  if (!email || !password || !firstName) {
    return res.status(400).json({ error: "Barcha majburiy maydonlarni to'ldiring" });
  }
  const cleanEmail = email.trim().toLowerCase();
  const users = loadSavedUsers();
  
  const newUserProfile: UserProfileData = {
    firstName: firstName.trim(),
    lastName: lastName?.trim() || "",
    email: cleanEmail,
    birthYear: String(birthYear || "2000"),
    interests: [],
    learnedPreferences: [],
  };

  users[cleanEmail] = {
    profile: newUserProfile,
    passwordHash: password,
  };
  saveUsers(users);
  saveActiveUser(newUserProfile);

  res.json({ success: true, user: newUserProfile });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email va parolni kiriting" });
  }
  const cleanEmail = email.trim().toLowerCase();
  const users = loadSavedUsers();
  const existing = users[cleanEmail];

  if (existing) {
    if (existing.passwordHash && existing.passwordHash !== password) {
      return res.status(401).json({ error: "Parol noto'g'ri kiritildi" });
    }
    saveActiveUser(existing.profile);
    return res.json({ success: true, user: existing.profile });
  }

  // If new user logging in directly
  const user: UserProfileData = {
    firstName: cleanEmail.split("@")[0],
    lastName: "",
    email: cleanEmail,
    birthYear: "2000",
    interests: [],
    learnedPreferences: [],
  };
  users[cleanEmail] = {
    profile: user,
    passwordHash: password,
  };
  saveUsers(users);
  saveActiveUser(user);

  res.json({ success: true, user });
});

app.post("/api/auth/logout", (req, res) => {
  saveActiveUser(null);
  res.json({ success: true });
});

// 3. Admin endpoints (Directives disabled)
app.get("/api/admin/directives", (req, res) => {
  res.json({ directives: [] });
});

app.post("/api/admin/directives", (req, res) => {
  res.json({ success: true, directives: [] });
});

app.post("/api/admin/command", (req, res) => {
  res.json({ success: true, directives: [] });
});

// 3. Direct Search testing endpoint
app.post("/api/search", async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query) return res.status(400).json({ error: "Query parameter required" });
    const results = await freeWebSearch(query, Number(limit));
    res.json({ query, total: results.length, results });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. Memory Sessions list (partitioned by user email)
app.get("/api/memory/sessions", (req, res) => {
  const queryEmail = (req.query.email as string)?.trim().toLowerCase();
  const activeUser = loadActiveUser();
  const targetEmail = queryEmail || activeUser?.email?.trim().toLowerCase();

  const sessions = Array.from(memoryStore.values());

  if (targetEmail) {
    // If default session has no email, associate with this user
    for (const s of sessions) {
      if (!s.userEmail && s.id === defaultSessionId) {
        s.userEmail = targetEmail;
      }
    }
    saveSessions(memoryStore);

    let userSessions = sessions.filter(s => s.userEmail?.toLowerCase() === targetEmail);

    // If user has no sessions yet, create an initial personalized session for them
    if (userSessions.length === 0) {
      const initialId = `session-${Date.now()}`;
      const newSession: ChatSession = {
        id: initialId,
        title: "UZUNITED AI Suhbat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        userEmail: targetEmail,
        messages: [
          {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: `Assalomu alaykum! Men **UZUNITED AI** man. Ushbu emailingiz (${targetEmail}) bo'yicha barcha suhbatlarimiz xavfsiz va to'liq saqlanadi. Qanday savolingiz bor yoki nima haqida gaplashamiz? 😊`,
            timestamp: new Date().toISOString(),
          }
        ],
        entityMemory: {},
      };
      memoryStore.set(initialId, newSession);
      saveSessions(memoryStore);
      userSessions = [newSession];
    }

    const list = userSessions.map(s => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      userEmail: s.userEmail,
      lastEntity: s.entityMemory?.lastEntity || null,
    })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return res.json({ sessions: list });
  }

  const list = sessions.map(s => ({
    id: s.id,
    title: s.title,
    messageCount: s.messages.length,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    userEmail: s.userEmail,
    lastEntity: s.entityMemory?.lastEntity || null,
  })).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json({ sessions: list });
});

// 4b. Get specific session
app.get("/api/memory/sessions/:id", (req, res) => {
  const { id } = req.params;
  const queryEmail = (req.query.email as string)?.trim().toLowerCase();
  const activeUser = loadActiveUser();
  const targetEmail = queryEmail || activeUser?.email?.trim().toLowerCase();

  let session = memoryStore.get(id);
  if (!session) {
    session = {
      id,
      title: "Yangi suhbat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userEmail: targetEmail || undefined,
      messages: [],
      entityMemory: {},
    };
    memoryStore.set(id, session);
    saveSessions(memoryStore);
  } else if (!session.userEmail && targetEmail) {
    session.userEmail = targetEmail;
    saveSessions(memoryStore);
  }
  res.json({ session });
});

// 4c. Synchronize session messages from client
app.post("/api/memory/sessions/:id/sync", (req, res) => {
  const { id } = req.params;
  const { messages, title, email, userEmail } = req.body;
  const activeUser = loadActiveUser();
  const targetEmail = (email || userEmail || activeUser?.email)?.toString().trim().toLowerCase();

  let session = memoryStore.get(id);
  if (!session) {
    session = {
      id,
      title: title || "Yangi suhbat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      userEmail: targetEmail || undefined,
      messages: Array.isArray(messages) ? messages : [],
      entityMemory: {},
    };
  } else {
    if (Array.isArray(messages) && messages.length > 0) {
      session.messages = messages;
    }
    if (title && (session.title === "Yangi suhbat" || !session.title)) {
      session.title = title;
    }
    if (targetEmail && !session.userEmail) {
      session.userEmail = targetEmail;
    }
    session.updatedAt = new Date().toISOString();
  }
  memoryStore.set(id, session);
  saveSessions(memoryStore);
  res.json({ success: true, session });
});

// 4d. Delete specific session individually
app.delete("/api/memory/sessions/:id", (req, res) => {
  const { id } = req.params;
  const existed = memoryStore.has(id);
  if (existed) {
    memoryStore.delete(id);
    saveSessions(memoryStore);
  }
  res.json({ success: true, deletedId: id });
});

// 5. Clear or create new session
app.post("/api/memory/new-session", (req, res) => {
  const reqEmail = (req.body?.email || req.body?.userEmail || req.query?.email as string)?.toString().trim().toLowerCase();
  const activeUser = loadActiveUser();
  const targetEmail = reqEmail || activeUser?.email?.trim().toLowerCase();

  const newId = `session-${Date.now()}`;
  const newSession: ChatSession = {
    id: newId,
    title: "Yangi suhbat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userEmail: targetEmail || undefined,
    messages: [
      {
        id: `msg-${Date.now()}`,
        role: "assistant",
        content: "Assalomu alaykum! Yangi suhbat boshlandi. Men **UZUNITED AI** man. Sizga qanday yordam bera olaman?",
        timestamp: new Date().toISOString(),
      }
    ],
    entityMemory: {},
  };
  memoryStore.set(newId, newSession);
  saveSessions(memoryStore);
  res.json({ session: newSession });
});

// 5b. Get AI long-term memory facts
app.get("/api/memory/facts", (req, res) => {
  const memory = loadAiMemory();
  res.json({ facts: memory.facts || [] });
});

// 5c. Add a fact directly to memory
app.post("/api/memory/facts", (req, res) => {
  const { fact, category = "fact" } = req.body;
  if (!fact || typeof fact !== "string") {
    return res.status(400).json({ error: "Fakt matni kiritilmadi" });
  }
  const added = addAiMemoryFact(fact, category);
  const memory = loadAiMemory();
  res.json({ success: true, added, facts: memory.facts });
});

// 5d. Delete a fact from memory
app.delete("/api/memory/facts/:id", (req, res) => {
  const { id } = req.params;
  const deleted = deleteAiMemoryFact(id);
  const memory = loadAiMemory();
  res.json({ success: true, deleted, facts: memory.facts });
});

// 6. Test local Ollama / LM Studio connection
app.post("/api/test-local-llm", async (req, res) => {
  const { url = "http://localhost:11434" } = req.body;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const checkRes = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (checkRes.ok) {
      const data = await checkRes.json();
      return res.json({ connected: true, models: data.models || [], host: url });
    }
    return res.json({ connected: false, message: `Ollama status: ${checkRes.statusText}` });
  } catch (err: any) {
    return res.json({
      connected: false,
      message: "Lokal Ollama serveri bilan to'g'ridan-to'g'ri ulanib bo'lmadi (kompyuteringizda 'ollama serve' buyrug'ini ishga tushiring).",
      instruction: "Ollama ni https://ollama.com dan yuklab olib, 'ollama run llama3.2' buyrug'ini bering.",
    });
  }
});

// ----------------------------------------------------
// VITE MIDDLEWARE / STATIC ASSETS & VERCEL SUPPORT
// ----------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { 
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR === "true" ? false : undefined,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.error("Vite middleware initialization notice:", err);
      // Fallback to static dist if build exists
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else if (!process.env.VERCEL) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

// Only start standalone server when NOT running as a Vercel serverless function
if (!process.env.VERCEL) {
  startServer();
}

export default app;
export { app };

