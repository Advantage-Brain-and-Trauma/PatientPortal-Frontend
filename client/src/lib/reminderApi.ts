import axios, { AxiosError } from "axios";

/**
 * ABT appointment reminder API client (public /abt-reminder page).
 *
 * Deliberately a SEPARATE axios instance from `lib/api.ts`:
 * - the only credential is the reminder token from the SMS link, sent in the
 *   URL path — the portal JWT must never be attached to these calls;
 * - the shared response interceptor treats any 401 as a full portal logout,
 *   which must not happen to a signed-in patient because of a reminder error;
 * - these endpoints are not case-scoped (no `?case_id=` injection).
 *
 * The token is never logged or persisted outside the page URL.
 */

const reminderHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "https://adm.advantagehcs.com/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

/** Backend rule: help request note max length. */
export const REMINDER_NOTE_MAX_LENGTH = 500;

export type ResponseStatus = "confirmed" | "help_requested" | null;

export interface ReminderAppointment {
  patient_first_name: string | null;
  /** YYYY-MM-DD */
  attend_date: string;
  /** HH:MM:SS, clinic time (America/Chicago) */
  time: string;
  end_time: string | null;
  provider_name: string | null;
  service: string | null;
  visit_type: string | null;
  visit_type_name: string | null;
  location: string | null;
  address: string | null;
  facility_phone_no: string | null;
  /** 1 = telehealth, 0 = in person */
  is_virtual: number;
  attend_status: string;
  can_respond: boolean;
  /**
   * status stays "confirmed" after a later help request.
   * reason: help text sent before confirming, otherwise null.
   * help_reason: latest help text sent after confirming, otherwise null
   * (optional so older backends without the field still type-check).
   */
  response: { status: ResponseStatus; reason: string | null; help_reason?: string | null };
  /** Present on the help-request response: the label of what was requested. */
  request?: string;
}

export interface ReminderTimeSlot {
  /** H:i, sent back to the reschedule call */
  time: string;
  /** Display label, e.g. "1:00 PM" */
  label: string;
}

export interface ReminderTimeSlots {
  attend_date: string;
  current_time: string;
  /** At most 3: the earliest open times later the same day. */
  slots: ReminderTimeSlot[];
  /** null when there are slots; otherwise why none are open (e.g. "Not Available", holiday, provider leave). */
  message?: string | null;
}

export interface ReminderReschedule {
  attend_date: string;
  time: string;
  end_time: string | null;
}

export type HelpCategory = "transportation" | "location" | "other";

export interface HelpRequestBody {
  category: HelpCategory;
  option: string;
  note?: string;
}

export type ReminderErrorKind =
  | "invalid_link"
  | "expired"
  | "unprocessable"
  | "rate_limited"
  | "network"
  | "server";

export class ReminderApiError extends Error {
  kind: ReminderErrorKind;
  status?: number;
  fieldErrors: Record<string, string[]>;

  constructor(kind: ReminderErrorKind, message: string, status?: number, fieldErrors: Record<string, string[]> = {}) {
    super(message);
    this.name = "ReminderApiError";
    this.kind = kind;
    this.status = status;
    this.fieldErrors = fieldErrors;
  }

  /** First validation message for a field, if the backend sent one. */
  fieldError(field: string): string | undefined {
    return this.fieldErrors[field]?.[0];
  }
}

const DEFAULT_MESSAGES: Record<ReminderErrorKind, string> = {
  invalid_link: "This link is not valid.",
  expired: "This appointment has already passed.",
  unprocessable: "We couldn’t complete that request. Please call us for help.",
  rate_limited: "Too many requests. Please wait a minute and try again.",
  network: "We couldn’t connect. Please check your connection and try again.",
  server: "Something went wrong. Please try again.",
};

const toReminderError = (error: unknown): ReminderApiError => {
  if (error instanceof ReminderApiError) return error;
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (!status) return new ReminderApiError("network", DEFAULT_MESSAGES.network);
    const body = (error.response?.data ?? {}) as { message?: unknown; errors?: unknown };
    const message = typeof body.message === "string" && body.message ? body.message : undefined;
    const fieldErrors =
      body.errors && typeof body.errors === "object" ? (body.errors as Record<string, string[]>) : {};
    let kind: ReminderErrorKind = "server";
    if (status === 404) kind = "invalid_link";
    else if (status === 410) kind = "expired";
    else if (status === 429) kind = "rate_limited";
    else if (status >= 400 && status < 500) kind = "unprocessable";
    // 429 bodies are not guaranteed to carry a readable message.
    const text = kind === "rate_limited" ? DEFAULT_MESSAGES.rate_limited : message || DEFAULT_MESSAGES[kind];
    return new ReminderApiError(kind, text, status, fieldErrors);
  }
  return new ReminderApiError("server", DEFAULT_MESSAGES.server);
};

async function request<T>(method: "get" | "post", path: string, body?: unknown): Promise<T> {
  try {
    const response = await reminderHttp.request<{ success: boolean; data?: T; message?: string }>({
      method,
      url: path,
      data: body,
    });
    if (!response.data?.success) {
      throw new ReminderApiError("server", response.data?.message || DEFAULT_MESSAGES.server, response.status);
    }
    return response.data.data as T;
  } catch (error) {
    throw toReminderError(error);
  }
}

const base = (token: string) => `appointment-reminder/${encodeURIComponent(token)}`;

const ReminderApi = {
  getAppointment: (token: string) => request<ReminderAppointment>("get", base(token)),
  confirm: (token: string) => request<ReminderAppointment>("post", `${base(token)}/confirm`),
  getTimeSlots: (token: string) => request<ReminderTimeSlots>("get", `${base(token)}/time-slots`),
  reschedule: (token: string, time: string) => request<ReminderReschedule>("post", `${base(token)}/reschedule`, { time }),
  helpRequest: (token: string, body: HelpRequestBody) =>
    request<ReminderAppointment>("post", `${base(token)}/help-request`, body),
};

export default ReminderApi;
