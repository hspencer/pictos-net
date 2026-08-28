import { getModelProvider } from '../netlify/functions/_shared/modelCatalog.js';
/**
 * Claude Service — Phases 1 (COMPRENDER), 2 (COMPONER), and spatial prompt regen.
 *
 * Uses forced tool use followed by canonical runtime validation; tool use alone is not validation.
 * Phase 5 (ESTRUCTURAR / vision) lives in svgStructureService.ts.
 */

import { NLUData, GlobalConfig, VisualElement, PhaseExecution } from "../types";
import { callClaude, callGeminiNlu, callOpenAIText, extractToolUse, type ClaudeParams } from "./aiClient";
import { buildNluRequest, buildCompositionRequest, acceptNlu, acceptComposition, createPhaseExecution, requestSpatialPrompt } from "../netlify/functions/_shared/pipelineContracts.js";

type ExecutionCallback = (execution: PhaseExecution) => void;

/** Route a Claude-format params object to the correct NLU endpoint. */
function callNluModel(model: string, params: ClaudeParams) {
    const provider = getModelProvider(model);
    if (provider === 'openai') return callOpenAIText(params);
    if (provider === 'gemini') return callGeminiNlu(params);
    if (provider === 'claude') return callClaude(params);
    throw new Error('Unsupported semantic model');
}

type LogFn = (type: 'info' | 'error' | 'success', msg: string) => void;

// ── Phase 1: COMPRENDER ──────────────────────────────────────────────────────

export const generateNLU = async (
    utterance: string,
    onLog?: LogFn,
    config?: GlobalConfig,
    onExecution?: ExecutionCallback,
): Promise<NLUData> => {
    const request = buildNluRequest(utterance, config);
    onLog?.('info', `[NLU] Enviando a ${request.model}…`);
    const response = await callNluModel(request.model, request as ClaudeParams);
    const result = acceptNlu(extractToolUse(response, 'analyze_utterance'), utterance) as NLUData;
    if (onExecution) onExecution(await createPhaseExecution(1, request, result, response) as PhaseExecution);
    onLog?.('success', `[NLU] Completado y validado. Intent: ${result.metadata?.intent || 'N/A'}`);
    return result;
};

// ── Phase 2: COMPONER ────────────────────────────────────────────────────────
export const generateVisualBlueprint = async (
    nlu: NLUData,
    config: GlobalConfig,
    onLog?: LogFn,
    onExecution?: ExecutionCallback,
): Promise<{ elements: VisualElement[]; prompt: string }> => {
    const request = buildCompositionRequest(nlu, config);
    onLog?.('info', `[VISUAL] Enviando NLU completo a ${request.model}…`);
    const response = await callNluModel(request.model, request as ClaudeParams);
    const result = acceptComposition(extractToolUse(response, 'compose_pictogram'), nlu.lang);
    if (onExecution) onExecution(await createPhaseExecution(2, request, result, response) as PhaseExecution);
    onLog?.('success', `[VISUAL] Composición validada. Prompt: ${result.prompt.substring(0, 60)}…`);
    return result as { elements: VisualElement[]; prompt: string };
};

// ── Spatial prompt regen (same Phase 2 validation and evidence boundary) ────────
export const generateSpatialPrompt = async (
    nlu: NLUData,
    elements: VisualElement[],
    config: GlobalConfig,
    onLog?: LogFn,
    onExecution?: ExecutionCallback,
): Promise<string> => {
    onLog?.('info', '[PROMPT] Regenerando composición con el NLU completo…');
    const prompt = await requestSpatialPrompt(
        nlu, elements, config,
        (model: string, request: unknown) => callNluModel(model, request as ClaudeParams),
        onExecution,
    );
    onLog?.('success', `[PROMPT] Composición validada: ${prompt.substring(0, 80)}…`);
    return prompt;
};
