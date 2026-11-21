import React, { useState, useEffect } from 'react';
import { Header, AppTabType } from './components/Header';
import { ChatInterface } from './components/ChatInterface';
import { SidebarDrawer } from './components/SidebarDrawer';
import { AuthModal } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';
import { ArchitectureViewer } from './components/ArchitectureViewer';
import { CodebaseExplorer } from './components/CodebaseExplorer';
import { LocalLLMComparison } from './components/LocalLLMComparison';
import { MemoryInspector } from './components/MemoryInspector';
import { WebGPUModal } from './components/WebGPUModal';
import { ChatMessage, ChatSession, UserProfile, FileAttachment } from './types';
import { generateClientResponse } from './utils/clientAiEngine';
import { getActiveWebLLMEngine, streamWebLLMCompletion } from './utils/webLlmEngine';

const createFreshSessionId = () =>
  `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getOrCreateGuestId = (): string => {
  try {
    let existing = localStorage.getItem('uzunited_guest_id');
    if (!existing || !/^[a-zA-Z0-9_-]{16,64}$/.test(existing)) {
      const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID().replace(/-/g, '')
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
      existing = `g_${rand}`;
      localStorage.setItem('uzunited_guest_id', existing);
    }
    return existing;
  } catch {
    return `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  }
};

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [guestId] = useState<string>(() => getOrCreateGuestId());

  const [currentTab, setCurrentTab] = useState<AppTabType>('chat');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [isPrivateChat, setIsPrivateChat] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isWebGPUModalOpen, setIsWebGPUModalOpen] = useState(false);
  const [isWebGPUActive, setIsWebGPUActive] = useState<boolean>(() => {
    try {
      return localStorage.getItem('uzunited_webgpu_active') === 'true';
    } catch {
      return false;
    }
  });

  const [selectedModel, setSelectedModel] = useState('UZUNITED AI v1.0');
  const [tokenCount, setTokenCount] = useState(842);

  const [sessionId, setSessionId] = useState<string>(() => createFreshSessionId());
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-0',
      role: 'assistant',
      content: "Salom! Men **UZUNITED AI** man — universal sun'iy intellekt yordamchingiz. Qanday mavzuda suhbatlashamiz yoki qanday savolingiz bor?",
      timestamp: new Date().toISOString(),
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeReasoningSteps, setActiveReasoningSteps] = useState<string[]>([]);

  // Authenticated fetch wrapper (always attaches in-memory Bearer token, HttpOnly cookie credentials, and per-device guest ID)
  const apiFetch = (input: RequestInfo | URL, init: RequestInit = {}, overrideToken?: string | null) => {
    const tokenToUse = overrideToken !== undefined ? overrideToken : authToken;
    const headers = new Headers(init.headers || {});
    headers.set('X-Requested-With', 'XMLHttpRequest');
    headers.set('X-Guest-Id', guestId);
    if (tokenToUse) {
      headers.set('Authorization', `Bearer ${tokenToUse}`);
    }
    return fetch(input, {
      ...init,
      credentials: 'include',
      headers,
    });
  };

  // Fetch list of sessions strictly for the current verified user (or isolated guest browser)
  const fetchSessions = async (autoRestore = false, overrideToken?: string | null, ownerEmail?: string | null) => {
    try {
      const res = await apiFetch('/api/memory/sessions', {}, overrideToken);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data.sessions) ? data.sessions : [];
        setSessions(list);
        if (autoRestore && list.length > 0) {
          const scopeKey = ownerEmail || guestId;
          const storageKey = `uzunited_current_session_${scopeKey}`;
          const savedCurrentId = localStorage.getItem(storageKey);
          const target = list.find((s: any) => s.id === savedCurrentId) || list[0];
          if (target && target.messageCount > 0) {
            handleSelectSession(target.id, overrideToken, scopeKey);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load sessions', e);
    }
  };

  // Initial load: clean legacy unverified localStorage auth keys and restore session purely from verified server cookie
  useEffect(() => {
    try {
      localStorage.removeItem('uzunited_admin_mode');
      localStorage.removeItem('uzunited_admin_directives');
      localStorage.removeItem('uzunited_user');
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('uzunited_pwd_')) localStorage.removeItem(k);
      });
    } catch {}

    const bootstrapAuth = async () => {
      try {
        const res = await apiFetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          if (data.user) {
            setUser(data.user);
            fetchSessions(true, null, data.user.email);
            return;
          }
        }
      } catch (e) {
        console.warn('Auth bootstrap check failed', e);
      }
      fetchSessions(false);
    };
    bootstrapAuth();
  }, []);

  // Global Cmd+K / Ctrl+K shortcut for new chat
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCurrentTab('chat');
        handleNewChat();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user?.email]);

  // Send message handler supporting attachments
  const handleSendMessage = async (
    text: string, 
    isDeepSearch: boolean, 
    isAiMode = true, 
    attachments: FileAttachment[] = []
  ) => {
    const userMsgId = `msg-${Date.now()}-u`;
    const effectiveContent = text.trim() || (
      attachments.length > 0
        ? (attachments[0].isImage ? "Ushbu rasmni batafsil tahlil qilib bering." : "Ushbu faylni batafsil tahlil qilib bering.")
        : "Salom"
    );

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: effectiveContent,
      attachments: attachments.length > 0 ? attachments : undefined,
      timestamp: new Date().toISOString(),
    };

    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setTokenCount(prev => prev + Math.floor(effectiveContent.length / 3) + 45);

    const steps = [`1. Savol qabul qilindi: "${effectiveContent}"`];
    if (attachments.length > 0) {
      steps.push(`1.1. ${attachments.length} ta rasm/fayl kiritildi: ${attachments.map(a => a.name).join(", ")}`);
    }
    steps.push(`2. Butun dunyo bilimlari va kontekst xotirasi tahlilga tortilmoqda...`);
    setActiveReasoningSteps(steps);

    // In-Browser WebGPU AI Execution (0 API Key mode)
    const activeWebEngine = getActiveWebLLMEngine();
    if (isWebGPUActive && activeWebEngine) {
      const assistantMsgId = `msg-${Date.now()}-webgpu`;
      const placeholderAssistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, placeholderAssistantMsg]);
      setActiveReasoningSteps([
        `1. Foydalanuvchi so'rovi qabul qilindi: "${effectiveContent}"`,
        `2. ⚡ Brauzer WebGPU neyrotarmog'i ishga tushirildi (0 API Kalitsiz, lokal hisob-kitob)...`,
      ]);

      try {
        const conversationHistory = messages.slice(-6).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        conversationHistory.push({ role: 'user', content: effectiveContent });

        const systemInstruction = {
          role: 'system' as const,
          content: `Siz "UZUNITED AI" — foydalanuvchi qurilmasida WebGPU yordamida ishlaydigan aqlli, samimiy va erkin sun'iy intellektsiz. O'zbek tilida insondek samimiy, lo'nda va tabiiy javob bering. Foydalanuvchining ismi: ${user?.firstName || 'do‘stim'}.`,
        };

        let generatedText = '';
        await streamWebLLMCompletion(
          activeWebEngine,
          [systemInstruction, ...conversationHistory],
          (_token, accumulated) => {
            generatedText = accumulated;
            setMessages(prev =>
              prev.map(m => (m.id === assistantMsgId ? { ...m, content: accumulated } : m))
            );
          }
        );

        setActiveReasoningSteps([
          `1. Foydalanuvchi so'rovi: "${effectiveContent}"`,
          `2. ⚡ WebGPU: 0 API Kalitsiz to'liq lokal neyrotarmoq hisoblandi.`,
          `3. Javob muvaffaqiyatli yetkazildi.`,
        ]);
        setTokenCount(prev => prev + Math.floor(generatedText.length / 3));

        // Save session history permanently partitioned by verified owner
        if (!isPrivateChat) {
          const updatedMsgs = [...messages, userMsg, { ...placeholderAssistantMsg, content: generatedText }];
          apiFetch(`/api/memory/sessions/${sessionId}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: updatedMsgs,
              title: effectiveContent.slice(0, 30) + (effectiveContent.length > 30 ? '...' : ''),
            }),
          }).then(() => fetchSessions(false, undefined, user?.email)).catch(() => {});
        }

        setIsLoading(false);
        return;
      } catch (gpuErr: any) {
        console.warn("WebGPU generation failed, falling back to server:", gpuErr);
        setMessages(prev => prev.filter(m => m.id !== assistantMsgId));
      }
    }

    try {
      const executeRequest = async (isRetry = false): Promise<any> => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          const res = await apiFetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              message: effectiveContent,
              isDeepSearch,
              isAiMode,
              customModel: selectedModel,
              attachments,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson.error || `Server xatosi (${res.status})`);
          }

          return await res.json();
        } catch (fetchErr: any) {
          if (!isRetry && (fetchErr.name === 'AbortError' || fetchErr.message?.includes('fetch') || fetchErr.name === 'TypeError')) {
            await new Promise(r => setTimeout(r, 600));
            return executeRequest(true);
          }
          throw fetchErr;
        }
      };

      const data = await executeRequest();

      if (data.reasoningSteps) {
        setActiveReasoningSteps(data.reasoningSteps);
      }

      if (data.assistantMessage) {
        setMessages(prev => [...prev, data.assistantMessage]);
        setTokenCount(prev => prev + Math.floor((data.assistantMessage.content?.length || 100) / 3));
      }

      // If AI extracted new learned preferences, update local user state
      if (data.newLearnedPreferences && data.newLearnedPreferences.length > 0 && user) {
        setUser(prev => {
          if (!prev) return null;
          const existing = prev.learnedPreferences || [];
          const combined = Array.from(new Set([...existing, ...data.newLearnedPreferences]));
          return { ...prev, learnedPreferences: combined };
        });
      }

      // Refresh sessions list strictly for this user/device
      fetchSessions(false, undefined, user?.email);
    } catch (err: any) {
      console.warn('Chat request handled with client AI engine:', err);
      
      const fallbackResult = generateClientResponse({
        query: effectiveContent,
        user,
        attachments,
        history: messages,
      });

      setActiveReasoningSteps(fallbackResult.reasoningSteps);

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-a`,
        role: 'assistant',
        content: fallbackResult.answer,
        timestamp: new Date().toISOString(),
      };
      
      setMessages(prev => {
        const nextMsgs = [...prev, assistantMsg];
        if (!isPrivateChat) {
          apiFetch(`/api/memory/sessions/${sessionId}/sync`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: nextMsgs,
              title: effectiveContent.slice(0, 30) + (effectiveContent.length > 30 ? '...' : ''),
            }),
          }).then(() => fetchSessions(false, undefined, user?.email)).catch(() => {});
        }
        return nextMsgs;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Create new chat
  const handleNewChat = async () => {
    try {
      const res = await apiFetch('/api/memory/new-session', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.session) {
        setSessionId(data.session.id);
        const scopeKey = user?.email || guestId;
        localStorage.setItem(`uzunited_current_session_${scopeKey}`, data.session.id);
        setMessages(data.session.messages);
        setActiveReasoningSteps([]);
        fetchSessions(false, undefined, user?.email);
        return;
      }
    } catch {}

    const newId = createFreshSessionId();
    setSessionId(newId);
    const scopeKey = user?.email || guestId;
    localStorage.setItem(`uzunited_current_session_${scopeKey}`, newId);
    setMessages([
      {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: "Assalomu alaykum! Yangi suhbat boshlandi. Men **UZUNITED AI** man. Sizga qanday yordam bera olaman?",
        timestamp: new Date().toISOString(),
      }
    ]);
    setActiveReasoningSteps([]);
  };

  // Select an existing session
  const handleSelectSession = async (targetId: string, overrideToken?: string | null, scopeOverride?: string) => {
    const scopeKey = scopeOverride || user?.email || guestId;
    localStorage.setItem(`uzunited_current_session_${scopeKey}`, targetId);
    try {
      const res = await apiFetch(`/api/memory/sessions/${encodeURIComponent(targetId)}`, {}, overrideToken);
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setSessionId(data.session.id);
          setMessages(data.session.messages);
          setActiveReasoningSteps([]);
          return;
        }
      }
    } catch (e) {
      console.warn('Could not fetch session detail', e);
    }
    setSessionId(targetId);
  };

  // Delete an individual chat session
  const handleDeleteSession = async (targetId: string) => {
    try {
      await apiFetch(`/api/memory/sessions/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      setSessions(prev => prev.filter(s => s.id !== targetId));
      if (sessionId === targetId) {
        const freshId = createFreshSessionId();
        setSessionId(freshId);
        const scopeKey = user?.email || guestId;
        try {
          localStorage.removeItem(`uzunited_current_session_${scopeKey}`);
        } catch {}
        setMessages([
          {
            id: 'msg-0',
            role: 'assistant',
            content: "Salom! Men **UZUNITED AI** man — universal sun'iy intellekt yordamchingiz. Qanday mavzuda suhbatlashamiz yoki qanday savolingiz bor?",
            timestamp: new Date().toISOString(),
          }
        ]);
        setActiveReasoningSteps([]);
      }
    } catch (e) {
      console.warn('Failed to delete session', e);
      setSessions(prev => prev.filter(s => s.id !== targetId));
    }
  };

  // Auth callbacks
  const handleAuthSuccess = (authenticatedUser: UserProfile, token?: string) => {
    setAuthToken(token || null);
    setUser(authenticatedUser);
    setIsAuthModalOpen(false);
    setSessions([]);
    const freshId = createFreshSessionId();
    setSessionId(freshId);
    setMessages([
      {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Assalomu alaykum, **${authenticatedUser.firstName}**! 🎉\n\nMen **UZUNITED AI** man. Suhbatlaringiz va eslab qolingan mavzular faqat sizning profilingiz (${authenticatedUser.email}) bilan xavfsiz bog'landi. Qanday savolingiz bor yoki nima haqida suhbatlashamiz? 😊`,
        timestamp: new Date().toISOString(),
      }
    ]);
    fetchSessions(true, token || null, authenticatedUser.email);
  };

  // User profile update
  const handleUpdateUser = async (updated: UserProfile) => {
    setUser(updated);
    try {
      await apiFetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: updated }),
      });
    } catch (e) {
      console.warn('Could not sync user profile to server', e);
    }
  };

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    try {
      localStorage.removeItem('uzunited_user');
    } catch {}
    setAuthToken(null);
    setUser(null);
    setSessions([]);
    const freshId = createFreshSessionId();
    setSessionId(freshId);
    setMessages([
      {
        id: 'msg-0',
        role: 'assistant',
        content: "Salom! Men **UZUNITED AI** man — universal sun'iy intellekt yordamchingiz. Qanday mavzuda suhbatlashamiz yoki qanday savolingiz bor?",
        timestamp: new Date().toISOString(),
      }
    ]);
    fetchSessions(false, null);
    setIsAuthModalOpen(true);
  };

  const handleOpenProfileOrAuth = () => {
    if (user) {
      setIsProfileModalOpen(true);
    } else {
      setIsAuthModalOpen(true);
    }
  };

  const handleTogglePrivateChat = () => {
    setIsPrivateChat((prev) => {
      const next = !prev;
      if (next) {
        const privId = `private-${Date.now()}`;
        setSessionId(privId);
        setMessages([
          {
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: "Shaxsiy suhbat rejimi faollashdi. Bu suhbat maxfiy tarzda olib boriladi.",
            timestamp: new Date().toISOString(),
          },
        ]);
        setActiveReasoningSteps([]);
      } else {
        handleNewChat();
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 h-[100dvh] w-full flex bg-white text-slate-900 overflow-hidden font-sans select-text">
      {/* Persistent Desktop Sidebar + Mobile Slide-Over Drawer */}
      <SidebarDrawer
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        desktopOpen={desktopSidebarOpen}
        onToggleDesktop={() => setDesktopSidebarOpen((prev) => !prev)}
        sessions={sessions}
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        user={user}
        onOpenProfile={handleOpenProfileOrAuth}
        onOpenWebGPUModal={() => setIsWebGPUModalOpen(true)}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
      />

      {/* Right Main Area */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full bg-white overflow-hidden">
        <Header
          onOpenMenu={() => setIsSidebarOpen(true)}
          desktopSidebarOpen={desktopSidebarOpen}
          onToggleDesktopSidebar={() => setDesktopSidebarOpen((prev) => !prev)}
          onNewChat={handleNewChat}
          onOpenProfile={handleOpenProfileOrAuth}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
          user={user}
          tokenCount={tokenCount}
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          isWebGPUActive={isWebGPUActive}
          onOpenWebGPUModal={() => setIsWebGPUModalOpen(true)}
          isPrivateChat={isPrivateChat}
          onTogglePrivateChat={handleTogglePrivateChat}
        />

        {/* Main Multi-Module Viewport */}
        <main className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
          {currentTab === 'chat' && (
            <ChatInterface
              messages={messages}
              onSendMessage={handleSendMessage}
              isLoading={isLoading}
              activeReasoningSteps={activeReasoningSteps}
              onNewSession={handleNewChat}
              selectedModel={selectedModel}
              user={user}
              isWebGPUActive={isWebGPUActive}
              onOpenWebGPUModal={() => setIsWebGPUModalOpen(true)}
              isPrivateChat={isPrivateChat}
              onTogglePrivateChat={handleTogglePrivateChat}
            />
          )}

          {currentTab === 'architecture' && (
            <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
              <ArchitectureViewer />
            </div>
          )}

          {currentTab === 'codebase' && (
            <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
              <CodebaseExplorer />
            </div>
          )}

          {currentTab === 'models' && (
            <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
              <LocalLLMComparison onOpenWebGPU={() => setIsWebGPUModalOpen(true)} />
            </div>
          )}

          {currentTab === 'memory' && (
            <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
              <MemoryInspector
                sessions={sessions}
                currentSessionId={sessionId}
                messages={messages}
                onClearSession={handleNewChat}
                apiFetch={apiFetch}
              />
            </div>
          )}
        </main>
      </div>

      {/* Registration & Login Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={handleAuthSuccess}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* User Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user}
        onUpdateUser={handleUpdateUser}
        onLogout={handleLogout}
      />

      {/* WebGPU In-Browser AI Modal (0 API Key) */}
      <WebGPUModal
        isOpen={isWebGPUModalOpen}
        onClose={() => setIsWebGPUModalOpen(false)}
        isWebGPUActive={isWebGPUActive}
        onToggleWebGPUActive={(active) => {
          setIsWebGPUActive(active);
          try {
            localStorage.setItem('uzunited_webgpu_active', active.toString());
          } catch {}
        }}
      />

    </div>
  );
}
