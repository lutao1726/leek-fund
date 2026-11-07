import { commands, ExtensionContext, WebviewView, WebviewViewProvider } from 'vscode';
import { getTemplateFileContent } from '../shared/utils';
import { registerAgentBridge } from './leek-center/agent-service';

export class AgentView implements WebviewViewProvider {
  private view?: WebviewView;
  private prompt?: string;
  constructor(private context: ExtensionContext) {}
  resolveWebviewView(view: WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.context.extensionUri] };
    registerAgentBridge(view.webview, view);
    view.webview.onDidReceiveMessage(message => { if (message.command === 'getAgent' && this.prompt) { void view.webview.postMessage({ command: 'agentPrompt', data: this.prompt }); this.prompt = undefined; } });
    view.onDidDispose(() => { if (this.view === view) this.view = undefined; });
    view.webview.html = getTemplateFileContent(['leek-center', 'build', 'index.html'], view.webview)
      .replace(/<script src="https:[^"]+"><\/script>/g, '')
      .replace('</head>', '<script>window.initialRoute="/agent";window.leekAgentStandalone=true;</script></head>');
  }
  async open(prompt?: string) {
    this.prompt = prompt;
    await commands.executeCommand('leekFundView.agent.focus');
    if (this.view && prompt) { void this.view.webview.postMessage({ command: 'agentPrompt', data: prompt }); this.prompt = undefined; }
  }
}
