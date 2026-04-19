import * as vscode from 'vscode';
import { SessionRegistry, GroovySession } from './session.js';
import { ProcessError } from './process.js';
import { ExecutionResult, Executable } from './types.js';
import { normalizePath } from './pathUtils.js';

/**
 * Detects if text looks like an HTML fragment: starts with `<tag>`, ends with `</tag>`.
 * Matches patterns like `<div>...</div>`, `<table class="x">...</table>`, etc.
 */
function looksLikeHtml(text: string): boolean {
    const trimmed = text.trim();
    return trimmed.length > 0
        && trimmed.startsWith('<')
        && trimmed.endsWith('>')
        && /^<[a-zA-Z][\w:-]*(\s[^>]*)?>[\s\S]*<\/[a-zA-Z][\w:-]*>$/.test(trimmed);
}

function createStdoutItem(text: string): vscode.NotebookCellOutputItem {
    if (looksLikeHtml(text)) {
        return vscode.NotebookCellOutputItem.text(text, 'text/html');
    }
    return vscode.NotebookCellOutputItem.stdout(text);
}

export class GroovyKernelController implements vscode.Disposable {
    /** Unique identifier for this notebook controller */
    public static readonly id = 'groovy-shell-kernel';
    /** Notebook type this controller handles */
    public static readonly type = 'groovy-notebook';
    /** Display label shown in VS Code UI */
    public static readonly label = 'Groovy Shell';
    /** Languages supported by this kernel */
    public static readonly supportedLanguages = ['groovy'];
    
    private readonly executionOrders = new Map<string, number>();
    private queue: Promise<void> = Promise.resolve();
    private currentExecution: vscode.NotebookCellExecution | null = null;
    private currentSession: Executable | undefined = undefined;
    private readonly statusSubscription: vscode.Disposable;
    
    private readonly controller: vscode.NotebookController;
    
    /**
     * Creates a new Groovy kernel controller.
     * @param registry - Session registry to manage Groovy process instances
     */
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

        this.statusSubscription = registry.onDidRestart((uri) => {
            this.executionOrders.delete(uri.toString());
        });
    }
    
    public dispose(): void {
        this.statusSubscription.dispose();
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
        let execution: vscode.NotebookCellExecution | null = null;

        try {
            const setup = await this.setupExecution(cell);
            execution = setup.execution;
            const session = setup.session;

            let streamedOutput = '';
            let streamed = false;

            const onOutput = (chunk: string) => {
                streamed = true;
                streamedOutput += chunk;
                execution!.replaceOutput([
                    new vscode.NotebookCellOutput([
                        createStdoutItem(streamedOutput)
                    ])
                ]);
            };

            const result = await session.run(cell.document.getText(), onOutput);
            this.handleOutputs(execution, result, streamed);
        } catch (error) {
            if (execution) {
                this.handleOutputs(execution, null, false, error);
            }
        } finally {
            if (execution) {
                this.cleanupExecution(execution);
            }
        }
    }

    private async setupExecution(cell: vscode.NotebookCell): Promise<{ execution: vscode.NotebookCellExecution; session: Executable }> {
        if (this.currentExecution) {
            this.currentExecution.end(false, Date.now());
        }

        const execution = this.controller.createNotebookCellExecution(cell);
        this.currentExecution = execution;
        const notebookKey = cell.notebook.uri.toString();
        const nextOrder = (this.executionOrders.get(notebookKey) ?? 0) + 1;
        this.executionOrders.set(notebookKey, nextOrder);
        execution.executionOrder = nextOrder;
        execution.start(Date.now());
        execution.clearOutput();

        const cwd = normalizePath(cell.document.uri.path);
        const session = this.registry.getOrCreate(cell.notebook.uri, cwd);
        this.currentSession = session;

        return { execution, session };
    }

    private appendOutput(execution: vscode.NotebookCellExecution, ...items: vscode.NotebookCellOutputItem[]): void {
        execution.appendOutput([new vscode.NotebookCellOutput(items)]);
    }

    private handleError(execution: vscode.NotebookCellExecution, error: unknown, streamed: boolean): void {
        const processError = error as ProcessError;
        const message = processError.message || 'Unknown error';

        if (!streamed && processError.stdout?.trim()) {
            this.appendOutput(execution, createStdoutItem(processError.stdout));
        }

        this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(processError.stderr || message));
        execution.end(false, Date.now());
    }

    private handleSuccess(execution: vscode.NotebookCellExecution, result: ExecutionResult, streamed: boolean): void {
        if (result.stderr?.trim()) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(result.stderr));
        }
        if (!streamed && result.stdout?.trim()) {
            this.appendOutput(execution, createStdoutItem(result.stdout));
        }
        execution.end(true, Date.now());
    }

    private handleOutputs(execution: vscode.NotebookCellExecution, result: ExecutionResult | null, streamed: boolean, error?: unknown): void {
        if (!this.isCurrentExecution(execution)) return;

        if (error) {
            const session = this.currentSession as GroovySession | undefined;
            if (session?.wasInterrupted()) {
                this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr('Execution interrupted'));
                execution.end(false, Date.now());
            } else {
                this.handleError(execution, error, streamed);
            }
        } else if (result) {
            this.handleSuccess(execution, result, streamed);
        }
    }

    private cleanupExecution(execution: vscode.NotebookCellExecution): void {
        if (this.currentExecution === execution) {
            this.currentExecution = null;
            this.currentSession = undefined;
        }
    }

    private isCurrentExecution(execution: vscode.NotebookCellExecution): boolean {
        return this.currentExecution === execution;
    }
}
