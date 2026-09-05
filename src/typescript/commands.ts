import * as vscode from 'vscode';
import type { GroovyKernelController } from './kernel.js';
import type { SessionRegistry } from './session.js';

/**
 * Registers VS Code commands for kernel control (restart, terminate).
 * @param context - Extension context to register commands in
 * @param registry - Session registry to manage kernel sessions
 */
export function registerKernelCommands(
    context: vscode.ExtensionContext,
    registry: SessionRegistry,
    kernel: GroovyKernelController,
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'groovy-notebook.showKernelCommands',
            async () => {
                const items = [
                    { label: '$(refresh) Restart Kernel', action: 'restart' },
                    {
                        label: '$(debug-stop) Terminate Kernel',
                        action: 'terminate',
                    },
                ];

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Groovy Kernel Commands',
                });

                if (selected && vscode.window.activeNotebookEditor) {
                    const uri = vscode.window.activeNotebookEditor.notebook.uri;

                    switch (selected.action) {
                        case 'restart':
                            kernel.discardQueue(uri, 'kernel restarted');
                            await registry.restart(uri);
                            vscode.window.showInformationMessage(
                                'Groovy kernel restarted',
                            );
                            break;
                        case 'terminate':
                            kernel.discardQueue(uri, 'kernel terminated');
                            await registry.terminate(uri);
                            vscode.window.showInformationMessage(
                                'Groovy kernel terminated',
                            );
                            break;
                    }
                }
            },
        ),

        vscode.commands.registerCommand(
            'groovy-notebook.restartKernel',
            async () => {
                if (vscode.window.activeNotebookEditor) {
                    const uri = vscode.window.activeNotebookEditor.notebook.uri;
                    kernel.discardQueue(uri, 'kernel restarted');
                    await registry.restart(uri);
                }
            },
        ),

        vscode.commands.registerCommand(
            'groovy-notebook.terminateKernel',
            async () => {
                if (vscode.window.activeNotebookEditor) {
                    const uri = vscode.window.activeNotebookEditor.notebook.uri;
                    kernel.discardQueue(uri, 'kernel terminated');
                    await registry.terminate(uri);
                }
            },
        ),
    );
}
