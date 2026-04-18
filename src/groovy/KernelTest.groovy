import org.junit.Test
import org.junit.Before
import org.junit.After
import static groovy.test.GroovyAssert.shouldFail

class KernelTest {
    private Kernel eval

    @Before
    void setUp() {
        eval = new Kernel()
    }

    @After
    void tearDown() {
        System.setOut(eval.originalStdout)
        eval.@executor.shutdown()
    }

    @Test
    void testProcessSimpleCode() {
        String result = eval.process("println 'Hello, World!'")
        assert result.contains("Hello, World!")
    }

    @Test
    void testProcessArithmetic() {
        String result = eval.process("println 2 + 2")
        assert result.contains("4")
    }

    @Test
    void testProcessVariableAssignment() {
        eval.process("x = 10")
        String result = eval.process("println x * 2")
        assert result.contains("20")
    }

    @Test
    void testProcessMultiLineCode() {
        String result = eval.process("""
            def greet(name) { "Hello, \${name}!" }
            println greet('Groovy')
        """)
        assert result.contains("Hello, Groovy!")
    }

    @Test
    void testProcessClosure() {
        String result = eval.process("""
            def list = [1, 2, 3]
            println list.collect { it * 2 }
        """)
        assert result.contains("[2, 4, 6]")
    }

    @Test
    void testProcessEmptyCodeThrowsAssertion() {
        shouldFail(AssertionError) {
            eval.process("")
        }
    }

    @Test
    void testProcessSystemExitBlocked() {
        shouldFail(AssertionError) {
            eval.process("System.exit(0)")
        }
    }

    @Test
    void testProcessExceptionHandling() {
        shouldFail(RuntimeException) {
            eval.process("throw new RuntimeException('test error')")
        }
    }

    @Test
    void testProcessListOperations() {
        String result = eval.process("""
            def list = [1, 2, 3, 4, 5]
            println list.findAll { it > 2 }.sum()
        """)
        assert result.contains("12")
    }

    @Test
    void testProcessMapOperations() {
        String result = eval.process("""
            def map = [a: 1, b: 2]
            println map.keySet()
        """)
        assert result.contains("a") && result.contains("b")
    }

    @Test
    void testContextPreservedAfterCancellation() {
        eval.process("x = 42")

        def completed = new java.util.concurrent.CountDownLatch(1)
        def thread = Thread.start {
            try {
                eval.process("while(true) { Thread.sleep(50) }")
            } finally {
                completed.countDown()
            }
        }

        Thread.sleep(200)
        eval.cancelCurrent()
        assert completed.await(2, java.util.concurrent.TimeUnit.SECONDS)

        def result = eval.process("println x")
        assert result.contains("42")
    }
}
