import React, { useState, useEffect } from 'react';
import { 
  X, 
  Cpu, 
  Zap, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Play, 
  Sparkles, 
  Check, 
  RefreshCw,
  HardDrive,
  ShieldCheck,
  Send
} from 'lucide-react';
import { 
  checkWebGPUSupport, 
  AVAILABLE_WEBGPU_MODELS, 
  initWebLLMEngine, 
  getActiveWebLLMEngine,
  getActiveModelId,
  streamWebLLMCompletion 
} from '../utils/webLlmEngine';

interface WebGPUModalProps {
  isOpen: boolean;
  onClose: () => void;
  isWebGPUActive: boolean;
  onToggleWebGPUActive: (active: boolean) => void;
}

export const WebGPUModal: React.FC<WebGPUModalProps> = ({
  isOpen,
  onClose,
  isWebGPUActive,
  onToggleWebGPUActive,
}) => {
  const [gpuStatus, setGpuStatus] = useState<{
    loading: boolean;
    supported: boolean;
    message: string;
    gpuName?: string;
  }>({
    loading: true,
    supported: false,
    message: 'WebGPU tekshirilmoqda...',
  });

  const [selectedModelId, setSelectedModelId] = useState<string>(AVAILABLE_WEBGPU_MODELS[0].id);
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [loadProgress, setLoadProgress] = useState<{ text: string; percent: number }>({
    text: '',
    percent: 0,
  });
  const [loadedModelId, setLoadedModelId] = useState<string | null>(getActiveModelId());
  const [testPrompt, setTestPrompt] = useState('Salom! Sen kimsa va qanday ishlaysan?');
  const [testResponse, setTestResponse] = useState('');
  const [isGeneratingTest, setIsGeneratingTest] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkStatus();
      setLoadedModelId(getActiveModelId());
    }
  }, [isOpen]);

  const checkStatus = async () => {
    setGpuStatus(prev => ({ ...prev, loading: true }));
    const res = await checkWebGPUSupport();
    setGpuStatus({
      loading: false,
      supported: res.supported,
      message: res.message,
      gpuName: res.gpuName,
    });
  };

  const handleLoadModel = async () => {
    setIsLoadingModel(true);
    setLoadProgress({ text: "Model yuklanishi boshlanmoqda...", percent: 2 });
    try {
      await initWebLLMEngine(selectedModelId, (p) => {
        setLoadProgress(p);
      });
      setLoadedModelId(selectedModelId);
      onToggleWebGPUActive(true);
      setLoadProgress({ text: "Model brauzer xotirasiga to'liq yuklandi va tayyor!", percent: 100 });
    } catch (err: any) {
      console.error("WebLLM load error:", err);
      setLoadProgress({ text: `Xatolik: ${err?.message || err}`, percent: 0 });
    } finally {
      setIsLoadingModel(false);
    }
  };

  const handleRunQuickTest = async () => {
    const engine = getActiveWebLLMEngine();
    if (!engine) return;

    setIsGeneratingTest(true);
    setTestResponse('');

    try {
      await streamWebLLMCompletion(
        engine,
        [
          { role: 'system', content: "Siz brauzer ichida ishlaydigan aqlli, samimiy va odobli sun'iy intellektsiz. O'zbek tilida ravon javob bering." },
          { role: 'user', content: testPrompt }
        ],
        (_token, accumulated) => {
          setTestResponse(accumulated);
        }
      );
    } catch (err: any) {
      setTestResponse(`Generatsiya xatosi: ${err?.message || err}`);
    } finally {
      setIsGeneratingTest(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-purple-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Zap className="w-5 h-5 fill-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-lg">Brauzer WebGPU AIsi</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  0 API Kalit • 100% Bepul
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Model to'g'ridan-to'g'ri brauzeringiz xotirasida (WebGPU) ishlaydi
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-600">
          {/* Hardware Detection Box */}
          <div className={`p-4 rounded-2xl border transition-all ${
            gpuStatus.supported 
              ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' 
              : 'bg-amber-50/70 border-amber-200 text-amber-900'
          }`}>
            <div className="flex items-start gap-3">
              {gpuStatus.supported ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-semibold text-slate-900 flex items-center justify-between">
                  <span>
                    {gpuStatus.supported ? "WebGPU Qurilmangizda Tayyor!" : "WebGPU Holati"}
                  </span>
                  <button 
                    onClick={checkStatus} 
                    className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-normal underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${gpuStatus.loading ? 'animate-spin' : ''}`} />
                    Qayta tekshirish
                  </button>
                </div>
                <p className="text-xs mt-1 leading-relaxed text-slate-600">
                  {gpuStatus.message}
                </p>
                {gpuStatus.gpuName && (
                  <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/80 border border-slate-200 text-xs font-medium text-slate-700">
                    <Cpu className="w-3.5 h-3.5 text-blue-600" />
                    <span>{gpuStatus.gpuName}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Brauzer uchun mos modelni tanlang
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {AVAILABLE_WEBGPU_MODELS.map((model) => {
                const isSelected = selectedModelId === model.id;
                const isCurrentLoaded = loadedModelId === model.id;

                return (
                  <div
                    key={model.id}
                    onClick={() => !isLoadingModel && setSelectedModelId(model.id)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition-all relative flex flex-col justify-between ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/40 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900 text-xs">{model.name}</span>
                        {model.isRecommended && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 font-bold">
                            Tavsiya
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2 mb-2">
                        {model.desc}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-medium">
                      <span>{model.sizeText}</span>
                      <span>{model.vramText}</span>
                    </div>

                    {isCurrentLoaded && (
                      <div className="absolute -top-2 -right-2 px-1.5 py-0.5 rounded-full bg-emerald-600 text-white text-[9px] font-bold shadow-sm flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" />
                        Yuklangan
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Load / Activate Button & Progress */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="font-semibold text-slate-900 text-xs sm:text-sm">
                  {loadedModelId === selectedModelId ? "Model Hozir Ishlamoqda" : "Modelni Brauzerga Yuklash"}
                </h4>
                <p className="text-xs text-slate-500">
                  Model vaznlari bir marta yuklanadi va keshlanadi. Hech qanday serverga xabar yuborilmaydi.
                </p>
              </div>

              <button
                onClick={handleLoadModel}
                disabled={isLoadingModel || !gpuStatus.supported}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2 flex-shrink-0 ${
                  isLoadingModel
                    ? 'bg-blue-300 text-white cursor-not-allowed'
                    : loadedModelId === selectedModelId
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-blue-600 hover:bg-blue-700 text-white'
                }`}
              >
                {isLoadingModel ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Yuklanmoqda ({loadProgress.percent}%)</span>
                  </>
                ) : loadedModelId === selectedModelId ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Qayta yuklash</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    <span>Brauzerga Yuklash</span>
                  </>
                )}
              </button>
            </div>

            {/* Progress Bar */}
            {isLoadingModel && (
              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-[11px] font-medium text-slate-600">
                  <span className="truncate max-w-[80%]">{loadProgress.text}</span>
                  <span>{loadProgress.percent}%</span>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-200"
                    style={{ width: `${Math.max(4, loadProgress.percent)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Test Playground if model loaded */}
          {loadedModelId && (
            <div className="p-4 rounded-2xl border border-indigo-100 bg-indigo-50/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span className="font-bold text-xs text-slate-800">
                    Lokal Test: Brauzer ichida tezkor sinab ko'ring
                  </span>
                </div>
                <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-100 px-2 py-0.5 rounded-full">
                  0 API Kalit • Neyrotarmoq
                </span>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                  placeholder="Savol yoki xabar yozing..."
                  className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-indigo-500"
                  onKeyDown={(e) => e.key === 'Enter' && !isGeneratingTest && handleRunQuickTest()}
                />
                <button
                  onClick={handleRunQuickTest}
                  disabled={isGeneratingTest || !testPrompt.trim()}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {isGeneratingTest ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>Sinash</span>
                </button>
              </div>

              {testResponse && (
                <div className="p-3 bg-white rounded-xl border border-indigo-100 text-xs text-slate-700 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                  {testResponse}
                </div>
              )}
            </div>
          )}

          {/* Mode Toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-semibold text-slate-700">
                Asosiy chatda Brauzer WebGPU AIsidan foydalanish
              </span>
            </div>
            <button
              onClick={() => onToggleWebGPUActive(!isWebGPUActive)}
              disabled={!loadedModelId}
              className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
                isWebGPUActive && loadedModelId ? 'bg-blue-600' : 'bg-slate-300'
              } ${!loadedModelId ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                isWebGPUActive && loadedModelId ? 'translate-x-6' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <span>Xavfsiz: Xabarlaringiz qurilmangizdan tashqariga chiqmaydi</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-medium transition-colors"
          >
            Yopish
          </button>
        </div>
      </div>
    </div>
  );
};
