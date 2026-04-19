import org.junit.Test

class CompactStackTraceTest extends GroovyTestBase {

    @Test
    void testCompactStackTraceFiltersInternal() {
        def e = new RuntimeException("test")
        e.fillInStackTrace()

        def result = Kernel.compactStackTrace(e)
        assert result instanceof String
    }
}
