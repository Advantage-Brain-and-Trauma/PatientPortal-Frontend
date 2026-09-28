import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { format, isToday } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  FileText,
  Headset,
  type LucideIcon,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Minus,
  Paperclip,
  RotateCw,
  SendHorizontal,
  Users,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import Apis from "@/lib/Apis";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ChatApi, {
  CHAT_ATTACHMENTS_ENABLED,
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_EXTENSIONS,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_POLL_INTERVAL_MS,
  ChatApiError,
  ChatCase,
  ChatConversation,
  ChatMessage,
  clearChatToken,
} from "@/lib/chatApi";

/**
 * Floating Patient Support chat widget (bottom-right on every patient page).
 *
 * Flow: Welcome -> [Location] -> [Case ID] -> Connecting -> Conversation.
 * The Location / Case ID steps are skipped automatically when only one option
 * exists. Both lists come from GET chat/cases (one row per case, with the
 * backend-derived department), so the frontend never maps cases to locations.
 */

type ChatView =
  | "welcome"
  | "loading"
  | "select_location"
  | "select_case"
  | "connecting"
  | "conversation"
  | "no_locations"
  | "no_cases"
  | "open_elsewhere"
  | "ended"
  | "session_expired"
  | "error";

interface ChatErrorState {
  title: string;
  message: string;
  retry?: () => void;
}

// Routes where the patient is not inside the portal shell.
const HIDDEN_ROUTES = ["/login", "/reset-password"];

const describeError = (error: unknown): { title: string; message: string } => {
  const kind = error instanceof ChatApiError ? error.kind : "server";
  switch (kind) {
    case "forbidden":
      return {
        title: "Not available",
        message: "This location or case isn't available for chat on your account.",
      };
    case "validation":
      return {
        title: "Something isn't right",
        message:
          (error as ChatApiError).detail || "Some of the chat details were invalid. Please try again.",
      };
    case "network":
      return {
        title: "Connection problem",
        message: "We couldn't reach the chat service. Check your connection and try again.",
      };
    case "rate_limited":
      return {
        title: "Please slow down",
        message: "Too many requests were made. Please wait a moment and try again.",
      };
    case "not_found":
      return {
        title: "Chat unavailable",
        message: "Chat isn't available right now. Please try again later.",
      };
    case "closed":
      return {
        title: "Chat ended",
        message: "This conversation has ended. Start a new chat to continue.",
      };
    case "open_elsewhere":
      return {
        title: "Conversation already open",
        message: "You already have an open conversation. End it before starting another.",
      };
    case "conflict":
      return {
        title: "Please try again",
        message: "This conversation is busy right now. Please try again in a moment.",
      };
    default:
      return {
        title: "Something went wrong",
        message: "We're having trouble right now. Please try again shortly.",
      };
  }
};

const isSessionExpired = (error: unknown) =>
  error instanceof ChatApiError && error.kind === "session_expired";

const isClosedConversation = (error: unknown) =>
  error instanceof ChatApiError && error.kind === "closed";

/** Header / message label for the team: the API's department peer name, else "{Location} Care Team". */
const careTeamNameFor = (conversation: ChatConversation, department: string): string => {
  if (conversation.peer?.external_type === "department" && conversation.peer.name) {
    return conversation.peer.name;
  }
  return department ? `${department} Care Team` : "Care Team";
};

/** "YYYY-MM-DD" -> "MM/DD/YYYY" without timezone shifts (same as the sidebar). */
const formatDoi = (raw: string | null | undefined): string => {
  const match = String(raw ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "";
};

const formatTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return isToday(date) ? format(date, "h:mm a") : format(date, "MMM d, h:mm a");
};

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/** Client-side check before upload; the backend remains the source of truth. */
const validateAttachment = (file: File): string => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (!CHAT_ATTACHMENT_EXTENSIONS.includes(extension)) {
    return `This file type isn't supported. Allowed: ${CHAT_ATTACHMENT_EXTENSIONS.join(", ").toUpperCase()}.`;
  }
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return `This file is too large. The maximum size is ${formatFileSize(CHAT_ATTACHMENT_MAX_BYTES)}.`;
  }
  return "";
};

/**
 * Only absolute http(s) attachment URLs are rendered as links (never javascript:/data:,
 * and never a relative path, which would wrongly resolve against the portal's origin).
 */
const safeAttachmentUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const attachmentName = (value: string): string => {
  const lastSegment = value.split("?")[0].split("/").pop() || "";
  try {
    return decodeURIComponent(lastSegment) || "Attachment";
  } catch {
    return lastSegment || "Attachment";
  }
};

const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
};

function StateIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Icon className="h-7 w-7" />
    </div>
  );
}

function StateText({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center">
      <h3 className="font-heading text-lg font-bold text-foreground">{title}</h3>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export default function PatientChatWidget() {
  const { user, isAuthenticated, logout } = useAuth();
  const [currentPath] = useLocation();

  const role = String(user?.role || "").toLowerCase();
  const isPatient = isAuthenticated && role !== "admin" && role !== "staff";
  const isVisible = isPatient && !HIDDEN_ROUTES.some((route) => currentPath.startsWith(route));

  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [view, setView] = useState<ChatView>("welcome");
  const [errorState, setErrorState] = useState<ChatErrorState | null>(null);

  const [cases, setCases] = useState<ChatCase[]>([]);
  // Portal case list (same source as the sidebar selector), keyed by case id.
  const [portalCases, setPortalCases] = useState<
    Record<string, { doi: string; insuranceType: string; order: number }>
  >({});
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");

  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [careTeamName, setCareTeamName] = useState("");
  // One open conversation per patient: the thread in the way, and the case the
  // patient was trying to open when the backend answered 409.
  const [otherOpen, setOtherOpen] = useState<{ uuid: string; case_id: number | null } | null>(null);
  const [pendingCase, setPendingCase] = useState<ChatCase | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [earliestPage, setEarliestPage] = useState(1);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Guards against double-clicks starting parallel flows, and against stale
  // responses landing after the conversation changed or the widget reset.
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const conversationUuidRef = useRef<string | null>(null);
  const latestPageRef = useRef(1);
  const refreshInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  // Same label as the sidebar case selector (Layout.getCaseDisplayLabel): the
  // portal case list's doi + insurance_type win; chat/cases' date_of_injury is
  // only a fallback when the case is missing from the portal list.
  const caseLabel = useCallback(
    (chatCase: ChatCase): string => {
      const portal = portalCases[String(chatCase.case_id)];
      const doi = portal ? formatDoi(portal.doi) : formatDoi(chatCase.date_of_injury);
      const insuranceType = portal?.insuranceType || "";
      if (doi && insuranceType) return `${doi} - ${insuranceType}`;
      if (doi) return doi;
      if (insuranceType) return insuranceType;
      return String(chatCase.case_id);
    },
    [portalCases]
  );

  // Filtered to the selected location, ordered like the sidebar list.
  const locationCases = useMemo(() => {
    const orderOf = (chatCase: ChatCase) =>
      portalCases[String(chatCase.case_id)]?.order ?? Number.MAX_SAFE_INTEGER;
    return cases
      .filter((chatCase) => chatCase.department === selectedLocation)
      .map((chatCase, index) => ({ chatCase, index }))
      .sort((a, b) => orderOf(a.chatCase) - orderOf(b.chatCase) || a.index - b.index)
      .map(({ chatCase }) => chatCase);
  }, [cases, selectedLocation, portalCases]);

  const resetFlow = useCallback(() => {
    generationRef.current += 1;
    busyRef.current = false;
    conversationUuidRef.current = null;
    latestPageRef.current = 1;
    lastMessageIdRef.current = null;
    setView("welcome");
    setErrorState(null);
    setCases([]);
    setPortalCases({});
    setLocations([]);
    setSelectedLocation("");
    setSelectedCaseId("");
    setConversation(null);
    setCareTeamName("");
    setOtherOpen(null);
    setPendingCase(null);
    setConfirmingEnd(false);
    setEnding(false);
    setMessages([]);
    setEarliestPage(1);
    setDraft("");
    setSendError("");
    setPendingFile(null);
  }, []);

  // A different (or no) patient signed in: drop all chat state and the token.
  useEffect(() => {
    clearChatToken();
    resetFlow();
    setIsOpen(false);
    setIsMinimized(false);
  }, [user?.email, isAuthenticated, resetFlow]);

  const showError = useCallback((error: unknown, retry?: () => void) => {
    if (isSessionExpired(error)) {
      setView("session_expired");
      return;
    }
    setErrorState({ ...describeError(error), retry });
    setView("error");
  }, []);

  /** Load the newest page of the transcript (the API is oldest-first). */
  const loadLatestMessages = useCallback(async (uuid: string) => {
    const first = await ChatApi.getMessages(uuid, 1);
    let page = first;
    if (first.last_page > 1) {
      page = await ChatApi.getMessages(uuid, first.last_page);
    }
    if (conversationUuidRef.current !== uuid) return;
    latestPageRef.current = Math.max(page.last_page, 1);
    setEarliestPage(page.current_page);
    setMessages(mergeMessages([], page.data));
  }, []);

  /** Poll step: re-read the latest page, following it forward if a new page appeared. */
  const refreshMessages = useCallback(async () => {
    const uuid = conversationUuidRef.current;
    if (!uuid || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      let page = await ChatApi.getMessages(uuid, latestPageRef.current);
      if (page.last_page > latestPageRef.current) {
        const collected = page.data;
        latestPageRef.current = page.last_page;
        page = await ChatApi.getMessages(uuid, page.last_page);
        page = { ...page, data: [...collected, ...page.data] };
      }
      if (conversationUuidRef.current !== uuid) return;
      setMessages((current) => mergeMessages(current, page.data));
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  /** Show an already-known conversation: load its transcript, then switch to the thread. */
  const enterConversation = useCallback(
    async (target: ChatConversation, department: string, generation: number) => {
      conversationUuidRef.current = target.uuid;
      setConversation(target);
      setCareTeamName(careTeamNameFor(target, department));
      setConfirmingEnd(false);
      setSendError("");
      await loadLatestMessages(target.uuid);
      if (generation !== generationRef.current) return;
      setView("conversation");
    },
    [loadLatestMessages]
  );

  const openConversation = useCallback(
    async (chatCase: ChatCase) => {
      const generation = generationRef.current;
      setSelectedCaseId(String(chatCase.case_id));
      setView("connecting");
      try {
        const opened = await ChatApi.openConversation(chatCase.case_id, chatCase.department);
        if (generation !== generationRef.current) return;
        await enterConversation(opened, chatCase.department, generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        conversationUuidRef.current = null;
        setConversation(null);
        if (error instanceof ChatApiError && error.kind === "open_elsewhere" && error.openConversation) {
          // One open conversation per patient: offer to resume or end the other one.
          setOtherOpen(error.openConversation);
          setPendingCase(chatCase);
          setView("open_elsewhere");
          return;
        }
        showError(error, () => void openConversation(chatCase));
      }
    },
    [enterConversation, showError]
  );

  /** Resume a thread that is still open (from the inbox, or the 409 payload). */
  const resumeConversation = useCallback(
    async (target: ChatConversation, allCases: ChatCase[]) => {
      const generation = generationRef.current;
      const department =
        allCases.find((chatCase) => chatCase.case_id === target.case_id)?.department || "";
      setSelectedCaseId(target.case_id ? String(target.case_id) : "");
      setView("connecting");
      try {
        await enterConversation(target, department, generation);
      } catch (error) {
        if (generation !== generationRef.current) return;
        conversationUuidRef.current = null;
        setConversation(null);
        showError(error, () => void resumeConversation(target, allCases));
      }
    },
    [enterConversation, showError]
  );

  const applyLocation = useCallback(
    (location: string, allCases: ChatCase[]) => {
      setSelectedLocation(location);
      setSelectedCaseId("");
      const matching = allCases.filter((chatCase) => chatCase.department === location);
      if (matching.length === 0) {
        setView("no_cases");
      } else if (matching.length === 1) {
        void openConversation(matching[0]);
      } else {
        setView("select_case");
      }
    },
    [openConversation]
  );

  const startFlow = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    const generation = generationRef.current;
    setErrorState(null);
    setView("loading");
    try {
      const fetchedCases = await ChatApi.getCases();
      if (generation !== generationRef.current) return;

      // Best-effort: reuse the portal's own case list (the sidebar's source) so
      // labels and order match the sidebar exactly. Joined by case id only.
      try {
        const response: any = user?.email ? await Apis.getCaseIdsByEmail(user.email) : null;
        const list = response?.data?.cases || response?.cases || [];
        if (Array.isArray(list) && generation === generationRef.current) {
          const map: Record<string, { doi: string; insuranceType: string; order: number }> = {};
          list.forEach((item: any, order: number) => {
            // Same id resolution as the sidebar (Layout.getCaseIdValue).
            const id = String(item?.case_id || item?.id || "");
            if (!id || map[id]) return;
            map[id] = {
              doi: String(item?.doi ?? "").trim(),
              insuranceType: String(item?.insurance_type ?? "").trim(),
              order,
            };
          });
          setPortalCases(map);
        }
      } catch {
        // Labels fall back to chat/cases' date of injury / case id.
      }
      if (generation !== generationRef.current) return;

      const uniqueLocations = Array.from(
        new Set(fetchedCases.map((chatCase) => chatCase.department).filter(Boolean))
      );
      setCases(fetchedCases);
      setLocations(uniqueLocations);

      // A patient may have only ONE open conversation. If one exists, resume it
      // directly instead of asking for a location/case again. Best-effort: if
      // the inbox call fails, the 409 on open still routes to the same place.
      let openThread: ChatConversation | undefined;
      try {
        const conversations = await ChatApi.getConversations();
        openThread = conversations.find((item) => !item.closed_at);
      } catch (error) {
        if (isSessionExpired(error)) throw error;
      }
      if (generation !== generationRef.current) return;
      if (openThread) {
        void resumeConversation(openThread, fetchedCases);
        return;
      }

      if (uniqueLocations.length === 0) {
        setView("no_locations");
      } else if (uniqueLocations.length === 1) {
        applyLocation(uniqueLocations[0], fetchedCases);
      } else {
        setView("select_location");
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      showError(error, () => void startFlow());
    } finally {
      busyRef.current = false;
    }
  }, [applyLocation, resumeConversation, showError, user?.email]);

  /** 409 screen: continue the conversation that is already open. */
  const handleContinueOther = () => {
    if (!otherOpen) return;
    void resumeConversation(
      {
        uuid: otherOpen.uuid,
        type: "direct",
        case_id: otherOpen.case_id,
        closed_at: null,
        last_message_at: null,
        peer: null,
      },
      cases
    );
  };

  /** 409 screen: end the open conversation, then open the one the patient chose. */
  const handleEndOtherAndStart = async () => {
    if (!otherOpen || !pendingCase || ending) return;
    const generation = generationRef.current;
    const target = pendingCase;
    setEnding(true);
    try {
      await ChatApi.closeConversation(otherOpen.uuid);
      if (generation !== generationRef.current) return;
      setOtherOpen(null);
      setPendingCase(null);
      void openConversation(target);
    } catch (error) {
      if (generation !== generationRef.current) return;
      showError(error, () => void handleEndOtherAndStart());
    } finally {
      setEnding(false);
    }
  };

  /** Patient ends the current conversation (final on the backend). */
  const handleEndChat = async () => {
    const uuid = conversationUuidRef.current;
    if (!uuid || ending) return;
    setEnding(true);
    try {
      await ChatApi.closeConversation(uuid);
      if (conversationUuidRef.current !== uuid) return;
      // Ended from the close (X) warning: end the chat and close the popup.
      setConfirmingEnd(false);
      setIsOpen(false);
      setIsMinimized(false);
      resetFlow();
    } catch (error) {
      if (isSessionExpired(error)) {
        setView("session_expired");
      } else {
        setSendError(describeError(error).message);
        setConfirmingEnd(false);
      }
    } finally {
      setEnding(false);
    }
  };

  /** From an ended / blocked state: back to the start of the flow. */
  const handleStartOver = () => {
    resetFlow();
    void startFlow();
  };

  const handleLocationContinue = () => {
    if (selectedLocation) applyLocation(selectedLocation, cases);
  };

  const handleCaseStart = () => {
    const chatCase = locationCases.find((item) => String(item.case_id) === selectedCaseId);
    if (chatCase) void openConversation(chatCase);
  };

  const backToLocations = () => {
    setSelectedCaseId("");
    setView("select_location");
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;
    const problem = validateAttachment(file);
    if (problem) {
      setPendingFile(null);
      setSendError(problem);
      return;
    }
    setSendError("");
    setPendingFile(file);
  };

  const handleSend = async () => {
    const uuid = conversationUuidRef.current;
    const text = draft.trim();
    const file = CHAT_ATTACHMENTS_ENABLED ? pendingFile : null;
    if (!uuid || (!text && !file) || sending) return;
    setSending(true);
    setSendError("");
    try {
      const sent = file
        ? await ChatApi.uploadAttachment(uuid, file, text || undefined)
        : await ChatApi.sendMessage(uuid, text);
      if (conversationUuidRef.current !== uuid) return;
      setMessages((current) => mergeMessages(current, [sent]));
      setDraft("");
      setPendingFile(null);
      void refreshMessages().catch(() => {});
    } catch (error) {
      if (isSessionExpired(error)) {
        setView("session_expired");
      } else if (isClosedConversation(error)) {
        // The conversation was ended (e.g. by the care team) — it can't be written to again.
        setView("ended");
      } else {
        setSendError(describeError(error).message);
      }
    } finally {
      setSending(false);
    }
  };

  const handleLoadEarlier = async () => {
    const uuid = conversationUuidRef.current;
    if (!uuid || earliestPage <= 1 || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await ChatApi.getMessages(uuid, earliestPage - 1);
      if (conversationUuidRef.current !== uuid) return;
      setEarliestPage(page.current_page);
      setMessages((current) => mergeMessages(current, page.data));
    } catch (error) {
      if (isSessionExpired(error)) setView("session_expired");
    } finally {
      setLoadingEarlier(false);
    }
  };

  // Poll the open conversation. A self-scheduling timeout (not setInterval)
  // guarantees requests never overlap; it only runs while the thread is on
  // screen and pauses while the browser tab is hidden.
  useEffect(() => {
    if (!isVisible || !isOpen || isMinimized || view !== "conversation" || !conversation) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (cancelled) return;
      if (!document.hidden) {
        try {
          await refreshMessages();
        } catch (error) {
          if (cancelled) return;
          if (isSessionExpired(error)) {
            setView("session_expired");
            return;
          }
          // Transient failures are retried on the next tick.
        }
      }
      if (!cancelled) timer = setTimeout(tick, CHAT_POLL_INTERVAL_MS);
    };

    timer = setTimeout(tick, CHAT_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isVisible, isOpen, isMinimized, view, conversation, refreshMessages]);

  // Keep the newest message in view when one arrives (not when loading older ones).
  useEffect(() => {
    const newest = messages[messages.length - 1]?.id ?? null;
    if (newest && newest !== lastMessageIdRef.current) {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
    lastMessageIdRef.current = newest;
  }, [messages]);

  // Re-anchor to the bottom when the thread is shown again after minimizing.
  useEffect(() => {
    if (isOpen && !isMinimized && view === "conversation") {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    }
  }, [isOpen, isMinimized, view]);

  const handleLauncherClick = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  const handleClose = () => {
    // Closing an active conversation ends it, so warn first.
    if (view === "conversation" && conversationUuidRef.current) {
      setConfirmingEnd(true);
      return;
    }
    setIsOpen(false);
    setIsMinimized(false);
    resetFlow();
  };

  const handleStartNewChat = () => {
    clearChatToken();
    resetFlow();
    void startFlow();
  };

  if (!isVisible) return null;

  const inConversation = view === "conversation" && conversation;
  const headerTitle = inConversation ? careTeamName : "Patient Support";
  const otherOpenCase = otherOpen
    ? cases.find((chatCase) => chatCase.case_id === otherOpen.case_id)
    : undefined;
  const canGoBackToLocations = locations.length > 1;

  // ---- Closed / minimized: floating launcher -------------------------------
  if (!isOpen || isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-end gap-3 sm:bottom-6 sm:right-6">
        {!isMinimized && (
          <div className="hidden rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground shadow-soft sm:block">
            <p>Need help?</p>
            <p>Chat with us!</p>
          </div>
        )}
        <button
          type="button"
          onClick={handleLauncherClick}
          aria-label={isMinimized ? "Open chat" : "Open patient support chat"}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <MessageCircle className="h-6 w-6" />
          {isMinimized && inConversation && (
            <span className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-card bg-sidebar-primary" />
          )}
        </button>
      </div>
    );
  }

  const renderBody = () => {
    switch (view) {
      case "welcome":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateText title="Let's chat!">Select where you need assistance to get started.</StateText>
            <Button className="mt-6 w-full" onClick={() => void startFlow()}>
              Start chat
            </Button>
          </div>
        );

      case "loading":
        return (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
            <Spinner className="size-6 text-primary" />
            Loading your options...
          </div>
        );

      case "select_location":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={MapPin} />
            <StateText title="Choose a location">Select the clinic you want help with.</StateText>
            <Select value={selectedLocation} onValueChange={setSelectedLocation}>
              <SelectTrigger className="mt-5 w-full" aria-label="Location">
                <SelectValue placeholder="-- Choose a location --" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                {locations.map((location) => (
                  <SelectItem key={location} value={location}>
                    {location}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="mt-4 w-full" disabled={!selectedLocation} onClick={handleLocationContinue}>
              Continue
            </Button>
          </div>
        );

      case "select_case":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={FileText} />
            <StateText title="Choose a Case ID">Select the case you want help with.</StateText>
            <Select value={selectedCaseId} onValueChange={setSelectedCaseId}>
              <SelectTrigger className="mt-5 w-full" aria-label="Case ID">
                <SelectValue placeholder="-- Choose a Case ID --" />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                {locationCases.map((chatCase) => (
                  <SelectItem key={chatCase.case_id} value={String(chatCase.case_id)}>
                    {caseLabel(chatCase)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button className="mt-4 w-full" disabled={!selectedCaseId} onClick={handleCaseStart}>
              Start the chat
            </Button>
            {canGoBackToLocations && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={backToLocations}>
                <ArrowLeft className="h-4 w-4" /> Back to locations
              </Button>
            )}
          </div>
        );

      case "connecting":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={MessagesSquare} />
            <StateText title="Connecting you to your care team...">
              Please hold on while we open your conversation.
            </StateText>
            <div className="mx-auto mt-5">
              <Spinner className="size-6 text-primary" />
            </div>
          </div>
        );

      case "no_locations":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={Users} />
            <StateText title="No locations available">
              We couldn't find an active location available for chat.
            </StateText>
            <div className="mt-4 flex gap-2 rounded-lg bg-primary/5 p-3 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 text-primary" />
              If you believe this is incorrect, please contact your care team.
            </div>
          </div>
        );

      case "no_cases":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={FileText} />
            <StateText title="No cases available">
              We couldn't find an active case for the selected location.
            </StateText>
            {canGoBackToLocations && (
              <Button variant="outline" className="mt-5 w-full" onClick={backToLocations}>
                <ArrowLeft className="h-4 w-4" /> Choose another location
              </Button>
            )}
          </div>
        );

      case "open_elsewhere":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={MessagesSquare} />
            <StateText title="You already have an open conversation">
              You can have one conversation open at a time
              {otherOpenCase
                ? ` (${otherOpenCase.department}, ${caseLabel(otherOpenCase)}).`
                : "."}{" "}
              Continue it, or end it to start this one.
            </StateText>
            <Button className="mt-5 w-full" disabled={ending} onClick={handleContinueOther}>
              Continue that conversation
            </Button>
            <Button
              variant="outline"
              className="mt-2 w-full"
              disabled={ending}
              onClick={() => void handleEndOtherAndStart()}
            >
              {ending ? <Spinner /> : null} End it & start this one
            </Button>
          </div>
        );

      case "ended":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={MessageCircle} />
            <StateText title="This conversation has ended">
              Your care team has closed this conversation. Start a new chat to continue.
            </StateText>
            <Button className="mt-5 w-full" onClick={handleStartOver}>
              Start a new chat
            </Button>
          </div>
        );

      case "session_expired":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={Clock} />
            <StateText title="Your chat session has expired">
              Please sign in again to continue chatting with your care team.
            </StateText>
            <Button className="mt-5 w-full" onClick={() => void logout()}>
              Sign in to continue
            </Button>
            <Button variant="outline" className="mt-2 w-full" onClick={handleStartNewChat}>
              Start a new chat
            </Button>
          </div>
        );

      case "error":
        return (
          <div className="flex flex-1 flex-col justify-center p-6">
            <StateIcon icon={AlertCircle} />
            <StateText title={errorState?.title || "Something went wrong"}>{errorState?.message}</StateText>
            {errorState?.retry && (
              <Button className="mt-5 w-full" onClick={errorState.retry}>
                <RotateCw className="h-4 w-4" /> Try again
              </Button>
            )}
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => resetFlow()}>
              Start over
            </Button>
          </div>
        );

      case "conversation":
        return (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
              {earliestPage > 1 && (
                <div className="text-center">
                  <Button variant="ghost" size="sm" disabled={loadingEarlier} onClick={handleLoadEarlier}>
                    {loadingEarlier ? <Spinner /> : null} Load earlier messages
                  </Button>
                </div>
              )}
              {messages.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Send a message to start the conversation.
                </p>
              )}
              {messages.map((message) => {
                const mine = message.sender?.external_type === "patient";
                return (
                  <div key={message.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                    <span className="mb-1 flex gap-2 text-[11px] text-muted-foreground">
                      {!mine && <span>{careTeamName}</span>}
                      <span>{formatTime(message.created_at)}</span>
                    </span>
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-primary/10 text-foreground" : "bg-muted text-foreground"
                      )}
                    >
                      {message.attachment && (() => {
                        const href = safeAttachmentUrl(message.attachment);
                        const name = attachmentName(message.attachment);
                        const content = (
                          <>
                            <FileText className="h-4 w-4 shrink-0 text-primary" />
                            <span className="truncate">{name}</span>
                          </>
                        );
                        return href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cn("flex items-center gap-2 underline-offset-2 hover:underline", message.message && "mb-1")}
                          >
                            {content}
                          </a>
                        ) : (
                          <span className={cn("flex items-center gap-2", message.message && "mb-1")}>{content}</span>
                        );
                      })()}
                      {message.message}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-border p-3">
              {sendError && <p className="mb-2 text-xs text-destructive">{sendError}</p>}
              {pendingFile && (
                <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{pendingFile.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatFileSize(pendingFile.size)}</span>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    disabled={sending}
                    onClick={() => setPendingFile(null)}
                    className="rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
                {CHAT_ATTACHMENTS_ENABLED ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={CHAT_ATTACHMENT_ACCEPT}
                      className="hidden"
                      onChange={handleFileSelected}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Attach a document"
                      disabled={sending}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  // Upload API not live yet: visible but disabled. The span keeps the
                  // tooltip working (disabled buttons don't fire pointer events).
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <Button type="button" variant="outline" size="icon" disabled aria-label="Attachments coming soon">
                          <Paperclip className="h-4 w-4" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="z-[60]">
                      Attachments coming soon
                    </TooltipContent>
                  </Tooltip>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  maxLength={5000}
                  placeholder="Type a message..."
                  aria-label="Message"
                  className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={(!draft.trim() && !pendingFile) || sending}
                  aria-label="Send message"
                >
                  {sending ? <Spinner /> : <SendHorizontal className="h-4 w-4" />}
                </Button>
              </form>
            </div>
          </>
        );
    }
  };

  // ---- Open popup ----------------------------------------------------------
  return (
    <div
      role="dialog"
      aria-label="Patient support chat"
      className="fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:bottom-6 sm:right-6 sm:w-[370px]"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headset className="h-5 w-5" />
          </div>
          <p className="truncate text-sm font-semibold text-foreground">{headerTitle}</p>
        </div>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Minimize chat" onClick={() => setIsMinimized(true)}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close chat" onClick={handleClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{renderBody()}</div>

      {view !== "conversation" && (
        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Zap className="h-3 w-3 text-primary" />
          We typically reply in a few minutes.
        </div>
      )}

      {/* Close (X) during an active conversation: warn that closing ends the chat.
          Rendered INSIDE the popup (not portaled) so it only covers the chat, not the site. */}
      {confirmingEnd && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !ending) setConfirmingEnd(false);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="chat-end-title"
            aria-describedby="chat-end-description"
            className="w-full rounded-lg border border-border bg-card p-5 shadow-lg"
          >
            <h3 id="chat-end-title" className="font-heading text-base font-bold text-foreground">
              End this chat?
            </h3>
            <p id="chat-end-description" className="mt-2 text-sm text-muted-foreground">
              Closing will end your conversation with the {careTeamName || "care team"}. You won't be able to
              send more messages in it, but you can start a new chat any time. To keep this chat open, use
              minimize instead.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" autoFocus disabled={ending} onClick={() => setConfirmingEnd(false)}>
                Keep chatting
              </Button>
              <Button variant="destructive" disabled={ending} onClick={() => void handleEndChat()}>
                {ending ? <Spinner /> : null} End chat
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
