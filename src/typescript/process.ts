import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import { CONFIG } from './config.js';
import { SIGNAL_READY, SIGNAL_END_OF_MESSAGE } from './protocol.js';
import { ExecutionStatus, ExecutionResult, ExecutionError, ProcessConfig } from './types.js';

export type ProcessResult = ExecutionResult;
export type ProcessStatus = ExecutionStatus;

export interface ProcessError extends ExecutionError {
    code?: string;
}

/**
 * Wrapper around the Groovy subprocess that handles spawning,
 * code execution, and process lifecycle.
 */
export class GroovyProcess {
    private static readonly INITIALIZATION_TIMEOUT = CONFIG.TIMEOUT_SPAWN_MS;
    private static readonly TERMINATION_TIMEOUT = CONFIG.TIMEOUT_THREAD_JOIN_MS;
    private static readonly MAX_BUFFER_SIZE = CONFIG.MAX_BUFFER_SIZE;

    private process: ChildProcess | null = null;
    private status: ProcessStatus = 'idle';
    private readonly onStatusChange = new vscode.EventEmitter<ProcessStatus>();
    private intentionallyTerminated = false;
    
    constructor(private readonly config: ProcessConfig) {}
    
    public readonly onDidChangeStatus = this.onStatusChange.event;
    
    public getStatus(): ProcessStatus {
        return this.status;
    }
    
    public async start(): Promise<void> {
        if (this.process && this.isProcessAlive()) {
            return;
        }
        
        this.intentionallyTerminated = false;
        this.process = await this.spawn();
    }
    
    public async run(code: string): Promise<ProcessResult> {
        if (!this.process || !this.isProcessAlive()) {
            this.process = null;
            await this.start();
        }
        
        this.setStatus('busy');
        
        try {
            const result = await this.executeCode(code);
            this.setStatus('idle');
            return result;
        } catch (error) {
            this.setStatus('error');
            throw error;
        }
    }
    
    public async terminate(): Promise<void> {
        if (!this.process) {
            return;
        }
        
        this.intentionallyTerminated = true;
        const proc = this.process;
        this.process = null;
        
        await this.killProcess(proc);
        this.setStatus('terminated');
    }
    
    public interrupt(): void {
        if (this.process) {
            this.process.kill('SIGINT');
        }
    }
    
    private isProcessAlive(): boolean {
        if (!this.process) {
            return false;
        }
        try {
            this.process.pid && process.kill(this.process.pid, 0);
            return true;
        } catch {
            return false;
        }
    }
    
    private setStatus(status: ProcessStatus): void {
        if (this.status !== status) {
            this.status = status;
            this.onStatusChange.fire(status);
        }
    }
    
    private spawn(): Promise<ChildProcess> {
        return new Promise((resolve, reject) => {
            let settled = false;
            
            const env = {
                ...process.env,
                JAVA_HOME: this.config.javaHome || process.env.JAVA_HOME
            };
            
            const proc = spawn(this.config.groovyPath, [this.config.evalScriptPath], {
                cwd: this.config.cwd,
                env
            });
            
            const stdout = proc.stdout;
            
            if (!stdout) {
                this.killProcess(proc);
                reject(new Error(`Groovy process closed unexpectedly during startup. This may indicate a problem with the Groovy installation or the Eval.groovy script.`));
                return;
            }
            
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.killProcess(proc);
                reject(new Error(`Failed to start Groovy shell after ${GroovyProcess.INITIALIZATION_TIMEOUT/1000}s. Verify Groovy is installed and accessible at '${this.config.groovyPath}'. Run 'groovy --version' in terminal to check.`));
            }, GroovyProcess.INITIALIZATION_TIMEOUT);
            
            const onData = (chunk: Buffer) => {
                if (chunk.toString().includes(SIGNAL_READY)) {
                    if (settled) return;
                    settled = true;
                    stdout.removeListener('data', onData);
                    clearTimeout(timeoutId);
                    resolve(proc);
                }
            };
            
            proc.on('error', (error) => {
                if (settled) return;
                settled = true;
                stdout.removeListener('data', onData);
                clearTimeout(timeoutId);
                reject(error);
            });
            
            stdout.on('data', onData);
        });
    }
    
    private executeCode(code: string): Promise<ProcessResult> {
        return new Promise((resolve, reject) => {
            if (!this.process) {
                reject(new Error('No process available'));
                return;
            }
            
            const proc = this.process;
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let totalBufferSize = 0;
            let exitCode: number | null = null;
            let settled = false;
            
            const checkBufferLimit = (chunk: Buffer): boolean => {
                totalBufferSize += chunk.length;
                if (totalBufferSize > GroovyProcess.MAX_BUFFER_SIZE) {
                    return true;
                }
                return false;
            };
            
            const cleanup = () => {
                if (settled) return;
                settled = true;
                proc.stdout?.removeAllListeners();
                proc.stderr?.removeAllListeners();
                proc.removeAllListeners();
            };
            
            const onExit = (code: number | null) => {
                exitCode = code;
                if (settled) return;
                cleanup();
                
                if (code !== null && code !== 0) {
                    reject(this.createError(
                        `Groovy process exited unexpectedly with code ${code}. Check the output above for error details, or try restarting the kernel.`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString(),
                        code
                    ));
                } else {
                    reject(this.createError(
                        'Groovy process exited unexpectedly before sending response. Try restarting the kernel.',
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString(),
                        code
                    ));
                }
            };
            
            const onError = (error: Error) => {
                if (settled) return;
                cleanup();
                reject(this.createError(
                    error.message,
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            };
            
            const onStdout = (chunk: Buffer) => {
                stdoutChunks.push(chunk);
                if (checkBufferLimit(chunk)) {
                    if (settled) return;
                    cleanup();
                    reject(this.createError(
                        `Output buffer size exceeded limit of ${GroovyProcess.MAX_BUFFER_SIZE} bytes`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString()
                    ));
                    return;
                }
                if (chunk.includes(SIGNAL_END_OF_MESSAGE)) {
                    if (settled) return;
                    cleanup();
                    const stdout = Buffer.concat(stdoutChunks)
                        .toString()
                        .replace(SIGNAL_END_OF_MESSAGE, '')
                        .trim();
                    const stderr = Buffer.concat(stderrChunks).toString();
                    resolve({ stdout, stderr, exitCode });
                }
            };
            
            const onStderr = (chunk: Buffer) => {
                stderrChunks.push(chunk);
                if (checkBufferLimit(chunk)) {
                    if (settled) return;
                    cleanup();
                    reject(this.createError(
                        `Output buffer size exceeded limit of ${GroovyProcess.MAX_BUFFER_SIZE} bytes`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString()
                    ));
                    return;
                }
            };
            
            proc.on('exit', onExit);
            proc.on('error', onError);
            proc.stdout?.on('data', onStdout);
            proc.stderr?.on('data', onStderr);
            
            proc.stdin?.write(code + SIGNAL_END_OF_MESSAGE);
        });
    }
    
    private killProcess(proc: ChildProcess): Promise<void> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                proc.kill('SIGKILL');
                resolve();
            }, GroovyProcess.TERMINATION_TIMEOUT);
            
            proc.once('exit', () => {
                clearTimeout(timeout);
                resolve();
            });
            
            proc.kill('SIGTERM');
        });
    }
    
    private createError(
        message: string,
        stdout?: string,
        stderr?: string,
        exitCode?: number | null
    ): ProcessError {
        const error = new Error(message) as ProcessError;
        error.stdout = stdout;
        error.stderr = stderr;
        error.exitCode = exitCode;
        return error;
    }
}
