import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowUp,
  Plus,
  Mic,
  MicOff,
  RotateCw,
  Copy,
  Share2,
  Volume2,
  VolumeX,
  ExternalLink,
  Globe,
  Sparkles,
  Check,
  Brain,
  ChevronDown,
  ChevronUp,
  FileText,
  Code,
  Image as ImageIcon,
  X,
  Eye,
  Zap,
  Pencil,
  BookOpen,
  Folder,
  Lock,
  Paperclip,
} from 'lucide-react';
import { marked } from 'marked';
import { ChatMessage, FileAttachment, UserProfile } from '../types';
import { AiBrandLogo } from './AiBrandLogo';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (
    text: string,
    isDeepSearch: boolean,
    isAiMode?: boolean,
    attachments?: FileAttachment[]
  ) => Promise<void>;
  isLoading: boolean;
  activeReasoningSteps: string[];
  onNewSession: () => void;
  selectedModel: string;
  user?: UserProfile | null;
  isWebGPUActive?: boolean;
  onOpenWebGPUModal?: () => void;
  isPrivateChat?: boolean;
  onTogglePrivateChat?: () => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isLoading,
  isWebGPUActive = false,
  onOpenWebGPUModal,
  isPrivateChat = false,
  onTogglePrivateChat,
}) => {
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [expandedReasoning, setExpandedReasoning] = useState<Record<string, boolean>>({});
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [selectedLang, setSelectedLang] = useState('O‘zbekcha');

  // Attachments and multimodal preview
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [previewModalImage, setPreviewModalImage] = useState<{ url: string; title: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Determine whether we're in the fresh welcome view or an active conversation
  const isWelcomeState =
    !isLoading &&
    messages.length <= 1 &&
    !messages.some((m) => m.role === 'user');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isWelcomeState) {
      scrollToBottom();
    }
  }, [messages, isLoading, isWelcomeState]);

  // Voice speech synthesis (UzSpeech)
  const handleUzSpeech = (id: string, text: string) => {
    if (!('speechSynthesis' in window)) return;

    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*#`_\[\]()]/g, '').slice(0, 500);
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'uz-UZ';
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);

    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleShare = async (text: string) => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AI Chat javobi',
          text: text.slice(0, 300) + '...',
          url: window.location.href,
        });
      } catch {}
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  const toggleListening = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isListening) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'uz-UZ';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
        setIsListening(false);
        textareaRef.current?.focus();
      };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  const processFiles = async (files: FileList | File[]) => {
    const newAttachments: FileAttachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImg = file.type.startsWith('image/');

      if (isImg) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newAttachments.push({
          id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          name: file.name,
          type: file.type,
          mimeType: file.type,
          size: file.size,
          dataUrl,
          base64Data: dataUrl,
          isImage: true,
        });
      } else {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        const isTextBased =
          ['txt', 'md', 'json', 'csv', 'js', 'ts', 'jsx', 'tsx', 'py', 'html', 'css', 'sql', 'sh'].includes(ext) ||
          file.type.includes('text') ||
          file.type.includes('json');

        if (isTextBased) {
          const textContent = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve('');
            reader.readAsText(file);
          });

          newAttachments.push({
            id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            type: file.type || ext.toUpperCase(),
            mimeType: file.type || 'text/plain',
            size: file.size,
            textContent,
            isImage: false,
          });
        } else {
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
          });

          newAttachments.push({
            id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
            name: file.name,
            type: file.type || ext.toUpperCase(),
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            dataUrl,
            base64Data: dataUrl,
            isImage: false,
          });
        }
      }
    }

    if (newAttachments.length > 0) {
      setAttachments((prev) => [...prev, ...newAttachments]);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      processFiles(files);
    }
  };

  const submitForm = () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    const text = input.trim();
    const currentAttachments = [...attachments];
    setInput('');
    setAttachments([]);
    setShowPlusMenu(false);
    setShowToolsMenu(false);
    onSendMessage(text, false, true, currentAttachments);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitForm();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitForm();
    }
  };

  const toggleReasoning = (msgId: string) => {
    setExpandedReasoning((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const suggestionCards = [
    {
      title: 'Yozish va tahrirlash',
      subtitle: 'Fikrlaringizni so‘zga aylantiring',
      icon: Pencil,
      iconBg: 'bg-violet-50 text-[#6C38FF]',
      prompt: 'Professional uslubda rasmiy xat yoki maqola matnini yozishda yordam ber.',
    },
    {
      title: 'Kod yozish',
      subtitle: 'Yechimni birga topamiz',
      icon: Code,
      iconBg: 'bg-sky-50 text-sky-600',
      prompt: 'Python yoki JavaScript tilida samarali funksiya yozib tushuntirib ber.',
    },
    {
      title: 'Yangi bilimlar',
      subtitle: 'Murakkab mavzularni tushuning',
      icon: BookOpen,
      iconBg: 'bg-amber-50 text-amber-600',
      prompt: 'Sun’iy intellekt va neyrotarmoqlar qanday ishlashini sodda tilda tushuntirib ber.',
    },
    {
      title: 'G‘oya topish',
      subtitle: 'Ilhom uchun yangi qarashlar',
      icon: Sparkles,
      iconBg: 'bg-rose-50 text-rose-500',
      prompt: 'Zamonaviy IT startap yoki kontent loyiha uchun 5 ta original g‘oya taklif qil.',
    },
  ];

  // Shared Composer Box matching PC & Mobile screenshots
  const renderComposer = (compact = false) => (
    <div className="w-full">
      {/* Attachments Preview */}
      {attachments.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-2 px-1 mb-2 no-scrollbar">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl p-1.5 pr-2.5 shadow-2xs text-xs shrink-0"
            >
              {att.isImage && att.dataUrl ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-8 h-8 rounded-lg object-cover border border-slate-100"
                />
              ) : (
                <div className="w-8 h-8 rounded-lg bg-violet-50 text-[#6C38FF] flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
              )}
              <div className="flex flex-col max-w-[140px]">
                <span className="font-medium text-slate-800 truncate">{att.name}</span>
                <span className="text-[10px] text-slate-400 tabular-nums">
                  {formatFileSize(att.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="p-1 text-slate-400 hover:text-red-500 rounded-md transition-colors cursor-pointer"
                title="O‘chirish"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="relative">
        <div className="bg-white border border-slate-200/90 rounded-[24px] shadow-[0_2px_12px_rgba(15,23,42,0.03)] px-4 pt-3.5 pb-3 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 transition-all">
          <textarea
            ref={textareaRef}
            id="input-main-chat"
            rows={compact ? 1 : 2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Xayolingizdagi savolni yozing..."
            disabled={isLoading}
            className="w-full bg-transparent text-slate-900 placeholder:text-slate-400 text-[14.5px] sm:text-[15px] leading-relaxed focus:outline-none resize-none disabled:opacity-50 max-h-40"
          />

          {/* Bottom Toolbar Inside Composer */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 relative">
              {/* + Button */}
              <div className="relative">
                <button
                  type="button"
                  id="btn-composer-plus"
                  onClick={() => {
                    setShowPlusMenu((prev) => !prev);
                    setShowToolsMenu(false);
                  }}
                  title="Rasm yoki fayl biriktirish"
                  className="w-8 h-8 rounded-full text-slate-700 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
                >
                  <Plus className="w-5 h-5 stroke-[1.8]" />
                </button>

                {showPlusMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowPlusMenu(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-200/80 py-1.5 z-40">
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          imageInputRef.current?.click();
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <ImageIcon className="w-4 h-4 text-[#6C38FF]" />
                        <span>Rasm yuklash</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          fileInputRef.current?.click();
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <Paperclip className="w-4 h-4 text-sky-600" />
                        <span>Fayl yoki kod yuklash</span>
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Vositalar Pill Button */}
              <div className="relative">
                <button
                  type="button"
                  id="btn-composer-tools"
                  onClick={() => {
                    setShowToolsMenu((prev) => !prev);
                    setShowPlusMenu(false);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100/90 hover:bg-slate-200/80 text-slate-700 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Folder className="w-3.5 h-3.5 text-slate-600 stroke-[1.8]" />
                  <span>Vositalar</span>
                </button>

                {showToolsMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowToolsMenu(false)}
                    />
                    <div className="absolute bottom-full left-0 mb-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-200/80 py-1.5 z-40">
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false);
                          imageInputRef.current?.click();
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <ImageIcon className="w-4 h-4 text-[#6C38FF]" />
                        <span>Rasm tahlili</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false);
                          fileInputRef.current?.click();
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <FileText className="w-4 h-4 text-sky-600" />
                        <span>Fayl va hujjat tahlili</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowToolsMenu(false);
                          onOpenWebGPUModal?.();
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between cursor-pointer"
                      >
                        <span className="flex items-center gap-2.5">
                          <Zap className="w-4 h-4 text-amber-500" />
                          <span>Brauzer WebGPU AI</span>
                        </span>
                        {isWebGPUActive && (
                          <span className="text-[10px] font-semibold text-emerald-600">Faol</span>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Right: Mic + Send */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                id="btn-voice-mic"
                onClick={toggleListening}
                title={isListening ? 'Eshitilmoqda...' : 'Ovoz bilan yozish'}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isListening
                    ? 'bg-red-50 text-red-600 ring-2 ring-red-200'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {isListening ? (
                  <MicOff className="w-[18px] h-[18px]" />
                ) : (
                  <Mic className="w-[18px] h-[18px] stroke-[1.8]" />
                )}
              </button>

              <button
                type="submit"
                id="btn-send-message"
                disabled={(!input.trim() && attachments.length === 0) || isLoading}
                className="w-10 h-10 rounded-[14px] bg-[#6C38FF] hover:bg-[#5B27EE] text-white flex items-center justify-center transition-all disabled:opacity-45 disabled:pointer-events-none shadow-xs active:scale-95 cursor-pointer shrink-0"
              >
                <ArrowUp className="w-[18px] h-[18px] stroke-[2.3]" />
              </button>
            </div>
          </div>
        </div>
      </form>

      <p className="text-[11px] text-slate-400 text-center mt-2.5 px-2">
        AI xato qilishi mumkin. Muhim ma’lumotlarni tekshirib ko‘ring.
      </p>
    </div>
  );

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col h-full bg-white text-slate-900 relative overflow-hidden ${
        isDragging ? 'ring-4 ring-violet-500/25' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file inputs */}
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        multiple
        className="hidden"
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.doc,.docx,.txt,.csv,.json,.py,.js,.ts,.tsx,.jsx,.html,.css,.sql,.md"
        multiple
        className="hidden"
      />

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-40 bg-violet-600/10 backdrop-blur-xs flex flex-col items-center justify-center border-2 border-dashed border-[#6C38FF] rounded-2xl m-3 pointer-events-none">
          <div className="p-4 bg-white rounded-2xl shadow-xl flex items-center gap-3 text-[#6C38FF] font-semibold text-sm">
            <ImageIcon className="w-6 h-6" />
            <span>Rasm yoki faylni shu yerga tashlang</span>
          </div>
        </div>
      )}

      {/* Full Image Preview Modal */}
      {previewModalImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4"
          onClick={() => setPreviewModalImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 bg-slate-800/90 text-white text-xs font-semibold">
              <span className="truncate max-w-md">{previewModalImage.title}</span>
              <button
                type="button"
                onClick={() => setPreviewModalImage(null)}
                className="p-1 hover:bg-white/20 rounded-full transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <img
              src={previewModalImage.url}
              alt={previewModalImage.title}
              className="max-h-[80vh] w-auto object-contain mx-auto"
            />
          </div>
        </div>
      )}

      {isWelcomeState ? (
        /* WELCOME HERO VIEW MATCHING BOTH PC & MOBILE SCREENSHOTS */
        <>
          <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain px-4">
            {/* Mobile centered Lock/Shaxsiy suhbat trigger matching mobile screenshot */}
            <div className="flex md:hidden justify-center pt-1 pb-1 shrink-0">
              <button
                type="button"
                onClick={onTogglePrivateChat}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full transition-colors cursor-pointer ${
                  isPrivateChat
                    ? 'bg-violet-50 text-[#6C38FF]'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{isPrivateChat ? 'Shaxsiy rejim faol' : 'Shaxsiy suhbat'}</span>
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center max-w-[760px] w-full mx-auto py-2 md:py-4">
              {/* Hero Brand + Headline + 4 Cards */}
              <div className="w-full flex flex-col items-center my-auto">
                <AiBrandLogo size="lg" />

                <h1 className="mt-4 sm:mt-5 text-[25px] sm:text-[32px] font-bold tracking-tight text-slate-900 text-center leading-[1.2] text-balance">
                  Bugun nimada yordam beray?
                </h1>
                <p className="mt-2 text-[13.5px] sm:text-[15px] text-slate-500 text-center max-w-md leading-relaxed">
                  G‘oyadan natijagacha — aqlli yordamchingiz yoningizda.
                </p>

                {/* 4 Suggestion Cards (2x2 Mobile, 4-col Desktop) */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3 w-full mt-5 sm:mt-7">
                  {suggestionCards.map((card) => {
                    const Icon = card.icon;
                    return (
                      <button
                        key={card.title}
                        type="button"
                        onClick={() => {
                          setInput(card.prompt);
                          textareaRef.current?.focus();
                        }}
                        className="bg-white border border-slate-200/90 hover:border-violet-300 hover:shadow-sm rounded-2xl p-3.5 sm:p-4 text-left transition-all flex flex-col items-start gap-2.5 sm:gap-3 cursor-pointer group"
                      >
                        <div
                          className={`w-8 h-8 rounded-xl flex items-center justify-center ${card.iconBg}`}
                        >
                          <Icon className="w-4 h-4 stroke-[2]" />
                        </div>
                        <div>
                          <div className="font-semibold text-[13px] text-slate-900 leading-snug group-hover:text-[#6C38FF] transition-colors">
                            {card.title}
                          </div>
                          <div className="text-[11.5px] text-slate-500 mt-1 leading-snug">
                            {card.subtitle}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Desktop Composer inside centered hero */}
                <div className="hidden md:block w-full mt-6">
                  {renderComposer(false)}
                </div>
              </div>
            </div>

            {/* Bottom Centered Language Selector Pill (Desktop) */}
            <div className="hidden md:flex justify-center pb-5 pt-1 relative shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowLangMenu((prev) => !prev)}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-full border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 transition-colors cursor-pointer"
                >
                  <span>{selectedLang}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {showLangMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setShowLangMenu(false)}
                    />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-40 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-40">
                      {['O‘zbekcha', 'O‘zbekcha (Kirill)', 'English'].map((lang) => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => {
                            setSelectedLang(lang);
                            setShowLangMenu(false);
                          }}
                          className={`w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50 flex items-center justify-between cursor-pointer ${
                            selectedLang === lang ? 'text-[#6C38FF] font-semibold' : 'text-slate-700'
                          }`}
                        >
                          <span>{lang}</span>
                          {selectedLang === lang && <Check className="w-3.5 h-3.5" />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Composer ALWAYS pinned cleanly at bottom (never scrolls out of view) */}
          <div className="block md:hidden shrink-0 w-full bg-white px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {renderComposer(false)}
          </div>
        </>
      ) : (
        /* ACTIVE CONVERSATION THREAD VIEW */
        <>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-6">
            <div className="max-w-[760px] mx-auto w-full space-y-6">
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const isExpanded = expandedReasoning[msg.id] ?? false;

                if (isUser) {
                  return (
                    <div key={msg.id} className="flex flex-col items-end space-y-1.5">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 justify-end max-w-[85%] sm:max-w-[75%]">
                          {msg.attachments.map((att) => (
                            <div key={att.id}>
                              {att.isImage && att.dataUrl ? (
                                <div
                                  onClick={() =>
                                    setPreviewModalImage({ url: att.dataUrl!, title: att.name })
                                  }
                                  className="relative cursor-pointer rounded-xl overflow-hidden border border-slate-200 shadow-xs hover:ring-2 hover:ring-violet-400 max-w-[200px] bg-slate-900"
                                >
                                  <img
                                    src={att.dataUrl}
                                    alt={att.name}
                                    className="h-28 w-auto object-cover"
                                  />
                                  <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 flex items-center justify-center text-white text-xs font-medium transition-opacity">
                                    <Eye className="w-4 h-4 mr-1" /> Ko‘rish
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-800">
                                  <FileText className="w-4 h-4 text-[#6C38FF] shrink-0" />
                                  <div className="flex flex-col text-left max-w-[150px]">
                                    <span className="truncate font-semibold">{att.name}</span>
                                    <span className="text-[10px] text-slate-400 tabular-nums">
                                      {formatFileSize(att.size)}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="bg-[#6C38FF] text-white px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[85%] sm:max-w-[75%] text-[14.5px] leading-relaxed shadow-xs">
                        {msg.content}
                      </div>
                      {msg.timestamp && (
                        <span className="text-[11px] text-slate-400 mr-1 tabular-nums">
                          {formatTime(msg.timestamp)}
                        </span>
                      )}
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex items-start gap-3.5 w-full">
                    <AiBrandLogo size="sm" />

                    <div className="flex-1 min-w-0 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-[14px] text-slate-900 tracking-tight">
                          AI Chat
                        </span>

                        <button
                          type="button"
                          onClick={() => {
                            const lastUserMsg = [...messages]
                              .reverse()
                              .find((m) => m.role === 'user');
                            if (lastUserMsg) {
                              onSendMessage(lastUserMsg.content, false, true);
                            }
                          }}
                          title="Qaytadan javob olish"
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {msg.reasoningSteps && msg.reasoningSteps.length > 0 && (
                        <div className="bg-slate-50/80 border border-slate-200/80 rounded-xl overflow-hidden">
                          <button
                            type="button"
                            onClick={() => toggleReasoning(msg.id)}
                            className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-600 hover:bg-slate-100/70 transition-colors cursor-pointer"
                          >
                            <span className="flex items-center gap-2 font-medium">
                              <Brain className="w-3.5 h-3.5 text-[#6C38FF]" />
                              <span>Tahlil bosqichlari ({msg.reasoningSteps.length})</span>
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {isExpanded && (
                            <div className="p-3 border-t border-slate-200/60 text-[11px] space-y-1 text-slate-600 font-mono">
                              {msg.reasoningSteps.map((st, i) => (
                                <div key={i} className="flex items-start gap-1.5">
                                  <span className="text-[#6C38FF] font-bold">›</span>
                                  <span>{st}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <div
                        className="prose prose-slate prose-sm sm:prose-base max-w-none text-slate-800 leading-relaxed [&>p]:mb-3 [&>p:last-child]:mb-0 [&>ol]:space-y-2 [&>ol]:my-3 [&>ul]:space-y-1.5 [&>pre]:bg-slate-900 [&>pre]:text-slate-100 [&>pre]:p-3.5 [&>pre]:rounded-xl [&>code]:bg-slate-100 [&>code]:text-[#6C38FF] [&>code]:px-1 [&>code]:py-0.5 [&>code]:rounded"
                        dangerouslySetInnerHTML={{
                          __html: marked.parse(msg.content) as string,
                        }}
                      />

                      {msg.sources && msg.sources.length > 0 && (
                        <div className="pt-2 border-t border-slate-100">
                          <div className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-[#6C38FF]" />
                            <span>Manbalar</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {msg.sources.map((s) => (
                              <a
                                key={s.id}
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex flex-col p-2.5 bg-slate-50/70 border border-slate-200/80 hover:border-violet-300 rounded-xl transition-colors group"
                              >
                                <div className="flex items-center justify-between text-xs font-semibold text-[#6C38FF] truncate">
                                  <span className="truncate">
                                    [{s.id}] {s.title}
                                  </span>
                                  <ExternalLink className="w-3 h-3 ml-1 shrink-0 opacity-60" />
                                </div>
                                <p className="text-[11px] text-slate-500 line-clamp-2 mt-1">
                                  {s.snippet}
                                </p>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 pt-1">
                        <button
                          id={`btn-copy-${msg.id}`}
                          type="button"
                          onClick={() => handleCopy(msg.id, msg.content)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          {copiedId === msg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-emerald-700">Nusxalandi</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Nusxa</span>
                            </>
                          )}
                        </button>

                        <button
                          id={`btn-share-${msg.id}`}
                          type="button"
                          onClick={() => handleShare(msg.content)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                          <span>Ulashish</span>
                        </button>

                        <button
                          id={`btn-uzspeech-${msg.id}`}
                          type="button"
                          onClick={() => handleUzSpeech(msg.id, msg.content)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                            speakingId === msg.id
                              ? 'bg-[#6C38FF] text-white'
                              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                          }`}
                        >
                          {speakingId === msg.id ? (
                            <>
                              <VolumeX className="w-3.5 h-3.5" />
                              <span>To‘xtatish</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>Ovoz</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="flex items-start gap-3.5 w-full">
                  <AiBrandLogo size="sm" />
                  <div className="bg-slate-50 border border-slate-200/80 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5 h-10">
                    <span className="w-2 h-2 bg-[#6C38FF] rounded-full typing-dot-1" />
                    <span className="w-2 h-2 bg-blue-500 rounded-full typing-dot-2" />
                    <span className="w-2 h-2 bg-pink-500 rounded-full typing-dot-3" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="shrink-0 w-full bg-white px-4 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-4">
            <div className="max-w-[760px] mx-auto w-full">
              {renderComposer(true)}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
