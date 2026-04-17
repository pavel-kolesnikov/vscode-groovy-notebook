// AI Tool Usage BOM
// ------------------
//
// AI Tools Used:
// - Anthropic Claude Sonnet 4.6

import org.junit.Test

class PrettyPrintHelperTest {

    @Test
    void testToYamlWithMap() {
        def result = PrettyPrintHelper.toYaml([a: 1, b: 2])
        assert result.contains("a: 1")
        assert result.contains("b: 2")
    }

    @Test
    void testToYamlWithList() {
        def result = PrettyPrintHelper.toYaml([1, 2, 3])
        assert result.contains("- 1")
        assert result.contains("- 2")
        assert result.contains("- 3")
    }

    @Test
    void testToYamlWithNestedStructure() {
        def result = PrettyPrintHelper.toYaml([outer: [inner: "value"]])
        assert result.contains("outer:")
        assert result.contains("inner:")
        assert result.contains("value")
    }

    @Test
    void testToYamlWithNull() {
        def result = PrettyPrintHelper.stripTransients(null)
        assert result == null
    }

    @Test
    void testToYamlWithPrimitive() {
        def result = PrettyPrintHelper.toYaml(42)
        assert result.contains("42")
    }

    @Test
    void testToYamlWithString() {
        def result = PrettyPrintHelper.toYaml("hello")
        assert result.contains("hello")
    }

    @Test
    void testToYamlWithCustomObject() {
        def obj = new TestPerson(name: "John", age: 30)
        def result = PrettyPrintHelper.toYaml(obj)
        assert result.contains("John")
        assert result.contains("30")
    }

    @Test
    void testToYamlWithTransientField() {
        def obj = new TestPersonWithTransient(name: "Jane", temp: "temporary")
        def result = PrettyPrintHelper.toYaml(obj)
        assert result.contains("Jane")
        assert !result.contains("temporary")
    }
}
