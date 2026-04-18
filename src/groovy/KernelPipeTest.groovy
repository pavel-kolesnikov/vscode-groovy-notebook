import org.junit.Test
import org.junit.Before
import org.junit.After

class KernelPipeTest {
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    private PipedOutputStream testWrite
    private PipedInputStream kernelRead
    private PipedOutputStream kernelWrite
    private PipedInputStream testRead
    private Kernel kernel
    private Thread kernelThread
    private PrintStream savedOut

    @Before
    void setUp() {
        testWrite = new PipedOutputStream()
        kernelRead = new PipedInputStream(testWrite)
        kernelWrite = new PipedOutputStream()
        testRead = new PipedInputStream(kernelWrite)

        savedOut = System.out
        System.setOut(new PrintStream(kernelWrite, true))

        kernel = new Kernel(kernelRead, kernelWrite)
        kernelThread = Thread.start { kernel.run() }

        int ack = testRead.read()
        assert ack == 6 : "Expected ACK (0x06), got: ${ack}"
    }

    @After
    void tearDown() {
        kernel.shutdown()
        testWrite.close()
        kernelThread?.join(5000)
        System.setOut(savedOut)
    }

    private String send(String code) {
        testWrite.write((code + SIGNAL_END_OF_MESSAGE).bytes)
        testWrite.flush()

        def buf = new ByteArrayOutputStream()
        def readBuf = new byte[4096]
        while (true) {
            int n = testRead.read(readBuf)
            if (n == -1) throw new IllegalStateException("Stream closed before ETX")
            buf.write(readBuf, 0, n)
            String str = buf.toString("UTF-8")
            if (str.contains(SIGNAL_END_OF_MESSAGE)) {
                return str.replace(SIGNAL_END_OF_MESSAGE, "").strip()
            }
        }
    }

    @Test
    void testSimpleOutput() {
        def result = send("println 'Hello, World!'")
        assert result.contains("Hello, World!")
    }

    @Test
    void testArithmetic() {
        def result = send("println 2 + 2")
        assert result.contains("4")
    }

    @Test
    void testVariableStatePreserved() {
        send("x = 42")
        def result = send("println x * 2")
        assert result.contains("84")
    }

    @Test
    void testMultiLineCode() {
        def result = send("""
            def greet(name) { "Hello, \${name}!" }
            println greet('Groovy')
        """)
        assert result.contains("Hello, Groovy!")
    }

    @Test
    void testExceptionInUserCode() {
        def result = send("throw new RuntimeException('test error')")
        assert result.contains("test error")
    }

    @Test
    void testSystemExitBlocked() {
        def result = send("System.exit(0)")
        assert result.contains("System.exit")
    }

    @Test
    void testWhitespaceOnlyCode() {
        def result = send("   ")
        assert result != null
    }

    @Test
    void testMultipleSequentialCalls() {
        assert send("println 'first'").contains("first")
        assert send("println 'second'").contains("second")
        assert send("println 'third'").contains("third")
    }

    @Test
    void testPrintWithoutNewline() {
        def result = send("print 42")
        assert result.contains("42") : "print() without newline must flush output, got: [${result}]"
    }

    @Test
    void testPrintFollowedByOtherOutput() {
        def result = send("print 'hello '\nprintln 'world'")
        assert result.contains("hello") : "print() output must appear before subsequent println, got: [${result}]"
        assert result.contains("world") : "println output must also appear, got: [${result}]"
    }

    @Test
    void testHelpCommand() {
        def result = send("help")
        assert result.size() > 0
    }

    @Test
    void testClosureAndCollection() {
        def result = send("""
            def list = [1, 2, 3]
            println list.collect { it * 2 }
        """)
        assert result.contains("[2, 4, 6]")
    }

    static void main(String[] args) {
        def testMethods = KernelPipeTest.class.declaredMethods
            .findAll { it.name.startsWith('test') && it.parameterCount == 0 }
            .sort { it.name }

        int passed = 0
        int failed = 0
        def failures = []

        testMethods.each { method ->
            def test = new KernelPipeTest()
            try {
                System.err.println("SETUP ${method.name}...")
                test.setUp()
                System.err.println("RUN ${method.name}...")
                method.invoke(test)
                System.err.println("PASS ${method.name}")
                passed++
            } catch (Exception e) {
                System.err.println("FAIL ${method.name}: ${e.cause?.message ?: e.message}")
                failed++
                failures << "${method.name}: ${e.cause?.message ?: e.message}"
            } finally {
                try { test.tearDown() } catch (Exception ignored) {}
            }
        }

        System.err.println("JUnit 4 Runner, Tests: ${passed + failed}, Failures: ${failed}, Time: N/A")
        failures.each { System.err.println("FAIL: ${it}") }
        System.exit(failed > 0 ? 1 : 0)
    }
}
