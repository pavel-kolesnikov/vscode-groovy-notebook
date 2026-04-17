import * as vscode from 'vscode';
import {
  validateGroovyPath as validateGroovyPathImpl,
  validateJavaHome as validateJavaHomeImpl,
  validatePaths,
  ValidationResult,
  ConfigValidationResult,
} from './configValidation.js';

export { ValidationResult, ConfigValidationResult };

export const CONFIG = {
  GROOVY_PATH_KEY: 'groovyNotebook.groovyPath',
  JAVA_HOME_KEY: 'groovyNotebook.javaHome',
  COMPRESS_OUTPUTS_KEY: 'groovyNotebook.compressOutputs',
  DEFAULT_GROOVY_PATH: 'groovy',
  TIMEOUT_SPAWN_MS: 10_000,
  TIMEOUT_THREAD_JOIN_MS: 5_000,
  MAX_BUFFER_SIZE: 1024 * 1024 * 1024,
  LOG_PREVIEW_LENGTH: 100,
  LOG_PREVIEW_LONG_LENGTH: 200,
};

/**
 * Returns the configured Groovy executable path.
 * Falls back to 'groovy' if not configured.
 */
export function getGroovyPath(): string {
  return vscode.workspace.getConfiguration().get(CONFIG.GROOVY_PATH_KEY) as string || CONFIG.DEFAULT_GROOVY_PATH;
}

/**
 * Returns the configured JAVA_HOME path, if set.
 */
export function getJavaHome(): string | undefined {
  const javaHome = vscode.workspace.getConfiguration().get(CONFIG.JAVA_HOME_KEY) as string;
  return javaHome ? javaHome : undefined;
}

export function shouldCompressOutputs(): boolean {
  return vscode.workspace.getConfiguration().get<boolean>(CONFIG.COMPRESS_OUTPUTS_KEY) ?? true;
}

export const validateGroovyPath = validateGroovyPathImpl;
export const validateJavaHome = validateJavaHomeImpl;

/**
 * Validates the current configuration (Groovy path and JAVA_HOME).
 * @returns Validation result with any errors found
 */
export function validateConfig(): ConfigValidationResult {
  return validatePaths(getGroovyPath(), getJavaHome());
}
