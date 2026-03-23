import groovy.test.GroovyTestCase
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

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
    
    void testContextPreservedAfterCancellation() {
        eval.process("x = 42")
        
        def completed = new CountDownLatch(1)
        def thread = Thread.start {
            try {
                eval.process("while(true) { Thread.sleep(50) }")
            } finally {
                completed.countDown()
            }
        }
        
        Thread.sleep(200)
        eval.cancelCurrent()
        completed.await(2, TimeUnit.SECONDS)
        
        def result = eval.process("println x")
        assert result.contains("42")
    }
}
