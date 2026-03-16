import assert from 'assert';
import { validateGroovyPath, validateJavaHome } from '../typescript/configValidation.js';

describe('configValidation.ts', () => {
    describe('validateGroovyPath', () => {
        it('should validate a simple path', () => {
            const result = validateGroovyPath('groovy');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should validate an absolute path', () => {
            const result = validateGroovyPath('/usr/bin/groovy');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should validate a Windows path', () => {
            const result = validateGroovyPath('C:\\groovy\\bin\\groovy.bat');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should reject empty string', () => {
            const result = validateGroovyPath('');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.message, 'Groovy path cannot be empty');
        });

        it('should reject whitespace-only string', () => {
            const result = validateGroovyPath('   ');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.message, 'Groovy path cannot be empty');
        });

        it('should reject null character in path', () => {
            const result = validateGroovyPath('/path/to\0groovy');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.message, 'Groovy path contains invalid null character');
        });
    });

    describe('validateJavaHome', () => {
        it('should accept undefined (optional setting)', () => {
            const result = validateJavaHome(undefined);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should accept empty string (not configured)', () => {
            const result = validateJavaHome('');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should validate a valid java home path', () => {
            const result = validateJavaHome('/usr/lib/jvm/java-11');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should validate a Windows java home path', () => {
            const result = validateJavaHome('C:\\Program Files\\Java\\jdk-11');
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.message, '');
        });

        it('should reject whitespace-only string', () => {
            const result = validateJavaHome('   ');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.message, 'Java home cannot be whitespace only');
        });

        it('should reject null character in path', () => {
            const result = validateJavaHome('/path/to\0java');
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.message, 'Java home contains invalid null character');
        });
    });
});
