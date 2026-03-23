import * as vscode from 'vscode';
import * as path from 'path';
import { GroovyKernelController } from './kernel.js';
import { SessionRegistry } from './session.js';
import { GroovyContentSerializer } from './serializer.js';
import { KernelStatusBar } from './statusBar.js';
import { registerKernelCommands } from './commands.js';
import { getGroovyPath } from './config.js';
import { ProcessConfig } from './types.js';
import { initLogger } from './logger.js';

async function makeSampleNotebook() {
    const type = GroovyKernelController.type;
    const language = GroovyKernelController.supportedLanguages[0];
    const cell = (code: string) => new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, language);
    const data = new vscode.NotebookData([
        cell("a = 1"),
        cell("b = 2"),
        cell("println a+b"),
    ]);
    data.metadata = {
        custom: {
            cells: [],
            metadata: { orig_nbformat: 4 },
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
        filters: { 'Groovy Files': ['groovy'] }
    });
    
    if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(code));
        vscode.window.showInformationMessage(`Exported notebook to ${uri.fsPath}`);
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        const logChannel = initLogger();
        
        const evalScriptPath = context.asAbsolutePath("src/groovy/Kernel.groovy");
        const groovyPath = getGroovyPath();
        
        const baseConfig: Omit<ProcessConfig, 'cwd'> = {
            groovyPath,
            evalScriptPath
        };
        
        const registry = new SessionRegistry(baseConfig);
        const kernel = new GroovyKernelController(registry);
        const statusBar = new KernelStatusBar(registry);
        
        registerKernelCommands(context, registry);
        
        context.subscriptions.push(
            logChannel,
            vscode.commands.registerCommand('groovy-notebook.createSampleNotebook', makeSampleNotebook),
            vscode.commands.registerCommand('groovy-notebook.exportAsGroovy', () => {
                const notebook = vscode.window.activeNotebookEditor?.notebook;
                if (notebook) {
                    exportAsGroovy(notebook);
                }
            }),
            vscode.workspace.registerNotebookSerializer(
                GroovyKernelController.type,
                new GroovyContentSerializer(),
                { transientOutputs: false }
            ),
            kernel,
            registry,
            statusBar
        );
    } catch (e) {
        vscode.window.showErrorMessage(String(e));
    }
}
