/** One Phase 3 dispatcher for step, cascade, retry and bulk regeneration. */
import type { GlobalConfig, VisualElement, Phase3Result } from '../types';
import * as Recraft from './recraftService';
import * as Gemini from './geminiService';
import { callOpenAI } from './aiClient';

export async function generateImage(
    elements: VisualElement[], prompt: string,
    row: { UTTERANCE: string; NLU?: any }, config: GlobalConfig,
    onLog?: (type: 'info' | 'error' | 'success', msg: string) => void,
): Promise<Phase3Result> {
    if (config.generationModel === 'gpt-image-2') {
        const response = await callOpenAI({
            model: config.generationModel,
            prompt: Gemini.composeGeminiPrompt(elements, prompt, row, config),
            quality: config.openaiImageQuality ?? 'low',
        }, msg => onLog?.('info', msg));
        return { ...response, generationModel: config.generationModel };
    }
    return config.generationModel?.startsWith('recraft')
        ? Recraft.generateImage(elements, prompt, row, config, onLog)
        : Gemini.generateImage(elements, prompt, row, config, onLog);
}
