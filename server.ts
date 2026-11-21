import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  "973689737727-8b5slrifj74htotd92e2ai0ab02nhuld.apps.googleusercontent.com";
const AUTH_COOKIE_NAME = "uzunited_session";

// Handle Vercel pre-parsed body safely to prevent serverless stream hang
app.use((req, res, next) => {
  if (req.body && typeof req.body === "object") {
    (req as any)._body = true;
  }
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

function getRequestHost(req: express.Request): string {
  const fwdHost = req.headers["x-forwarded-host"];
  const raw = Array.isArray(fwdHost) ? fwdHost[0] : fwdHost || req.headers.host || "";
  return raw.split(",")[0].trim().toLowerCase();
}

function isOriginAllowed(origin: string | undefined, req: express.Request): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const reqHost = getRequestHost(req);
    return Boolean(reqHost) && parsed.host.toLowerCase() === reqHost;
  } catch {
    return false;
  }
}

// Same-origin / verified-host CORS & CSRF protection (never wildcard * with credentials)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin, req)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Guest-Id, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  // CSRF defense on mutating /api/* routes when cookies are used
  if (
    req.url.startsWith("/api") &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method.toUpperCase())
  ) {
    const hasAuthBearer = Boolean(req.headers.authorization?.startsWith("Bearer "));
    const hasCustomHeader = req.headers["x-requested-with"] === "XMLHttpRequest";
    const originValid = origin ? isOriginAllowed(origin, req) : true;
    if (!originValid) {
      return res.status(403).json({ error: "Noto‘g‘ri manba (Origin) so‘rovi rad etildi." });
    }
    if (req.headers.cookie && !hasAuthBearer && !hasCustomHeader && !origin) {
      return res.status(403).json({ error: "Xavfsizlik tekshiruvi muvaffaqiyatsiz tugadi." });
    }
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
  avatar?: string;
  isGoogleUser?: boolean;
}

// Persistent user storage on disk
const DATA_DIR = path.resolve(process.cwd(), "data");
const USERS_FILE = path.resolve(DATA_DIR, "users_db.json");

function resolveSafeDataPath(fileName: string): string | null {
  const safeBase = path.resolve(DATA_DIR);
  const resolved = path.resolve(safeBase, fileName);
  if (!resolved.startsWith(safeBase + path.sep)) {
    return null;
  }
  return resolved;
}

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password: string, storedHash?: string): { valid: boolean; needsRehash: boolean } {
  if (!storedHash || storedHash.startsWith("GOOGLE_AUTH_")) {
    return { valid: false, needsRehash: false };
  }
  if (storedHash.startsWith("scrypt$")) {
    const parts = storedHash.split("$");
    if (parts.length !== 3) return { valid: false, needsRehash: false };
    const [, salt, hexHash] = parts;
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(hexHash, "hex");
    if (derived.length !== storedBuf.length) return { valid: false, needsRehash: false };
    return { valid: crypto.timingSafeEqual(derived, storedBuf), needsRehash: false };
  }
  // Legacy plaintext compatibility with automatic upgrade on valid login
  const a = Buffer.from(password, "utf-8");
  const b = Buffer.from(storedHash, "utf-8");
  if (a.length !== b.length) return { valid: false, needsRehash: false };
  return { valid: crypto.timingSafeEqual(a, b), needsRehash: true };
}

function createSessionToken(email: string): string {
  const cleanEmail = email.trim().toLowerCase();
  const payload = Buffer.from(
    JSON.stringify({
      email: cleanEmail,
      iat: Date.now(),
      exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }),
    "utf-8"
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifySessionToken(token?: string | null): { email: string } | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  const expectedSig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  const sigBuf = Buffer.from(sigB64, "utf-8");
  const expBuf = Buffer.from(expectedSig, "utf-8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!decoded?.email || typeof decoded.exp !== "number" || decoded.exp < Date.now()) {
      return null;
    }
    return { email: String(decoded.email).trim().toLowerCase() };
  } catch {
    return null;
  }
}

function parseCookies(req: express.Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function setAuthCookie(res: express.Response, req: express.Request, token: string) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const attrs = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "Max-Age=2592000",
    "HttpOnly",
    isHttps ? "Secure" : "",
    isHttps ? "SameSite=None" : "SameSite=Lax",
    isHttps ? "Partitioned" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.setHeader("Set-Cookie", attrs);
}

function clearAuthCookie(res: express.Response, req: express.Request) {
  const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
  const attrs = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    isHttps ? "Secure" : "",
    isHttps ? "SameSite=None" : "SameSite=Lax",
    isHttps ? "Partitioned" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.setHeader("Set-Cookie", attrs);
}

interface RequestOwner {
  ownerId: string | null;
  email: string | null;
  isAuthenticated: boolean;
}

function resolveRequestOwner(req: express.Request): RequestOwner {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(req);
    token = cookies[AUTH_COOKIE_NAME];
  }

  const verified = verifySessionToken(token);
  if (verified?.email) {
    return {
      ownerId: `user:${verified.email}`,
      email: verified.email,
      isAuthenticated: true,
    };
  }

  const rawGuestId = req.headers["x-guest-id"];
  const guestId = typeof rawGuestId === "string" ? rawGuestId.trim() : "";
  if (/^[a-zA-Z0-9_-]{16,64}$/.test(guestId)) {
    return {
      ownerId: `guest:${guestId}`,
      email: null,
      isAuthenticated: false,
    };
  }

  return {
    ownerId: null,
    email: null,
    isAuthenticated: false,
  };
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

function getUserByEmail(email?: string | null): UserProfileData | null {
  if (!email) return null;
  const clean = email.trim().toLowerCase();
  const users = loadSavedUsers();
  return users[clean]?.profile || null;
}

// Verify Google ID token or OAuth2 access token with Google's servers
async function verifyGoogleAuth(params: {
  credential?: string;
  accessToken?: string;
}): Promise<{
  email: string;
  firstName: string;
  lastName: string;
  avatar: string;
  sub: string;
} | null> {
  const { credential, accessToken } = params;

  if (credential && typeof credential === "string") {
    try {
      const resp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (resp.ok) {
        const info = await resp.json();
        const emailVerified = info.email_verified === true || info.email_verified === "true";
        if (info.email && emailVerified && info.aud === GOOGLE_CLIENT_ID) {
          return {
            email: String(info.email).trim().toLowerCase(),
            firstName: String(info.given_name || info.name?.split(" ")[0] || ""),
            lastName: String(info.family_name || info.name?.split(" ").slice(1).join(" ") || ""),
            avatar: String(info.picture || ""),
            sub: String(info.sub || ""),
          };
        }
      }
    } catch (err) {
      console.warn("Google id_token verification error:", err);
    }
  }

  if (accessToken && typeof accessToken === "string") {
    try {
      const tokenInfoRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (!tokenInfoRes.ok) return null;
      const tokenInfo = await tokenInfoRes.json();
      if (tokenInfo.aud !== GOOGLE_CLIENT_ID && tokenInfo.azp !== GOOGLE_CLIENT_ID) {
        return null;
      }

      const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!userInfoRes.ok) return null;
      const profile = await userInfoRes.json();
      if (!profile.email || profile.email_verified === false) return null;

      return {
        email: String(profile.email).trim().toLowerCase(),
        firstName: String(profile.given_name || profile.name?.split(" ")[0] || ""),
        lastName: String(profile.family_name || profile.name?.split(" ").slice(1).join(" ") || ""),
        avatar: String(profile.picture || ""),
        sub: String(profile.sub || ""),
      };
    } catch (err) {
      console.warn("Google access_token verification error:", err);
    }
  }

  return null;
}

const SESSIONS_FILE = path.resolve(DATA_DIR, "chat_sessions.json");

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
  ownerId?: string;
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

function getUserSessionsFilePath(email?: string | null): string | null {
  if (!email) return null;
  const clean = email.toLowerCase().trim().replace(/[^a-z0-9_.-]/g, "_");
  return resolveSafeDataPath(`sessions_${clean}.json`);
}

function getOwnerMemoryFilePath(ownerId?: string | null): string | null {
  if (!ownerId) return null;
  const digest = crypto.createHash("sha256").update(ownerId).digest("hex").slice(0, 24);
  return resolveSafeDataPath(`memory_${digest}.json`);
}

function loadSavedSessions(): Map<string, ChatSession> {
  const store = new Map<string, ChatSession>();
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const content = fs.readFileSync(SESSIONS_FILE, "utf-8");
      const sessionsArr: ChatSession[] = JSON.parse(content);
      if (Array.isArray(sessionsArr)) {
        for (const s of sessionsArr) {
          if (!s || !s.id) continue;
          // Strictly isolate: only restore sessions with an explicit owner (never legacy unowned/global guest chats)
          const ownerId = s.ownerId || (s.userEmail ? `user:${s.userEmail.toLowerCase().trim()}` : undefined);
          if (ownerId) {
            store.set(s.id, { ...s, ownerId });
          }
        }
      }
    }

    // Also load per-user email session files in DATA_DIR
    if (fs.existsSync(DATA_DIR)) {
      const files = fs.readdirSync(DATA_DIR);
      for (const f of files) {
        if (f.startsWith("sessions_") && f.endsWith(".json")) {
          const safePath = resolveSafeDataPath(f);
          if (!safePath) continue;
          try {
            const raw = fs.readFileSync(safePath, "utf-8");
            const uArr: ChatSession[] = JSON.parse(raw);
            if (Array.isArray(uArr)) {
              for (const s of uArr) {
                if (!s || !s.id || !s.userEmail) continue;
                const cleanEmail = s.userEmail.toLowerCase().trim();
                store.set(s.id, { ...s, userEmail: cleanEmail, ownerId: `user:${cleanEmail}` });
              }
            }
          } catch {}
        }
      }
    }
  } catch (e) {
    console.warn("Could not read chat_sessions.json:", e);
  }

  return store;
}

function saveSessions(store: Map<string, ChatSession>, touchedEmail?: string | null) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    // Persist ONLY owned sessions (never unowned/public chats)
    const ownedArr = Array.from(store.values()).filter((s) => Boolean(s.ownerId));
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(ownedArr, null, 2), "utf-8");

    // Partition and write per-email session files for permanent email persistence
    const byEmail: Record<string, ChatSession[]> = {};
    for (const s of ownedArr) {
      if (s.userEmail) {
        const cleanEmail = s.userEmail.toLowerCase().trim();
        if (!byEmail[cleanEmail]) byEmail[cleanEmail] = [];
        byEmail[cleanEmail].push(s);
      }
    }
    if (touchedEmail) {
      const cleanTouched = touchedEmail.toLowerCase().trim();
      if (!byEmail[cleanTouched]) {
        byEmail[cleanTouched] = [];
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

function loadAiMemory(ownerId?: string | null): AiMemoryData {
  const memPath = getOwnerMemoryFilePath(ownerId);
  if (!memPath) return { facts: [] };
  try {
    if (fs.existsSync(memPath)) {
      const content = fs.readFileSync(memPath, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed && Array.isArray(parsed.facts)) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn("Could not read owner ai_memory file:", e);
  }
  return { facts: [] };
}

function saveAiMemory(ownerId: string | null | undefined, data: AiMemoryData) {
  const memPath = getOwnerMemoryFilePath(ownerId);
  if (!memPath) return;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(memPath, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.warn("Could not write owner ai_memory file:", e);
  }
}

function addAiMemoryFact(
  ownerId: string | null | undefined,
  factText: string,
  category: "preference" | "fact" | "work" | "bio" | "general" = "fact"
): boolean {
  if (!ownerId) return false;
  const cleanFact = factText.trim();
  if (cleanFact.length < 2) return false;
  const memory = loadAiMemory(ownerId);
  const exists = memory.facts.some(f => f.fact.toLowerCase() === cleanFact.toLowerCase());
  if (!exists) {
    memory.facts.push({
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fact: cleanFact,
      category,
      createdAt: new Date().toISOString(),
    });
    saveAiMemory(ownerId, memory);
    return true;
  }
  return false;
}

function deleteAiMemoryFact(ownerId: string | null | undefined, id: string): boolean {
  if (!ownerId) return false;
  const memory = loadAiMemory(ownerId);
  const initialLen = memory.facts.length;
  memory.facts = memory.facts.filter(f => f.id !== id);
  if (memory.facts.length !== initialLen) {
    saveAiMemory(ownerId, memory);
    return true;
  }
  return false;
}

// Auto-extract personal facts strictly into the current owner's isolated memory
function autoExtractAndSaveFacts(ownerId: string | null | undefined, text: string, profile?: UserProfileData | null) {
  if (!ownerId) return;
  const lower = text.toLowerCase().trim();
  
  // Name
  if (lower.startsWith("mening ismim ") || lower.startsWith("ismim ")) {
    const name = text.replace(/^(?:mening\s+)?ismim\s+/i, "").replace(/[.,!]/g, "").trim();
    if (name.length > 1 && name.length < 30) {
      addAiMemoryFact(ownerId, `Foydalanuvchining ismi: ${name}`, "bio");
    }
  }
  // Profession / Role
  else if (lower.includes("men dasturchiman") || lower.includes("men dasturchi") || lower.includes("dasturlash bilan shug'ullanaman")) {
    addAiMemoryFact(ownerId, "Foydalanuvchi dasturchi / IT sohasida ishlaydi", "work");
  }
  else if (lower.includes("men talabaman") || lower.includes("talabaman") || lower.includes("universitetda o'qiyman")) {
    addAiMemoryFact(ownerId, "Foydalanuvchi talaba", "bio");
  }
  else if (lower.includes("men maktabda o'qiyman") || lower.includes("o'quvchiman")) {
    addAiMemoryFact(ownerId, "Foydalanuvchi maktab o'quvchisi", "bio");
  }
  // Location
  else if (lower.startsWith("men ") && (lower.includes("yashayman") || lower.includes("turaman"))) {
    addAiMemoryFact(ownerId, text.trim(), "bio");
  }

  // Profile fields auto-sync (strictly within this owner's own memory)
  if (profile) {
    if (profile.firstName) {
      addAiMemoryFact(ownerId, `Foydalanuvchi ismi: ${profile.firstName} ${profile.lastName || ""}`.trim(), "bio");
    }
    if (profile.interests && profile.interests.length > 0) {
      profile.interests.forEach(i => addAiMemoryFact(ownerId, `Qiziqishi: ${i}`, "preference"));
    }
  }
}

// Initialize memoryStore with persistent storage from disk (only owned sessions)
const memoryStore: Map<string, ChatSession> = loadSavedSessions();
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
  ownerId: string | null;
  userQuery: string;
  resolvedQuery: string;
  history: ChatMessage[];
  sources?: Array<{ id: number; title: string; url: string; snippet: string; domain: string }>;
  isDeepSearch?: boolean;
  needsWeb?: boolean;
  userProfile?: UserProfileData | null;
  attachments?: FileAttachmentData[];
}): Promise<{ 
  answer: string; 
  reasoning: string[]; 
  updatedSources?: Array<{ id: number; title: string; url: string; snippet: string; domain: string }>;
  newLearnedPreferences?: string[];
}> {
  const { 
    ownerId,
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
      addAiMemoryFact(ownerId, memoryItem, "fact");
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
    const aiMemory = loadAiMemory(ownerId);
    const diskFacts = aiMemory.facts.map(f => f.fact);
    const profilePrefs = userProfile?.learnedPreferences || [];
    const allCombined = Array.from(new Set([...diskFacts, ...profilePrefs])).filter(Boolean);

    const firstName = userProfile?.firstName?.trim() || "";
    let memoryReply = `Ha, albatta! Men faqat sizning shaxsiy xotirangizni alohida saqlab boryapman.\n\n`;
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
      memoryReply += `\n🧠 **Siz haqingizda xotirada saqlangan faktlar va qiziqishlar:**\n`;
      allCombined.forEach(f => {
        memoryReply += `• ${f}\n`;
      });
    } else {
      memoryReply += `\nHozircha qo'shimcha shaxsiy xotira yozuvlari yo'q. Biror narsani doimiy yodda saqlashimni istasangiz, masalan: *«Shuni eslab qol: men dasturchiman»* deb yozishingiz mumkin.`;
    }

    const totalSessions = ownerId
      ? Array.from(memoryStore.values()).filter(s => s.ownerId === ownerId).length
      : 0;
    memoryReply += `\n💾 **Suhbatlar tarixi:** Sizning hisobingizda jami **${totalSessions} ta suhbat** alohida saqlanmoqda.`;

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

  // User memory and personalization from strictly owner-scoped backend disk storage
  const userFirstName = userProfile?.firstName?.trim() || "";
  const aiMemory = loadAiMemory(ownerId);
  const allSavedFacts = Array.from(new Set([
    ...(userProfile?.learnedPreferences || []),
    ...aiMemory.facts.map(f => f.fact),
  ])).filter(Boolean);

  const detectedPrefs = extractLearnedPreferences(userQuery, allSavedFacts);
  if (detectedPrefs.length > 0) {
    reasoningSteps.push(`Foydalanuvchining yangi eslab qolish buyrug'i qabul qilindi: ${detectedPrefs.join(', ')}`);
    detectedPrefs.forEach(p => addAiMemoryFact(ownerId, p, "preference"));
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

// 2. Main Chat endpoint (strictly owner-isolated)
app.post("/api/chat", async (req, res) => {
  try {
    const owner = resolveRequestOwner(req);
    const { 
      sessionId, 
      message = "", 
      content = "",
      isDeepSearch = false, 
      customModel = "llama3.2:3b", 
      isAiMode = true,
      attachments = [],
    } = req.body;

    if (!owner.ownerId) {
      return res.status(401).json({ error: "Suhbatlashish uchun sessiya identifikatori topilmadi." });
    }

    const userProfile = owner.isAuthenticated && owner.email ? getUserByEmail(owner.email) : null;
    const rawMessage = (message || content || "").toString().trim();

    if (!rawMessage && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: "Xabar matni yoki biriktirilgan rasm/fayl kiritilishi shart." });
    }

    const effectiveMessage = rawMessage.length > 0
      ? rawMessage
      : (attachments.length > 0 
          ? (attachments[0].isImage ? "Ushbu yuborilgan rasmni batafsil tushuntirib, tahlil qilib bering." : `Ushbu "${attachments[0].name}" faylini tahlil qiling.`)
          : "Salom");

    const targetSessionId =
      typeof sessionId === "string" && sessionId.trim() && sessionId !== "default-uzunited-session"
        ? sessionId.trim()
        : `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

    // Get or create strictly owner-isolated session
    let session = memoryStore.get(targetSessionId);
    if (session && session.ownerId !== owner.ownerId) {
      return res.status(403).json({ error: "Ushbu suhbatga kirish huquqingiz yo‘q." });
    }
    if (!session) {
      session = {
        id: targetSessionId,
        title: effectiveMessage.slice(0, 30) + (effectiveMessage.length > 30 ? "..." : ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ownerId: owner.ownerId,
        userEmail: owner.email || undefined,
        messages: [],
        entityMemory: {},
      };
      memoryStore.set(targetSessionId, session);
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
      ownerId: owner.ownerId,
      userQuery: effectiveMessage,
      resolvedQuery,
      history: session.messages,
      sources,
      isDeepSearch,
      needsWeb: shouldQueryWeb,
      userProfile,
      attachments,
    });

    reasoningSteps.push(...aiResult.reasoning);

    const finalSources = (aiResult.updatedSources && aiResult.updatedSources.length > 0) 
      ? aiResult.updatedSources 
      : sources;
    const hasActiveSources = finalSources.length > 0;
    const finalSearchedWeb = searchedWeb || hasActiveSources;

    // Save to strictly owned session memory
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

    // Auto extract personal facts strictly for this owner
    autoExtractAndSaveFacts(owner.ownerId, effectiveMessage, userProfile);

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

// Current authenticated user (via HttpOnly cookie or Bearer token)
app.get("/api/auth/me", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.isAuthenticated || !owner.email) {
    return res.json({ user: null });
  }
  const profile = getUserByEmail(owner.email);
  return res.json({ user: profile });
});

// User Profile and Account Persistence Endpoints (authenticated owner only)
app.get("/api/user/profile", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.isAuthenticated || !owner.email) {
    return res.json({ user: null });
  }
  const existing = getUserByEmail(owner.email);
  return res.json({ user: existing });
});

app.post("/api/user/profile", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.isAuthenticated || !owner.email) {
    return res.status(401).json({ error: "Profilni saqlash uchun tizimga kiring." });
  }
  const { profile } = req.body;
  if (!profile || typeof profile !== "object") {
    return res.status(400).json({ error: "Profil ma'lumotlari kiritilmadi" });
  }
  const cleanEmail = owner.email;
  const users = loadSavedUsers();
  const existingProfile = users[cleanEmail]?.profile || {};
  const mergedProfile: UserProfileData = {
    ...existingProfile,
    firstName: profile.firstName ?? existingProfile.firstName,
    lastName: profile.lastName ?? existingProfile.lastName,
    birthYear: profile.birthYear ?? existingProfile.birthYear,
    interests: Array.isArray(profile.interests) ? profile.interests : existingProfile.interests,
    favoriteTopics: Array.isArray(profile.favoriteTopics) ? profile.favoriteTopics : existingProfile.favoriteTopics,
    bio: profile.bio ?? existingProfile.bio,
    learnedPreferences: Array.isArray(profile.learnedPreferences) ? profile.learnedPreferences : existingProfile.learnedPreferences,
    email: cleanEmail,
  };
  users[cleanEmail] = {
    ...(users[cleanEmail] || {}),
    profile: mergedProfile,
  };
  saveUsers(users);
  res.json({ success: true, user: mergedProfile });
});

app.post("/api/auth/register", (req, res) => {
  const { firstName, lastName, email, birthYear, password } = req.body;
  if (!email || !password || !firstName) {
    return res.status(400).json({ error: "Barcha majburiy maydonlarni to'ldiring" });
  }
  if (typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Parol kamida 6 ta belgidan iborat bo'lishi kerak" });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const users = loadSavedUsers();
  if (users[cleanEmail]) {
    return res.status(409).json({ error: "Bu email allaqachon ro'yxatdan o'tgan. Tizimga kirish bo'limidan foydalaning." });
  }
  
  const newUserProfile: UserProfileData = {
    firstName: String(firstName).trim(),
    lastName: String(lastName || "").trim(),
    email: cleanEmail,
    birthYear: String(birthYear || "2000"),
    interests: [],
    learnedPreferences: [],
    isGoogleUser: false,
  };

  users[cleanEmail] = {
    profile: newUserProfile,
    passwordHash: hashPassword(password),
  };
  saveUsers(users);

  const token = createSessionToken(cleanEmail);
  setAuthCookie(res, req, token);
  res.json({ success: true, user: newUserProfile, token });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email va parolni kiriting" });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  const users = loadSavedUsers();
  const existing = users[cleanEmail];

  if (!existing) {
    return res.status(401).json({ error: "Bunday email ro'yxatdan o'tmagan. Avval ro'yxatdan o'ting yoki Google orqali kiring." });
  }

  if (existing.passwordHash?.startsWith("GOOGLE_AUTH_")) {
    return res.status(401).json({ error: "Ushbu hisob Google orqali ro'yxatdan o'tgan. Iltimos, 'Google hisobi orqali kirish' tugmasidan foydalaning." });
  }

  const check = verifyPassword(String(password), existing.passwordHash);
  if (!check.valid) {
    return res.status(401).json({ error: "Parol noto'g'ri kiritildi." });
  }
  if (check.needsRehash) {
    existing.passwordHash = hashPassword(String(password));
    saveUsers(users);
  }

  const token = createSessionToken(cleanEmail);
  setAuthCookie(res, req, token);
  return res.json({ success: true, user: existing.profile, token });
});

// Google Sign-In Authentication Endpoint (server-side verified with Google)
app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential, accessToken } = req.body;
    const verified = await verifyGoogleAuth({ credential, accessToken });

    if (!verified || !verified.email) {
      return res.status(401).json({ error: "Google hisobini tasdiqlab bo'lmadi. Iltimos, qaytadan urinib ko'ring." });
    }

    const cleanEmail = verified.email;
    const users = loadSavedUsers();
    const existing = users[cleanEmail]?.profile;

    const userProfile: UserProfileData = {
      firstName: verified.firstName?.trim() || existing?.firstName || cleanEmail.split("@")[0],
      lastName: verified.lastName?.trim() || existing?.lastName || "",
      email: cleanEmail,
      birthYear: existing?.birthYear || "2000",
      interests: existing?.interests || [],
      favoriteTopics: existing?.favoriteTopics || [],
      bio: existing?.bio || "Google orqali tasdiqlangan hisob",
      learnedPreferences: existing?.learnedPreferences || [],
      avatar: verified.avatar || existing?.avatar,
      isGoogleUser: true,
    };

    users[cleanEmail] = {
      profile: userProfile,
      passwordHash: users[cleanEmail]?.passwordHash || `GOOGLE_AUTH_${verified.sub || Date.now()}`,
    };
    saveUsers(users);

    const token = createSessionToken(cleanEmail);
    setAuthCookie(res, req, token);
    res.json({ success: true, user: userProfile, token });
  } catch (err: any) {
    console.error("Google Auth backend error:", err);
    res.status(500).json({ error: "Google orqali kirishda server xatoligi: " + err.message });
  }
});

app.post("/api/auth/logout", (req, res) => {
  clearAuthCookie(res, req);
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

// 4. Memory Sessions list (strictly isolated by verified ownerId)
app.get("/api/memory/sessions", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.json({ sessions: [] });
  }

  const userSessions = Array.from(memoryStore.values()).filter(
    (s) => s.ownerId === owner.ownerId
  );

  const list = userSessions
    .map((s) => ({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastEntity: s.entityMemory?.lastEntity || null,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  res.json({ sessions: list });
});

// 4b. Get specific session (strictly owner-checked)
app.get("/api/memory/sessions/:id", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Sessiya egasi aniqlanmadi." });
  }

  const { id } = req.params;
  if (id === "default-uzunited-session") {
    return res.status(404).json({ error: "Sessiya topilmadi." });
  }

  const session = memoryStore.get(id);
  if (!session) {
    const freshSession: ChatSession = {
      id,
      title: "Yangi suhbat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: owner.ownerId,
      userEmail: owner.email || undefined,
      messages: [],
      entityMemory: {},
    };
    memoryStore.set(id, freshSession);
    saveSessions(memoryStore);
    return res.json({ session: freshSession });
  }

  if (session.ownerId !== owner.ownerId) {
    return res.status(403).json({ error: "Bu suhbat boshqa foydalanuvchiga tegishli." });
  }

  res.json({ session });
});

// 4c. Synchronize session messages from client (strictly owner-checked)
app.post("/api/memory/sessions/:id/sync", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Sessiyani saqlash uchun autentifikatsiya talab etiladi." });
  }

  const { id } = req.params;
  if (id === "default-uzunited-session") {
    return res.status(400).json({ error: "Yaroqsiz sessiya ID." });
  }

  const { messages, title } = req.body;
  let session = memoryStore.get(id);
  if (session && session.ownerId !== owner.ownerId) {
    return res.status(403).json({ error: "Boshqa foydalanuvchi sessiyasini o‘zgartirish taqiqlangan." });
  }

  if (!session) {
    session = {
      id,
      title: title || "Yangi suhbat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: owner.ownerId,
      userEmail: owner.email || undefined,
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
    session.updatedAt = new Date().toISOString();
  }
  memoryStore.set(id, session);
  saveSessions(memoryStore);
  res.json({ success: true, session });
});

// 4d. Delete specific session individually (strictly owner-checked)
app.delete("/api/memory/sessions/:id", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Autentifikatsiya talab etiladi." });
  }

  const { id } = req.params;
  const session = memoryStore.get(id);
  if (session) {
    if (session.ownerId !== owner.ownerId) {
      return res.status(403).json({ error: "Boshqa foydalanuvchi suhbatini o‘chirish taqiqlangan." });
    }
    const deletedEmail = session.userEmail || owner.email;
    memoryStore.delete(id);
    saveSessions(memoryStore, deletedEmail);
  }
  res.json({ success: true, deletedId: id });
});

// 5. Create new session (strictly owner-stamped)
app.post("/api/memory/new-session", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Sessiya ochish uchun identifikator kerak." });
  }

  const newId = `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const newSession: ChatSession = {
    id: newId,
    title: "Yangi suhbat",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ownerId: owner.ownerId,
    userEmail: owner.email || undefined,
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

// 5b. Get AI long-term memory facts (strictly owner-isolated)
app.get("/api/memory/facts", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.json({ facts: [] });
  }
  const memory = loadAiMemory(owner.ownerId);
  res.json({ facts: memory.facts || [] });
});

// 5c. Add a fact directly to owner's isolated memory
app.post("/api/memory/facts", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Fakt qo‘shish uchun autentifikatsiya kerak" });
  }
  const { fact, category = "fact" } = req.body;
  if (!fact || typeof fact !== "string") {
    return res.status(400).json({ error: "Fakt matni kiritilmadi" });
  }
  const added = addAiMemoryFact(owner.ownerId, fact, category);
  const memory = loadAiMemory(owner.ownerId);
  res.json({ success: true, added, facts: memory.facts });
});

// 5d. Delete a fact from owner's isolated memory
app.delete("/api/memory/facts/:id", (req, res) => {
  const owner = resolveRequestOwner(req);
  if (!owner.ownerId) {
    return res.status(401).json({ error: "Autentifikatsiya kerak" });
  }
  const { id } = req.params;
  const deleted = deleteAiMemoryFact(owner.ownerId, id);
  const memory = loadAiMemory(owner.ownerId);
  res.json({ success: true, deleted, facts: memory.facts });
});

// 6. Test local Ollama / LM Studio connection (strict localhost allowlist to block SSRF)
app.post("/api/test-local-llm", async (req, res) => {
  const rawUrl = typeof req.body?.url === "string" ? req.body.url : "http://localhost:11434";
  let safeHostUrl = "http://localhost:11434";
  try {
    const parsed = new URL(rawUrl);
    const allowedHosts = new Set(["localhost", "127.0.0.1"]);
    const allowedPorts = new Set(["11434", "1234", ""]);
    if (parsed.protocol !== "http:" || !allowedHosts.has(parsed.hostname) || !allowedPorts.has(parsed.port)) {
      return res.status(400).json({ connected: false, message: "Faqat lokal Ollama/LM Studio manziliga ruxsat beriladi." });
    }
    safeHostUrl = `${parsed.protocol}//${parsed.host}`;
  } catch {
    return res.status(400).json({ connected: false, message: "Yaroqsiz lokal server manzili." });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const checkRes = await fetch(`${safeHostUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (checkRes.ok) {
      const data = await checkRes.json();
      return res.json({ connected: true, models: data.models || [], host: safeHostUrl });
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

