import * as vscode from 'vscode';
import { SessionRegistry } from './session';
import { ProcessError } from './process';

export class GroovyKernelController implements vscode.Disposable {
    public static readonly id = 'groovy-shell-kernel';
    public static readonly type = 'groovy-notebook';
    public static readonly label = 'Groovy Shell';
    public static readonly supportedLanguages = ['groovy'];
    
    private executionOrder = 0;
    private queue: Promise<void> = Promise.resolve();
    private currentExecution: vscode.NotebookCellExecution | null = null;
    private currentSession: ReturnType<SessionRegistry['get']> = undefined;
    
    private readonly controller: vscode.NotebookController;
    
    constructor(private readonly registry: SessionRegistry) {
        this.controller = vscode.notebooks.createNotebookController(
            GroovyKernelController.id,
            GroovyKernelController.type,
            GroovyKernelController.label
        );
        
        this.controller.supportedLanguages = GroovyKernelController.supportedLanguages;
        this.controller.supportsExecutionOrder = true;
        this.controller.interruptHandler = this.interrupt.bind(this);
        this.controller.executeHandler = this.execute.bind(this);
    }
    
    public dispose(): void {
        this.controller.dispose();
    }
    
    private interrupt(): void {
        if (this.currentExecution) {
            this.currentSession?.interrupt();
            this.currentExecution.end(false, Date.now());
            this.currentExecution = null;
        }
    }
    
    private execute(cells: vscode.NotebookCell[]): void {
        for (const cell of cells) {
            this.queue = this.queue.then(() => this.executeCell(cell));
        }
    }
    
    private async executeCell(cell: vscode.NotebookCell): Promise<void> {
        if (this.currentExecution) {
            this.currentExecution.end(false, Date.now());
        }
        
        const execution = this.controller.createNotebookCellExecution(cell);
        this.currentExecution = execution;
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());
        execution.clearOutput();
        
        const cwd = this.normalizePath(cell.document.uri.path);
        const session = this.registry.getOrCreate(cell.notebook.uri, cwd);
        this.currentSession = session;
        
        try {
            const result = await session.run(cell.document.getText());
            
            if (this.currentExecution === execution) {
                if (result.stderr?.trim()) {
                    execution.appendOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stderr(result.stderr)
                        ])
                    ]);
                }
                
                if (result.stdout?.trim()) {
                    execution.appendOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stdout(result.stdout)
                        ])
                    ]);
                }
                
                execution.end(true, Date.now());
            }
        } catch (error) {
            if (this.currentExecution === execution) {
                const processError = error as ProcessError;
                const message = processError.message || 'Unknown error';
                
                if (processError.stdout?.trim()) {
                    execution.appendOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.stdout(processError.stdout)
                        ])
                    ]);
                }
                
                execution.appendOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.stderr(processError.stderr || message)
                    ])
                ]);
                
                execution.end(false, Date.now());
            }
        } finally {
            if (this.currentExecution === execution) {
                this.currentExecution = null;
                this.currentSession = undefined;
            }
        }
    }
    
    private normalizePath(path: string): string {
        if (process.platform === 'win32') {
            path = path.replace(/^[/]([a-zA-Z]:[/])/, '$1');
        }
        return path.substring(0, path.lastIndexOf('/'));
    }
}
