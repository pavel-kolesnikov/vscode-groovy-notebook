import org.junit.Test
import org.junit.Before
import org.junit.After

class KernelPipeTest extends GroovyTestBase {

    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    private PipedOutputStream testWrite
    private PipedInputStream kernelRead
    private PipedOutputStream kernelWrite
    private PipedInputStream testRead
    private PipedOutputStream kernelErrWrite
    private PipedInputStream testErrRead
    private Kernel kernel
    private Thread kernelThread

    @Before
    void setUp() {
        testWrite = new PipedOutputStream()
        kernelRead = new PipedInputStream(testWrite)
        kernelWrite = new PipedOutputStream()
        testRead = new PipedInputStream(kernelWrite)
        kernelErrWrite = new PipedOutputStream()
        testErrRead = new PipedInputStream(kernelErrWrite)

        kernel = new Kernel(kernelRead, kernelWrite, kernelErrWrite)
        kernelThread = Thread.start { kernel.run() }

        int ack = testRead.read()
        assert ack == 6 : "Expected ACK (0x06), got: ${ack}"
    }

    @After
    void tearDown() {
        kernel.shutdown()
        testWrite.close()
        kernelThread?.join(5000)
    }

    private static class ExecutionResult {
        String stdout = ''
        String stderr = ''
    }

    private ExecutionResult send(String code) {
        testWrite.write((code + SIGNAL_END_OF_MESSAGE).bytes)
        testWrite.flush()

        // Drain stderr in background while waiting for ETX on stdout
        def errBuf = new ByteArrayOutputStream()
        def errThread = new Thread({
            try {
                def readBuf = new byte[4096]
                while (true) {
                    int n = testErrRead.read(readBuf)
                    if (n == -1) break
                    errBuf.write(readBuf, 0, n)
                }
            } catch (IOException ignored) {}
        } as Runnable)
        errThread.daemon = true
        errThread.start()

        def outBuf = new ByteArrayOutputStream()
        def readBuf = new byte[4096]
        while (true) {
            int n = testRead.read(readBuf)
            if (n == -1) throw new IllegalStateException("Stream closed before ETX")
            outBuf.write(readBuf, 0, n)
            String str = outBuf.toString("UTF-8")
            if (str.contains(SIGNAL_END_OF_MESSAGE)) {
                // ETX received — give stderr a moment to drain, then stop
                errThread.join(200)
                errThread.interrupt()
                return new ExecutionResult(
                    stdout: str.replace(SIGNAL_END_OF_MESSAGE, "").strip(),
                    stderr: errBuf.toString("UTF-8").strip()
                )
            }
        }
    }

    @Test
    void testSimpleOutput() {
        def result = send("println 'Hello, World!'")
        assert result.stdout.contains("Hello, World!")
        assert result.stderr == ""
    }

    @Test
    void testArithmetic() {
        def result = send("println 2 + 2")
        assert result.stdout.contains("4")
    }

    @Test
    void testVariableStatePreserved() {
        send("x = 42")
        def result = send("println x * 2")
        assert result.stdout.contains("84")
    }

    @Test
    void testMultiLineCode() {
        def result = send("""
            def greet(name) { "Hello, \${name}!" }
            println greet('Groovy')
        """)
        assert result.stdout.contains("Hello, Groovy!")
    }

    @Test
    void testExceptionInUserCode() {
        def result = send("throw new RuntimeException('test error')")
        assert result.stdout == ""
        assert result.stderr.contains("test error")
    }

    @Test
    void testSystemExitBlocked() {
        def result = send("System.exit(0)")
        assert result.stdout == ""
        assert result.stderr.contains("System.exit")
    }

    @Test
    void testWhitespaceOnlyCode() {
        def result = send("   ")
        assert result.stdout != null
    }

    @Test
    void testMultipleSequentialCalls() {
        assert send("println 'first'").stdout.contains("first")
        assert send("println 'second'").stdout.contains("second")
        assert send("println 'third'").stdout.contains("third")
    }

    @Test
    void testPrintWithoutNewline() {
        def result = send("print 42")
        assert result.stdout.contains("42") : "print() without newline must flush output, got: [${result.stdout}]"
    }

    @Test
    void testPrintFollowedByOtherOutput() {
        def result = send("print 'hello '\nprintln 'world'")
        assert result.stdout.contains("hello") : "print() output must appear before subsequent println, got: [${result.stdout}]"
        assert result.stdout.contains("world") : "println output must also appear, got: [${result.stdout}]"
    }

    @Test
    void testHelpCommand() {
        def result = send("help")
        assert result.stdout.contains("Output:")
        assert result.stdout.contains("Meta:")
    }

    @Test
    void testClosureAndCollection() {
        def result = send("""
            def list = [1, 2, 3]
            println list.collect { it * 2 }
        """)
        assert result.stdout.contains("[2, 4, 6]")
    }

    @Test
    void testErrorsGoToStderrNotStdout() {
        def result = send("assert false : 'boom'")
        assert result.stdout == "" : "stdout should be empty on assertion error, got: [${result.stdout}]"
        assert result.stderr.contains("boom")
    }

}
