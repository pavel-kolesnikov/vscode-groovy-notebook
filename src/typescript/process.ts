import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';

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

export type ProcessStatus = 'idle' | 'busy' | 'error' | 'terminated';

export class GroovyProcess {
    private static readonly INITIALIZATION_TIMEOUT = 10_000;
    private static readonly TERMINATION_TIMEOUT = 5_000;
    private static readonly SIGNAL_END_OF_MESSAGE = '\x03';
    private static readonly SIGNAL_READY = '\x06';

    private process: ChildProcess | null = null;
    private status: ProcessStatus = 'idle';
    private readonly onStatusChange = new vscode.EventEmitter<ProcessStatus>();
    private intentionallyTerminated = false;
    
    constructor(
        private readonly groovyPath: string,
        private readonly evalScriptPath: string,
        private readonly cwd: string,
        private readonly javaHome?: string
    ) {}
    
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
            const env = {
                ...process.env,
                JAVA_HOME: this.javaHome || process.env.JAVA_HOME
            };
            
            const proc = spawn(this.groovyPath, [this.evalScriptPath], {
                cwd: this.cwd,
                env
            });
            
            const stdout = proc.stdout;
            
            if (!stdout) {
                this.killProcess(proc);
                reject(new Error('Process stdout is unexpectedly closed'));
                return;
            }
            
            const timeoutId = setTimeout(() => {
                this.killProcess(proc);
                reject(new Error('Timeout waiting for process initialization'));
            }, GroovyProcess.INITIALIZATION_TIMEOUT);
            
            const onData = (chunk: Buffer) => {
                if (chunk.toString().includes(GroovyProcess.SIGNAL_READY)) {
                    stdout.removeListener('data', onData);
                    clearTimeout(timeoutId);
                    resolve(proc);
                }
            };
            
            proc.on('error', (error) => {
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
            let exitCode: number | null = null;
            
            const cleanup = () => {
                proc.stdout?.removeAllListeners();
                proc.stderr?.removeAllListeners();
                proc.removeAllListeners();
            };
            
            const onExit = (code: number | null) => {
                exitCode = code;
                cleanup();
                
                if (code !== null && code !== 0) {
                    reject(this.createError(
                        `Process exited with code ${code}`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString(),
                        code
                    ));
                }
            };
            
            const onError = (error: Error) => {
                cleanup();
                reject(this.createError(
                    error.message,
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString()
                ));
            };
            
            const onStdout = (chunk: Buffer) => {
                stdoutChunks.push(chunk);
                if (chunk.includes(GroovyProcess.SIGNAL_END_OF_MESSAGE)) {
                    cleanup();
                    const stdout = Buffer.concat(stdoutChunks)
                        .toString()
                        .replace(GroovyProcess.SIGNAL_END_OF_MESSAGE, '')
                        .trim();
                    const stderr = Buffer.concat(stderrChunks).toString();
                    resolve({ stdout, stderr, exitCode });
                }
            };
            
            const onStderr = (chunk: Buffer) => {
                stderrChunks.push(chunk);
            };
            
            proc.on('exit', onExit);
            proc.on('error', onError);
            proc.stdout?.on('data', onStdout);
            proc.stderr?.on('data', onStderr);
            
            proc.stdin?.write(code + GroovyProcess.SIGNAL_END_OF_MESSAGE);
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
