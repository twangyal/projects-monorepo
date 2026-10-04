// The declaration-only sibling does not supply an implementation.
declare function unavailable(value: number): number;

export function measure(value: number): number;
export function measure(value: number) {
  return value * 2;
}

const
  wrapped = (
    (value: number) => {
      return value + 1;
    }
  ) satisfies (value: number) => number;

class Ledger {
  @audited
  // The member decorator belongs to the following method only.
  public async record(value: number) {
    return value;
  }
  get amount() { return 1; }
  set amount(value: number) { consume(value); }
  ['quoted']() { function blocked() {} }
  #private() { function hidden() {} }
}

const bound = class Internal {
  method() { return 1; }
};
