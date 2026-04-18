import java.util.logging.ConsoleHandler
import java.util.logging.SimpleFormatter
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException

import groovy.lang.GroovyShell
import groovy.util.logging.Log
import groovy.transform.ThreadInterrupt
import org.codehaus.groovy.control.CompilerConfiguration
import org.codehaus.groovy.control.customizers.ASTTransformationCustomizer

@groovy.transform.TypeChecked
@Log
class Kernel {
    static {
        def rootLogger = java.util.logging.Logger.getLogger("")
        rootLogger.handlers.each { rootLogger.removeHandler(it) }
        
        def handler = new ConsoleHandler()
        handler.formatter = new SimpleFormatter() {
            @Override
            String format(java.util.logging.LogRecord record) {
                return String.format("%1\$tY-%1\$tm-%1\$td %1\$tH:%1\$tM:%1\$tS [%4\$s] %2\$s %3\$s%n",
                    new Date(record.millis),
                    record.level,
                    record.message,
                    record.loggerName)
            }
        }
        rootLogger.addHandler(handler)
    }

    private static final String SIGNAL_READY = '\6'
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    public static void main(args) {
        new Kernel().run(System.in)
    }

    private ByteArrayOutputStream scriptOutputBuf = new ByteArrayOutputStream()
    private GroovyShell shell
    private PrintStream originalStdout
    private ExecutorService executor = Executors.newSingleThreadExecutor()
    private Future currentFuture = null
    private volatile boolean shutdownRequested = false

    Kernel() {
        this.originalStdout = System.out
        this.shell = resetShell()
        installSignalHandler()
        warmUpJsonService()
    }

    private void warmUpJsonService() {
        try {
            new groovy.json.JsonSlurper().parseText('[]')
        } catch (Exception e) {
            log.warning "Failed to warm up JsonSlurper (needed for FastStringService cache): ${e.message}"
        }
    }
    
    private void installSignalHandler() {
        try {
            def signalClass = Class.forName('sun.misc.Signal')
            def signalHandlerClass = Class.forName('sun.misc.SignalHandler')
            def signalConstructor = signalClass.getConstructor(String)
            def signal = signalConstructor.newInstance('INT')
            def handler = signalHandlerClass.cast(
                Proxy.newProxyInstance(
                    this.class.classLoader,
                    [signalHandlerClass] as Class[],
                    { proxy, method, args ->
                        if (method.name == 'handle') {
                            if (currentFuture != null && !currentFuture.done) {
                                currentFuture.cancel(true)
                            } else {
                                shutdownRequested = true
                            }
                        }
                        null
                    } as InvocationHandler
                )
            )
            def handleMethod = signalClass.getMethod('handle', signalClass, signalHandlerClass)
            handleMethod.invoke(null, signal, handler)
        } catch (ClassNotFoundException | Exception e) {
            log.warning "Signal handling not available: ${e.message}"
        }
    }

    private GroovyShell resetShell() {
        scriptOutputBuf = new ByteArrayOutputStream()

        def out = new PrintStream(scriptOutputBuf, true)
        System.setOut(out)
        System.setErr(out)

        Binding shellBinding = new Binding(out: new PrintWriter(out, true))

        def config = new CompilerConfiguration()
        config.addCompilationCustomizers(
            new ASTTransformationCustomizer(ThreadInterrupt)
        )

        def shell = new GroovyShell(
            this.class.classLoader,
            shellBinding,
            config
        )
        MacroHelper.injectMacroses(shell)

        return shell
    }

    private run(java.io.InputStream stdin) {
        Scanner scanner = new Scanner(stdin)
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

        originalStdout.print(SIGNAL_READY)
        originalStdout.flush()

        try {
            while (!shutdownRequested) {
                if (scanner.hasNext()) {
                    String code = scanner.next().strip()
                    try {
                        process(code)
                    } catch (Exception e) {
                        print "Evaluation failed:\n${e.getClass().name}: ${e.message}\n${compactStackTrace(e)}"
                    } catch (java.lang.AssertionError e) {
                        print "Assertion failed: \n${e.message}"
                    } finally {
                        originalStdout.print(scriptOutputBuf.toString("UTF-8"))
                        originalStdout.print(SIGNAL_END_OF_MESSAGE)
                        originalStdout.flush()
                        cleanupOutput()
                    }
                }
            }
        } finally {
            scanner.close()
            executor.shutdown()
        }
    }

    private String compactStackTrace(Throwable e) {
        def result = []
        def inInternalStack = false
        
        e.stackTrace.each { element ->
            def className = element.className
            if (className.startsWith('org.codehaus.groovy.') || 
                className.startsWith('java.base/jdk.internal') || 
                className.startsWith('groovy.lang.') ||
                className.startsWith('groovy.ui.GroovyMain') ||
                className.startsWith('jdk.internal.reflect.') ||
                className.startsWith('java.lang.reflect.')
            ) {
                if (!inInternalStack) {
                    inInternalStack = true
                }
            } else {
                inInternalStack = false
                result << "    at ${element.className}.${element.methodName}(${element.fileName}:${element.lineNumber})"
            }
        }
        
        return result.join('\n')
    }

    private String process(String code) {
        assert code, "Code is empty"
        assert !code.isEmpty(), "Code is empty"
        assert !code.contains("System.exit"), "Refusing to call `System.exit`"

        code = preprocessCommand(code)

        cleanupOutput()
        
        currentFuture = executor.submit {
            shell.parse(code).run()
        }
        
        try {
            currentFuture.get()
            return scriptOutputBuf.toString("UTF-8").strip()
        } catch (InterruptedException e) {
            println "Execution interrupted"
            return scriptOutputBuf.toString("UTF-8").strip()
        } catch (CancellationException e) {
            println "Execution cancelled"
            return scriptOutputBuf.toString("UTF-8").strip()
        } catch (ExecutionException e) {
            throw e.cause ?: e
        } finally {
            currentFuture = null
        }
    }

    String preprocessCommand(String code) {
        if (code == '/help' || code == 'help') return 'help()'
        if (code.startsWith('/help ')) return "help('${code.substring(6).strip()}')"
        return code
    }

    void cancelCurrent() {
        if (currentFuture != null && !currentFuture.done) {
            currentFuture.cancel(true)
        }
    }

    private cleanupOutput() {
        scriptOutputBuf.reset()
    }
}
