import * as vscode from 'vscode';
import { ExecutionQueue } from './executionQueue.js';
import { normalizePath } from './pathUtils.js';
import type { ProcessError } from './process.js';
import type { GroovySession, SessionRegistry } from './session.js';
import type { ExecutionResult } from './types.js';

function looksLikeHtml(text: string): boolean {
    const t = text.trim();
    return (
        t.length > 0 &&
        t.startsWith('<') &&
        t.endsWith('>') &&
        /^<[a-zA-Z][\w:-]*(\s[^>]*)?>[\s\S]*<\/[a-zA-Z][\w:-]*>$/.test(t)
    );
}
function createStdoutItem(text: string): vscode.NotebookCellOutputItem {
    return looksLikeHtml(text)
        ? vscode.NotebookCellOutputItem.text(text, 'text/html')
        : vscode.NotebookCellOutputItem.stdout(text);
}

export class GroovyKernelController implements vscode.Disposable {
    public static readonly id = 'groovy-shell-kernel';
    public static readonly type = 'groovy-notebook';
    public static readonly label = 'Groovy Shell';
    public static readonly supportedLanguages = ['groovy'];
    private readonly executionOrders = new Map<string, number>();
    private readonly queues = new Map<
        string,
        ExecutionQueue<vscode.NotebookCell>
    >();
    private readonly active = new Map<
        string,
        {
            execution: vscode.NotebookCellExecution;
            session: GroovySession;
            stopped: boolean;
        }
    >();
    private readonly statusSubscription: vscode.Disposable;
    private readonly controller: vscode.NotebookController;

    constructor(private readonly registry: SessionRegistry) {
        this.controller = vscode.notebooks.createNotebookController(
            GroovyKernelController.id,
            GroovyKernelController.type,
            GroovyKernelController.label,
        );
        this.controller.supportedLanguages =
            GroovyKernelController.supportedLanguages;
        this.controller.supportsExecutionOrder = true;
        this.controller.interruptHandler = this.interrupt.bind(this);
        this.controller.executeHandler = this.execute.bind(this);
        this.statusSubscription = registry.onDidRestart((uri) =>
            this.executionOrders.delete(uri.toString()),
        );
    }
    public dispose(): void {
        for (const q of this.queues.values()) q.clearPending();
        this.queues.clear();
        this.active.clear();
        this.statusSubscription.dispose();
        this.controller.dispose();
    }
    public discardQueue(uri: vscode.Uri, reason: string): void {
        this.queueFor(uri).discardPending(reason);
        const a = this.active.get(uri.toString());
        if (a && !a.stopped) {
            a.stopped = true;
            a.session.interrupt();
        }
    }
    public disposeQueue(uri: vscode.Uri): void {
        const k = uri.toString();
        this.queues.get(k)?.clearPending();
        this.queues.delete(k);
        this.executionOrders.delete(k);
    }
    private interrupt(notebook: vscode.NotebookDocument): void {
        this.discardQueue(notebook.uri, 'execution stopped');
    }
    private execute(
        cells: vscode.NotebookCell[],
        notebook: vscode.NotebookDocument,
    ): void {
        this.queueFor(notebook.uri).enqueue(...cells);
    }
    private queueFor(uri: vscode.Uri): ExecutionQueue<vscode.NotebookCell> {
        const k = uri.toString();
        let q = this.queues.get(k);
        if (!q) {
            q = new ExecutionQueue(
                (c) => this.executeCell(c),
                (c, reason) => this.discardCell(c, reason ?? 'kernel stopped'),
            );
            this.queues.set(k, q);
        }
        return q;
    }
    private discardCell(cell: vscode.NotebookCell, reason: string): void {
        const e = this.controller.createNotebookCellExecution(cell);
        e.start(Date.now());
        e.appendOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.stderr(`Skipped: ${reason}`),
            ]),
        ]);
        e.end(false, Date.now());
    }
    private async executeCell(cell: vscode.NotebookCell): Promise<void> {
        const key = cell.notebook.uri.toString();
        let execution: vscode.NotebookCellExecution | undefined;
        let streamed = false;
        try {
            const setup = this.setupExecution(cell);
            execution = setup.execution;
            let output = '';
            const onOutput = (chunk: string) => {
                streamed = true;
                output += chunk;
                execution?.replaceOutput([
                    new vscode.NotebookCellOutput([createStdoutItem(output)]),
                ]);
            };
            const result = await setup.session.run(
                cell.document.getText(),
                onOutput,
            );
            const active = this.active.get(key);
            if (active?.stopped) {
                this.appendOutput(
                    execution,
                    vscode.NotebookCellOutputItem.stderr(
                        'Execution interrupted',
                    ),
                );
                execution.end(false, Date.now());
            } else this.handleSuccess(execution, result, streamed);
        } catch (error) {
            if (execution) this.handleError(execution, error, streamed);
            throw error;
        } finally {
            if (this.active.get(key)?.execution === execution)
                this.active.delete(key);
        }
    }
    private setupExecution(cell: vscode.NotebookCell): {
        execution: vscode.NotebookCellExecution;
        session: GroovySession;
    } {
        const e = this.controller.createNotebookCellExecution(cell);
        const k = cell.notebook.uri.toString();
        e.executionOrder = (this.executionOrders.get(k) ?? 0) + 1;
        this.executionOrders.set(k, e.executionOrder);
        e.start(Date.now());
        e.clearOutput();
        const s = this.registry.getOrCreate(
            cell.notebook.uri,
            normalizePath(cell.document.uri.path),
        );
        this.active.set(k, { execution: e, session: s, stopped: false });
        return { execution: e, session: s };
    }
    private appendOutput(
        e: vscode.NotebookCellExecution,
        ...items: vscode.NotebookCellOutputItem[]
    ): void {
        e.appendOutput([new vscode.NotebookCellOutput(items)]);
    }
    private handleError(
        e: vscode.NotebookCellExecution,
        error: unknown,
        streamed: boolean,
    ): void {
        const p = error as ProcessError;
        if (!streamed && p.stdout?.trim())
            this.appendOutput(e, createStdoutItem(p.stdout));
        this.appendOutput(
            e,
            vscode.NotebookCellOutputItem.stderr(
                p.stderr || p.message || 'Unknown error',
            ),
        );
        e.end(false, Date.now());
    }
    private handleSuccess(
        e: vscode.NotebookCellExecution,
        r: ExecutionResult,
        streamed: boolean,
    ): void {
        if (r.stderr?.trim())
            this.appendOutput(
                e,
                vscode.NotebookCellOutputItem.stderr(r.stderr),
            );
        if (!streamed && r.stdout?.trim())
            this.appendOutput(e, createStdoutItem(r.stdout));
        e.end(true, Date.now());
    }
}
