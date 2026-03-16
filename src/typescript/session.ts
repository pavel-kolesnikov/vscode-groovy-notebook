import * as vscode from 'vscode';
import { GroovyProcess, ProcessResult } from './process.js';
import { ExecutionStatus, ExecutionResult, Executable, ProcessConfig } from './types.js';

export type SessionStatus = ExecutionStatus;

export class GroovySession implements vscode.Disposable, Executable {
    private process: GroovyProcess | null = null;
    private processStatusSubscription: vscode.Disposable | null = null;
    private status: SessionStatus = 'idle';
    private readonly onStatusChange = new vscode.EventEmitter<SessionStatus>();
    private disposed = false;
    
    constructor(
        public readonly notebookUri: vscode.Uri,
        private readonly config: ProcessConfig
    ) {}
    
    public readonly onDidChangeStatus = this.onStatusChange.event;
    
    public getStatus(): SessionStatus {
        return this.status;
    }
    
    public async ensureStarted(): Promise<void> {
        if (this.disposed) {
            throw new Error('Session has been disposed');
        }
        
        if (!this.process) {
            this.process = await this.createProcess();
        }
    }
    
    public async run(code: string): Promise<ProcessResult> {
        if (!this.process) {
            this.setStatus('starting');
        }
        
        await this.ensureStarted();
        
        this.setStatus('busy');
        
        try {
            const result = await this.process!.run(code);
            this.setStatus('idle');
            return result;
        } catch (error) {
            this.setStatus('error');
            throw error;
        }
    }
    
    public async restart(): Promise<void> {
        if (this.process) {
            await this.process.terminate();
            this.process = null;
        }
        
        this.processStatusSubscription?.dispose();
        this.processStatusSubscription = null;
        
        this.setStatus('idle');
    }
    
    public async terminate(): Promise<void> {
        if (this.process) {
            await this.process.terminate();
            this.process = null;
        }
        
        this.setStatus('terminated');
    }
    
    public interrupt(): void {
        this.process?.interrupt();
    }
    
    public dispose(): void {
        if (this.disposed) {
            return;
        }
        
        this.disposed = true;
        this.terminate().catch(console.error);
        this.processStatusSubscription?.dispose();
        this.processStatusSubscription = null;
        this.onStatusChange.dispose();
    }
    
    private setStatus(status: SessionStatus): void {
        if (this.status !== status) {
            this.status = status;
            this.onStatusChange.fire(status);
        }
    }
    
    private async createProcess(): Promise<GroovyProcess> {
        const proc = new GroovyProcess(this.config);
        
        this.processStatusSubscription = proc.onDidChangeStatus((status: ExecutionStatus) => {
            if (status === 'error' && this.status !== 'busy') {
                this.setStatus('error');
            }
        });
        
        await proc.start();
        return proc;
    }
}

export class SessionRegistry implements vscode.Disposable {
    private readonly sessions = new Map<string, GroovySession>();
    private readonly sessionSubscriptions = new Map<string, vscode.Disposable>();
    private readonly onDidChangeSessionStatus = new vscode.EventEmitter<{ uri: vscode.Uri; status: SessionStatus }>();
    
    constructor(private readonly baseConfig: Omit<ProcessConfig, 'cwd'>) {}
    
    public readonly onDidChangeStatus = this.onDidChangeSessionStatus.event;
    
    public get(uri: vscode.Uri): GroovySession | undefined {
        return this.sessions.get(uri.toString());
    }
    
    public getOrCreate(uri: vscode.Uri, cwd: string): GroovySession {
        const key = uri.toString();
        let session = this.sessions.get(key);
        
        if (!session) {
            const config: ProcessConfig = {
                ...this.baseConfig,
                cwd
            };
            session = new GroovySession(uri, config);
            
            const subscription = session.onDidChangeStatus((status) => {
                this.onDidChangeSessionStatus.fire({ uri, status });
            });
            this.sessionSubscriptions.set(key, subscription);
            
            this.sessions.set(key, session);
        }
        
        return session;
    }
    
    public async terminate(uri: vscode.Uri): Promise<void> {
        const session = this.sessions.get(uri.toString());
        if (session) {
            await session.terminate();
        }
    }
    
    public async restart(uri: vscode.Uri): Promise<void> {
        const session = this.sessions.get(uri.toString());
        if (session) {
            await session.restart();
        }
    }
    
    public dispose(): void {
        for (const subscription of this.sessionSubscriptions.values()) {
            subscription.dispose();
        }
        this.sessionSubscriptions.clear();
        for (const session of this.sessions.values()) {
            session.dispose();
        }
        this.sessions.clear();
        this.onDidChangeSessionStatus.dispose();
    }
}
