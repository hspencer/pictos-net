/** One Phase 3 dispatcher for step, cascade, retry and bulk regeneration. */
import { configuredModel, type GlobalConfig, type VisualElement, type Phase3Result } from '../types';
import { assertModelAvailable } from '../netlify/functions/_shared/modelCatalog.js';
import * as Recraft from './recraftService';
import * as Gemini from './geminiService';
import { callOpenAI } from './aiClient';

export async function generateImage(
    elements: VisualElement[], prompt: string,
    row: { UTTERANCE: string; NLU?: any }, config: GlobalConfig,
    onLog?: (type: 'info' | 'error' | 'success', msg: string) => void,
): Promise<Phase3Result> {
    assertModelAvailable(configuredModel(config, 3), [3]);
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
