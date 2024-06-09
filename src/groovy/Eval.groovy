import groovy.lang.GroovyShell

@groovy.transform.TypeChecked
class Eval {
    private static final String SIGNAL_READY = '\6' //ASCII ACK
    private static final String SIGNAL_END_OF_MESSAGE = '\3' //ASCII ETX

    public static void main(args) {
        new Eval().run(System.in)
    }

    private StringWriter scriptOutputBuf = new StringWriter()
    private GroovyShell shell

    Eval() {
        this.shell = resetShell()
    }

    private GroovyShell resetShell() {
        // Get printed things out from GroovyShell
        scriptOutputBuf = new StringWriter()
        Binding shellBinding = new Binding(out: new PrintWriter(scriptOutputBuf))

        def shell = new GroovyShell(shellBinding)
        injectMacroses(shell)

        return shell
    }

    private run(java.io.InputStream stdin) {
        Scanner scanner = new Scanner(stdin)
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

        print SIGNAL_READY

        try {
            while (true) {
                if (scanner.hasNext()) {
                    String code = scanner.next().strip()
                    try {
                        process(code)
                        // N.B. If implicit return value of the script execution is needed, 
                        //      do `print process(code)`
                    } catch (e) {
                        print "Evaluation failed:\n$e"
                    } catch (java.lang.AssertionError e) {
                        print e
                    } finally {
                        print SIGNAL_END_OF_MESSAGE
                    }
                }
            }
        } finally {
            scanner.close()
        }
    }

    private String process(String code) {
        assert code, "Code is empty"
        assert !code.isEmpty(), "Code is empty"
        assert !code.contains("System.exit"), "Code has System.exit call"

        cleanupOutput()
        shell.parse(code).run()

        return scriptOutputBuf.toString().strip()
    }

    private cleanupOutput() {
        scriptOutputBuf.buffer.length = 0
    }

    private static injectMacroses(GroovyShell shell) {
        final Binding b = shell.context

        b.setVariable "p", { ...v ->
            println v
        }

        b.setVariable "pp", { ...v ->
            def yb = new groovy.yaml.YamlBuilder()
            yb(v)
            println yb.toString()
        }

        b.setVariable "addClasspath", { String path ->
            assert new File(path).isDirectory(), "Classpath must be a directory"
            shell.classLoader.addClasspath(path)
        }

        b.setVariable "grab", { String... artifacts ->
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
