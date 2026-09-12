export function money(
  cents: number | string | null | undefined,
): string {
  const value = Number(cents ?? 0) / 100;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function shortDate(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }

  const date = new Date(
    value.length === 10
      ? `${value}T12:00:00`
      : value,
  );

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function dateTime(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function label(
  value: string | null | undefined,
): string {
  if (!value) {
    return "—";
  }

  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) =>
      character.toUpperCase(),
    );
}

export function value(
  object: Record<string, unknown> | null | undefined,
  camel: string,
  snake?: string,
): unknown {
  if (!object) {
    return undefined;
  }

  if (object[camel] !== undefined) {
    return object[camel];
  }

  if (snake && object[snake] !== undefined) {
    return object[snake];
  }

  return undefined;
}

export function textValue(
  object: Record<string, unknown> | null | undefined,
  camel: string,
  snake?: string,
): string {
  const result = value(object, camel, snake);

  if (
    result === null ||
    result === undefined ||
    result === ""
  ) {
    return "—";
  }

  return String(result);
}
