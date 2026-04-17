class PrettyPrintHelper {
    static String toYaml(obj) {
        def yb = new groovy.yaml.YamlBuilder()
        yb(stripTransients(obj))
        return yb.toString()
    }

    private static Object stripTransients(obj) {
        if (obj == null) return null
        if (obj instanceof Map) {
            return obj.collectEntries { k, v -> [k, stripTransients(v)] }
        }
        if (obj instanceof List) {
            return obj.collect { stripTransients(it) }
        }
        def clazz = obj.getClass()
        if (clazz.isPrimitive() || obj instanceof Number || obj instanceof CharSequence || obj instanceof Boolean || obj instanceof Enum) {
            return obj
        }
        def pkg = clazz.package?.name
        if (pkg?.startsWith('java.') || pkg?.startsWith('javax.')) {
            return obj
        }
        def result = [:]
        clazz.declaredFields.findAll { f ->
            !java.lang.reflect.Modifier.isTransient(f.modifiers) &&
            !java.lang.reflect.Modifier.isStatic(f.modifiers) &&
            !(f.name.contains('$'))
        }.each { f ->
            f.accessible = true
            result[f.name] = stripTransients(f.get(obj))
        }
        return result
    }
}
