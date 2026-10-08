// JSX text is literal syntax, not a browser execution request.
export const View = (value: string) => {
  function label(input: string) {
    return input.toUpperCase();
  }
  return <section>{label(value)}</section>;
};

export default () => <aside>Anonymous export is omitted</aside>;
