export function normalizePath(path: string): string {
    if (process.platform === 'win32') {
        path = path.replace(/^[/]([a-zA-Z]:[/])/, '$1');
    }
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) {
        return path;
    }
    return path.substring(0, lastSlashIndex);
}
