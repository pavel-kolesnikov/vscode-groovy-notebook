import org.junit.Test
import org.junit.After
import static groovy.test.GroovyAssert.shouldFail

class CompactStackTraceTest {
    private Kernel kernel

    @After
    void tearDown() {
        if (kernel != null) {
            kernel.@executor.shutdown()
        }
    }

    @Test
    void testCompactStackTraceFiltersInternal() {
        kernel = new Kernel(new ByteArrayInputStream([]), new ByteArrayOutputStream(), new ByteArrayOutputStream())
        def method = Kernel.class.getDeclaredMethod("compactStackTrace", Throwable)
        method.accessible = true

        def e = new RuntimeException("test")
        e.fillInStackTrace()

        def result = method.invoke(kernel, e)
        assert result instanceof String
    }
}
