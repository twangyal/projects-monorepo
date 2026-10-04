"""Fixed optional-parser protocol limits; importing this module loads no grammar."""

MAX_SOURCE_BYTES = 512 * 1024
MAX_FUNCTIONS = 10_000
MAX_QUALIFIED_NAME_BYTES = 2 * 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
WALL_SECONDS = 5.0
ADDRESS_SPACE_BYTES = 512 * 1024 * 1024
CPU_SECONDS = (3, 4)

LANGUAGES = frozenset({'javascript', 'typescript', 'tsx'})
KINDS = frozenset({'function', 'async function', 'getter', 'setter'})
ERROR_CODES = frozenset({'dependencies', 'syntax', 'complexity', 'unsupported'})
SUFFIX_LANGUAGES = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
    '.cjs': 'javascript', '.ts': 'typescript', '.mts': 'typescript',
    '.cts': 'typescript', '.tsx': 'tsx',
}
