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
import { ChatMessage, ChatSession, UserProfile, FileAttachment } from './types';
import { generateClientResponse } from './utils/clientAiEngine';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('uzunited_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [currentTab, setCurrentTab] = useState<AppTabType>('chat');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  const [selectedModel, setSelectedModel] = useState('UZUNITED AI v1.0');
  const [tokenCount, setTokenCount] = useState(842);

  const [sessionId, setSessionId] = useState<string>('default-uzunited-session');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const savedUser = (() => {
      try {
        const s = localStorage.getItem('uzunited_user');
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    })();

    const greeting = savedUser?.firstName 
      ? `Salom, **${savedUser.firstName}**! Men **UZUNITED AI** man. Bugun qanday mavzuda suhbatlashamiz yoki qanday yordam bera olaman?`
      : "Salom! Men **UZUNITED AI** man — universal sun'iy intellekt yordamchingiz. Qanday mavzuda suhbatlashamiz yoki qanday savolingiz bor?";

    return [
      {
        id: 'msg-0',
        role: 'assistant',
        content: greeting,
        timestamp: new Date().toISOString(),
      }
    ];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [activeReasoningSteps, setActiveReasoningSteps] = useState<string[]>([]);

  // Fetch list of all sessions partitioned by user email
  const fetchSessions = async (targetEmail?: string, autoRestore = false) => {
    try {
      const emailToUse = targetEmail !== undefined ? targetEmail : (user?.email || '');
      const url = emailToUse ? `/api/memory/sessions?email=${encodeURIComponent(emailToUse)}` : '/api/memory/sessions';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data.sessions && data.sessions.length > 0) {
          setSessions(data.sessions);
          if (autoRestore) {
            const storageKey = emailToUse ? `uzunited_current_session_${emailToUse}` : 'uzunited_current_session';
            const savedCurrentId = localStorage.getItem(storageKey);
            const target = data.sessions.find((s: any) => s.id === savedCurrentId) || data.sessions[0];
            if (target && target.messageCount > 0) {
              handleSelectSession(target.id, emailToUse);
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to load sessions', e);
    }
  };

  // Fetch active user profile from server for true cross-session persistence
  const fetchUserProfile = async () => {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setUser(prev => {
            const merged = { ...prev, ...data.user };
            localStorage.setItem('uzunited_user', JSON.stringify(merged));
            return merged;
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load user profile from server', e);
    }
  };

  // Initial load
  useEffect(() => {
    try {
      localStorage.removeItem('uzunited_admin_mode');
      localStorage.removeItem('uzunited_admin_directives');
    } catch {}
    fetchUserProfile();
  }, []);

  // Sync sessions whenever user email is loaded or changed
  useEffect(() => {
    if (user?.email) {
      fetchSessions(user.email, true);
    } else {
      fetchSessions('', true);
    }
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

    try {
      const executeRequest = async (isRetry = false): Promise<any> => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 35000);

          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sessionId,
              email: user?.email,
              userEmail: user?.email,
              message: effectiveContent,
              isDeepSearch,
              isAiMode,
              customModel: selectedModel,
              userProfile: user,
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

      // If AI extracted new learned preferences, save them into the user's profile!
      if (data.newLearnedPreferences && data.newLearnedPreferences.length > 0 && user) {
        setUser(prev => {
          if (!prev) return null;
          const existing = prev.learnedPreferences || [];
          const combined = Array.from(new Set([...existing, ...data.newLearnedPreferences]));
          const updated = { ...prev, learnedPreferences: combined };
          localStorage.setItem('uzunited_user', JSON.stringify(updated));
          return updated;
        });
      }

      // Refresh sessions list for this user email
      fetchSessions(user?.email);
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
        // Ensure chat history is immediately synchronized and persisted to backend disk
        fetch(`/api/memory/sessions/${sessionId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: nextMsgs,
            email: user?.email,
            userEmail: user?.email,
            title: effectiveContent.slice(0, 30) + (effectiveContent.length > 30 ? '...' : ''),
          }),
        }).then(() => fetchSessions(user?.email)).catch(() => {});
        return nextMsgs;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Create new chat
  const handleNewChat = async () => {
    try {
      const res = await fetch('/api/memory/new-session', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user?.email, userEmail: user?.email }),
      });
      const data = await res.json();
      if (data.session) {
        setSessionId(data.session.id);
        const storageKey = user?.email ? `uzunited_current_session_${user.email}` : 'uzunited_current_session';
        localStorage.setItem(storageKey, data.session.id);
        setMessages(data.session.messages);
        setActiveReasoningSteps([]);
        fetchSessions(user?.email);
      }
    } catch (e) {
      const newId = `session-${Date.now()}`;
      setSessionId(newId);
      const storageKey = user?.email ? `uzunited_current_session_${user.email}` : 'uzunited_current_session';
      localStorage.setItem(storageKey, newId);
      setMessages([
        {
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: "Assalomu alaykum! Yangi suhbat boshlandi. Men **UZUNITED AI** man. Sizga qanday yordam bera olaman?",
          timestamp: new Date().toISOString(),
        }
      ]);
      setActiveReasoningSteps([]);
    }
  };

  // Select an existing session
  const handleSelectSession = async (targetId: string, emailToUse?: string) => {
    const curEmail = emailToUse !== undefined ? emailToUse : (user?.email || '');
    const storageKey = curEmail ? `uzunited_current_session_${curEmail}` : 'uzunited_current_session';
    localStorage.setItem(storageKey, targetId);
    try {
      const url = curEmail ? `/api/memory/sessions/${targetId}?email=${encodeURIComponent(curEmail)}` : `/api/memory/sessions/${targetId}`;
      const res = await fetch(url);
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
    // Fallback switch ID
    setSessionId(targetId);
  };

  // Delete an individual chat session (bittalab o'chirish)
  const handleDeleteSession = async (targetId: string) => {
    try {
      await fetch(`/api/memory/sessions/${targetId}`, { method: 'DELETE' });
      // Update local sessions list
      setSessions(prev => prev.filter(s => s.id !== targetId));
      // If current session was deleted, start new one
      if (sessionId === targetId) {
        handleNewChat();
      }
    } catch (e) {
      console.warn('Failed to delete session', e);
      setSessions(prev => prev.filter(s => s.id !== targetId));
    }
  };

  // Auth callbacks
  const handleAuthSuccess = (authenticatedUser: UserProfile) => {
    setUser(authenticatedUser);
    localStorage.setItem('uzunited_user', JSON.stringify(authenticatedUser));
    setIsAuthModalOpen(false);
    fetchSessions(authenticatedUser.email, true);
  };

  // User profile update
  const handleUpdateUser = async (updated: UserProfile) => {
    setUser(updated);
    localStorage.setItem('uzunited_user', JSON.stringify(updated));
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: updated }),
      });
    } catch (e) {
      console.warn('Could not sync user profile to server', e);
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem('uzunited_user');
    setUser(null);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {}
    setIsAuthModalOpen(true);
  };

  return (
    <div className="h-screen flex flex-col bg-[#f8fafc] text-slate-900 overflow-hidden font-sans select-text">
      
      {/* Top Header matching screenshot */}
      <Header
        onOpenMenu={() => setIsSidebarOpen(true)}
        onNewChat={handleNewChat}
        onOpenProfile={() => {
          if (user) {
            setIsProfileModalOpen(true);
          } else {
            setIsAuthModalOpen(true);
          }
        }}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
        user={user}
        tokenCount={tokenCount}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
      />

      {/* Main Multi-Module Viewport */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentTab === 'chat' && (
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            activeReasoningSteps={activeReasoningSteps}
            onNewSession={handleNewChat}
            selectedModel={selectedModel}
            user={user}
            onOpenProfile={() => setIsProfileModalOpen(true)}
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
            <LocalLLMComparison />
          </div>
        )}

        {currentTab === 'memory' && (
          <div className="flex-1 overflow-y-auto bg-slate-950 text-slate-100">
            <MemoryInspector
              sessions={sessions}
              currentSessionId={sessionId}
              messages={messages}
              onClearSession={handleNewChat}
            />
          </div>
        )}
      </main>

      {/* Slide-out Sidebar Drawer with Chat History and individual delete buttons */}
      <SidebarDrawer
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        currentSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        onDeleteSession={handleDeleteSession}
        user={user}
        onLogout={handleLogout}
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
      />

      {/* Registration & Login Modal on first entrance */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onSuccess={handleAuthSuccess}
      />

      {/* User Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        user={user}
        onUpdateUser={handleUpdateUser}
        onLogout={handleLogout}
      />

    </div>
  );
}
