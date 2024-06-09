import { spawn } from 'child_process';

class GroovyProc {
    SIGNAL_READY = String.fromCharCode(6);
    SIGNAL_END_OF_MESSAGE = String.fromCharCode(3);
    GROOVY_CMD = {
        cmd: "groovy",
        args: ["/home/pkolesnikov/Documents/gh/vscode-groovy-notebook/src/groovy/Eval.groovy"]
    }

    constructor() {
        this.proc = null
    }

    _spawn(cmd, args) {
        const groovy = spawn(cmd, args)

        for (let event of [`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `uncaughtException`, `SIGTERM`]) {
            process.on(event, groovy.kill.bind(groovy))
        }

        return groovy
    }

    _getOrSpawn() {
        if (this.proc && this.proc.exitCode == null) {
            return Promise.resolve(this.proc)
        }

        return new Promise((resolve, reject) => {
            this.proc = this._spawn(this.GROOVY_CMD.cmd, this.GROOVY_CMD.args)
            const stdout = this.proc.stdout

            const timeoutId = setTimeout(() => {
                if (!this.proc) return
                this.proc.kill()
                reject(new Error("Timeout waiting Groovy initialization"))
            }, 30_000)

            stdout.on("data", chunk => {
                if (chunk.includes(this.SIGNAL_READY)) {
                    stdout.removeAllListeners()
                    clearTimeout(timeoutId)
                    console.log("Groovy is ready...")
                    resolve(this.proc)
                }
            })
        })
    }

    async run(code) {
        const EOM = this.SIGNAL_END_OF_MESSAGE
        const p = await this._getOrSpawn()

        return new Promise(async (resolve, reject) => {
            function onExit(code) {
                reject(new Error("process exited with code " + code))
            }

            const buffers = []
            function readStdout(chunk) {
                buffers.push(chunk)

                if (chunk.includes(EOM)) {
                    p.stdout.removeAllListeners()
                    p.removeAllListeners()
                    const text = Buffer.
                        concat(buffers).
                        toString().
                        trim().
                        replace(EOM, '');
                    resolve(text)
                }
            }

            p.stdout.on("data", readStdout)
            console.log(`evaluating '${code}'`)
            p.stdin.write(code + EOM)
            p.once("exit", onExit)
        })
    }
}

const groovy = new GroovyProc()

console.log("groovy: ", await groovy.run("p 1+1"))
console.log("groovy: ", await groovy.run("a = 1"))
console.log("groovy: ", await groovy.run("b = 1"))
console.log("groovy: ", await groovy.run("p a + b"))