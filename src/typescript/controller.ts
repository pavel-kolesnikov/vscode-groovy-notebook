import * as vscode from 'vscode';
import { GroovyProcess, ProcessError, ProcessResult } from './GroovyProcess';

export class GroovyKernel {
	public static readonly id = 'groovy-shell-kernel';
	public static readonly type = 'groovy-notebook';
	public static readonly label = 'Groovy Shell';
	public static readonly supportedLanguages = ['groovy'];

	private executionOrder = 0;
	private queue: Promise<void> = Promise.resolve();
	private currentCellExecution: vscode.NotebookCellExecution | null = null;
	private currentGroovyProcess: GroovyProcess | null = null;

	private readonly groovyProcMan: GroovyProcManager = new GroovyProcManager();
	private readonly controller: vscode.NotebookController;
	private readonly groovyEvaluatorPath: string;

	constructor(groovyEvaluatorPath: string) {
		this.controller = vscode.notebooks.createNotebookController(
			GroovyKernel.id,
			GroovyKernel.type,
			GroovyKernel.label
		);

		this.controller.supportedLanguages = GroovyKernel.supportedLanguages;
		this.controller.supportsExecutionOrder = true;
		this.controller.interruptHandler = this.interruptHandler.bind(this);
		this.controller.executeHandler = this.executeHandler.bind(this);

		this.groovyEvaluatorPath = groovyEvaluatorPath;
	}

	public async terminate(): Promise<void> {
		await this.groovyProcMan.dispose();
	}

	public dispose(): void {
		this.controller.dispose();
		this.terminate().catch(error => {
			console.error('Error during disposal:', error);
		});
	}

	private async interruptHandler(): Promise<void> {
		if (this.currentCellExecution) {
			// First interrupt the Groovy process
			if (this.currentGroovyProcess) {
				this.currentGroovyProcess.interrupt();
				this.currentGroovyProcess = null;
			}
			// Then end the execution
			this.currentCellExecution.end(false, Date.now());
			this.currentCellExecution = null;
		}
	}

	private executeHandler(
		cells: vscode.NotebookCell[],
		_notebook: vscode.NotebookDocument,
		_controller: vscode.NotebookController
	): void {
		for (const cell of cells) {
			this.enqueue(cell);
		}
	}

	private enqueue(cell: vscode.NotebookCell) {
		// TRICK: force cells execution order one after another.
		this.queue = this.queue.then(() => this.execute(cell));
	}

	private async execute(cell: vscode.NotebookCell): Promise<void> {
		// If there's already an execution in progress, end it first
		if (this.currentCellExecution) {
			this.currentCellExecution.end(false, Date.now());
			this.currentCellExecution = null;
		}

		// Create new execution and set it as current
		const execution = this.controller.createNotebookCellExecution(cell);
		this.currentCellExecution = execution;
		execution.executionOrder = ++this.executionOrder;

		const cwd = this.normalizeDocumentPath(cell.document.uri.path);
		const ctxId = cell.document.uri.path;
		const code = cell.document.getText();

		try {
			// Start execution and clear output
			execution.start(Date.now());
			execution.clearOutput();

			// Get or spawn Groovy process
			const groovy = this.groovyProcMan.getOrSpawn(ctxId, this.groovyEvaluatorPath, cwd);
			this.currentGroovyProcess = groovy;

			// Run the code
			const result = await groovy.run(code);

			// Check if execution was interrupted before appending output
			if (this.currentCellExecution === execution) {
				if (result.stderr && result.stderr.trim().length > 0) {
					execution.appendOutput([
						new vscode.NotebookCellOutput([
							vscode.NotebookCellOutputItem.stderr(result.stderr)
						])
					]);
				}

				if (result.stdout && result.stdout.trim().length > 0) {
					execution.appendOutput([
						new vscode.NotebookCellOutput([
							vscode.NotebookCellOutputItem.stdout(result.stdout)
						])
					]);
				}

				execution.end(true, Date.now());
			}
		} catch (error) {
			console.error('Error during execution:', error);
			// Check if execution was interrupted before appending output
			if (this.currentCellExecution === execution) {
				const processError = error as ProcessError;
				const errorMessage = processError.message || 'Unknown error occurred';
				const stderr = processError.stderr || '';
				const stdout = processError.stdout || '';

				if (stdout && stdout.trim().length > 0) {
					execution.appendOutput([
						new vscode.NotebookCellOutput([
							vscode.NotebookCellOutputItem.stdout(stdout)
						])
					]);
				}

				execution.appendOutput([
					new vscode.NotebookCellOutput([
						vscode.NotebookCellOutputItem.stderr(stderr || errorMessage)
					])
				]);

				execution.end(false, Date.now());
			}
		} finally {
			// Only clear current execution if it's the same one we started
			if (this.currentCellExecution === execution) {
				this.currentCellExecution = null;
			}
			if (this.currentGroovyProcess) {
				this.currentGroovyProcess = null;
			}
		}
	}

	private normalizeDocumentPath(path: string): string {
		if (process.platform === "win32") {
			// On Windows the path will be `/X:/.....`, remove this leading /
			path = path.replace(/^[/]([a-zA-Z]:[/])/, "$1");
		}
		return path.substring(0, path.lastIndexOf('/'));
	}
}

class GroovyProcManager {
	private readonly processes: Map<string, GroovyProcess> = new Map();
	private readonly processPool: GroovyProcess[] = [];
	private readonly processQueue: Array<{
		resolve: (process: GroovyProcess) => void;
		reject: (error: Error) => void;
	}> = [];

	public async dispose(): Promise<void> {
		const disposePromises = Array.from(this.processes.values()).map(process => process.terminate());
		await Promise.all(disposePromises);
		this.processes.clear();
		this.processPool.length = 0;
		this.processQueue.length = 0;
	}

	public getOrSpawn(key: string, groovyEvaluatorScript: string, cwd: string): GroovyProcess {
		let groovy = this.processes.get(key);
		
		if (!groovy) {
			if (this.processPool.length > 0) {
				groovy = this.processPool.pop()!;
				groovy.useArgs(groovyEvaluatorScript);
				groovy.useCwd(cwd);
			} else {
				groovy = new GroovyProcess();
				groovy.useArgs(groovyEvaluatorScript);
				groovy.useCwd(cwd);
			}
			this.processes.set(key, groovy);
		}

		return groovy;
	}

	private async returnToPool(process: GroovyProcess): Promise<void> {
		if (this.processQueue.length > 0) {
			const { resolve } = this.processQueue.shift()!;
			resolve(process);
		} else if (this.processPool.length < 3) { // Using fixed pool size
			this.processPool.push(process);
		} else {
			await process.terminate();
		}
	}

	private async acquireProcess(groovyEvaluatorScript: string, cwd: string): Promise<GroovyProcess> {
		if (this.processPool.length > 0) {
			const process = this.processPool.pop()!;
			process.useArgs(groovyEvaluatorScript);
			process.useCwd(cwd);
			return process;
		}

		return new Promise((resolve, reject) => {
			this.processQueue.push({ resolve, reject });
		});
	}
}