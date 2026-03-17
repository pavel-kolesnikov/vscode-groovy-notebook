import assert from 'assert';
import { normalizePath } from '../typescript/pathUtils.js';

describe('pathUtils.ts', () => {
    describe('normalizePath', () => {
        describe('posix paths', () => {
            const originalPlatform = process.platform;

            beforeEach(() => {
                Object.defineProperty(process, 'platform', { value: 'linux' });
            });

            afterEach(() => {
                Object.defineProperty(process, 'platform', { value: originalPlatform });
            });

            it('should return parent directory for file path', () => {
                assert.strictEqual(normalizePath('/home/user/project/file.groovy'), '/home/user/project');
            });

            it('should return root for path in root', () => {
                assert.strictEqual(normalizePath('/file.groovy'), '');
            });

            it('should return parent for nested directory path', () => {
                assert.strictEqual(normalizePath('/a/b/c/d/file.groovy'), '/a/b/c/d');
            });

            it('should return path as-is when no slash exists', () => {
                assert.strictEqual(normalizePath('nofile'), 'nofile');
            });

            it('should handle relative path with multiple segments', () => {
                assert.strictEqual(normalizePath('src/main/groovy/file.groovy'), 'src/main/groovy');
            });

            it('should handle trailing slash', () => {
                assert.strictEqual(normalizePath('/home/user/dir/'), '/home/user/dir');
            });
        });

        describe('windows paths', () => {
            const originalPlatform = process.platform;

            beforeEach(() => {
                Object.defineProperty(process, 'platform', { value: 'win32' });
            });

            afterEach(() => {
                Object.defineProperty(process, 'platform', { value: originalPlatform });
            });

            it('should convert VSCode URI path to Windows path format', () => {
                assert.strictEqual(normalizePath('/C:/Users/project/file.groovy'), 'C:/Users/project');
            });

            it('should handle lowercase drive letter', () => {
                assert.strictEqual(normalizePath('/c:/Users/project/file.groovy'), 'c:/Users/project');
            });

            it('should handle path without drive letter prefix', () => {
                assert.strictEqual(normalizePath('C:/Users/project/file.groovy'), 'C:/Users/project');
            });

            it('should handle path with no slash returning path as-is', () => {
                assert.strictEqual(normalizePath('nofile'), 'nofile');
            });
        });
    });
});
