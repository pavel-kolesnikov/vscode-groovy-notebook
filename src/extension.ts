import * as vscode from 'vscode';
import { GroovyKernel } from './controller';
import { GroovyContentSerializer } from './serializer';

async function makeSampleNotebook(kernel: GroovyKernel) {
	const type = kernel.type;
	const language = kernel.supportedLanguages[0];
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
	const doc = await vscode.workspace.openNotebookDocument(type, data);
	await vscode.window.showNotebookDocument(doc);
}

export function activate(context: vscode.ExtensionContext) {
	const kernel = new GroovyKernel();
	context.subscriptions.push(
		vscode.commands.registerCommand('groovy-notebook.createSampleNotebook', async () => makeSampleNotebook(kernel)),
		vscode.workspace.registerNotebookSerializer(kernel.type, new GroovyContentSerializer(), { transientOutputs: true }),
		kernel
	);
}
