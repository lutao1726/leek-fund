import * as vscode from 'vscode';
import OpenAI from 'openai';
import { AgentModel, AgentUserError } from '../shared/agent';

export interface AgentWireMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
export interface AgentToolDefinition { name: string; description: string; parameters: Record<string, unknown> }
export type AgentChunk = { text: string } | { call: { id: string; name: string; input: unknown } };
export interface AgentModelRunner { name: string; stream(messages: AgentWireMessage[], tools: AgentToolDefinition[], signal: AbortSignal): AsyncIterable<AgentChunk> }

export class AgentModels {
  async list(): Promise<AgentModel[]> {
    let models: vscode.LanguageModelChat[] = [];
    try { if (vscode.lm?.selectChatModels) models = await vscode.lm.selectChatModels(); } catch { /* BYOK remains selectable when IDE discovery is unavailable. */ }
    const result: AgentModel[] = models.map(model => ({ id: 'ide:' + model.id, name: `${model.name} (${model.vendor})`, source: 'ide' }));
    const ai = vscode.workspace.getConfiguration('leek-fund', null).get<any>('aiConfig');
    if (ai?.apiKey?.trim() && ai?.baseUrl?.trim() && ai?.model?.trim()) result.push({ id: 'byok', name: `${ai.model} · 自带 API`, source: 'byok' });
    return result;
  }
  async resolve(id: string, supplied?: vscode.LanguageModelChat): Promise<AgentModelRunner> {
    if (supplied) return this.ide(supplied);
    if (id.startsWith('ide:')) {
      const model = (await vscode.lm?.selectChatModels({ id: id.slice(4) }))?.[0];
      if (!model) throw new AgentUserError('IDE 模型不可用，请刷新模型列表或手动选择自带 API');
      return this.ide(model);
    }
    if (id !== 'byok') throw new AgentUserError('请选择可用模型');
    const config = vscode.workspace.getConfiguration('leek-fund', null).get<any>('aiConfig');
    if (!config?.apiKey?.trim() || !config?.baseUrl?.trim() || !config?.model?.trim()) throw new AgentUserError('请先填写现有 AI 配置，再选择自带 API');
    const url = new URL(config.baseUrl);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new AgentUserError('模型地址须为 HTTPS 或本机 HTTP');
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 0, timeout: 60000 });
    return { name: `${config.model} · 自带 API`, async *stream(messages, tools, signal) {
      const response = await client.chat.completions.create({ model: config.model, messages: messages as any,
        stream: true, max_tokens: 4000, ...(tools.length ? { tools: tools.map(tool => ({ type: 'function' as const, function: tool })) } : {}) }, { signal });
      const calls = new Map<number, { id: string; name: string; arguments: string }>();
      let finish: string | null | undefined;
      for await (const chunk of response) {
        if (signal.aborted) return;
        const choice = chunk.choices[0]; if (!choice) continue;
        finish = choice.finish_reason || finish;
        if (choice.delta.content) yield { text: choice.delta.content };
        for (const part of choice.delta.tool_calls || []) {
          if (part.index > 7) throw new AgentUserError('工具调用过多');
          const call = calls.get(part.index) || { id: '', name: '', arguments: '' };
          if (part.id) call.id = part.id;
          call.name += part.function?.name || ''; call.arguments += part.function?.arguments || '';
          if (call.arguments.length > 4000 || call.name.length > 100) throw new AgentUserError('工具参数过长');
          calls.set(part.index, call);
        }
      }
      if (finish === 'length' || finish === 'content_filter') throw new AgentUserError('模型输出被截断或过滤');
      for (const call of calls.values()) { if (!call.id || !call.name) throw new AgentUserError('工具请求不完整'); yield { call: { id: call.id, name: call.name, input: JSON.parse(call.arguments || '{}') } }; }
    } };
  }
  private ide(model: vscode.LanguageModelChat): AgentModelRunner {
    return { name: `${model.name} · IDE`, async *stream(messages, tools, signal) {
      const source = new vscode.CancellationTokenSource(); const abort = () => source.cancel();
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) source.cancel();
      try {
        const history = messages.map(message => {
          if (message.role === 'tool') return vscode.LanguageModelChatMessage.User([new vscode.LanguageModelToolResultPart(message.tool_call_id!, [new vscode.LanguageModelTextPart(message.content)])]);
          if (message.role === 'assistant') return vscode.LanguageModelChatMessage.Assistant([
            ...(message.content ? [new vscode.LanguageModelTextPart(message.content)] : []),
            ...(message.tool_calls || []).map(call => new vscode.LanguageModelToolCallPart(call.id, call.function.name, JSON.parse(call.function.arguments))),
          ]);
          return vscode.LanguageModelChatMessage.User((message.role === 'system' ? '运行规则：\n' : '') + message.content);
        });
        const counts = await Promise.all(history.map(message => model.countTokens(message, source.token)));
        if (counts.reduce((a, b) => a + b, 0) > model.maxInputTokens * 0.8) throw new AgentUserError('上下文超出模型容量，请新建会话或选择更大上下文模型');
        const response = await model.sendRequest(history, tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.parameters })) } : {}, source.token);
        for await (const part of response.stream) {
          if (signal.aborted) return;
          if (part instanceof vscode.LanguageModelTextPart) yield { text: part.value };
          else if (part instanceof vscode.LanguageModelToolCallPart) yield { call: { id: part.callId, name: part.name, input: part.input } };
        }
      } finally { signal.removeEventListener('abort', abort); source.dispose(); }
    } };
  }
}
