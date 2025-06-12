import * as vscode from 'vscode';
import { GroovyKernel } from './controller';
import { GroovyContentSerializer } from './serializer';
import * as path from 'path';

async function makeSampleNotebook() {
	const type = GroovyKernel.type;
	const language = GroovyKernel.supportedLanguages[0];
	const cell = (code: string) => new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, language);
	const data = new vscode.NotebookData([
		cell("a = 1"),
		cell("b = 2"),
		cell("println a+b"),
	]);
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

async function exportAsGroovy(notebook: vscode.NotebookDocument) {
	const codeCells = notebook.getCells().filter(cell => cell.kind === vscode.NotebookCellKind.Code);
	const code = codeCells.map(cell => cell.document.getText()).join('\n\n');
	
	const defaultUri = vscode.Uri.file(path.join(
		path.dirname(notebook.uri.fsPath),
		path.basename(notebook.uri.fsPath, '.groovynb') + '.groovy'
	));
	
	const uri = await vscode.window.showSaveDialog({
		defaultUri,
		filters: {
			'Groovy Files': ['groovy']
		}
	});
	
	if (uri) {
		await vscode.workspace.fs.writeFile(uri, Buffer.from(code));
		vscode.window.showInformationMessage(`Exported notebook to ${uri.fsPath}`);
	}
}

export function activate(context: vscode.ExtensionContext) {
	try {
		const groovyEvaluatorScriptPath = context.asAbsolutePath("src/groovy/Eval.groovy");
		const kernel = new GroovyKernel(groovyEvaluatorScriptPath);
		context.subscriptions.push(
			vscode.commands.registerCommand('groovy-notebook.createSampleNotebook', makeSampleNotebook),
			vscode.commands.registerCommand('groovy-notebook.terminateKernel', () => kernel.terminate()),
			vscode.commands.registerCommand('groovy-notebook.exportAsGroovy', () => {
				const notebook = vscode.window.activeNotebookEditor?.notebook;
				if (notebook) {
					exportAsGroovy(notebook);
				}
			}),
			vscode.workspace.registerNotebookSerializer(GroovyKernel.type, new GroovyContentSerializer(), { transientOutputs: true }),
			kernel
		);
	} catch (e) {
		vscode.window.showErrorMessage(String(e));
	}
}
