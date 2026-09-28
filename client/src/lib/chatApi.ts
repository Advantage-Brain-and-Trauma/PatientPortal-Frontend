import axios, { AxiosError, AxiosRequestConfig } from "axios";

/**
 * Patient Support chat API client (backend-pp /api/chat/*).
 *
 * Deliberately a SEPARATE axios instance from `lib/api.ts`:
 * - chat endpoints authenticate with a short-lived `chat_token`, not the portal
 *   JWT, and the shared instance's request interceptor would overwrite it;
 * - the shared response interceptor treats ANY 401 as a full portal logout,
 *   but an expired chat token must only trigger a re-identify;
 * - chat endpoints are not case-scoped by the `?case_id=` interceptor — the
 *   case travels explicitly in the conversation body.
 *
 * The chat token is held in memory only (never localStorage / URL). Message
 * bodies and tokens are never logged.
 */

const chatHttp = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "https://adm.advantagehcs.com/api",
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

/** How often the open conversation is refreshed (no realtime API exists). */
export const CHAT_POLL_INTERVAL_MS = 5000;
/** Transcript page size (backend default is 50). */
export const CHAT_PAGE_SIZE = 50;

/**
 * Attachments (API reference r5): upload first via POST chat/attachments, then
 * send the returned path as `attachment` on the normal send call. Set to false
 * to show the paperclip disabled again.
 */
export const CHAT_ATTACHMENTS_ENABLED = true;
/** Backend rule: chat.attachments.max_kb = 102400 (100 MB). */
export const CHAT_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
/** Backend rule: mimes:jpg,jpeg,png,gif,webp,heic,heif,pdf,doc,docx,xls,xlsx,csv (checked by contents). */
export const CHAT_ATTACHMENT_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "heic", "heif",
  "pdf", "doc", "docx", "xls", "xlsx", "csv",
];
export const CHAT_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic", "heif"];
/** Large uploads need far longer than the 30s default. */
const CHAT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
export const CHAT_ATTACHMENT_ACCEPT = CHAT_ATTACHMENT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export type ChatErrorKind =
  | "session_expired"
  | "forbidden"
  | "not_found"
  | "validation"
  | "rate_limited"
  /** 413 from the web server (HTML, not JSON): upload exceeded the server's body limit. */
  | "too_large"
  | "network"
  | "server"
  /** 409: the patient already has a DIFFERENT open conversation (one open per patient). */
  | "open_elsewhere"
  /** 409: the conversation has been ended (closed:true) and can no longer be written to. */
  | "closed"
  /** 409: any other conflict (e.g. the staff first-responder lock). */
  | "conflict";

export class ChatApiError extends Error {
  kind: ChatErrorKind;
  status?: number;
  /** Backend-provided message, only kept for 422 validation errors (plain strings). */
  detail?: string;
  /** For `open_elsewhere`: the conversation that is already open. */
  openConversation?: { uuid: string; case_id: number | null };

  constructor(kind: ChatErrorKind, status?: number, detail?: string) {
    super(kind);
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

export interface ChatCase {
  case_id: number;
  department: string;
  date_of_injury: string | null;
}

export interface ChatPeer {
  uuid: string;
  external_type: string;
  name: string;
}

export interface ChatConversation {
  uuid: string;
  type: string;
  case_id: number | null;
  /** 1 until a thread for this case is ended; the next chat about the case is session 2, 3, ... */
  session?: number;
  /** Non-null means ENDED: still readable, never writable again. */
  closed_at?: string | null;
  last_message_at: string | null;
  peer: ChatPeer | null;
}

export interface ChatMessage {
  id: string;
  sender: { uuid: string; external_type: string; name: string };
  message: string | null;
  message_type: string;
  /** Stored path, as sent. */
  attachment: string | null;
  /** Public URL resolved by the portal (no auth, no expiry). */
  attachment_url?: string | null;
  /** Original file name for display. */
  attachment_name?: string | null;
  read_at: string | null;
  created_at: string;
}

/** Response of POST chat/attachments. `attachment` is what the send call takes. */
export interface ChatUploadedAttachment {
  attachment: string;
  url: string;
  name: string;
  size: number;
  extension: string;
}

export interface ChatMessagePage {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
  data: ChatMessage[];
}

let chatToken: string | null = null;
let identifyInFlight: Promise<string> | null = null;

const toChatError = (error: unknown): ChatApiError => {
  if (error instanceof ChatApiError) return error;
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (!status) return new ChatApiError("network");
    if (status === 401) return new ChatApiError("session_expired", status);
    if (status === 403) return new ChatApiError("forbidden", status);
    if (status === 404) return new ChatApiError("not_found", status);
    if (status === 429) return new ChatApiError("rate_limited", status);
    if (status === 413) return new ChatApiError("too_large", status);
    if (status === 409) {
      const body = error.response?.data as any;
      if (body?.open_conversation?.uuid) {
        const conflict = new ChatApiError("open_elsewhere", status);
        conflict.openConversation = {
          uuid: String(body.open_conversation.uuid),
          case_id: body.open_conversation.case_id ?? null,
        };
        return conflict;
      }
      if (body?.closed === true) return new ChatApiError("closed", status);
      return new ChatApiError("conflict", status);
    }
    if (status === 422) {
      const body = error.response?.data as any;
      const detail = typeof body?.message === "string" ? body.message : undefined;
      return new ChatApiError("validation", status, detail);
    }
    return new ChatApiError("server", status);
  }
  return new ChatApiError("server");
};

/** Forget the in-memory chat token (e.g. on logout or widget reset). */
export const clearChatToken = () => {
  chatToken = null;
  identifyInFlight = null;
};

/**
 * Exchange the portal JWT for a chat token. The ONLY call that uses the JWT.
 * A 401 here means the portal session itself is no longer valid.
 */
const identifyPatient = (): Promise<string> => {
  if (identifyInFlight) return identifyInFlight;

  identifyInFlight = (async () => {
    const jwt = localStorage.getItem("ahcs_token");
    if (!jwt) throw new ChatApiError("session_expired");
    try {
      const response = await chatHttp.post("chat/identify/patient", undefined, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      const token = response.data?.chat_token;
      if (!response.data?.success || typeof token !== "string" || !token) {
        throw new ChatApiError("server", response.status);
      }
      chatToken = token;
      return token;
    } catch (error) {
      throw toChatError(error);
    }
  })();

  identifyInFlight.finally(() => {
    identifyInFlight = null;
  }).catch(() => {});

  return identifyInFlight;
};

/**
 * Perform a chat request with the chat token. On a 401 the token is refreshed
 * via Identify exactly once and the request retried; a second failure surfaces
 * as `session_expired` (no retry loop).
 */
async function chatRequest<T>(config: AxiosRequestConfig): Promise<T> {
  const send = async (token: string) =>
    (await chatHttp.request<T>({
      ...config,
      headers: { ...(config.headers || {}), Authorization: `Bearer ${token}` },
    })).data;

  const token = chatToken || (await identifyPatient());
  try {
    return await send(token);
  } catch (error) {
    const chatError = toChatError(error);
    if (chatError.kind !== "session_expired") throw chatError;
  }

  // Chat token lapsed (inactivity) — re-identify once with the portal JWT.
  chatToken = null;
  const freshToken = await identifyPatient();
  try {
    return await send(freshToken);
  } catch (error) {
    throw toChatError(error);
  }
}

const ChatApi = {
  /** One row per case the patient may chat about, with its derived department. */
  getCases: async (): Promise<ChatCase[]> => {
    const data = await chatRequest<{ success: boolean; cases?: ChatCase[] }>({
      method: "GET",
      url: "chat/cases",
    });
    return Array.isArray(data?.cases) ? data.cases : [];
  },

  /** This patient's threads, newest activity first (open and ended). */
  getConversations: async (): Promise<ChatConversation[]> => {
    const data = await chatRequest<{ success: boolean; conversations?: ChatConversation[] }>({
      method: "GET",
      url: "chat/conversations",
    });
    return Array.isArray(data?.conversations) ? data.conversations : [];
  },

  /** Patient ends the conversation. Final and idempotent. */
  closeConversation: async (uuid: string): Promise<void> => {
    const data = await chatRequest<{ success: boolean }>({
      method: "POST",
      url: `chat/conversations/${encodeURIComponent(uuid)}/close`,
    });
    if (!data?.success) throw new ChatApiError("server");
  },

  /**
   * Open (or resume) the thread for a case. Department is taken from the same
   * case row. 409 `open_elsewhere` when a different conversation is still open.
   */
  openConversation: async (caseId: number, department: string): Promise<ChatConversation> => {
    const data = await chatRequest<{ success: boolean; conversation?: ChatConversation }>({
      method: "POST",
      url: "chat/conversations",
      data: { case_id: caseId, department },
    });
    if (!data?.success || !data.conversation?.uuid) throw new ChatApiError("server");
    return data.conversation;
  },

  /** Paginated transcript, oldest first. Also marks the thread read for the patient. */
  getMessages: async (uuid: string, page: number): Promise<ChatMessagePage> => {
    const data = await chatRequest<{ success: boolean; messages?: ChatMessagePage }>({
      method: "GET",
      url: `chat/conversations/${encodeURIComponent(uuid)}/messages`,
      params: { page, per_page: CHAT_PAGE_SIZE },
    });
    if (!data?.messages || !Array.isArray(data.messages.data)) throw new ChatApiError("server");
    return data.messages;
  },

  /**
   * Upload a file (multipart field `file`). Not conversation-scoped: nothing is
   * attached until the returned `attachment` path is sent with a message.
   */
  uploadAttachment: async (
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<ChatUploadedAttachment> => {
    const formData = new FormData();
    formData.append("file", file);
    const data = await chatRequest<{ success: boolean; attachment?: ChatUploadedAttachment }>({
      method: "POST",
      url: "chat/attachments",
      data: formData,
      // Must NOT stay application/json: axios would serialise the FormData to
      // JSON. With multipart/form-data the browser sets the boundary itself.
      headers: { "Content-Type": "multipart/form-data" },
      timeout: CHAT_UPLOAD_TIMEOUT_MS,
      onUploadProgress: (event) => {
        if (onProgress && event.total) onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
    if (!data?.success || !data.attachment?.attachment) throw new ChatApiError("server");
    return data.attachment;
  },

  /** Send a message. With an `attachment` path, `message` may be empty (file-only message). */
  sendMessage: async (
    uuid: string,
    message: string,
    attachment?: { path: string; type: "image" | "file" }
  ): Promise<ChatMessage> => {
    const body: Record<string, string> = {};
    if (message) body.message = message;
    if (attachment) {
      body.attachment = attachment.path;
      body.message_type = attachment.type;
    }
    const data = await chatRequest<{ success: boolean; message_data?: ChatMessage }>({
      method: "POST",
      url: `chat/conversations/${encodeURIComponent(uuid)}/messages`,
      data: body,
    });
    if (!data?.success || !data.message_data?.id) throw new ChatApiError("server");
    return data.message_data;
  },
};

export default ChatApi;
