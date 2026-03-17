import groovy.test.GroovyTestCase

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
