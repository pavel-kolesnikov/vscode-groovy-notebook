import * as vscode from 'vscode';
import { GroovyKernel } from './controller';
import { GroovyContentSerializer } from './serializer';

async function makeSampleNotebook() {
	const type = GroovyKernel.type;
	const language = GroovyKernel.supportedLanguages[0];
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
		vscode.commands.registerCommand('groovy-notebook.createSampleNotebook', makeSampleNotebook),
		vscode.workspace.registerNotebookSerializer(GroovyKernel.type, new GroovyContentSerializer(), { transientOutputs: true }),
		kernel
	);
}
