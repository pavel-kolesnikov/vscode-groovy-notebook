import groovy.test.GroovyTestCase

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

    void testReadySignalGoesToOriginalStdout() {
        def kernel = new Kernel()
        def originalOut = new ByteArrayOutputStream()
        def redirectedOut = new ByteArrayOutputStream()
        
        def savedOut = System.out
        System.setOut(new PrintStream(redirectedOut))
        
        try {
            kernel.originalStdout = new PrintStream(originalOut)
            kernel.originalStdout.print(SIGNAL_READY)
            kernel.originalStdout.flush()
        } finally {
            System.setOut(savedOut)
        }
        
        assert originalOut.toString() == SIGNAL_READY
        assert redirectedOut.toString() == ""
    }

    void testOutputGoesToOriginalStdoutAfterRedirection() {
        def kernel = new Kernel()
        def originalOut = new ByteArrayOutputStream()
        
        def savedOut = System.out
        System.setOut(new PrintStream(new ByteArrayOutputStream()))
        
        try {
            kernel.originalStdout = new PrintStream(originalOut)
            kernel.process("println 'hello'")
            
            kernel.originalStdout.print(kernel.scriptOutputBuf.toString("UTF-8"))
            kernel.originalStdout.print(SIGNAL_END_OF_MESSAGE)
            kernel.originalStdout.flush()
        } finally {
            System.setOut(savedOut)
        }
        
        def output = originalOut.toString()
        assert output.contains("hello")
        assert output.contains(SIGNAL_END_OF_MESSAGE)
    }
}
