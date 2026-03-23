import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function initLogger(): vscode.OutputChannel {
    channel = vscode.window.createOutputChannel('Groovy Notebook');
    return channel;
}

export function log(component: string, ...args: unknown[]): void {
    if (!channel) return;
    const timestamp = new Date().toISOString().substring(11, 23);
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');
    channel.appendLine(`${timestamp} [${component}] ${message}`);
}

export function disposeLogger(): void {
    channel?.dispose();
    channel = null;
}
