/** One Phase 3 dispatcher for step, cascade, retry and bulk regeneration. */
import { configuredModel, type GlobalConfig, type VisualElement, type Phase3Result } from '../types';
import { assertModelAvailable, getModelProvider } from '../netlify/functions/_shared/modelCatalog.js';
import * as Recraft from './recraftService';
import * as Gemini from './geminiService';
import { callOpenAI } from './aiClient';

export async function generateImage(
    elements: VisualElement[], prompt: string,
    row: { UTTERANCE: string; NLU?: any }, config: GlobalConfig,
    onLog?: (type: 'info' | 'error' | 'success', msg: string) => void,
): Promise<Phase3Result> {
    const model = configuredModel(config, 3);
    assertModelAvailable(model, [3]);
    // Every branch receives the resolved model: a library that pins none
    // follows the catalog default, which the raw field does not carry.
    const resolved = { ...config, generationModel: model as GlobalConfig['generationModel'] };
    const provider = getModelProvider(model);
    if (provider === 'openai') {
        const response = await callOpenAI({
            model,
            prompt: Gemini.composeGeminiPrompt(elements, prompt, row, resolved),
            quality: config.openaiImageQuality ?? 'low',
        }, msg => onLog?.('info', msg));
        return { ...response, generationModel: resolved.generationModel };
    }
    return provider === 'recraft'
        ? Recraft.generateImage(elements, prompt, row, resolved, onLog)
        : Gemini.generateImage(elements, prompt, row, resolved, onLog);
}
