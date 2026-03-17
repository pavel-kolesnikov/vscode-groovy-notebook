import groovy.test.GroovyTestCase

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
