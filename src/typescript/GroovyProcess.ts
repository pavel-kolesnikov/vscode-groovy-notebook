import { ProcessManager, ProcessResult, ProcessError, ProcessConfig } from './ProcessManager';
import * as vscode from 'vscode';

export { ProcessResult, ProcessError };

/**
 * A class that manages the execution of Groovy code through a child process.
 * Provides methods to run Groovy code and handle process lifecycle.
 */
export class GroovyProcess {
    private processManager: ProcessManager;

    constructor() {
        const cmd = this.findGroovyPath();
        const config: ProcessConfig = {
            cmd,
            args: [vscode.workspace.getConfiguration('groovyNotebook').get('groovyPath', 'groovy')],
            cwd: ''
        };
        this.processManager = new ProcessManager(config);
    }

    /**
     * Sets a custom path to the Groovy binary
     */
    public useCmd(pathToBinary: string): void {
        this.processManager = new ProcessManager({
            ...this.processManager['config'],
            cmd: pathToBinary
        });
    }

    /**
     * Sets custom arguments for the Groovy process
     */
    public useArgs(...args: string[]): void {
        this.processManager = new ProcessManager({
            ...this.processManager['config'],
            args
        });
    }

    /**
     * Sets the working directory for the Groovy process
     */
    public useCwd(cwd: string): void {
        this.processManager = new ProcessManager({
            ...this.processManager['config'],
            cwd
        });
    }

    /**
     * Terminates the current Groovy process if it's running
     */
    public async terminate(): Promise<void> {
        await this.processManager.dispose();
    }

    /**
     * Runs the provided Groovy code and returns the execution result
     */
    public async run(code: string): Promise<ProcessResult> {
        return this.processManager.run(code);
    }

    public interrupt(): void {
        this.processManager.emit('interrupt');
    }

    private findGroovyPath(): string {
        return vscode.workspace.getConfiguration('groovyNotebook').get('groovyPath', 'groovy');
    }
}