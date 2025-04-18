import java.util.logging.ConsoleHandler
import java.util.logging.SimpleFormatter

import groovy.grape.Grape
import groovy.lang.GroovyShell
import groovy.util.logging.Log
import groovy.util.logging.Log
import groovy.yaml.YamlBuilder

@groovy.transform.TypeChecked
@Log
class Eval {
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

    private static final String SIGNAL_READY = '\6' //ASCII ACK
    private static final String SIGNAL_END_OF_MESSAGE = '\3' //ASCII ETX

    public static void main(args) {
        new Eval().run(System.in)
    }

    private StringWriter scriptOutputBuf = new StringWriter()
    private GroovyShell shell

    Eval() {
        log.info "Starting Eval initialization..."
        log.info "Creating Groovy shell..."
        this.shell = resetShell()
        log.info "Eval initialization complete"
    }

    private GroovyShell resetShell() {
        log.info "Starting GroovyShell reset..."
        log.info "Creating new StringWriter for output buffer..."
        scriptOutputBuf = new StringWriter()
        log.info "Creating new Binding..."
        Binding shellBinding = new Binding(out: new PrintWriter(scriptOutputBuf))

        log.info "Creating new GroovyShell instance..."
        def shell = new GroovyShell(shellBinding)
        log.info "Starting macro injection..."
        MacroHelper.injectMacroses(shell)
        log.info "GroovyShell reset complete"

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
                    } catch (Exception e) {
                        print "Evaluation failed:\n${e.getClass().name}: ${e.message}\n${compactStackTrace(e)}"
                    } catch (java.lang.AssertionError e) {
                        print "Assertion failed: \n${e.message}"
                    } finally {
                        print SIGNAL_END_OF_MESSAGE
                    }
                }
            }
        } finally {
            scanner.close()
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

        cleanupOutput()
        shell.parse(code).run()

        return scriptOutputBuf.toString().strip()
    }

    private cleanupOutput() {
        scriptOutputBuf.buffer.length = 0
    }
}

@Log
class MacroHelper {
    static void injectMacroses(GroovyShell shell) {
        log.info "Starting macro injection..."
        final Binding b = shell.context

        log.info "Injecting 'p' macro..."
        b.setVariable "p", MacroHelper.&p

        log.info "Injecting 'pp' macro..."
        b.setVariable "pp", MacroHelper.&pp

        log.info "Injecting 'addClasspath' macro..."
        b.setVariable "addClasspath", MacroHelper.&addClasspath.curry(shell)

        log.info "Injecting 'grab' macro..."
        b.setVariable "grab", MacroHelper.&grab.curry(shell)

        log.info "Injecting 'tt' macro..."
        b.setVariable "tt", MacroHelper.&tt

        log.info "Macro injection complete"
    }

    private static void p(Object... v) {
        println v.collect { String.valueOf(it) }.join(' ')
    }

    private static void pp(Object... v) {
        def yb = new YamlBuilder()
        yb(v)
        println yb.toString()
    }

    private static void addClasspath(GroovyShell shell, String path) {
        assert new File(path).isDirectory(), "Classpath must be a directory"
        shell.classLoader.addClasspath(path)
    }

    private static void grab(GroovyShell shell, String... artifacts) {
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
    

    private static void tt(Object data, String columnsToRender = null) {
        assert data instanceof List<Map<Object,Object>>, "Data must be a List of Maps"
        def dataList = data as List<Map<Object,Object>>

        if (!dataList) {
            println "<No data to display>"
            return
        }

        // Convert data to string format and validate
        def stringData = dataList.grep().collect { row ->
            row.collectEntries { k, v -> [k.toString(), v?.toString() ?: ''] }
        }
        
        // Determine columns to display
        def allColumns = stringData*.keySet().flatten().unique()
        def columns = columnsToRender?.tokenize() ?: allColumns
        
        // Calculate column widths
        def columnWidths = columns.collectEntries { col ->
            def maxWidth = Math.max(
                col.length(),
                stringData.collect { it[col]?.length() ?: 0 }.max() ?: 0
            )
            return [col, maxWidth]
        }

        // Print table
        def printRow = { values -> 
            println values.collect { col, width -> 
                (col ?: '').padRight(width)
            }.join(' | ')
        }

        // Header
        printRow(columns.collectEntries { [it, columnWidths[it]] })
        printRow(columns.collectEntries { [it, columnWidths[it]].collectEntries { k, v -> [k, '-'.multiply(v)] } })

        // Data rows
        stringData.each { row ->
            printRow(columns.collectEntries { [it, columnWidths[it]] }.collectEntries { col, width ->
                [row[col] ?: '', width]
            })
        }
    }
} 