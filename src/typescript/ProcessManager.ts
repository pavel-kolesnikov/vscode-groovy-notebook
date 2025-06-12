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
        console.log('[ProcessManager] Starting code execution');
        try {
            this.currentProcess = await this.acquire();
            console.log('[ProcessManager] Process acquired, executing code');
            return await this.executeCode(code);
        } catch (error: unknown) {
            console.error('[ProcessManager] Error during execution:', error);
            throw error;
        } finally {
            if (this.currentProcess) {
                console.log('[ProcessManager] Releasing process');
                await this.release(this.currentProcess);
                this.currentProcess = null;
            }
        }
    }

    public async dispose(): Promise<void> {
        this.isTerminated = true;
        this.isReady = false;
        const disposePromises = this.pool.map(process => this.terminateProcess(process));
        await Promise.all(disposePromises);
        this.pool = [];
        this.processRequestQueue = [];
        if (this.currentProcess) {
            await this.terminateProcess(this.currentProcess);
            this.currentProcess = null;
        }
    }

    private async spawn(): Promise<ChildProcess> {
        console.log('[ProcessManager] Spawning new process');
        return new Promise((resolve, reject) => {
            if (this.isTerminated) {
                console.error('[ProcessManager] Cannot spawn: process manager is terminated');
                reject(new Error('Process manager is terminated'));
                return;
            }

            const process = this.createProcess();
            console.log('[ProcessManager] Process created, waiting for initialization');
            const stdout = process.stdout;
            const stderr = process.stderr;

            if (!stdout) {
                console.error('[ProcessManager] Process stdout is unexpectedly closed');
                this.terminateProcess(process);
                reject(new Error("Process stdout is unexpectedly closed"));
                return;
            }

            const timeoutId = setTimeout(() => {
                console.error('[ProcessManager] Process initialization timeout');
                this.terminateProcess(process);
                reject(new Error('Timeout waiting for process initialization'));
            }, ProcessManager.INITIALIZATION_TIMEOUT);

            const onData = (chunk: Buffer) => {
                const data = chunk.toString();
                console.log('[ProcessManager] Received data:', data);
                if (data.includes(ProcessManager.SIGNAL_READY)) {
                    console.log('[ProcessManager] Process is ready');
                    stdout.removeListener('data', onData);
                    clearTimeout(timeoutId);
                    this.isReady = true;
                    resolve(process);
                }
            };

            const onError = (error: Error) => {
                console.error('[ProcessManager] Process error:', error);
                stdout.removeListener('data', onData);
                clearTimeout(timeoutId);
                this.terminateProcess(process);
                reject(error);
            };

            if (stderr) {
                stderr.on('data', (chunk: Buffer) => {
                    console.error('[ProcessManager] Process stderr:', chunk.toString());
                });
            }

            process.on('error', onError);
            stdout.on('data', onData);
        });
    }

    private async executeCode(code: string): Promise<ProcessResult> {
        console.log('[ProcessManager] Executing code');
        return new Promise((resolve, reject) => {
            if (!this.currentProcess) {
                console.error('[ProcessManager] No process available for execution');
                reject(new Error('No process available'));
                return;
            }

            if (this.isTerminated) {
                console.error('[ProcessManager] Cannot execute: process manager is terminated');
                reject(new Error('Process manager is terminated'));
                return;
            }

            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let exitCode: number | null = null;
            let hasReceivedOutput = false;

            const cleanup = () => {
                console.log('[ProcessManager] Cleaning up process listeners');
                this.currentProcess?.stdout?.removeAllListeners();
                this.currentProcess?.stderr?.removeAllListeners();
                this.currentProcess?.removeAllListeners();
            };

            const onExit = (code: number | null) => {
                console.log('[ProcessManager] Process exited with code:', code);
                exitCode = code;
                cleanup();
                
                // If we haven't received any output and the process exited cleanly,
                // it means we need to restart the process
                if (!hasReceivedOutput && code === 0) {
                    console.log('[ProcessManager] Process exited cleanly without output, will restart');
                    this.currentProcess = null;
                    this.isReady = false;
                    reject(new Error('Process exited cleanly without output'));
                    return;
                }

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
                console.error('[ProcessManager] Process execution error:', error);
                cleanup();
                reject(this.createError(
                    error.message,
                    'PROCESS_ERROR',
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            };

            const onStdout = (chunk: Buffer) => {
                console.log('[ProcessManager] Received stdout chunk');
                hasReceivedOutput = true;
                stdoutChunks.push(chunk);
                if (chunk.includes(ProcessManager.SIGNAL_END_OF_MESSAGE)) {
                    console.log('[ProcessManager] Received end of message signal');
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
                console.log('[ProcessManager] Received stderr chunk:', chunk.toString());
                hasReceivedOutput = true;
                stderrChunks.push(chunk);
            };

            const timeout = setTimeout(() => {
                console.error('[ProcessManager] Execution timeout');
                cleanup();
                reject(this.createError(
                    'Execution timeout',
                    'EXECUTION_TIMEOUT',
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            }, ProcessManager.EXECUTION_TIMEOUT);

            this.currentProcess.on('exit', onExit);
            this.currentProcess.on('error', onError);
            this.currentProcess.stdout?.on('data', onStdout);
            this.currentProcess.stderr?.on('data', onStderr);

            console.log('[ProcessManager] Writing code to process stdin');
            this.currentProcess.stdin?.write(code + ProcessManager.SIGNAL_END_OF_MESSAGE);
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