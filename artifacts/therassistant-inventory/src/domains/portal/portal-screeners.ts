export type ScreenerAnswers = {
  phq9: Array<number | null>;
  gad7: Array<number | null>;
  cssrs: Array<boolean | null>;
  declined?: boolean;
};

export type ScreenerSummary = {
  declined: boolean;
  complete: boolean;
  phq9Total: number | null;
  gad7Total: number | null;
  cssrsSubmitted: boolean;
  cssrsPositiveItems: number[];
  phq9Responses: Array<number | null>;
  gad7Responses: Array<number | null>;
  cssrsResponses: Array<boolean | null>;
};

export const emptyScreeners = (): ScreenerAnswers => ({
  phq9: Array(9).fill(null),
  gad7: Array(7).fill(null),
  cssrs: Array(7).fill(null),
});

export function readScreeners(value: unknown): ScreenerAnswers {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const numeric = (key: string, count: number) => Array.from({ length: count }, (_, index) => {
    const values = v[key];
    const current = Array.isArray(values) ? values[index] : null;
    return Number.isInteger(current) && Number(current) >= 0 && Number(current) <= 3
      ? Number(current)
      : null;
  });

  return {
    phq9: numeric("phq9", 9),
    gad7: numeric("gad7", 7),
    cssrs: Array.from({ length: 7 }, (_, index) =>
      Array.isArray(v.cssrs) && typeof v.cssrs[index] === "boolean"
        ? v.cssrs[index] as boolean
        : null,
    ),
    declined: v.declined === true,
  };
}

export function screenerTotal(values: Array<number | null>, count: number): number | null {
  return values.length === count && values.every(
    value => value !== null && Number.isInteger(value) && value >= 0 && value <= 3,
  )
    ? (values as number[]).reduce((sum, value) => sum + value, 0)
    : null;
}

export function cssrsComplete(values: Array<boolean | null>) {
  const required = [0, 1, 5];
  if (values[1] === true) required.push(2, 3, 4);
  if (values[5] === true) required.push(6);
  return required.every(index => typeof values[index] === "boolean");
}

export function screenersComplete(value: ScreenerAnswers) {
  return value.declined === true || (
    screenerTotal(value.phq9, 9) !== null &&
    screenerTotal(value.gad7, 7) !== null &&
    cssrsComplete(value.cssrs)
  );
}

export function summarizeScreeners(value: ScreenerAnswers): ScreenerSummary {
  if (value.declined === true) {
    return {
      declined: true,
      complete: true,
      phq9Total: null,
      gad7Total: null,
      cssrsSubmitted: false,
      cssrsPositiveItems: [],
      phq9Responses: Array(9).fill(null),
      gad7Responses: Array(7).fill(null),
      cssrsResponses: Array(7).fill(null),
    };
  }

  return {
    declined: false,
    complete: screenersComplete(value),
    phq9Total: screenerTotal(value.phq9, 9),
    gad7Total: screenerTotal(value.gad7, 7),
    cssrsSubmitted: cssrsComplete(value.cssrs),
    cssrsPositiveItems: value.cssrs.flatMap((answer, index) => answer === true ? [index] : []),
    phq9Responses: [...value.phq9],
    gad7Responses: [...value.gad7],
    cssrsResponses: [...value.cssrs],
  };
}

export const phqItems = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "Trouble concentrating on things, such as reading the newspaper or watching television",
  "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
  "Thoughts that you would be better off dead or of hurting yourself in some way",
];

export const gadItems = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];

export const cssrsItems = [
  "Have you wished you were dead or wished you could go to sleep and not wake up?",
  "Have you actually had any thoughts of killing yourself?",
  "Have you thought about how you might do this?",
  "Have you had any intention of acting on these thoughts of killing yourself, as opposed to you have the thoughts, but you definitely would not act on them?",
  "Have you started to work out, or actually worked out, the specific details of how to kill yourself and did you actually intend to carry out the details of your plan?",
  "Have you ever done anything, started to do anything, or prepared to do anything to end your life?",
  "If yes, did this occur in the past 3 months?",
];
