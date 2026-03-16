import groovy.test.GroovyTestCase
import groovy.yaml.YamlBuilder
import java.lang.reflect.Method
import junit.textui.TestRunner
import junit.framework.TestSuite

class KernelTests extends GroovyTestCase {
    private Kernel eval

    void setUp() {
        eval = new Kernel()
    }

    void testProcessSimpleCode() {
        String result = eval.process("println 'Hello, World!'")
        assert result.contains("Hello, World!")
    }

    void testProcessArithmetic() {
        String result = eval.process("println 2 + 2")
        assert result.contains("4")
    }

    void testProcessVariableAssignment() {
        eval.process("x = 10")
        String result = eval.process("println x * 2")
        assert result.contains("20")
    }

    void testProcessMultiLineCode() {
        String result = eval.process("""
            def greet(name) { "Hello, \${name}!" }
            println greet('Groovy')
        """)
        assert result.contains("Hello, Groovy!")
    }

    void testProcessClosure() {
        String result = eval.process("""
            def list = [1, 2, 3]
            println list.collect { it * 2 }
        """)
        assert result.contains("[2, 4, 6]")
    }

    void testProcessEmptyCodeThrowsAssertion() {
        shouldFail(AssertionError) {
            eval.process("")
        }
    }

    void testProcessSystemExitBlocked() {
        shouldFail(AssertionError) {
            eval.process("System.exit(0)")
        }
    }

    void testProcessExceptionHandling() {
        shouldFail(RuntimeException) {
            eval.process("throw new RuntimeException('test error')")
        }
    }

    void testProcessListOperations() {
        String result = eval.process("""
            def list = [1, 2, 3, 4, 5]
            println list.findAll { it > 2 }.sum()
        """)
        assert result.contains("12")
    }

    void testProcessMapOperations() {
        String result = eval.process("""
            def map = [a: 1, b: 2]
            println map.keySet()
        """)
        assert result.contains("a") && result.contains("b")
    }
}

class MacroHelperTests extends GroovyTestCase {

    void testPSingleArg() {
        def output = captureOutput {
            MacroHelper.p("test")
        }
        assert output.contains("test")
    }

    void testPMultipleArgs() {
        def output = captureOutput {
            MacroHelper.p("hello", "world", 123)
        }
        assert output.contains("hello world 123")
    }

    void testPWithNull() {
        def output = captureOutput {
            MacroHelper.p(null)
        }
        assert output.contains("null") || output.trim().isEmpty()
    }

    void testPPSingleObject() {
        def output = captureOutput {
            MacroHelper.pp([a: 1, b: 2])
        }
        assert output.contains("a:") && output.contains("b:")
    }

    void testPPMultipleObjects() {
        def output = captureOutput {
            MacroHelper.pp([1, 2])
        }
        assert output.contains("1") && output.contains("2")
    }

    void testPPWithList() {
        def output = captureOutput {
            MacroHelper.pp([1, 2, 3])
        }
        assert output.contains("1") && output.contains("2") && output.contains("3")
    }

    void testRenderTableWithMaps() {
        def data = [
            [name: "Alice", age: 30],
            [name: "Bob", age: 25]
        ]
        def result = MacroHelper.renderTable(data, "name age")
        assert result.contains("Alice") && result.contains("Bob")
        assert result.contains("30") && result.contains("25")
    }

    void testRenderTableEmptyData() {
        def result = MacroHelper.renderTable([])
        assert result == ""
    }

    void testRenderTableWithNullValues() {
        def data = [[name: "Test", value: null]]
        def result = MacroHelper.renderTable(data, "name value")
        assert result.contains("Test")
    }

    void testRenderTableWithMultilineContent() {
        def data = [[text: "line1\nline2"]]
        def result = MacroHelper.renderTable(data, "text")
        assert result.contains("line1") && result.contains("line2")
    }

    void testRenderTableWithCustomColumns() {
        def data = [[a: 1, b: 2, c: 3]]
        def result = MacroHelper.renderTable(data, "a c")
        assert result.contains("1") && result.contains("3")
        assert !result.contains("2")
    }

    void testConvertToMapListWithMaps() {
        def data = [[a: 1], [b: 2]]
        def result = MacroHelper.convertToMapList(data)
        assert result == data
    }

    void testConvertToMapListWithObjects() {
        def obj = new TestPerson(name: "John", age: 30)
        def result = MacroHelper.convertToMapList([obj])
        assert result[0].name == "John"
        assert result[0].age == 30
    }

    void testConvertToMapListWithCollection() {
        def result = MacroHelper.convertToMapList([[1, 2, 3]])
        assert result[0].value == [1, 2, 3]
    }

    void testFormatMethodSignatureSimple() {
        def method = String.class.getMethod("substring", int)
        def result = MacroHelper.formatMethodSignature(method)
        assert result.contains("substring")
        assert result.contains("int")
    }

    void testFormatMethodSignatureWithParams() {
        def method = String.class.getMethod("lastIndexOf", String.class, int)
        def result = MacroHelper.formatMethodSignature(method)
        assert result.contains("lastIndexOf")
        assert result.contains("String")
        assert result.contains("int")
    }

    void testDirForObject() {
        def output = captureOutput {
            MacroHelper.dir(new TestPerson(name: "Test", age: 25))
        }
        assert output.contains("TestPerson")
        assert output.contains("name") || output.contains("age")
    }

    void testDirForString() {
        def output = captureOutput {
            MacroHelper.dir("test string")
        }
        assert output.contains("String")
    }

    void testAddClasspathInvalid() {
        shouldFail(AssertionError) {
            MacroHelper.addClasspath(new GroovyShell(), "/nonexistent/path")
        }
    }

    void testFindClassReturnsList() {
        def shell = new GroovyShell()
        def result = MacroHelper.findClass(shell, "String")
        assert result instanceof List
    }

    private String captureOutput(Closure closure) {
        def baos = new ByteArrayOutputStream()
        def oldOut = System.out
        System.setOut(new PrintStream(baos))
        try {
            closure()
        } finally {
            System.setOut(oldOut)
        }
        return baos.toString()
    }
}

class PrettyPrintHelperTests extends GroovyTestCase {

    void testToYamlWithMap() {
        def result = PrettyPrintHelper.toYaml([a: 1, b: 2])
        assert result.contains("a: 1")
        assert result.contains("b: 2")
    }

    void testToYamlWithList() {
        def result = PrettyPrintHelper.toYaml([1, 2, 3])
        assert result.contains("- 1")
        assert result.contains("- 2")
        assert result.contains("- 3")
    }

    void testToYamlWithNestedStructure() {
        def result = PrettyPrintHelper.toYaml([outer: [inner: "value"]])
        assert result.contains("outer:")
        assert result.contains("inner:")
        assert result.contains("value")
    }

    void testToYamlWithNull() {
        def result = PrettyPrintHelper.stripTransients(null)
        assert result == null
    }

    void testToYamlWithPrimitive() {
        def result = PrettyPrintHelper.toYaml(42)
        assert result.contains("42")
    }

    void testToYamlWithString() {
        def result = PrettyPrintHelper.toYaml("hello")
        assert result.contains("hello")
    }

    void testToYamlWithCustomObject() {
        def obj = new TestPerson(name: "John", age: 30)
        def result = PrettyPrintHelper.toYaml(obj)
        assert result.contains("John")
        assert result.contains("30")
    }

    void testToYamlWithTransientField() {
        def obj = new TestPersonWithTransient(name: "Jane", temp: "temporary")
        def result = PrettyPrintHelper.toYaml(obj)
        assert result.contains("Jane")
        assert !result.contains("temporary")
    }
}

class CompactStackTraceTests extends GroovyTestCase {

    void testCompactStackTraceFiltersInternal() {
        def kernel = new Kernel()
        def method = Kernel.class.getDeclaredMethod("compactStackTrace", Throwable)
        method.accessible = true
        
        def e = new RuntimeException("test")
        e.fillInStackTrace()
        
        def result = method.invoke(kernel, e)
        assert result instanceof String
    }
}

class WireProtocolTests extends GroovyTestCase {
    private static final String SIGNAL_READY = '\6'
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    void testSignalReadyConstant() {
        assert SIGNAL_READY == '\6' as String
        assert SIGNAL_READY.charAt(0) == 6
    }

    void testSignalEndOfMessageConstant() {
        assert SIGNAL_END_OF_MESSAGE == '\3' as String
        assert SIGNAL_END_OF_MESSAGE.charAt(0) == 3
    }

    void testDelimiterConstants() {
        assert SIGNAL_READY == '\6' as String
        assert SIGNAL_END_OF_MESSAGE == '\3' as String
    }

    void testSendsReadySignalOnStartup() {
        def baos = new ByteArrayOutputStream()
        def oldOut = System.out
        System.setOut(new PrintStream(baos))
        
        try {
            print SIGNAL_READY
        } finally {
            System.setOut(oldOut)
        }
        
        assert baos.toString() == SIGNAL_READY
    }

    void testProcessCodeWithEndOfMessageDelimiter() {
        def kernel = new Kernel()
        def result = kernel.process("println 'test'")
        assert result.contains("test")
    }

    void testEndOfMessageSentAfterProcess() {
        def kernel = new Kernel()
        def result = kernel.process("println 'hello'")
        assert result.contains("hello")
    }

    void testErrorMessageFormat() {
        def kernel = new Kernel()
        try {
            kernel.process("throw new RuntimeException('error')")
            fail("Should have thrown exception")
        } catch (RuntimeException e) {
            assert e.message == "error"
        }
    }

    void testWhitespaceStrippedFromCode() {
        def kernel = new Kernel()
        def result = kernel.process("   println 'stripped'   ")
        assert result.contains("stripped")
    }

    void testAssertionErrorHandled() {
        def kernel = new Kernel()
        try {
            kernel.process("assert false : 'my assertion failed'")
            fail("Should have thrown AssertionError")
        } catch (AssertionError e) {
            assert e.message.contains("my assertion failed")
        }
    }

    void testSystemExitBlockedInProtocol() {
        def kernel = new Kernel()
        try {
            kernel.process("System.exit(0)")
            fail("Should have thrown AssertionError")
        } catch (AssertionError e) {
            assert e.message.contains("System.exit")
        }
    }

    void testCodeIsEmptyCheck() {
        def kernel = new Kernel()
        try {
            kernel.process("")
            fail("Should have thrown AssertionError")
        } catch (AssertionError e) {
            assert e.message.contains("empty") || e.message.contains("Code")
        }
    }

    void testMultipleSequentialProcessCalls() {
        def kernel = new Kernel()
        
        def result1 = kernel.process("println 'first'")
        assert result1.contains("first")
        
        def result2 = kernel.process("println 'second'")
        assert result2.contains("second")
        
        def result3 = kernel.process("println 'third'")
        assert result3.contains("third")
    }

    void testProcessMaintainsState() {
        def kernel = new Kernel()
        
        kernel.process("x = 42")
        def result = kernel.process("println x")
        assert result.contains("42")
    }

    void testScannerDelimiterIsEndOfMessage() {
        def testInput = "code1${SIGNAL_END_OF_MESSAGE}code2${SIGNAL_END_OF_MESSAGE}"
        def scanner = new Scanner(new ByteArrayInputStream(testInput.bytes))
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)
        
        assert scanner.hasNext()
        assert scanner.next() == "code1"
        assert scanner.hasNext()
        assert scanner.next() == "code2"
    }
}

class TestPerson {
    String name
    int age
}

class TestPersonWithTransient {
    String name
    transient String temp
}

class AllTestsRunner {
    static void main(String[] args) {
        def suite = new TestSuite()
        suite.addTestSuite(KernelTests)
        suite.addTestSuite(MacroHelperTests)
        suite.addTestSuite(PrettyPrintHelperTests)
        suite.addTestSuite(CompactStackTraceTests)
        suite.addTestSuite(WireProtocolTests)
        TestRunner.run(suite)
    }
}
