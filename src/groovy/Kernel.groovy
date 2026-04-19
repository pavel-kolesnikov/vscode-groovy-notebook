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

    static void main(args) {
        warmUpJsonService()

        def kernel = new Kernel(System.in, System.out, System.err)
        installSignalHandler(kernel)
        kernel.run()
    }

    private final InputStream stdin
    private final FlushingWriter out
    private final PrintStream errPrint
    private GroovyShell shell
    private MacroHelper macroHelper
    private ExecutorService executor = Executors.newSingleThreadExecutor()
    private Future currentFuture = null
    private volatile boolean shutdownRequested = false

    Kernel(InputStream in, OutputStream out, OutputStream err) {
        this.stdin = in
        this.out = new FlushingWriter(new PrintStream(out, true))
        this.errPrint = new PrintStream(err, true)
        this.shell = createShell()
    }
    
    private static void warmUpJsonService() {
        try {
            new groovy.json.JsonSlurper().parseText('[]')
        } catch (Exception e) {
            log.warning "Failed to warm up JsonSlurper (needed for FastStringService cache): ${e.message}"
        }
    }

    private static void installSignalHandler(Kernel kernel) {
        try {
            def signalClass = Class.forName('sun.misc.Signal')
            def signalHandlerClass = Class.forName('sun.misc.SignalHandler')
            def signalConstructor = signalClass.getConstructor(String)
            def signal = signalConstructor.newInstance('INT')
            def handler = signalHandlerClass.cast(
                Proxy.newProxyInstance(
                    Kernel.class.classLoader,
                    [signalHandlerClass] as Class[],
                    { proxy, method, args ->
                        if (method.name == 'handle') {
                            if (kernel.interrupt()) {
                                // interrupted running future
                            } else {
                                kernel.shutdown()
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

    private static class FlushingWriter extends PrintWriter {
        FlushingWriter(OutputStream out) { super(out, true) }
        @Override void write(char[] buf, int off, int len) { super.write(buf, off, len); super.flush() }
        @Override void write(String s, int off, int len) { super.write(s, off, len); super.flush() }
    }

    private GroovyShell createShell() {
        Binding shellBinding = new Binding(out: out)

        def config = new CompilerConfiguration()
        config.addCompilationCustomizers(
            new ASTTransformationCustomizer(ThreadInterrupt)
        )

        def shell = new GroovyShell(
            this.class.classLoader,
            shellBinding,
            config
        )
        this.macroHelper = new MacroHelper(shell)
        this.macroHelper.inject()

        return shell
    }

    void run() {
        Scanner scanner = new Scanner(stdin)
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

        out.print(SIGNAL_READY)
        out.flush()

        try {
            while (!shutdownRequested) {
                if (scanner.hasNext()) {
                    String code = scanner.next().strip()
                    try {
                        process(code)
                    } catch (Exception e) {
                        errPrint.println "Evaluation failed:\n${e.getClass().name}: ${e.message}\n${compactStackTrace(e)}"
                    } catch (java.lang.AssertionError e) {
                        errPrint.println "Assertion failed: \n${e.message}"
                    } finally {
                        out.print(SIGNAL_END_OF_MESSAGE)
                        out.flush()
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

    private void process(String code) {
        assert code, "Code is empty"
        assert !code.isEmpty(), "Code is empty"
        assert !code.contains("System.exit"), "Refusing to call `System.exit`"

        code = preprocessCommand(code)

        currentFuture = executor.submit {
            shell.parse(code).run()
        }
        
        try {
            currentFuture.get()
        } catch (InterruptedException e) {
            errPrint.println "Execution interrupted"
        } catch (CancellationException e) {
            errPrint.println "Execution cancelled"
        } catch (ExecutionException e) {
            throw e.cause ?: e
        } finally {
            currentFuture = null
        }
    }

    static String preprocessCommand(String code) {
        if (code == '/help' || code == 'help') return 'help()'
        if (code.startsWith('/help ')) return "help('${code.substring(6).strip()}')"
        return code
    }

    boolean interrupt() {
        if (currentFuture != null && !currentFuture.done) {
            currentFuture.cancel(true)
            return true
        }
        return false
    }

    void shutdown() {
        shutdownRequested = true
    }
}
