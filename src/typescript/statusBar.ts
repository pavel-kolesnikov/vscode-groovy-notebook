import * as vscode from 'vscode';
import { SessionRegistry } from './session.js';
import { ExecutionStatus } from './types.js';

export class KernelStatusBar implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;
    private readonly disposables: vscode.Disposable[] = [];
    private currentNotebookUri: vscode.Uri | null = null;
    
    constructor(private readonly registry: SessionRegistry) {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.item.command = 'groovy-notebook.showKernelCommands';
        this.item.tooltip = 'Groovy Kernel Status';
        
        this.disposables.push(
            this.registry.onDidChangeStatus(({ uri, status }: { uri: vscode.Uri; status: ExecutionStatus }) => {
                if (this.currentNotebookUri?.toString() === uri.toString()) {
                    this.updateDisplay(status);
                }
            })
        );
        
        this.disposables.push(
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
            })
        );
        
        const activeEditor = vscode.window.activeNotebookEditor;
        if (activeEditor) {
            this.currentNotebookUri = activeEditor.notebook.uri;
            const session = this.registry.get(activeEditor.notebook.uri);
            this.updateDisplay(session?.getStatus() ?? 'idle');
            this.item.show();
        }
    }
    
    private updateDisplay(status: ExecutionStatus): void {
        const config: Record<ExecutionStatus, { icon: string; text: string }> = {
            idle: { icon: '$(circle-outline)', text: 'Groovy' },
            starting: { icon: '$(sync)', text: 'Groovy (Starting...)' },
            busy: { icon: '$(sync~spin)', text: 'Groovy' },
            error: { icon: '$(error)', text: 'Groovy (Error)' },
            terminated: { icon: '$(circle-slash)', text: 'Groovy (Stopped)' }
        };
        
        const { icon, text } = config[status] ?? config.idle;
        this.item.text = `${icon} ${text}`;
    }
    
    public dispose(): void {
        this.item.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }
}
