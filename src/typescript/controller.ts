import * as vscode from 'vscode';
import { ChildProcess, exec, spawn as spawn } from 'child_process';

class EvalResult {
	readonly outputItem: vscode.NotebookCellOutputItem
	readonly success: boolean

	constructor(success: boolean, outputItem: vscode.NotebookCellOutputItem) {
		this.outputItem = outputItem;
		this.success = success;
	}
}

class ContextManager {
	private readonly processes: Map<string, ChildProcess> = new Map();

	public dispose() {
		this.processes.forEach(p => p.kill());
	}

	public get(key: string, cmd: string, cwd: string): ChildProcess {
		let p = this.processes.get(key);
		
		if (!p) {
			p = spawn(cmd, { shell: true, cwd: cwd });
			this.processes.set(key, p);
		}
		
		return p;
	}
}

export class GroovyKernel {
	public static readonly id = 'groovy-shell-kernel';
	public static readonly type = 'groovy-notebook';
	public static readonly label = 'Groovy Shell';
	public static readonly supportedLanguages = ['groovy'];

	private static readonly END_OF_TRANSMISSION = String.fromCharCode(4);
	
	private executionOrder = 0;
	private queue: Promise<void> = Promise.resolve();
	
	private readonly contextManager: ContextManager = new ContextManager();
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

	dispose(): void {
		this.controller.dispose();
		this.contextManager.dispose();
	}

	private interruptHandler() {
		this.contextManager.dispose();
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
		this.queue = this.queue.then(() => this.execute(cell));
	}

	private async execute(cell: vscode.NotebookCell): Promise<void> {
		const execution = this.controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++this.executionOrder;

		try {
			execution.start(Date.now());
			await execution.clearOutput();
			
			const code = cell.document.getText();
			const ctxId = cell.document.uri.path;
			const cmd = `groovy "${this.groovyEvaluatorPath}"`;

			// On Windows the path will be `/c:/.....` and on UNIX `//home/...`
			// We do not need this starting `/`, take from 1 till last / (exclusive), where the file name begins.
			const cwd = cell.document.uri.path.substring(1, cell.document.uri.path.lastIndexOf("/"));

			const groovyProcess = this.contextManager.get(ctxId, cmd, cwd);
			const result = await this.communicate(groovyProcess, code);

			if (result.outputItem.data.length > 0) {
				execution.appendOutput([new vscode.NotebookCellOutput([result.outputItem])]);
			}

			execution.end(result.success, Date.now());
		} catch (err) {
			this.interruptHandler();
			execution.appendOutput([new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.stderr(err as string)
			])]);
			execution.end(false, Date.now());
		}
	}

	private async communicate(groovyshProcess: ChildProcess, code: string): Promise<EvalResult> {
		groovyshProcess.removeAllListeners();
		groovyshProcess.stdout?.removeAllListeners();
		groovyshProcess.stderr?.removeAllListeners();

		return new Promise((resolve, reject) => {
			// we setup listeners first, then call the evaluation

			groovyshProcess.once('error', reject);
			groovyshProcess.once('close', (code: number) => {
				groovyshProcess.stderr?.
					map(x => x.toString()).
					toArray().then(chunks => {
						const err = chunks.join("");
						reject(new Error(err + `\n\nGroovy process exited with code ${code}.`));
					});
			});

			let stderr = "";
			groovyshProcess.stderr?.on('data', (data: Buffer | string) => {
				const s = data.toString();

				stderr += s;
				if (s.includes(GroovyKernel.END_OF_TRANSMISSION)) {
					stderr = stderr.trim().replace(GroovyKernel.END_OF_TRANSMISSION, '');
					resolve(new EvalResult(false, vscode.NotebookCellOutputItem.stderr(stderr)));
				}
			});

			let stdout = "";
			groovyshProcess.stdout?.on('data', (data: Buffer | string) => {
				const s = data.toString();
				stdout += s;
				if (s.includes(GroovyKernel.END_OF_TRANSMISSION)) {
					stdout = stdout.trim().replace(GroovyKernel.END_OF_TRANSMISSION, '');
					resolve(new EvalResult(true, vscode.NotebookCellOutputItem.stdout(stdout)));
				}
			});

			groovyshProcess.stdin?.write(code + GroovyKernel.END_OF_TRANSMISSION);
		});
	}
}
