import * as vscode from 'vscode';
import { GroovyKernel } from './controller';
import { GroovyContentSerializer } from './serializer';

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

export function activate(context: vscode.ExtensionContext) {
	try {
		const groovyEvaluatorScriptPath = context.asAbsolutePath("src/groovy/Eval.groovy");
		const kernel = new GroovyKernel(groovyEvaluatorScriptPath);
		context.subscriptions.push(
			vscode.commands.registerCommand('groovy-notebook.createSampleNotebook', makeSampleNotebook),
			vscode.commands.registerCommand('groovy-notebook.terminateKernel', () => kernel.terminate()),
			vscode.workspace.registerNotebookSerializer(GroovyKernel.type, new GroovyContentSerializer(), { transientOutputs: true }),
			kernel
		);
	} catch (e) {
		vscode.window.showErrorMessage(String(e));
	}
}
