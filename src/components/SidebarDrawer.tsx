import React, { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Folder,
  PanelLeft,
  Sparkles,
  ArrowUpRight,
  User,
  MoreHorizontal,
  Trash2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Layers,
  FileCode,
  Cpu,
  Database,
  X,
} from 'lucide-react';
import { ChatSession, UserProfile } from '../types';
import { AppTabType } from './Header';
import { AiBrandLogo } from './AiBrandLogo';

interface SidebarDrawerProps {
  isOpen: boolean; // Mobile drawer open state
  onClose: () => void; // Close mobile drawer
  desktopOpen: boolean; // Desktop persistent sidebar open state
  onToggleDesktop: () => void; // Toggle desktop sidebar
  sessions: ChatSession[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onDeleteSession: (id: string) => void;
  user: UserProfile | null;
  onOpenProfile: () => void;
  onOpenWebGPUModal?: () => void;
  currentTab?: AppTabType;
  onSelectTab?: (tab: AppTabType) => void;
}

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  isOpen,
  onClose,
  desktopOpen,
  onToggleDesktop,
  sessions,
  currentSessionId,
  onSelectSession,
  onNewChat,
  onDeleteSession,
  user,
  onOpenProfile,
  onOpenWebGPUModal,
  currentTab = 'chat',
  onSelectTab,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectsExpanded, setProjectsExpanded] = useState(false);

  const groupedSessions = useMemo(() => {
    const filtered = sessions.filter((s) => {
      if (!searchQuery.trim()) return true;
      const title = (s.title || 'Yangi suhbat').toLowerCase();
      return title.includes(searchQuery.toLowerCase().trim());
    });

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

    const today: ChatSession[] = [];
    const yesterday: ChatSession[] = [];
    const older: ChatSession[] = [];

    for (const s of filtered) {
      const ts = new Date(s.updatedAt || s.createdAt).getTime();
      if (ts >= startOfToday) {
        today.push(s);
      } else if (ts >= startOfYesterday) {
        yesterday.push(s);
      } else {
        older.push(s);
      }
    }

    return { today, yesterday, older };
  }, [sessions, searchQuery]);

  const renderSidebarBody = (isMobile: boolean) => (
    <div className="flex flex-col h-full bg-[#fcfcfd] text-slate-900 select-none">
      {/* Top Brand + Collapse Icon */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            onSelectTab?.('chat');
            if (isMobile) onClose();
          }}
          className="flex items-center gap-2.5 text-left focus:outline-none"
        >
          <AiBrandLogo size="sm" />
          <span className="font-bold text-[17px] tracking-tight text-slate-900 whitespace-nowrap">
            AI Chat
          </span>
        </button>

        <button
          id={isMobile ? 'btn-close-sidebar' : 'btn-toggle-desktop-sidebar'}
          type="button"
          onClick={isMobile ? onClose : onToggleDesktop}
          title="Yon panelni yopish"
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
        >
          <PanelLeft className="w-[18px] h-[18px] stroke-[1.8]" />
        </button>
      </div>

      {/* Primary CTA: + Yangi suhbat ⌘K */}
      <div className="px-3.5 pb-3">
        <button
          id={isMobile ? 'btn-new-chat-drawer' : 'btn-new-chat-sidebar'}
          type="button"
          onClick={() => {
            onNewChat();
            onSelectTab?.('chat');
            if (isMobile) onClose();
          }}
          className="w-full bg-[#6C38FF] hover:bg-[#5E2DF0] active:scale-[0.99] text-white font-medium text-[13.5px] rounded-xl px-3.5 py-2.5 flex items-center justify-between shadow-xs transition-all cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4 stroke-[2.2]" />
            <span>Yangi suhbat</span>
          </span>
          <span className="text-[11px] font-medium text-white/80 tracking-wider hidden sm:inline">
            ⌘ K
          </span>
        </button>
      </div>

      {/* Search & Projects Navigation */}
      <div className="px-3 space-y-0.5 pb-3">
        {searchOpen ? (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white border border-slate-200 focus-within:border-violet-400">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Suhbatlarni qidirish..."
              className="w-full text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none bg-transparent"
            />
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSearchOpen(false);
              }}
              className="text-slate-400 hover:text-slate-700 p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-[13.5px] font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 transition-colors cursor-pointer"
          >
            <Search className="w-[17px] h-[17px] text-slate-500 stroke-[1.8]" />
            <span>Suhbatlarni qidirish</span>
          </button>
        )}

        <div>
          <button
            type="button"
            onClick={() => setProjectsExpanded((prev) => !prev)}
            className={`w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-[13.5px] font-medium transition-colors cursor-pointer ${
              currentTab !== 'chat'
                ? 'bg-violet-50 text-violet-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Folder className="w-[17px] h-[17px] text-slate-500 stroke-[1.8]" />
              <span>Loyihalar</span>
            </span>
            {projectsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100" />
            )}
          </button>

          {projectsExpanded && onSelectTab && (
            <div className="mt-1 ml-3 pl-2.5 border-l border-slate-200 space-y-0.5">
              {[
                { id: 'chat' as AppTabType, label: 'Asosiy suhbat', icon: MessageSquare },
                { id: 'architecture' as AppTabType, label: 'Tizim Arxitekturasi', icon: Layers },
                { id: 'codebase' as AppTabType, label: 'Python Kodlar', icon: FileCode },
                { id: 'models' as AppTabType, label: 'Lokal Modellar', icon: Cpu },
                { id: 'memory' as AppTabType, label: 'Xotira Tizimi', icon: Database },
              ].map((item) => {
                const Icon = item.icon;
                const active = currentTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      if (isMobile) onClose();
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors cursor-pointer ${
                      active
                        ? 'bg-violet-50 text-violet-700 font-semibold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Chat History Grouped by BUGUN / KECHA / OLDIN */}
      <div className="flex-1 overflow-y-auto px-3 space-y-5 pb-4 no-scrollbar">
        {[
          { label: 'BUGUN', items: groupedSessions.today },
          { label: 'KECHA', items: groupedSessions.yesterday },
          { label: 'OLDIN', items: groupedSessions.older },
        ].map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.label}>
                <div className="px-2.5 mb-1.5 text-[10.5px] font-semibold text-slate-400 tracking-wider uppercase">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((sess) => {
                    const isActive = sess.id === currentSessionId && currentTab === 'chat';
                    return (
                      <div
                        key={sess.id}
                        onClick={() => {
                          onSelectSession(sess.id);
                          onSelectTab?.('chat');
                          if (isMobile) onClose();
                        }}
                        className={`group flex items-center justify-between px-2.5 py-2 rounded-xl text-[13px] transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-slate-100 text-slate-900 font-medium'
                            : 'text-slate-700 hover:bg-slate-100/70'
                        }`}
                      >
                        <span className="truncate pr-2">
                          {sess.title || 'Yangi suhbat'}
                        </span>
                        <button
                          id={`btn-delete-session-${sess.id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSession(sess.id);
                          }}
                          title="Suhbatni o‘chirish"
                          className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity shrink-0 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
        )}

        {sessions.length === 0 && (
          <div className="px-2.5 py-6 text-xs text-slate-400">
            Hali suhbatlar mavjud emas.
          </div>
        )}
      </div>

      {/* Bottom Pro Upgrade Card & Account Footer */}
      <div className="px-3.5 pb-3.5 pt-2 space-y-3 bg-[#fcfcfd]">
        {/* Ko'proq imkoniyat card matching design */}
        <div className="p-3.5 rounded-2xl bg-[#F4EFFF] border border-violet-100/80">
          <div className="flex items-center gap-1.5 text-slate-900 font-semibold text-[13px]">
            <Sparkles className="w-4 h-4 text-[#6C38FF]" />
            <span>Ko‘proq imkoniyat</span>
          </div>
          <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">
            Kuchliroq AI. Kattaroq imkoniyatlar.
          </p>
          <button
            type="button"
            onClick={() => {
              onOpenWebGPUModal?.();
              if (isMobile) onClose();
            }}
            className="mt-3 w-full flex items-center justify-between text-xs font-semibold text-[#6C38FF] hover:text-[#5522E0] transition-colors cursor-pointer"
          >
            <span>Pro tarifga o‘tish</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Account Footer */}
        <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onOpenProfile();
              if (isMobile) onClose();
            }}
            className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:bg-slate-100/70 p-1.5 -ml-1.5 rounded-xl transition-colors cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-[#F4EFFF] text-[#6C38FF] flex items-center justify-center font-semibold text-xs shrink-0 overflow-hidden">
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.firstName}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-4 h-4 stroke-[2]" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-slate-900 truncate">
                {user?.firstName
                  ? [user.firstName, user.lastName].filter(Boolean).join(' ')
                  : 'Shaxsiy hisob'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {user?.email || 'Bepul tarif'}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenProfile();
              if (isMobile) onClose();
            }}
            title="Hisob sozlamalari"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0 cursor-pointer"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Persistent Collapsible Sidebar */}
      <aside
        className={`hidden md:flex flex-col shrink-0 border-r border-slate-200/70 bg-[#fcfcfd] transition-all duration-200 overflow-hidden ${
          desktopOpen ? 'w-[264px]' : 'w-0 border-r-0'
        }`}
      >
        <div className="w-[264px] h-full">{renderSidebarBody(false)}</div>
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div
            className="fixed inset-0 bg-slate-950/35 backdrop-blur-[2px] transition-opacity"
            onClick={onClose}
          />
          <div className="relative w-[280px] max-w-[85vw] h-full bg-[#fcfcfd] shadow-2xl z-10 border-r border-slate-200/70">
            {renderSidebarBody(true)}
          </div>
        </div>
      )}
    </>
  );
};
