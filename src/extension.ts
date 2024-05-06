import * as vscode from 'vscode';
import { GroovyKernel } from './controller';
import { GroovyContentSerializer } from './serializer';

const NOTEBOOK_TYPE = 'groovy-notebook-serializer';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(vscode.commands.registerCommand('groovy-notebook.createJsonNotebook', async () => {
		const language = 'groovy';
		const defaultValue = `println "Hello, Groovy"`;
		const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, defaultValue, language);
		const data = new vscode.NotebookData([cell]);
		data.metadata = {
			custom: {
				cells: [],
				metadata: {
					orig_nbformat: 4
				},
				nbformat: 4,
				nbformat_minor: 2
			}
		};
		const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
		await vscode.window.showNotebookDocument(doc);
	}));

	context.subscriptions.push(
		vscode.workspace.registerNotebookSerializer(
			NOTEBOOK_TYPE, new GroovyContentSerializer(), { transientOutputs: true }
		),
		new GroovyKernel()
	);
}
