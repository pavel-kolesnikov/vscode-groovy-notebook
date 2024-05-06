import * as vscode from 'vscode';

export class GroovyKernel {
	public static readonly id = 'groovy-notebook-serializer-kernel';
	public static readonly type = 'groovy-notebook';
	public static readonly label = 'Groovy Notebook Kernel';
	public static readonly supportedLanguages = ['groovy'];

	private _executionOrder = 0;
	private readonly _controller: vscode.NotebookController;

	constructor() {
		this._controller = vscode.notebooks.createNotebookController(GroovyKernel.id, GroovyKernel.type, GroovyKernel.label);
		this._controller.supportedLanguages = GroovyKernel.supportedLanguages;
		this._controller.supportsExecutionOrder = true;
		this._controller.executeHandler = this._executeAll.bind(this);
	}

	dispose(): void {
		this._controller.dispose();
	}

	private _executeAll(cells: vscode.NotebookCell[], _notebook: vscode.NotebookDocument, _controller: vscode.NotebookController): void {
		for (const cell of cells) {
			this._doExecution(cell);
		}
	}

	private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
		const execution = this._controller.createNotebookCellExecution(cell);

		execution.executionOrder = ++this._executionOrder;
		execution.start(Date.now());

		try {
			execution.replaceOutput([new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.json(JSON.parse(cell.document.getText()))
			])]);

			execution.end(true, Date.now());
		} catch (err) {
			execution.replaceOutput([new vscode.NotebookCellOutput([
				vscode.NotebookCellOutputItem.error(err as Error)
			])]);
			execution.end(false, Date.now());
		}
	}
}
