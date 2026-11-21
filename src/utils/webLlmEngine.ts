import { CreateMLCEngine, MLCEngine, InitProgressReport } from '@mlc-ai/web-llm';

export interface WebGPUModelOption {
  id: string;
  name: string;
  sizeText: string;
  vramText: string;
  desc: string;
  isRecommended?: boolean;
}

export const AVAILABLE_WEBGPU_MODELS: WebGPUModelOption[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 (0.5B Instruct)',
    sizeText: '~350 MB',
    vramText: '~900 MB VRAM',
    desc: "O'zbek, rus va ingliz tillarini mukammal tushunadigan o'ta ixcham va tezkor neyrotarmoq.",
    isRecommended: true,
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 (360M Instruct)',
    sizeText: '~200 MB',
    vramText: '~400 MB VRAM',
    desc: 'Ultra-yengil model, oddiy noutbuklar va zaifroq videokartalarda ham bir zumda ishlaydi.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Meta Llama 3.2 (1B Instruct)',
    sizeText: '~850 MB',
    vramText: '~1.1 GB VRAM',
    desc: 'Meta kompaniyasining yuqori zakovatli modeli, chuqurroq fikrlash va kod yozish uchun.',
  },
];

let globalEngine: MLCEngine | null = null;
let activeModelId: string | null = null;

/**
 * Checks if the user's browser has WebGPU support
 */
export async function checkWebGPUSupport(): Promise<{ supported: boolean; message: string; gpuName?: string }> {
  if (typeof window === 'undefined') {
    return { supported: false, message: 'Server muhitida WebGPU mavjud emas.' };
  }

  const nav = navigator as any;
  if (!nav.gpu) {
    return {
      supported: false,
      message: "Brauzeringizda WebGPU qo'llab-quvvatlanmaydi. Iltimos, so'nggi Google Chrome yoki Microsoft Edge brauzeridan foydalaning.",
    };
  }

  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) {
      return {
        supported: false,
        message: "Grafik adapter (GPU) topilmadi yoki WebGPU yoqilmagan.",
      };
    }
    const info = adapter.info || {};
    const gpuName = info.description || info.device || info.architecture || 'WebGPU Mos Moslama';
    return {
      supported: true,
      message: `WebGPU muvaffaqiyatli aniqlandi! Grafik tezlatgich tayyor: ${gpuName}`,
      gpuName,
    };
  } catch (err: any) {
    return {
      supported: false,
      message: `WebGPU tekshiruvida xatolik: ${err?.message || err}`,
    };
  }
}

/**
 * Loads a WebLLM model into the browser with live progress callback
 */
export async function initWebLLMEngine(
  modelId: string,
  onProgress?: (progress: { text: string; percent: number }) => void
): Promise<MLCEngine> {
  if (globalEngine && activeModelId === modelId) {
    return globalEngine;
  }

  const progressCallback = (report: InitProgressReport) => {
    const percent = Math.round(report.progress * 100);
    if (onProgress) {
      onProgress({
        text: report.text || "Model brauzerga yuklanmoqda...",
        percent: isNaN(percent) ? 0 : percent,
      });
    }
  };

  const engine = await CreateMLCEngine(modelId, {
    initProgressCallback: progressCallback,
  });

  globalEngine = engine;
  activeModelId = modelId;
  return engine;
}

export function getActiveWebLLMEngine(): MLCEngine | null {
  return globalEngine;
}

export function getActiveModelId(): string | null {
  return activeModelId;
}

/**
 * Generates response using local in-browser WebLLM
 */
export async function streamWebLLMCompletion(
  engine: MLCEngine,
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onToken: (token: string, accumulated: string) => void
): Promise<string> {
  const chunks = await engine.chat.completions.create({
    messages,
    stream: true,
    temperature: 0.7,
  });

  let fullText = '';
  for await (const chunk of chunks) {
    const delta = chunk.choices[0]?.delta?.content || '';
    if (delta) {
      fullText += delta;
      onToken(delta, fullText);
    }
  }

  return fullText;
}
