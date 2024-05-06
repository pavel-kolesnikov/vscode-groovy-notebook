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

export class GroovyKernel {
	public static readonly id = 'groovy-shell-kernel';
	public static readonly type = 'groovy-notebook';
	public static readonly label = 'Groovy Shell';
	public static readonly supportedLanguages = ['groovy'];

	private _executionOrder = 0;
	private readonly _controller: vscode.NotebookController;

	private _process: ChildProcess | null = null;
	private _inProgress: boolean = false;

	private static readonly END_OF_TRANSMISSION = String.fromCharCode(4);
	
	public readonly groovyEvaluatorPath: string;

	constructor(groovyEvaluatorPath: string) {
		this._controller = vscode.notebooks.createNotebookController(GroovyKernel.id, GroovyKernel.type, GroovyKernel.label);
		this._controller.supportedLanguages = GroovyKernel.supportedLanguages;
		this._controller.supportsExecutionOrder = true;
		this._controller.executeHandler = this._executeAll.bind(this);
		this._controller.interruptHandler = this._killProcess.bind(this);
		this.groovyEvaluatorPath = groovyEvaluatorPath;
	}

	dispose(): void {
		this._controller.dispose();
		if (this._process) {
			this._process.kill();
		}
	}

	private _killProcess() {
		this._process?.kill();
		this._process && this._eval(this._process, "System.exit(1)");
		this._process = null;
	}

	private _executeAll(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): void {
		// HACK: to serialize execution of the cells
		let p = Promise.resolve();
		for (const cell of cells) {
			p = p.then(() => this._doExecution(cell));
		}
		// HACK:end
	}

	private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
		const execution = this._controller.createNotebookCellExecution(cell);
		execution.executionOrder = ++this._executionOrder;

		try {
			execution.start(Date.now());
			await execution.clearOutput();

			if (this._process == null || this._process.pid == undefined) {
				await execution.appendOutput([new vscode.NotebookCellOutput([
					vscode.NotebookCellOutputItem.text("Spawning new GroovyShell...")
				])]);
				this._process = await this._spawn();
			}

			const code = cell.document.getText();
			const result = await this._eval(this._process, code);
			if (result.outputItem.data.length > 0) {
				execution.appendOutput([new vscode.NotebookCellOutput([result.outputItem])]);
			}
			execution.end(result.success, Date.now());
		} catch (err) {
			console.log(err);
			this._killProcess();
			execution.appendOutput([new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.stderr(err as string)
			])]);
			execution.end(false, Date.now());
		}
	}

	private async _eval(groovyshProcess: ChildProcess, code: string): Promise<EvalResult> {
		code = code.trim();
		if (code.length == 0) return Promise.reject("Empty input");

		return new Promise((resolve, reject) => {
			// we setup listeners first, then call the evaluation

			groovyshProcess.removeAllListeners();

			groovyshProcess.once('error', reject);
			groovyshProcess.once('close', (code: number) => {
				reject(new Error(`Groovy process exited with code ${code}.`));
			});

			let stderr = "";
			groovyshProcess.stderr?.removeAllListeners();
			groovyshProcess.stderr?.on('data', (data: Buffer | string) => {
				const s = data.toString();
				console.log(`stderr: '${s}'`);
				stderr += s;
				if (s.includes(GroovyKernel.END_OF_TRANSMISSION)) {
					stderr = stderr.trim().replace(GroovyKernel.END_OF_TRANSMISSION,'');
					resolve(new EvalResult(false, vscode.NotebookCellOutputItem.stderr(stderr)));
				}
			});

			let stdout = "";
			groovyshProcess.stdout?.removeAllListeners();
			groovyshProcess.stdout?.on('data', (data: Buffer | string) => {
				const s = data.toString();
				console.log(`stdout: '${s}'`);
				stdout += s;
				if (s.includes(GroovyKernel.END_OF_TRANSMISSION)) {
					stdout = stdout.trim().replace(GroovyKernel.END_OF_TRANSMISSION,'');
					resolve(new EvalResult(true, vscode.NotebookCellOutputItem.stdout(stdout)));
				}
			});

			console.log(`sending: '''${code}'''`);
			groovyshProcess.stdin?.write(code + GroovyKernel.END_OF_TRANSMISSION);
		});
	}

	private async _spawn(): Promise<ChildProcess> {
		// see https://nodejs.org/api/child_process.html#child-process

		const cmd = `groovy "${this.groovyEvaluatorPath}"`;
		console.log(`Spawning: '$cmd'`);
		const p = spawn(cmd, { shell: true });
		console.log("pid:", p.pid);
		return Promise.resolve(p);
	}
}
