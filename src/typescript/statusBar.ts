import * as vscode from 'vscode';
import { SessionRegistry, SessionStatus } from './session';

export class KernelStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private currentNotebookUri: vscode.Uri | null = null;
    
    constructor(private readonly registry: SessionRegistry) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'groovy-notebook.showKernelCommands';
        this.item.tooltip = 'Groovy Kernel Status';
        
        this.registry.onDidChangeStatus(({ uri, status }) => {
            if (this.currentNotebookUri?.toString() === uri.toString()) {
                this.updateDisplay(status);
            }
        });
        
        vscode.window.onDidChangeActiveNotebookEditor((editor) => {
            if (editor) {
                this.currentNotebookUri = editor.notebook.uri;
                const session = this.registry.get(editor.notebook.uri);
                this.updateDisplay(session?.getStatus() ?? 'idle');
                this.item.show();
            } else {
                this.currentNotebookUri = null;
                this.item.hide();
            }
        });
        
        const activeEditor = vscode.window.activeNotebookEditor;
        if (activeEditor) {
            this.currentNotebookUri = activeEditor.notebook.uri;
            const session = this.registry.get(activeEditor.notebook.uri);
            this.updateDisplay(session?.getStatus() ?? 'idle');
            this.item.show();
        }
    }
    
    private updateDisplay(status: SessionStatus): void {
        const config: Record<SessionStatus, { icon: string; text: string }> = {
            idle: { icon: '$(circle-outline)', text: 'Groovy' },
            busy: { icon: '$(sync~spin)', text: 'Groovy' },
            error: { icon: '$(error)', text: 'Groovy (Error)' },
            terminated: { icon: '$(circle-slash)', text: 'Groovy (Stopped)' }
        };
        
        const { icon, text } = config[status] ?? config.idle;
        this.item.text = `${icon} ${text}`;
    }
    
    public dispose(): void {
        this.item.dispose();
    }
}

export function registerKernelCommands(
    context: vscode.ExtensionContext,
    registry: SessionRegistry
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('groovy-notebook.showKernelCommands', async () => {
            const items = [
                { label: '$(refresh) Restart Kernel', action: 'restart' },
                { label: '$(debug-stop) Terminate Kernel', action: 'terminate' }
            ];
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Groovy Kernel Commands'
            });
            
            if (selected && vscode.window.activeNotebookEditor) {
                const uri = vscode.window.activeNotebookEditor.notebook.uri;
                
                switch (selected.action) {
                    case 'restart':
                        await registry.restart(uri);
                        vscode.window.showInformationMessage('Groovy kernel restarted');
                        break;
                    case 'terminate':
                        await registry.terminate(uri);
                        vscode.window.showInformationMessage('Groovy kernel terminated');
                        break;
                }
            }
        }),
        
        vscode.commands.registerCommand('groovy-notebook.restartKernel', async () => {
            if (vscode.window.activeNotebookEditor) {
                await registry.restart(vscode.window.activeNotebookEditor.notebook.uri);
            }
        }),
        
        vscode.commands.registerCommand('groovy-notebook.terminateKernel', async () => {
            if (vscode.window.activeNotebookEditor) {
                await registry.terminate(vscode.window.activeNotebookEditor.notebook.uri);
            }
        })
    );
}
