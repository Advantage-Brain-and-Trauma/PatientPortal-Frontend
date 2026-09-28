/**
 * Cross-tab sync for the Patient Support chat widget (BroadcastChannel,
 * same-origin tabs only). Carries ONLY event names and ids — never message
 * text, names or tokens. Each tab re-reads data through the chat API itself.
 * The popup's open/minimized/closed state is deliberately NOT synced.
 */

export type ChatSyncEvent =
  /** A tab entered this conversation (opened, resumed, or started a new session). */
  | { type: "conversation_opened"; uuid: string }
  /** A tab sent a message: others should refresh the transcript now. */
  | { type: "messages_changed"; uuid: string }
  /** A tab ended this conversation. */
  | { type: "conversation_ended"; uuid: string }
  /** Logout / account change: drop chat state. */
  | { type: "reset" };

type Envelope = ChatSyncEvent & { account: string };

const CHANNEL_NAME = "ahcs-patient-chat";

const channel: BroadcastChannel | null =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(CHANNEL_NAME)
    : null;

/** Tell other tabs about a chat event. `account` scopes it to the signed-in account. */
export const broadcastChatEvent = (account: string, event: ChatSyncEvent) => {
  if (!channel) return;
  try {
    channel.postMessage({ ...event, account } satisfies Envelope);
  } catch {
    // Sync is best-effort; each tab still works on its own.
  }
};

/** Listen for chat events from other tabs. Returns an unsubscribe function. */
export const subscribeChatEvents = (
  handler: (event: ChatSyncEvent & { account: string }) => void
): (() => void) => {
  if (!channel) return () => {};
  const listener = (message: MessageEvent<Envelope>) => {
    const data = message.data;
    if (data && typeof data === "object" && typeof data.type === "string") handler(data);
  };
  channel.addEventListener("message", listener);
  return () => channel.removeEventListener("message", listener);
};
