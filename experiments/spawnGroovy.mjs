import { execSync, spawn } from 'child_process';

class GroovyProc {
    SIGNAL_READY = String.fromCharCode(6);
    SIGNAL_END_OF_MESSAGE = String.fromCharCode(3);
    cmd = this._findGroovyPath()
    args = ["/home/pkolesnikov/Documents/gh/vscode-groovy-notebook/src/groovy/Eval.groovy"]

    constructor() {
        this.proc = null
    }

    useCmd(pathToBinary) {
        this.cmd = pathToBinary
    }

    useArgs(arg1 /*,arg2...*/) {
        if (arguments.length < 1) throw new Error("Must have at least 1 argument")
        this.args = Array.from(arguments)
    }

    _findGroovyPath() {
        return execSync("which groovy").toString().trim()
    }

    _spawn(cmd, args) {
        console.log('Spawning new Groovy process:', cmd, args)
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
            this.proc = this._spawn(this.cmd, this.args)
            const stdout = this.proc.stdout

            console.log("Waiting Groovy process ready...")

            const timeoutId = setTimeout(() => {
                this.terminate()
                reject(new Error("Timeout waiting Groovy initialization"))
            }, 30_000)

            stdout.on("data", chunk => {
                if (chunk.includes(this.SIGNAL_READY)) {
                    stdout.removeAllListeners()
                    clearTimeout(timeoutId)
                    console.log("Groovy is ready")
                    resolve(this.proc)
                }
            })
        })
    }

    terminate() {
        if (!this.proc) return
        this.proc.kill()
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
                    console.log("received:", text)
                    resolve(text)
                }
            }

            p.stdout.on("data", readStdout)
            console.log('sending', code)
            p.stdin.write(code + EOM)
            p.once("exit", onExit)
        })
    }
}

const groovy = new GroovyProc()

groovy.useArgs("/home/pkolesnikov/Documents/gh/vscode-groovy-notebook/src/groovy/Eval.groovy")

console.log("groovy: ", await groovy.run("p 1+1"))
console.log("groovy: ", await groovy.run(`class A {
    static final LOL = "FUFU"
}`))
console.log("groovy: ", await groovy.run("p A.LOL"))

console.log('killing groovy process...')
groovy.proc.once("exit", () => console.log("groovy is killed"))
groovy.proc.kill()

setTimeout(async () => {
    console.log("groovy: ", await groovy.run("a = 1"))
    console.log("groovy: ", await groovy.run("b = 1"))
    console.log("groovy: ", await groovy.run("p a + b"))
    groovy.terminate()
}, 3_000)
