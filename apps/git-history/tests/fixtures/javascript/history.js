// Authored committed fixture; never execute this source.
throw new Error('SOURCE_MUST_NOT_EXECUTE');

export async function fetchRecord(id) {
  function normalize(value) {
    return String(value);
  }
  return normalize(id);
}

const
  api = {
    nested: {
      load: (value) => {
        return value + 1;
      },
    },
    save(value) {
      return '<script>literal evidence</script>' + value;
    },
  };

const Bound = class Internal {
  constructor(value) { this.value = value; }
  async refresh() {
    return this.value;
  }
  compute = function alias(value) {
    return value + 1;
  };
};

const ignored = (() => { function hidden() {} return 1; })();
const callbacks = [() => { function alsoHidden() {} }];
