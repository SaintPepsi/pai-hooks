export interface FormatterDeps {
  now: () => Date;
  stderr: (msg: string) => void;
}

const defaultDeps: FormatterDeps = {
  now: () => new Date(),
  stderr: (msg) => process.stderr.write(msg + "\n"),
};

export function formatTimestamp(
  date: Date,
  deps: FormatterDeps = defaultDeps,
): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
