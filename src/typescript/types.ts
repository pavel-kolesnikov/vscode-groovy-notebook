export type ExecutionStatus = 'idle' | 'starting' | 'busy' | 'error' | 'terminated';

export interface ProcessConfig {
    groovyPath: string;
    evalScriptPath: string;
    classpath?: string;
    cwd: string;
    javaHome?: string;
}

export interface ExecutionResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

export interface ExecutionError extends Error {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
}

export interface Executable {
    run(code: string): Promise<ExecutionResult>;
    interrupt(): void;
}
