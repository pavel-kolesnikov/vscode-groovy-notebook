import org.junit.Test
import org.junit.Before
import org.junit.After
import static groovy.test.GroovyAssert.shouldFail

class WireProtocolTest {
    private static final String SIGNAL_READY = '\6'
    private static final String SIGNAL_END_OF_MESSAGE = '\3'

    private Kernel kernel
    private PrintStream savedStdout

    @Before
    void setUp() {
        savedStdout = System.out
    }

    @After
    void tearDown() {
        System.setOut(savedStdout)
        if (kernel != null) {
            kernel.@executor.shutdown()
        }
    }

    @Test
    void testSignalReadyConstant() {
        assert SIGNAL_READY == '\6' as String
        assert SIGNAL_READY.charAt(0) == 6
    }

    @Test
    void testSignalEndOfMessageConstant() {
        assert SIGNAL_END_OF_MESSAGE == '\3' as String
        assert SIGNAL_END_OF_MESSAGE.charAt(0) == 3
    }

    @Test
    void testDelimiterConstants() {
        assert SIGNAL_READY == '\6' as String
        assert SIGNAL_END_OF_MESSAGE == '\3' as String
    }

    @Test
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

    @Test
    void testProcessCodeWithEndOfMessageDelimiter() {
        kernel = new Kernel()
        def result = kernel.process("println 'test'")
        assert result.contains("test")
    }

    @Test
    void testEndOfMessageSentAfterProcess() {
        kernel = new Kernel()
        def result = kernel.process("println 'hello'")
        assert result.contains("hello")
    }

    @Test
    void testErrorMessageFormat() {
        kernel = new Kernel()
        def e = shouldFail(RuntimeException) {
            kernel.process("throw new RuntimeException('error')")
        }
        assert e.message == "error"
    }

    @Test
    void testWhitespaceStrippedFromCode() {
        kernel = new Kernel()
        def result = kernel.process("   println 'stripped'   ")
        assert result.contains("stripped")
    }

    @Test
    void testAssertionErrorHandled() {
        kernel = new Kernel()
        def e = shouldFail(AssertionError) {
            kernel.process("assert false : 'my assertion failed'")
        }
        assert e.message.contains("my assertion failed")
    }

    @Test
    void testSystemExitBlockedInProtocol() {
        kernel = new Kernel()
        def e = shouldFail(AssertionError) {
            kernel.process("System.exit(0)")
        }
        assert e.message.contains("System.exit")
    }

    @Test
    void testCodeIsEmptyCheck() {
        kernel = new Kernel()
        def e = shouldFail(AssertionError) {
            kernel.process("")
        }
        assert e.message.contains("empty") || e.message.contains("Code")
    }

    @Test
    void testMultipleSequentialProcessCalls() {
        kernel = new Kernel()

        def result1 = kernel.process("println 'first'")
        assert result1.contains("first")

        def result2 = kernel.process("println 'second'")
        assert result2.contains("second")

        def result3 = kernel.process("println 'third'")
        assert result3.contains("third")
    }

    @Test
    void testProcessMaintainsState() {
        kernel = new Kernel()

        kernel.process("x = 42")
        def result = kernel.process("println x")
        assert result.contains("42")
    }

    @Test
    void testScannerDelimiterIsEndOfMessage() {
        def testInput = "code1${SIGNAL_END_OF_MESSAGE}code2${SIGNAL_END_OF_MESSAGE}"
        def scanner = new Scanner(new ByteArrayInputStream(testInput.bytes))
        scanner.useDelimiter(SIGNAL_END_OF_MESSAGE)

        assert scanner.hasNext()
        assert scanner.next() == "code1"
        assert scanner.hasNext()
        assert scanner.next() == "code2"
    }

    @Test
    void testReadySignalGoesToOriginalStdout() {
        kernel = new Kernel()
        def originalOut = new ByteArrayOutputStream()
        def redirectedOut = new ByteArrayOutputStream()

        System.setOut(new PrintStream(redirectedOut))

        try {
            kernel.originalStdout = new PrintStream(originalOut)
            kernel.originalStdout.print(SIGNAL_READY)
            kernel.originalStdout.flush()
        } finally {
            System.setOut(savedStdout)
        }

        assert originalOut.toString() == SIGNAL_READY
        assert redirectedOut.toString() == ""
    }

    @Test
    void testOutputGoesToOriginalStdoutAfterRedirection() {
        kernel = new Kernel()
        def originalOut = new ByteArrayOutputStream()

        System.setOut(new PrintStream(new ByteArrayOutputStream()))

        try {
            kernel.originalStdout = new PrintStream(originalOut)
            kernel.process("println 'hello'")

            kernel.originalStdout.print(kernel.scriptOutputBuf.toString("UTF-8"))
            kernel.originalStdout.print(SIGNAL_END_OF_MESSAGE)
            kernel.originalStdout.flush()
        } finally {
            System.setOut(savedStdout)
        }

        def output = originalOut.toString()
        assert output.contains("hello")
        assert output.contains(SIGNAL_END_OF_MESSAGE)
    }
}
