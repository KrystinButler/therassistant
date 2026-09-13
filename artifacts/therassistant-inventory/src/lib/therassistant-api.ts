import { useEffect, useState } from "react";

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

export async function parseApiResponse<T>(
  response: Response,
): Promise<T> {
  const bodyText = await response.text();
  const contentType =
    response.headers.get("content-type") ?? "";

  let body: unknown = null;

  if (bodyText && contentType.includes("application/json")) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Request failed with ${response.status}`;

    throw new Error(message);
  }

  if (!bodyText) {
    return undefined as T;
  }

  if (body === null) {
    throw new Error(
      "The server returned an invalid response.",
    );
  }

  return body as T;
}

export function useApi<T>(path: string): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    fetch(path, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    })
      .then((response) => parseApiResponse<T>(response))
      .then((result) => {
        setData(result);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : "Unable to load data",
        );

        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [path]);

  return {
    data,
    loading,
    error,
  };
}
