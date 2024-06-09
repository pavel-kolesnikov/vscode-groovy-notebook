import { ChildProcess, execSync, spawn } from 'child_process';
import { constants as fsConst, accessSync } from 'fs';

export class GroovyProcess {
    proc: ChildProcess | null = null

    private static SIGNAL_READY = String.fromCharCode(6);
    private static SIGNAL_END_OF_MESSAGE = String.fromCharCode(3);

    private cwd: string = ''
    private cmd = GroovyProcess._findGroovyPath()
    private args = [
        "/home/pkolesnikov/Documents/gh/vscode-groovy-notebook/src/groovy/Eval.groovy"
    ]

    useCmd(pathToBinary: string) {
        this.cmd = pathToBinary;
    }

    useArgs(...args: string[]) {
        this.args = args;
    }

    useCwd(cwd: string) {
        this.cwd = cwd;
    }

    terminate() {
        if (!this.proc) return;
        this.proc.kill();
    }

    async run(code: string): Promise<string> {
        const EOM = GroovyProcess.SIGNAL_END_OF_MESSAGE;
        const p = await this._getOrSpawn();

        return new Promise((resolve, reject) => {
            function onExit(code: number) {
                reject(new Error("process exited with code " + code));
            }

            const buffers: Buffer[] = [];
            function readStdout(chunk: Buffer) {
                buffers.push(chunk);

                if (chunk.includes(EOM)) {
                    p.stdout?.removeAllListeners();
                    p.removeAllListeners();
                    const text = Buffer.
                        concat(buffers).
                        toString().
                        trim().
                        replace(EOM, '');
                    resolve(text);
                }
            }

            p.once("exit", onExit);
            p.stdout?.on("data", readStdout);
            p.stdin?.write(code + EOM);
        });
    }

    private static _findGroovyPath(): string {
        let cmd = "which groovy";

        if (process.platform == "win32") {
            cmd = "where groovy";
        }

        const path = execSync(cmd).toString().trim().split(/\r?\n/)[0];
        
        // check we're able to execute given file
        accessSync(path, fsConst.X_OK);

        return path;
    }

    private _spawn(cmd: string, args: string[]) {
        if (args.length == 0) throw new Error("Missing arguments to groovy executable");

        console.log('Spawning new Groovy process:', cmd, args);

        const groovy = spawn(cmd, args, { cwd: this.cwd });

        for (const event of [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`]) {
            process.on(event, () => {
                console.log('Groovy process dies, pid', process.pid);
                groovy.kill();
            });
        }

        return groovy;
    }

    private _getOrSpawn(): Promise<ChildProcess> {
        if (this.proc && this.proc.exitCode == null) {
            return Promise.resolve(this.proc);
        }

        return new Promise((resolve, reject) => {
            this.proc = this._spawn(this.cmd, this.args);
            const stdout = this.proc.stdout;
            if (!stdout) {
                reject(new Error("Groovy's stdout is unexpectedly closed. Process dead?"));
                return;
            }

            console.log("Waiting Groovy process ready...");

            const timeoutId = setTimeout(() => {
                this.terminate();
                reject(new Error("Timeout waiting Groovy initialization"));
            }, 30_000);

            stdout.on("data", chunk => {
                if (chunk.includes(GroovyProcess.SIGNAL_READY)) {
                    stdout.removeAllListeners();
                    clearTimeout(timeoutId);
                    console.log("Groovy is ready");
                    if (this.proc) {
                        resolve(this.proc);
                    } else {
                        reject(new Error("Code error: No Groovy process"));
                    }
                }
            });
        });
    }
}