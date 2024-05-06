import groovy.lang.GroovyShell

@groovy.transform.TypeChecked
class Eval {
    private static final String PROMPT = '\5' //ASCII EOT (end of transmission)
    private static final String END_OF_TRANSMISSION = '\4' //ASCII EOT (end of transmission)

    public static void main(args) {
        new Eval().run()
    }

    private StringWriter scriptOutputBuf = new StringWriter()
    private GroovyShell shell

    Eval() {
        // Get printed things out from GroovyShell
        Binding shellBinding = new Binding(out: new PrintWriter(scriptOutputBuf))
        shell = new GroovyShell(shellBinding)
        injectMacroses(shellBinding)
    }

    private run() {
        Scanner scanner = new Scanner(System.in)
        scanner.useDelimiter(END_OF_TRANSMISSION)

        try {
            while (true) {
                if (scanner.hasNext()) {
                    String text = scanner.next().strip()
                    if (!text) continue

                    try {
                        scriptOutputBuf.buffer.length = 0

                        def output = shell.parse(text).run()
                        if (output) println String.valueOf(output).strip()

                        output = String.valueOf(scriptOutputBuf).strip()
                        if (output) println output
                    } catch (e) {
                        print "Evaluation failed:\n$e"
                    } finally {
                        print END_OF_TRANSMISSION
                    }
                } else {
                    Thread.sleep(300)
                }
            }
        } finally {
            scanner.close()
        }
    }

    private injectMacroses(Binding binding) {
        assert shell, "Shell must be initialized first."

        binding.with {
            setVariable "p", { v ->
                println v
            }
            setVariable "pp", { v ->
                def yb = new groovy.yaml.YamlBuilder()
                yb(v)
                println yb.toString()
            }
            setVariable "addClasspath", { String path ->
                assert new File(path).isDirectory(), "Classpath must be a directory"
                shell.classLoader.addClasspath(path)
            }
            setVariable "grab", { String... artifacts ->
                Map[] coords = artifacts.collect { 
                    it.tokenize(":").with {[
                        group: it[0],
                        module: it[1],
                        version: it[2]
                    ]}
                }
                groovy.grape.Grape.grab(
                    classLoader: shell.classLoader,
                    coords
                )
            }
        }
    }
}
