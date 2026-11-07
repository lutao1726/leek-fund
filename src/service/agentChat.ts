import * as vscode from 'vscode';
import { agent } from './agent';

/** Optional IDE integration; the Webview remains available on editors without native Chat. */
export function registerAgentChat(context: vscode.ExtensionContext) {
  if (!vscode.chat?.createChatParticipant) return;
  context.subscriptions.push(vscode.chat.createChatParticipant('leek-fund.agent', async (request, history, response, token) => {
    const previous = [...history.history].reverse().find(turn => turn instanceof vscode.ChatResponseTurn && turn.participant === 'leek-fund.agent') as vscode.ChatResponseTurn | undefined;
    const saved = previous?.result.metadata?.agentSession;
    const id = typeof saved === 'string' && agent.state(saved).selected ? saved : agent.create();
    let length = 0; let stage = '';
    const unsubscribe = agent.subscribe(() => {
      const messages = agent.state(id).selected?.messages || []; const last = messages[messages.length - 1];
      if (last?.role !== 'assistant' || token.isCancellationRequested) return;
      if (last.stage && stage !== last.stage) { stage = last.stage; response.progress(stage); }
      if (last.text.length > length) { response.markdown(last.text.slice(length)); length = last.text.length; }
    });
    const cancellation = token.onCancellationRequested(() => agent.cancel(id));
    try {
      if (token.isCancellationRequested) return;
      agent.send(id, (request.command ? '/' + request.command + ' ' : '') + request.prompt, 'ide:' + request.model.id, request.model);
      await agent.wait(id);
      const messages = agent.state(id).selected!.messages; const answer = messages[messages.length - 1];
      if (!token.isCancellationRequested && answer.text.length > length) response.markdown(answer.text.slice(length));
      if (answer.error) response.markdown('\n\n' + answer.error);
      return { metadata: { agentSession: id } };
    } catch { response.markdown('LeekAgent 请求未完成，请检查模型权限或已有会话状态。'); return { metadata: { agentSession: id } }; }
    finally { unsubscribe(); cancellation.dispose(); }
  }));
}
