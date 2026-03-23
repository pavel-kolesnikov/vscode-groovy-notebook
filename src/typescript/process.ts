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

const LOG_PREFIX = '[GroovyNB]';
const LOG_ENABLED = false;
function log(...args: unknown[]): void {
    if (!LOG_ENABLED) return;
    console.log(LOG_PREFIX, '[Process]', new Date().toISOString().substr(11, 12), ...args);
}

function formatBuffer(buf: Buffer, maxLen = CONFIG.LOG_PREVIEW_LENGTH): string {
    const str = buf.toString();
    const preview = str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
    return JSON.stringify(preview);
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
    private lastActivity: number = 0;
    
    constructor(private readonly config: ProcessConfig) {}
    
    public readonly onDidChangeStatus = this.onStatusChange.event;
    
    public getStatus(): ProcessStatus {
        return this.status;
    }
    
    public isHealthy(): boolean {
        return this.process !== null && this.isProcessAlive();
    }
    
    public async start(): Promise<void> {
        if (this.process && this.isProcessAlive()) {
            return;
        }
        
        this.intentionallyTerminated = false;
        this.process = await this.spawn();
    }
    
    public async run(code: string): Promise<ProcessResult> {
        if (!this.process || !this.isProcessAlive() || !this.isHealthy()) {
            this.process = null;
            await this.start();
        }
        
        this.setStatus('busy');
        this.lastActivity = Date.now();
        
        try {
            const result = await this.executeCode(code);
            this.lastActivity = Date.now();
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
            
            log('Spawning Groovy process:', {
                groovyPath: this.config.groovyPath,
                evalScriptPath: this.config.evalScriptPath,
                cwd: this.config.cwd,
                javaHome: env.JAVA_HOME
            });
            
            const proc = spawn(this.config.groovyPath, [this.config.evalScriptPath], {
                cwd: this.config.cwd,
                env
            });
            
            const stdout = proc.stdout;
            const stderr = proc.stderr;
            
            if (!stdout) {
                log('ERROR: stdout is null immediately after spawn');
                this.killProcess(proc);
                reject(new Error(`Groovy process closed unexpectedly during startup. This may indicate a problem with the Groovy installation or the Groovy Kernel script.`));
                return;
            }
            
            log(`Process spawned with PID: ${proc.pid}`);
            
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                log(`TIMEOUT: No SIGNAL_READY received after ${GroovyProcess.INITIALIZATION_TIMEOUT/1000}s`);
                this.killProcess(proc);
                reject(new Error(`Failed to start Groovy shell after ${GroovyProcess.INITIALIZATION_TIMEOUT/1000}s. Verify Groovy is installed and accessible at '${this.config.groovyPath}'. Run 'groovy --version' in terminal to check.`));
            }, GroovyProcess.INITIALIZATION_TIMEOUT);
            
            let readyReceived = false;
            const onData = (chunk: Buffer) => {
                log('stdout chunk received:', formatBuffer(chunk));
                if (chunk.toString().includes(SIGNAL_READY)) {
                    if (settled) return;
                    readyReceived = true;
                    settled = true;
                    log('SIGNAL_READY received! Process is ready.');
                    stdout.removeListener('data', onData);
                    clearTimeout(timeoutId);
                    resolve(proc);
                }
            };
            
            if (stderr) {
                stderr.on('data', (chunk: Buffer) => {
                    log('stderr chunk:', formatBuffer(chunk));
                });
            }
            
            proc.on('error', (error) => {
                if (settled) return;
                settled = true;
                log('Process error event:', error);
                stdout.removeListener('data', onData);
                clearTimeout(timeoutId);
                reject(error);
            });
            
            proc.on('exit', (code, signal) => {
                log(`Process exit event: code=${code}, signal=${signal}, readyReceived=${readyReceived}`);
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
            
            log('executeCode called, code length:', code.length);
            
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
                log('executeCode: cleaning up listeners');
                proc.stdout?.removeAllListeners();
                proc.stderr?.removeAllListeners();
                proc.removeAllListeners();
            };
            
            const onExit = (code: number | null) => {
                exitCode = code;
                if (settled) return;
                cleanup();
                log('executeCode: process exited during execution, code=', code);
                
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
                log('executeCode: error event:', error);
                reject(this.createError(
                    error.message,
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            };
            
            const onStdout = (chunk: Buffer) => {
                log('executeCode: stdout chunk:', formatBuffer(chunk, CONFIG.LOG_PREVIEW_LONG_LENGTH));
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
                    log('executeCode: SIGNAL_END_OF_MESSAGE received, resolving');
                    const stdout = Buffer.concat(stdoutChunks)
                        .toString()
                        .replace(SIGNAL_END_OF_MESSAGE, '')
                        .trim();
                    const stderr = Buffer.concat(stderrChunks).toString();
                    resolve({ stdout, stderr, exitCode });
                }
            };
            
            const onStderr = (chunk: Buffer) => {
                log('executeCode: stderr chunk:', formatBuffer(chunk, CONFIG.LOG_PREVIEW_LONG_LENGTH));
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
            
            const message = code + SIGNAL_END_OF_MESSAGE;
            log('executeCode: writing to stdin, bytes:', message.length);
            proc.stdin?.write(message);
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
