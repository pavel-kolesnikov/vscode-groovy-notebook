import java.util.logging.ConsoleHandler
import java.util.logging.SimpleFormatter
import java.lang.reflect.Method

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
        final Binding b = shell.context
        log.info "Starting macro injection..."

        b.setVariable "addClasspath", MacroHelper.&addClasspath.curry(shell)
        b.setVariable "grab", MacroHelper.&grab.curry(shell)
        b.setVariable "findClass", MacroHelper.&findClass.curry(shell)
        b.setVariable "p", MacroHelper.&p
        b.setVariable "pp", MacroHelper.&pp
        b.setVariable "tt", MacroHelper.&tt
        b.setVariable "dir", MacroHelper.&dir

        log.info "Macro injection complete"

        log.info "Loading groovysh.rc..."
        loadGroovyshRc(shell)
        log.info "Loaded groovysh.rc"
    }

    private static void loadGroovyshRc(GroovyShell shell) {
        def groovyshRc = new File("${System.getProperty('user.home')}/.groovy/groovysh.rc")
        if (groovyshRc.exists()) {
            log.info "Reading groovysh.rc from ${groovyshRc.absolutePath}"
            try {
                shell.evaluate(groovyshRc.text)
                log.info "Successfully executed groovysh.rc"
            } catch (Exception e) {
                log.warning "Failed to execute groovysh.rc: ${e.message}"
            }
        } else {
            log.info "No groovysh.rc found at ${groovyshRc.absolutePath}"
        }
    }


    private static void p(Object... v) {
        println v.collect { String.valueOf(it) }.join(' ')
    }

    private static void pp(Object... v) {
        if (v.size() == 1) {
            println PrettyPrintHelper.toYaml(v[0])
        } else {
            println PrettyPrintHelper.toYaml(v)
        }
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

    private static List<String> findClass(GroovyShell shell, String className) {
        shell.classLoader.getURLs()
            .stream()
            .parallel()
            .map { url ->
                try {
                    Optional.of(new java.util.jar.JarFile(new File(url.toURI())))
                } catch (Exception e) {
                    Optional.empty()
                }
            }
            .filter { it.isPresent() }
            .map { it.get() }
            .flatMap { jar -> jar.entries().toList().stream() }
            .filter { it.name.endsWith('.class') }
            .map { it.name.replace('/', '.').replace('.class', '') }
            .filter { it.tokenize(".").last == className }
            .toList()
    }
    
    private static void tt(List<Object> data, String columnsToRender = null) {
        println renderTable(data, columnsToRender)
    }

    private static String renderTable(List<Map> data, String columnsToRender = null) {
        def dataList = convertToMapList(data)

        if (!dataList) {
            return ""
        }

        def stringData = dataList.grep().collect { row ->
            row.collectEntries { k, v -> [k.toString(), String.valueOf(v) ?: '-'] }
        }
        def allColumns = stringData*.keySet().flatten().unique()
        def columns = columnsToRender?.tokenize() ?: allColumns
        def columnWidths = columns.collectEntries { col ->
            def maxWidth = Math.max(
                col.length(),
                stringData.collect { (it[col]?.toString()?.split('\n') ?: ['']).collect { l -> l.length() }.max() ?: 0 }.max() ?: 0
            )
            [col, maxWidth]
        }

        def printRowMultiline = { List<String> values, Map<String, Integer> widths ->
            def cellLines = values.withIndex().collect { val, idx ->
                (val ?: '').toString().split('\n')
            }
            def maxLines = cellLines.collect { it.size() }.max() ?: 1
            (0..<maxLines).collect { lineIdx ->
                cellLines.withIndex().collect { lines, idx ->
                    def col = columns[idx]
                    (lines.size() > lineIdx ? lines[lineIdx] : '').padRight(widths[col])
                }.join('\t')
            }.join('\n')
        }

        def result = []
        result << printRowMultiline(columns, columnWidths)
        stringData.each { row ->
            result << printRowMultiline(columns.collect { row[it] ?: '' }, columnWidths)
        }
        return result.join('\n')
    }
    
    static String dir(obj) {
        def clazz = obj.getClass()
        def rows = []

        def getInheritanceDepth = { Class<?> c ->
            int depth = 0
            def current = c
            while (current != null) {
                depth++
                current = current.superclass
            }
            depth
        }

        def getDeclaringClassDepth = { Class<?> declaringClass ->
            def current = clazz
            int depth = 0
            while (current != null && current != declaringClass) {
                depth++
                current = current.superclass
            }
            depth
        }

        clazz.declaredFields.findAll { !it.synthetic }.each {
            rows << [
                name: it.name,
                type: 'field',
                signature: it.type.simpleName,
                from: it.declaringClass.simpleName,
                depth: getDeclaringClassDepth(it.declaringClass)
            ]
        }
        
        obj.properties.each { k, v ->
            def propDecl = null
            try {
                propDecl = clazz.getDeclaredField(k)?.declaringClass
            } catch (ignored) {
                def getter = clazz.methods.find { m -> m.name == "get"+k.capitalize() && m.parameterCount == 0 }
                propDecl = getter?.declaringClass
            }
            if (!propDecl) propDecl = clazz
            rows << [
                name: k,
                type: 'property',
                signature: v?.getClass()?.simpleName ?: 'null',
                from: propDecl.simpleName,
                depth: getDeclaringClassDepth(propDecl)
            ]
        }
        
        def methodRows = clazz.methods.collect {[
            name: it.name,
            type: 'method',
            signature: formatMethodSignature(it),
            from: it.declaringClass.simpleName,
            depth: getDeclaringClassDepth(it.declaringClass)
        ]}
        
        methodRows = methodRows.unique { [it.name, it.type, it.from] }
        methodRows = methodRows.findAll { !it.name.contains('$') }
        def isBean = { n -> n ==~ /^(get|set|is)[A-Z].*/ }
        def beanMethods = methodRows.findAll { isBean(it.name) }
        def otherMethods = methodRows.findAll { !isBean(it.name) }

        rows += beanMethods + otherMethods
        rows = rows.unique { [it.name, it.type, it.from] }
        rows = rows.findAll { !it.name.contains('$') }
        
        def typeOrder = ['field': 0, 'property': 1, 'method': 2]
        rows = rows.sort { a, b -> 
            a.depth <=> b.depth ?: 
            typeOrder[a.type] <=> typeOrder[b.type] ?: 
            a.name.toLowerCase() <=> b.name.toLowerCase() ?: 
            a.signature <=> b.signature
        }
        
        p "$clazz:"
        tt(rows, 'type name from signature')
    }

    private static String formatMethodSignature(Method method) {
        def defaultPackages = [
            'java.lang.',
            'java.util.',
            'java.io.',
            'java.net.',
            'groovy.lang.',
            'groovy.util.',
            'java.math.'
        ]
        def simplify = { String fqcn ->
            if (!fqcn) return fqcn
            for (pkg in defaultPackages) {
                if (fqcn.startsWith(pkg)) {
                    return fqcn.substring(pkg.length())
                }
            }
            return fqcn
        }
        def returnType = simplify(method.returnType.name.replace('$', '.').tokenize('.').join('.'))
        def params = method.parameterTypes.collect { pt ->
            simplify(pt.name.replace('$', '.').tokenize('.').join('.'))
        }.join(', ')
        def exceptions = method.exceptionTypes.collect { et ->
            simplify(et.name.replace('$', '.').tokenize('.').join('.'))
        }
        def throwsClause = exceptions ? ' throws ' + exceptions.join(', ') : ''
        return "${returnType} ${method.name}(${params})${throwsClause}"
    }

    private static List<Map> convertToMapList(List<Object> data) {
        if (!data) return []
        
        data.collect { obj ->
            if (obj instanceof Map) {
                return obj
            }
            
            if (obj instanceof Collection) {
                return [value: obj]
            }
            
            def result = [:]
            obj.getClass().declaredFields.each { field ->
                if (!field.synthetic && !field.name.contains('$') && !java.lang.reflect.Modifier.isTransient(field.modifiers)) {
                    field.accessible = true
                    result[field.name] = field.get(obj)
                }
            }
            return result
        }
    }
} 

class PrettyPrintHelper {
    static String toYaml(obj) {
        def yb = new groovy.yaml.YamlBuilder()
        yb(stripTransients(obj))
        return yb.toString()
    }

    private static Object stripTransients(obj) {
        if (obj == null) return null
        if (obj instanceof Map) {
            return obj.collectEntries { k, v -> [k, stripTransients(v)] }
        }
        if (obj instanceof List) {
            return obj.collect { stripTransients(it) }
        }
        def clazz = obj.getClass()
        if (clazz.isPrimitive() || obj instanceof Number || obj instanceof CharSequence || obj instanceof Boolean || obj instanceof Enum) {
            return obj
        }
        def pkg = clazz.package?.name
        if (pkg?.startsWith('java.') || pkg?.startsWith('javax.')) {
            return obj
        }
        def result = [:]
        clazz.declaredFields.findAll { f ->
            !java.lang.reflect.Modifier.isTransient(f.modifiers) &&
            !java.lang.reflect.Modifier.isStatic(f.modifiers) &&
            !(f.name.contains('$'))
        }.each { f ->
            f.accessible = true
            result[f.name] = stripTransients(f.get(obj))
        }
        return result
    }
}