export interface ValidationResult {
  valid: boolean;
  message: string;
}

export interface ConfigValidationResult {
  groovyPath: ValidationResult;
  javaHome: ValidationResult;
  allValid: boolean;
}

export function validateGroovyPath(path: string): ValidationResult {
  if (!path || path.trim() === '') {
    return { valid: false, message: 'Groovy path cannot be empty' };
  }
  if (path.includes('\0')) {
    return { valid: false, message: 'Groovy path contains invalid null character' };
  }
  return { valid: true, message: '' };
}

export function validateJavaHome(path: string | undefined): ValidationResult {
  if (path === undefined || path === '') {
    return { valid: true, message: '' };
  }
  if (path.trim() === '') {
    return { valid: false, message: 'Java home cannot be whitespace only' };
  }
  if (path.includes('\0')) {
    return { valid: false, message: 'Java home contains invalid null character' };
  }
  return { valid: true, message: '' };
}

export function validatePaths(groovyPath: string, javaHome: string | undefined): ConfigValidationResult {
  const groovyPathResult = validateGroovyPath(groovyPath);
  const javaHomeResult = validateJavaHome(javaHome);

  return {
    groovyPath: groovyPathResult,
    javaHome: javaHomeResult,
    allValid: groovyPathResult.valid && javaHomeResult.valid,
  };
}
