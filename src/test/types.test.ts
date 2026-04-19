import assert from 'assert';
import type { ExecutionStatus, ExecutionResult, ExecutionError, Executable, ProcessConfig } from '../typescript/types.js';

describe('types.ts interfaces', () => {
    describe('ExecutionStatus', () => {
        it('should be a union type of valid status values', () => {
            const statuses: ExecutionStatus[] = ['idle', 'starting', 'busy', 'error', 'terminated'];
            assert.strictEqual(statuses.length, 5);
        });
    });

    describe('ExecutionResult', () => {
        it('should define a valid result structure', () => {
            const result: ExecutionResult = {
                stdout: 'output',
                stderr: '',
                exitCode: 0
            };
            assert.strictEqual(result.stdout, 'output');
            assert.strictEqual(result.exitCode, 0);
        });

        it('should allow null exitCode', () => {
            const result: ExecutionResult = {
                stdout: '',
                stderr: 'error',
                exitCode: null
            };
            assert.strictEqual(result.exitCode, null);
        });
    });

    describe('ExecutionError', () => {
        it('should extend Error with optional execution properties', () => {
            const error = new Error('test error') as ExecutionError;
            error.stdout = 'output';
            error.stderr = 'error output';
            error.exitCode = 1;

            assert.strictEqual(error.message, 'test error');
            assert.strictEqual(error.stdout, 'output');
            assert.strictEqual(error.stderr, 'error output');
            assert.strictEqual(error.exitCode, 1);
        });

        it('should allow optional properties to be undefined', () => {
            const error = new Error('simple error') as ExecutionError;
            assert.strictEqual(error.stdout, undefined);
            assert.strictEqual(error.stderr, undefined);
            assert.strictEqual(error.exitCode, undefined);
        });
    });

    describe('Executable', () => {
        it('should define run and interrupt methods', () => {
            const executable: Executable = {
                async run(code: string): Promise<ExecutionResult> {
                    return { stdout: code, stderr: '', exitCode: 0 };
                },
                interrupt(): void {}
            };

            assert.strictEqual(typeof executable.run, 'function');
            assert.strictEqual(typeof executable.interrupt, 'function');
        });

        it('should return ExecutionResult from run', async () => {
            const executable: Executable = {
                async run(code: string): Promise<ExecutionResult> {
                    return { stdout: `executed: ${code}`, stderr: '', exitCode: 0 };
                },
                interrupt(): void {}
            };

            const result = await executable.run('test');
            assert.strictEqual(result.stdout, 'executed: test');
            assert.strictEqual(result.exitCode, 0);
        });
    });

    describe('ProcessConfig', () => {
        it('should define required groovyPath, evalScriptPath, and cwd', () => {
            const config: ProcessConfig = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy',
                cwd: '/workspace'
            };
            assert.strictEqual(config.groovyPath, '/usr/bin/groovy');
            assert.strictEqual(config.evalScriptPath, '/path/to/Kernel.groovy');
            assert.strictEqual(config.cwd, '/workspace');
        });

        it('should allow optional javaHome', () => {
            const config: ProcessConfig = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy',
                cwd: '/workspace',
                javaHome: '/usr/lib/jvm/java-11'
            };
            assert.strictEqual(config.javaHome, '/usr/lib/jvm/java-11');
        });

        it('should allow javaHome to be undefined', () => {
            const config: ProcessConfig = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy',
                cwd: '/workspace'
            };
            assert.strictEqual(config.javaHome, undefined);
        });

        it('should support spreading to create derived configs', () => {
            const baseConfig: Omit<ProcessConfig, 'cwd'> = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy'
            };
            
            const fullConfig: ProcessConfig = {
                ...baseConfig,
                cwd: '/workspace'
            };
            
            assert.strictEqual(fullConfig.groovyPath, '/usr/bin/groovy');
            assert.strictEqual(fullConfig.evalScriptPath, '/path/to/Kernel.groovy');
            assert.strictEqual(fullConfig.cwd, '/workspace');
        });

        it('should preserve javaHome when spreading', () => {
            const baseConfig: Omit<ProcessConfig, 'cwd'> = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy',
                javaHome: '/usr/lib/jvm/java-11'
            };
            
            const fullConfig: ProcessConfig = {
                ...baseConfig,
                cwd: '/workspace'
            };
            
            assert.strictEqual(fullConfig.javaHome, '/usr/lib/jvm/java-11');
        });

        it('should allow optional classpath', () => {
            const config: ProcessConfig = {
                groovyPath: '/usr/bin/groovy',
                evalScriptPath: '/path/to/Kernel.groovy',
                classpath: '/path/to/kernel-helpers.jar',
                cwd: '/workspace'
            };
            assert.strictEqual(config.classpath, '/path/to/kernel-helpers.jar');
        });
    });
});
