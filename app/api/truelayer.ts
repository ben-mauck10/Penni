type TrueLayerDebugPayload = Record<string, unknown>;

export function getTrueLayerAuthBaseUrl() {
  return process.env.TRUELAYER_AUTH_URL?.replace(/\/+$/, "");
}

export function getTrueLayerDataApiBaseUrl() {
  return process.env.TRUELAYER_DATA_API_URL?.replace(/\/+$/, "");
}

export function getTrueLayerRedirectUri(origin: string) {
  return process.env.TRUELAYER_REDIRECT_URI?.trim() || `${origin.replace(/\/+$/, "")}/callback`;
}

export function logTrueLayerDebug(event: string, payload: TrueLayerDebugPayload) {
  console.log(`[TrueLayer] ${event}`, payload);
}

export function getUpstreamMessage(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const maybeDescription = "error_description" in data ? data.error_description : undefined;
    const maybeError = "error" in data ? data.error : undefined;
    const maybeMessage = "message" in data ? data.message : undefined;

    if (typeof maybeDescription === "string" && maybeDescription.trim()) {
      return maybeDescription;
    }

    if (typeof maybeMessage === "string" && maybeMessage.trim()) {
      return maybeMessage;
    }

    if (typeof maybeError === "string" && maybeError.trim()) {
      return maybeError;
    }
  }

  return fallback;
}
