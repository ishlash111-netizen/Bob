import React, { useState } from 'react';
import {
  ChevronDown,
  Plus,
  PanelLeft,
  Lock,
  Check,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { UserProfile } from '../types';

export type AppTabType = 'chat' | 'architecture' | 'codebase' | 'models' | 'memory';

interface HeaderProps {
  onOpenMenu: () => void;
  desktopSidebarOpen: boolean;
  onToggleDesktopSidebar: () => void;
  onNewChat: () => void;
  onOpenProfile: () => void;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  user: UserProfile | null;
  tokenCount?: number;
  currentTab?: AppTabType;
  onSelectTab?: (tab: AppTabType) => void;
  isWebGPUActive?: boolean;
  onOpenWebGPUModal?: () => void;
  isPrivateChat?: boolean;
  onTogglePrivateChat?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenMenu,
  desktopSidebarOpen,
  onToggleDesktopSidebar,
  onNewChat,
  selectedModel,
  onSelectModel,
  currentTab = 'chat',
  onSelectTab,
  isWebGPUActive = false,
  onOpenWebGPUModal,
  isPrivateChat = false,
  onTogglePrivateChat,
}) => {
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  const models = [
    { id: 'UZUNITED AI v1.0', short: '2.0', label: 'UZUNITED AI v1.0', desc: 'Standart jonli va tahliliy intellekt' },
    { id: '⚡ Brauzer WebGPU (0 Kalit)', short: 'WebGPU', label: 'Brauzer WebGPU (0 Kalit)', desc: '100% brauzer neyrotarmog‘i, API kalitsiz' },
    { id: 'UZUNITED Turbo Flash', short: 'Turbo', label: 'UZUNITED Turbo Flash', desc: 'Ultra-tezkor muloqot modeli' },
    { id: 'UZUNITED Web Search', short: 'Search', label: 'UZUNITED Web Search', desc: 'Faktlar va internet xulosalari' },
    { id: 'UZUNITED Pro', short: 'Pro', label: 'UZUNITED Pro', desc: 'Chuqur fikrlash va dasturlash' },
  ];

  const activeModelObj = isWebGPUActive
    ? models[1]
    : models.find((m) => m.id === selectedModel) || models[0];

  return (
    <header className="w-full shrink-0 bg-white z-30 select-none">
      {/* Desktop Top Bar */}
      <div className="hidden md:flex items-center justify-between h-14 px-5">
        <div className="flex items-center gap-2">
          {!desktopSidebarOpen && (
            <button
              id="btn-expand-desktop-sidebar"
              type="button"
              onClick={onToggleDesktopSidebar}
              title="Yon panelni ochish"
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer mr-1"
            >
              <PanelLeft className="w-[18px] h-[18px] stroke-[1.8]" />
            </button>
          )}

          {currentTab !== 'chat' && onSelectTab && (
            <button
              type="button"
              onClick={() => onSelectTab('chat')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors mr-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Suhbatga qaytish</span>
            </button>
          )}

          {/* Model Selector Dropdown Trigger: AI Chat 2.0 v */}
          <div className="relative">
            <button
              id="btn-model-dropdown-trigger"
              type="button"
              onClick={() => setModelDropdownOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-100/80 transition-colors text-slate-900 cursor-pointer"
            >
              <span className="font-semibold text-[15px] tracking-tight whitespace-nowrap">
                AI Chat
              </span>
              <span className="text-[14px] font-medium text-slate-400 whitespace-nowrap">
                {activeModelObj.short}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 stroke-[2.2]" />
            </button>

            {modelDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setModelDropdownOpen(false)}
                />
                <div className="absolute top-full left-0 mt-1.5 w-72 bg-white rounded-2xl shadow-xl border border-slate-200/80 py-1.5 z-50">
                  <div className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100 flex items-center justify-between">
                    <span>AI Modelini tanlang</span>
                    <button
                      type="button"
                      onClick={() => {
                        setModelDropdownOpen(false);
                        onOpenWebGPUModal?.();
                      }}
                      className="text-[#6C38FF] hover:underline font-semibold cursor-pointer"
                    >
                      WebGPU Sozlash
                    </button>
                  </div>
                  {models.map((m) => {
                    const isSel =
                      (isWebGPUActive && m.id.includes('WebGPU')) ||
                      (!isWebGPUActive && selectedModel === m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectModel(m.id);
                          setModelDropdownOpen(false);
                          if (m.id.includes('WebGPU') && onOpenWebGPUModal) {
                            onOpenWebGPUModal();
                          }
                        }}
                        className={`w-full text-left px-3.5 py-2 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors cursor-pointer ${
                          isSel ? 'text-[#6C38FF] font-semibold bg-violet-50/50' : 'text-slate-700'
                        }`}
                      >
                        <div>
                          <div className="font-semibold flex items-center gap-1.5">
                            <span>{m.label}</span>
                            {m.id.includes('WebGPU') && (
                              <Sparkles className="w-3 h-3 text-[#6C38FF]" />
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                            {m.desc}
                          </div>
                        </div>
                        {isSel && <Check className="w-4 h-4 text-[#6C38FF] shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right: Shaxsiy suhbat pill button */}
        <button
          id="btn-private-chat-desktop"
          type="button"
          onClick={onTogglePrivateChat}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            isPrivateChat
              ? 'bg-violet-50 border-violet-200 text-[#6C38FF]'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
          }`}
        >
          <Lock className="w-3.5 h-3.5 stroke-[2]" />
          <span>{isPrivateChat ? 'Shaxsiy rejim faol' : 'Shaxsiy suhbat'}</span>
        </button>
      </div>

      {/* Mobile Top Bar matching AI_chat___Mobil */}
      <div className="flex md:hidden items-center justify-between h-14 px-4">
        <button
          id="btn-open-sidebar-menu"
          type="button"
          onClick={onOpenMenu}
          title="Yon menyu"
          className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-100 text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          <PanelLeft className="w-5 h-5 stroke-[1.8]" />
        </button>

        {/* Center Model Selector */}
        <div className="relative">
          <button
            id="btn-model-dropdown-trigger-mobile"
            type="button"
            onClick={() => setModelDropdownOpen((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl hover:bg-slate-100/70 transition-colors text-slate-900 cursor-pointer"
          >
            <span className="font-semibold text-[16px] tracking-tight whitespace-nowrap">
              AI Chat
            </span>
            <ChevronDown className="w-4 h-4 text-slate-500 stroke-[2.2]" />
          </button>

          {modelDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setModelDropdownOpen(false)}
              />
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-72 bg-white rounded-2xl shadow-xl border border-slate-200/80 py-1.5 z-50">
                <div className="px-3.5 py-1.5 text-[11px] font-semibold text-slate-400 border-b border-slate-100 flex items-center justify-between">
                  <span>AI Modelini tanlang</span>
                  <button
                    type="button"
                    onClick={() => {
                      setModelDropdownOpen(false);
                      onOpenWebGPUModal?.();
                    }}
                    className="text-[#6C38FF] hover:underline font-semibold cursor-pointer"
                  >
                    WebGPU Sozlash
                  </button>
                </div>
                {models.map((m) => {
                  const isSel =
                    (isWebGPUActive && m.id.includes('WebGPU')) ||
                    (!isWebGPUActive && selectedModel === m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        onSelectModel(m.id);
                        setModelDropdownOpen(false);
                        if (m.id.includes('WebGPU') && onOpenWebGPUModal) {
                          onOpenWebGPUModal();
                        }
                      }}
                      className={`w-full text-left px-3.5 py-2 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors cursor-pointer ${
                        isSel ? 'text-[#6C38FF] font-semibold bg-violet-50/50' : 'text-slate-700'
                      }`}
                    >
                      <div>
                        <div className="font-semibold">{m.label}</div>
                        <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                          {m.desc}
                        </div>
                      </div>
                      {isSel && <Check className="w-4 h-4 text-[#6C38FF] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <button
          id="btn-header-new-chat"
          type="button"
          onClick={onNewChat}
          title="Yangi suhbat"
          className="w-10 h-10 rounded-xl bg-[#F4EFFF] text-slate-900 hover:bg-[#EAE0FF] flex items-center justify-center transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-5 h-5 stroke-[2]" />
        </button>
      </div>
    </header>
  );
};
