import java.lang.annotation.*
import java.lang.reflect.Method

import groovy.grape.Grape
import groovy.lang.GroovyShell
import groovy.util.logging.Log

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
@interface Help {
    String category()
    String desc()
    String example()
    String output() default ""
}

@Log
class MacroHelper {
    private final GroovyShell shell
    private final PrintWriter out

    MacroHelper(GroovyShell shell) {
        this.shell = shell
        this.out = shell.context.out as PrintWriter
    }

    void inject() {
        def b = shell.context

        b.setVariable "addClasspath", this.&addClasspath
        b.setVariable "grab", this.&grab
        b.setVariable "findClass", this.&findClass
        b.setVariable "p", this.&p
        b.setVariable "pp", this.&pp
        b.setVariable "tt", this.&tt
        b.setVariable "dir", this.&dir

        b.setVariable "help", { String cmd = null ->
            if (cmd) {
                printHelpDetail(cmd)
            } else {
                printHelpOverview()
            }
        }

        loadGroovyshRc()
    }

    private void loadGroovyshRc() {
        def groovyshRc = new File("${System.getProperty('user.home')}/.groovy/groovysh.rc")
        if (!groovyshRc.exists()) return
        try {
            shell.evaluate(groovyshRc.text)
        } catch (Exception e) {
            log.warning "Failed to execute groovysh.rc: ${e.message}"
        }
    }

    @Help(category="Output", desc="Print arguments space-separated", example='p "x =", 42', output='x = 42')
    void p(Object... v) {
        out.println v.collect { String.valueOf(it) }.join(' ')
    }

    @Help(category="Output", desc="Pretty-print as YAML (strips transient/static fields)", example='pp [a: 1, b: [c: 2]]', output='a: 1\nb:\n  c: 2')
    void pp(Object... v) {
        if (v.size() == 1) {
            out.println PrettyPrintHelper.toYaml(v[0])
        } else {
            out.println PrettyPrintHelper.toYaml(v)
        }
    }

    @Help(category="Dependencies", desc="Add directory to classpath (relative to .groovynb file)", example='addClasspath "lib"')
    void addClasspath(String path) {
        assert new File(path).isDirectory(), "Classpath must be a directory"
        shell.classLoader.addClasspath(path)
    }

    @Help(category="Dependencies", desc="Grab Maven dependencies via Grape (cached in ~/.groovy/grapes)", example='grab "org.apache.commons:commons-lang3:3.17.0"')
    void grab(String... artifacts) {
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

    @Help(category="Exploration", desc="Find fully-qualified class name by short name (searches classpath JARs)", example='findClass "List"', output='[java.util.List]')
    List<String> findClass(String className) {
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

    @Help(category="Output", desc="Render ASCII table from list of maps", example="tt data, 'name age'")
    void tt(List<Object> data, String columnsToRender = null) {
        out.println renderTable(data, columnsToRender)
    }

    @Help(category="Exploration", desc="Inspect object members (fields, properties, methods) sorted by inheritance depth", example='dir "hello"')
    void dir(obj) {
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

    void printHelpOverview() {
        def methods = MacroHelper.class.declaredMethods.findAll { it.isAnnotationPresent(Help) }.unique { it.name }
        def grouped = methods.groupBy { it.getAnnotation(Help).category() }
        def categoryOrder = ['Output', 'Exploration', 'Dependencies']
        categoryOrder.each { cat ->
            if (grouped[cat]) {
                out.println "${cat}:"
                grouped[cat].sort { it.name }.each { m ->
                    def ann = m.getAnnotation(Help)
                    def name = m.name
                    out.println "  ${name.padRight(20)}${ann.desc()}"
                }
                out.println ""
            }
        }
        out.println "Meta:"
        out.println "  ${'help [cmd]'.padRight(20)}Show this help, or detailed help for a command"
    }

    void printHelpDetail(String cmd) {
        def method = MacroHelper.class.declaredMethods.find {
            it.name == cmd && it.isAnnotationPresent(Help)
        }
        if (!method) {
            out.println "Unknown command: ${cmd}"
            out.println "Type help() to see available commands."
            return
        }
        def ann = method.getAnnotation(Help)
        def paramTypes = method.parameterTypes.collect {
            if (it.array) {
                return it.componentType.simpleName == 'Object' ? 'args...' : it.componentType.simpleName + '...'
            }
            return it.simpleName
        }.join(', ')
        out.println "${cmd} <${paramTypes}>"
        out.println "  ${ann.desc()}"
        out.println ""
        out.println "  Example:"
        out.println "    ${ann.example()}"
        if (ann.output()) {
            out.println ""
            out.println "  Output:"
            ann.output().split('\n').each { line ->
                out.println "    ${line}"
            }
        }
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
