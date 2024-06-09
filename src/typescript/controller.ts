import * as vscode from 'vscode';
import { GroovyProcess } from './GroovyProcess';

export class GroovyKernel {
	public static readonly id = 'groovy-shell-kernel';
	public static readonly type = 'groovy-notebook';
	public static readonly label = 'Groovy Shell';
	public static readonly supportedLanguages = ['groovy'];

	private static readonly END_OF_TRANSMISSION = String.fromCharCode(4);

	private executionOrder = 0;
	private queue: Promise<void> = Promise.resolve();

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

	terminate() {
		this.groovyProcMan.dispose();
	}

	dispose(): void {
		this.controller.dispose();
		this.groovyProcMan.dispose();
	}

	private interruptHandler() {
		this.groovyProcMan.dispose();
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
		const execution = this.controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++this.executionOrder;

		const cwd = this.noramlizeDocumentPath(cell.document.uri.path);
		const ctxId = cell.document.uri.path;
		const code = cell.document.getText();

		try {
			execution.start(Date.now());
			await execution.clearOutput();

			const groovy = this.groovyProcMan.getOrSpawn(ctxId, this.groovyEvaluatorPath, cwd);
			const result = await groovy.run(code)

			if (result.length > 0) {
				execution.appendOutput([
					new vscode.NotebookCellOutput([
						vscode.NotebookCellOutputItem.stdout(result)
					])
				]);
			}

			execution.end(true, Date.now());
		} catch (err) {
			execution.appendOutput([new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.stderr(err as string)
			])]);
			execution.end(false, Date.now());
		}
	}

	private noramlizeDocumentPath(path: string): string {
		if (process.platform === "win32") {
			// On Windows the path will be `/X:/.....`, remove this leading /
			path = path.replace(/^[/]([a-zA-Z]:[/])/, "$1");
		}

		// taking base path
		path = path.substring(0, path.lastIndexOf('/'));
		return path;
	}
}

class GroovyProcManager {
	private readonly processes: Map<string, GroovyProcess> = new Map();

	public dispose() {
		this.processes.forEach(p => p.terminate());
	}

	public getOrSpawn(key: string, groovyEvaluatorScript: string, cwd: string): GroovyProcess {
		let groovy = this.processes.get(key);
		if (groovy?.proc?.exitCode) {
			console.log(
				"There's a leftover process object ", groovy.proc.pid,
				'for key', key,
				'exit code', groovy.proc.exitCode
			)
			groovy = undefined
		}
		if (!groovy) {
			groovy = new GroovyProcess()
			groovy.useArgs(groovyEvaluatorScript)
			groovy.useCwd(cwd)
			this.processes.set(key, groovy)
		}
		return groovy;
	}
}