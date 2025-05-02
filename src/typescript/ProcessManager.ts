import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export interface ProcessConfig {
    cmd: string;
    args: string[];
    cwd: string;
}

interface ProcessRequestQueueItem {
    resolve: (process: ChildProcess) => void;
    reject: (error: Error) => void;
}

export interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

export interface ProcessError extends Error {
    code?: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
}

export class ProcessManager extends EventEmitter {
    private static readonly MAX_POOL_SIZE = 3;
    private static readonly INITIALIZATION_TIMEOUT = 10_000; // 10 seconds
    private static readonly PROCESS_IDLE_TIMEOUT = 5 * 60_000; // 5 minutes
    private static readonly EXECUTION_TIMEOUT = 10 * 60_000; // 10 minutes
    private static readonly SIGNAL_END_OF_MESSAGE = String.fromCharCode(3);
    private static readonly SIGNAL_READY = String.fromCharCode(6);

    private pool: ChildProcess[] = [];
    private processRequestQueue: ProcessRequestQueueItem[] = [];
    private config: ProcessConfig;
    private isReady: boolean = false;
    private isTerminated: boolean = false;
    private lastActivityTime: number = Date.now();
    private idleTimeout: NodeJS.Timeout | null = null;
    private currentProcess: ChildProcess | null = null;

    constructor(config: ProcessConfig) {
        super();
        this.config = config;
    }

    public async acquire(): Promise<ChildProcess> {
        if (this.pool.length > 0) {
            return this.pool.pop()!;
        }

        if (this.pool.length < ProcessManager.MAX_POOL_SIZE) {
            return this.spawn();
        }

        return new Promise((resolve, reject) => {
            this.processRequestQueue.push({ resolve, reject });
        });
    }

    public async release(process: ChildProcess): Promise<void> {
        if (this.processRequestQueue.length > 0) {
            const { resolve } = this.processRequestQueue.shift()!;
            resolve(process);
        } else if (this.pool.length < ProcessManager.MAX_POOL_SIZE) {
            this.pool.push(process);
        } else {
            await this.terminateProcess(process);
        }
    }

    public async run(code: string): Promise<ProcessResult> {
        try {
            this.currentProcess = await this.acquire();
            return await this.executeCode(code);
        } finally {
            if (this.currentProcess) {
                await this.release(this.currentProcess);
                this.currentProcess = null;
            }
        }
    }

    public async dispose(): Promise<void> {
        const disposePromises = this.pool.map(process => this.terminateProcess(process));
        await Promise.all(disposePromises);
        this.pool = [];
        this.processRequestQueue = [];
    }

    private async spawn(): Promise<ChildProcess> {
        return new Promise((resolve, reject) => {
            const process = this.createProcess();
            const stdout = process.stdout;
            const stderr = process.stderr;

            if (!stdout) {
                console.error('Process stdout is unexpectedly closed');
                this.terminateProcess(process);
                reject(new Error("Process stdout is unexpectedly closed"));
                return;
            }

            const timeoutId = setTimeout(() => {
                console.error('Process initialization timeout after', ProcessManager.INITIALIZATION_TIMEOUT, 'ms');
                this.terminateProcess(process);
                reject(new Error('Timeout waiting for process initialization'));
            }, ProcessManager.INITIALIZATION_TIMEOUT);

            const onData = (chunk: Buffer) => {
                const data = chunk.toString();
                if (data.includes(ProcessManager.SIGNAL_READY)) {
                    stdout.removeListener('data', onData);
                    clearTimeout(timeoutId);
                    this.isReady = true;
                    this.updateLastActivity();
                    this.setupIdleTimeout();
                    resolve(process);
                }
            };

            if (stderr) {
                stderr.on('data', (chunk: Buffer) => {
                    console.error('Process stderr:', chunk.toString());
                });
            }

            stdout.on('data', onData);
        });
    }

    private async executeCode(code: string): Promise<ProcessResult> {
        return new Promise((resolve, reject) => {
            if (!this.currentProcess) {
                reject(new Error('No process available'));
                return;
            }

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let exitCode: number | null = null;

            const cleanup = () => {
                this.currentProcess?.stdout?.removeAllListeners();
                this.currentProcess?.stderr?.removeAllListeners();
                this.currentProcess?.removeAllListeners();
            };

            const onExit = (code: number | null) => {
                exitCode = code;
                cleanup();
                if (code !== null && code !== 0) {
                    const error = this.createError(
                        `Process exited with code ${code}`,
                        'PROCESS_EXIT',
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString(),
                        code
                    );
                    reject(error);
                }
            };

            const onError = (error: Error) => {
                cleanup();
                reject(this.createError(
                    error.message,
                    'PROCESS_ERROR',
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            };

            const onStdout = (chunk: Buffer) => {
                stdoutChunks.push(chunk);
                if (chunk.includes(ProcessManager.SIGNAL_END_OF_MESSAGE)) {
                    cleanup();
                    const stdout = Buffer.concat(stdoutChunks)
                        .toString()
                        .trim()
                        .replace(ProcessManager.SIGNAL_END_OF_MESSAGE, '');
                    const stderr = Buffer.concat(stderrChunks).toString();
                    resolve({ stdout, stderr, exitCode: exitCode || 0 });
                }
            };

            const onStderr = (chunk: Buffer) => {
                stderrChunks.push(chunk);
            };

            const timeout = setTimeout(() => {
                cleanup();
                reject(this.createError(
                    'Execution timeout',
                    'EXECUTION_TIMEOUT',
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            }, ProcessManager.EXECUTION_TIMEOUT);

            this.currentProcess.once('exit', onExit);
            this.currentProcess.once('error', onError);
            this.currentProcess.stdout?.on('data', onStdout);
            this.currentProcess.stderr?.on('data', onStderr);

            this.currentProcess.stdin?.write(code + ProcessManager.SIGNAL_END_OF_MESSAGE, (error) => {
                if (error) {
                    clearTimeout(timeout);
                    cleanup();
                    reject(this.createError(
                        `Failed to write to stdin: ${error.message}`,
                        'STDIN_ERROR'
                    ));
                }
            });
        });
    }

    private createProcess(): ChildProcess {
        const config = vscode.workspace.getConfiguration('groovyNotebook');
        const javaHome = config.get<string>('javaHome') || process.env.JAVA_HOME;
        
        const env = {
            ...process.env,
            JAVA_HOME: javaHome
        };
        
        return spawn(this.config.cmd, this.config.args, {
            cwd: this.config.cwd,
            env: env
        });
    }

    private async terminateProcess(process: ChildProcess): Promise<void> {
        return new Promise((resolve) => {
            if (!process) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                process.kill('SIGKILL');
                resolve();
            }, 5000);

            process.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });

            process.kill('SIGTERM');
        });
    }

    private updateLastActivity(): void {
        this.lastActivityTime = Date.now();
        this.setupIdleTimeout();
    }

    private setupIdleTimeout(): void {
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
        }

        this.idleTimeout = setTimeout(async () => {
            if (Date.now() - this.lastActivityTime >= ProcessManager.PROCESS_IDLE_TIMEOUT) {
                await this.dispose();
            }
        }, ProcessManager.PROCESS_IDLE_TIMEOUT);
    }

    private createError(
        message: string,
        code: string,
        stdout?: string,
        stderr?: string,
        exitCode?: number | null
    ): ProcessError {
        const error = new Error(message) as ProcessError;
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = exitCode;
        return error;
    }
} 