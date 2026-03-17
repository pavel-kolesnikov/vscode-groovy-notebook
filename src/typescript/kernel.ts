import * as vscode from 'vscode';
import { SessionRegistry } from './session.js';
import { ProcessError } from './process.js';
import { ExecutionResult, Executable } from './types.js';
import { normalizePath } from './pathUtils.js';

export class GroovyKernelController implements vscode.Disposable {
    /** Unique identifier for this notebook controller */
    public static readonly id = 'groovy-shell-kernel';
    /** Notebook type this controller handles */
    public static readonly type = 'groovy-notebook';
    /** Display label shown in VS Code UI */
    public static readonly label = 'Groovy Shell';
    /** Languages supported by this kernel */
    public static readonly supportedLanguages = ['groovy'];
    
    private executionOrder = 0;
    private queue: Promise<void> = Promise.resolve();
    private currentExecution: vscode.NotebookCellExecution | null = null;
    private currentSession: Executable | undefined = undefined;
    
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
        const { execution, session } = await this.setupExecution(cell);

        try {
            const result = await this.runAndGetResult(session, cell.document.getText());
            this.handleOutputs(execution, result);
        } catch (error) {
            this.handleOutputs(execution, null, error);
        } finally {
            this.cleanupExecution(execution);
        }
    }

    private async setupExecution(cell: vscode.NotebookCell): Promise<{ execution: vscode.NotebookCellExecution; session: Executable }> {
        const execution = this.controller.createNotebookCellExecution(cell);
        this.currentExecution = execution;
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());
        execution.clearOutput();

        const cwd = normalizePath(cell.document.uri.path);
        const session = this.registry.getOrCreate(cell.notebook.uri, cwd);
        this.currentSession = session;

        return { execution, session };
    }

    private async runAndGetResult(session: Executable, code: string): Promise<ExecutionResult> {
        return await session.run(code);
    }

    private appendOutput(execution: vscode.NotebookCellExecution, ...items: vscode.NotebookCellOutputItem[]): void {
        execution.appendOutput([new vscode.NotebookCellOutput(items)]);
    }

    private handleError(execution: vscode.NotebookCellExecution, error: unknown): void {
        const processError = error as ProcessError;
        const message = processError.message || 'Unknown error';

        if (processError.stdout?.trim()) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stdout(processError.stdout));
        }

        this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(processError.stderr || message));
        execution.end(false, Date.now());
    }

    private handleSuccess(execution: vscode.NotebookCellExecution, result: ExecutionResult): void {
        if (result.stderr?.trim()) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stderr(result.stderr));
        }

        if (result.stdout?.trim()) {
            this.appendOutput(execution, vscode.NotebookCellOutputItem.stdout(result.stdout));
        }

        execution.end(true, Date.now());
    }

    private handleOutputs(execution: vscode.NotebookCellExecution, result: ExecutionResult | null, error?: unknown): void {
        if (!this.isCurrentExecution(execution)) return;

        if (error) {
            this.handleError(execution, error);
        } else if (result) {
            this.handleSuccess(execution, result);
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
