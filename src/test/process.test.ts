import assert from 'assert';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

interface ProcessError extends Error {
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
}

const SIGNAL_END_OF_MESSAGE = '__END_OF_MESSAGE__';

function createError(
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

function executeCode(proc: ChildProcess, code: string): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        let exitCode: number | null = null;
        let settled = false;
        
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
                reject(createError(
                    `Process exited with code ${code}`,
                    Buffer.concat(stdoutChunks).toString(),
                    Buffer.concat(stderrChunks).toString(),
                    code
                ));
            }
        };
        
        const onError = (error: Error) => {
            if (settled) return;
            cleanup();
            reject(createError(
                error.message,
                Buffer.concat(stdoutChunks).toString(),
                Buffer.concat(stderrChunks).toString()
            ));
        };
        
        const onStdout = (chunk: Buffer) => {
            stdoutChunks.push(chunk);
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
        };
        
        proc.on('exit', onExit);
        proc.on('error', onError);
        proc.stdout?.on('data', onStdout);
        proc.stderr?.on('data', onStderr);
        
        proc.stdin?.write(code + SIGNAL_END_OF_MESSAGE);
    });
}

const SIGNAL_READY = '__READY__';

function spawnProcess(): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        let settled = false;
        
        const proc = spawn('node', ['-e', `
            setTimeout(() => {
                process.stdout.write('__READY__');
            }, Math.random() * 10);
        `]);
        
        const stdout = proc.stdout;
        
        if (!stdout) {
            proc.kill();
            reject(new Error('Process stdout is unexpectedly closed'));
            return;
        }
        
        const timeoutId = setTimeout(() => {
            if (settled) return;
            settled = true;
            proc.kill();
            reject(new Error('Timeout waiting for process initialization'));
        }, 1000);
        
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

describe('spawn race condition', () => {
    it('should resolve only once when ready signal is received', async () => {
        let resolveCount = 0;
        let rejectCount = 0;
        
        const procPromise = spawnProcess();
        
        procPromise.then(
            () => { resolveCount++; },
            () => { rejectCount++; }
        );
        
        const proc = await procPromise;
        
        await new Promise(r => setTimeout(r, 50));
        
        assert.strictEqual(resolveCount, 1, 'Promise should resolve exactly once');
        assert.strictEqual(rejectCount, 0, 'Promise should not reject');
        
        proc.kill();
    });

    it('should handle timeout and ready signal arriving simultaneously', async () => {
        let settled = false;
        let resolveCount = 0;
        let rejectCount = 0;
        
        const procPromise = new Promise<ChildProcess>((resolve, reject) => {
            const proc = spawn('node', ['-e', `
                process.stdout.write('__READY__');
            `]);
            
            const stdout = proc.stdout;
            
            if (!stdout) {
                proc.kill();
                reject(new Error('Process stdout is unexpectedly closed'));
                return;
            }
            
            const timeoutId = setTimeout(() => {
                if (settled) return;
                settled = true;
                proc.kill();
                reject(new Error('Timeout waiting for process initialization'));
            }, 0);
            
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
        
        procPromise.then(
            () => { resolveCount++; },
            () => { rejectCount++; }
        );
        
        await procPromise.catch(() => {});
        
        await new Promise(r => setTimeout(r, 50));
        
        assert.strictEqual(resolveCount + rejectCount, 1, 'Promise should settle exactly once');
    });
});

describe('executeCode race condition', () => {
    it('should resolve when process outputs end-of-message signal and exits cleanly', async () => {
        const proc = spawn('node', ['-e', `
            process.stdin.on('data', (chunk) => {
                const input = chunk.toString();
                if (input.includes('__END_OF_MESSAGE__')) {
                    process.stdout.write('result__END_OF_MESSAGE__');
                    process.exit(0);
                }
            });
        `]);
        
        const result = await executeCode(proc, 'test');
        
        assert.strictEqual(result.stdout, 'result');
        assert.ok(result.exitCode === null || result.exitCode === 0);
    });

    it('should reject when process exits with non-zero code', async () => {
        const proc = spawn('node', ['-e', `
            process.stdin.on('data', () => {
                process.exit(1);
            });
        `]);
        
        await assert.rejects(
            async () => executeCode(proc, 'test'),
            (err: ProcessError) => {
                assert.strictEqual(err.exitCode, 1);
                assert.match(err.message, /exited with code 1/);
                return true;
            }
        );
    });

    it('should handle rapid output and exit without double-settlement', async () => {
        const proc = spawn('node', ['-e', `
            process.stdout.write('fast__END_OF_MESSAGE__');
            process.exit(0);
        `]);
        
        const result = await executeCode(proc, 'test');
        
        assert.strictEqual(result.stdout, 'fast');
        assert.ok(result.exitCode === null || result.exitCode === 0);
    });

    it('should resolve only once even when exit and stdout arrive in quick succession', async () => {
        const proc = spawn('node', ['-e', `
            const signal = '__END_OF_MESSAGE__';
            process.stdout.write('output' + signal);
            process.exit(0);
        `]);
        
        let resolveCount = 0;
        let rejectCount = 0;
        
        const resultPromise = executeCode(proc, 'test');
        
        resultPromise.then(
            () => { resolveCount++; },
            () => { rejectCount++; }
        );
        
        await resultPromise;
        
        await new Promise(r => setTimeout(r, 50));
        
        assert.strictEqual(resolveCount, 1, 'Promise should resolve exactly once');
        assert.strictEqual(rejectCount, 0, 'Promise should not reject');
    });

    it('should not reject after resolve when process exits with code 0', async () => {
        const proc = spawn('node', ['-e', `
            process.stdin.on('data', (chunk) => {
                if (chunk.toString().includes('__END_OF_MESSAGE__')) {
                    process.stdout.write('done__END_OF_MESSAGE__');
                    setTimeout(() => process.exit(0), 10);
                }
            });
        `]);
        
        const result = await executeCode(proc, 'test');
        
        assert.strictEqual(result.stdout, 'done');
        assert.ok(result.exitCode === null || result.exitCode === 0);
        
        await new Promise(r => setTimeout(r, 50));
    });
});

describe('buffer size limit', () => {
    const TEST_MAX_BUFFER_SIZE = 1024;

    function executeCodeWithLimit(proc: ChildProcess, code: string): Promise<ProcessResult> {
        return new Promise((resolve, reject) => {
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            let totalBufferSize = 0;
            let exitCode: number | null = null;
            let settled = false;
            
            const checkBufferLimit = (chunk: Buffer): boolean => {
                totalBufferSize += chunk.length;
                return totalBufferSize > TEST_MAX_BUFFER_SIZE;
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
                    reject(createError(
                        `Process exited with code ${code}`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString(),
                        code
                    ));
                }
            };
            
            const onError = (error: Error) => {
                if (settled) return;
                cleanup();
                reject(createError(
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
                    reject(createError(
                        `Output buffer size exceeded limit of ${TEST_MAX_BUFFER_SIZE} bytes`,
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
                    reject(createError(
                        `Output buffer size exceeded limit of ${TEST_MAX_BUFFER_SIZE} bytes`,
                        Buffer.concat(stdoutChunks).toString(),
                        Buffer.concat(stderrChunks).toString()
                    ));
                }
            };
            
            proc.on('exit', onExit);
            proc.on('error', onError);
            proc.stdout?.on('data', onStdout);
            proc.stderr?.on('data', onStderr);
            
            proc.stdin?.write(code + SIGNAL_END_OF_MESSAGE);
        });
    }

    it('should reject when output exceeds buffer size limit', async () => {
        const proc = spawn('node', ['-e', `
            process.stdout.write('x'.repeat(2048));
            process.stdout.write('__END_OF_MESSAGE__');
        `]);
        
        await assert.rejects(
            async () => executeCodeWithLimit(proc, 'test'),
            (err: ProcessError) => {
                assert.match(err.message, /buffer size exceeded limit/);
                return true;
            }
        );
    });

    it('should allow output within buffer size limit', async () => {
        const proc = spawn('node', ['-e', `
            process.stdout.write('x'.repeat(512) + '__END_OF_MESSAGE__');
        `]);
        
        const result = await executeCodeWithLimit(proc, 'test');
        
        assert.strictEqual(result.stdout.length, 512);
    });
});
