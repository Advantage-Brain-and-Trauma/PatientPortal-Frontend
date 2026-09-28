import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { format, isToday } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  FileText,
  Headset,
  Heart,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Minus,
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
import ChatApi, {
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
    default:
      return {
        title: "Something went wrong",
        message: "We're having trouble right now. Please try again shortly.",
      };
  }
};

const isSessionExpired = (error: unknown) =>
  error instanceof ChatApiError && error.kind === "session_expired";

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

const mergeMessages = (current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] => {
  const byId = new Map<string, ChatMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((a, b) => {
    const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
};

function StateIcon({ icon: Icon }: { icon: typeof Heart }) {
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
  const [insuranceTypes, setInsuranceTypes] = useState<Record<string, string>>({});
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");

  const [conversation, setConversation] = useState<ChatConversation | null>(null);
  const [conversationDepartment, setConversationDepartment] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [earliestPage, setEarliestPage] = useState(1);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");

  // Guards against double-clicks starting parallel flows, and against stale
  // responses landing after the conversation changed or the widget reset.
  const busyRef = useRef(false);
  const generationRef = useRef(0);
  const conversationUuidRef = useRef<string | null>(null);
  const latestPageRef = useRef(1);
  const refreshInFlightRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const caseLabel = useCallback(
    (chatCase: ChatCase): string => {
      const doi = formatDoi(chatCase.date_of_injury);
      const insuranceType = insuranceTypes[String(chatCase.case_id)] || "";
      if (doi && insuranceType) return `${doi} - ${insuranceType}`;
      if (doi) return doi;
      if (insuranceType) return insuranceType;
      return `Case #${chatCase.case_id}`;
    },
    [insuranceTypes]
  );

  const locationCases = useMemo(
    () => cases.filter((chatCase) => chatCase.department === selectedLocation),
    [cases, selectedLocation]
  );

  const resetFlow = useCallback(() => {
    generationRef.current += 1;
    busyRef.current = false;
    conversationUuidRef.current = null;
    latestPageRef.current = 1;
    lastMessageIdRef.current = null;
    setView("welcome");
    setErrorState(null);
    setCases([]);
    setLocations([]);
    setSelectedLocation("");
    setSelectedCaseId("");
    setConversation(null);
    setConversationDepartment("");
    setMessages([]);
    setEarliestPage(1);
    setDraft("");
    setSendError("");
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

  const openConversation = useCallback(
    async (chatCase: ChatCase) => {
      const generation = generationRef.current;
      setSelectedCaseId(String(chatCase.case_id));
      setView("connecting");
      try {
        const opened = await ChatApi.openConversation(chatCase.case_id, chatCase.department);
        if (generation !== generationRef.current) return;
        conversationUuidRef.current = opened.uuid;
        setConversation(opened);
        setConversationDepartment(chatCase.department);
        await loadLatestMessages(opened.uuid);
        if (generation !== generationRef.current) return;
        setView("conversation");
      } catch (error) {
        if (generation !== generationRef.current) return;
        conversationUuidRef.current = null;
        setConversation(null);
        showError(error, () => void openConversation(chatCase));
      }
    },
    [loadLatestMessages, showError]
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

      // Best-effort: reuse the portal's own case list for the insurance type so
      // labels match the sidebar ("MM/DD/YYYY - PI"). Joined by case id only.
      try {
        const response: any = user?.email ? await Apis.getCaseIdsByEmail(user.email) : null;
        const list = response?.data?.cases || response?.cases || [];
        if (Array.isArray(list) && generation === generationRef.current) {
          const map: Record<string, string> = {};
          for (const item of list) {
            const id = String(item?.case_id ?? item?.id ?? "");
            const insuranceType = String(item?.insurance_type ?? "").trim();
            if (id && insuranceType) map[id] = insuranceType;
          }
          setInsuranceTypes(map);
        }
      } catch {
        // Labels fall back to the date of injury / case id.
      }
      if (generation !== generationRef.current) return;

      const uniqueLocations = Array.from(
        new Set(fetchedCases.map((chatCase) => chatCase.department).filter(Boolean))
      );
      setCases(fetchedCases);
      setLocations(uniqueLocations);

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
  }, [applyLocation, showError, user?.email]);

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

  const handleSend = async () => {
    const uuid = conversationUuidRef.current;
    const text = draft.trim();
    if (!uuid || !text || sending) return;
    setSending(true);
    setSendError("");
    try {
      const sent = await ChatApi.sendMessage(uuid, text);
      if (conversationUuidRef.current !== uuid) return;
      setMessages((current) => mergeMessages(current, [sent]));
      setDraft("");
      void refreshMessages().catch(() => {});
    } catch (error) {
      if (isSessionExpired(error)) {
        setView("session_expired");
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
  const headerTitle = inConversation ? `${conversationDepartment} Care Team` : "Patient Support";
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
            <StateIcon icon={Heart} />
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
                      {!mine && <span>{conversationDepartment} Care Team</span>}
                      <span>{formatTime(message.created_at)}</span>
                    </span>
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm",
                        mine ? "bg-primary/10 text-foreground" : "bg-muted text-foreground"
                      )}
                    >
                      {message.message}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
            <div className="border-t border-border p-3">
              {sendError && <p className="mb-2 text-xs text-destructive">{sendError}</p>}
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleSend();
                }}
              >
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
                <Button type="submit" size="icon" disabled={!draft.trim() || sending} aria-label="Send message">
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
      <div className="border-b border-border px-4 pb-3 pt-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-heading text-sm font-bold">
            <Heart className="h-5 w-5 fill-primary text-primary" />
            <span className="text-foreground">
              Advantage<span className="text-primary">HCS</span>
            </span>
          </div>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Minimize chat" onClick={() => setIsMinimized(true)}>
              <Minus className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Close chat" onClick={handleClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Headset className="h-5 w-5" />
          </div>
          <p className="text-sm font-semibold text-foreground">{headerTitle}</p>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">{renderBody()}</div>

      {view !== "conversation" && (
        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          <Zap className="h-3 w-3 text-primary" />
          We typically reply in a few minutes.
        </div>
      )}
    </div>
  );
}
