import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Accessibility,
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CalendarX2,
  CarFront,
  Check,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  CircleParking,
  ClipboardList,
  DoorOpen,
  Headphones,
  Info,
  Link2Off,
  Loader2,
  MapPin,
  MessageCircleQuestion,
  Navigation,
  Phone,
  RotateCcw,
  UserRound,
  Video,
  type LucideIcon,
} from "lucide-react";
import { ABT_REMINDER_BASE } from "@/lib/publicRoutes";
import ReminderApi, {
  REMINDER_NOTE_MAX_LENGTH,
  ReminderApiError,
  type HelpCategory,
  type ReminderAppointment,
  type ReminderReschedule,
} from "@/lib/reminderApi";
import "./abt-reminder.css";

/*
 * Public ABT appointment reminder (/abt-reminder/*?token=…).
 *
 * The patient opens it from the reminder SMS. The token in `?token=` is the
 * only credential (no portal login) and is carried on every sub-page URL.
 * Appointment details come from the appointment-reminder API and are reloaded
 * on every screen; confirm / reschedule / help requests post back to it.
 */

const ASSET_BASE = "/abt-reminder";
const LOGO_SRC = `${ASSET_BASE}/abt-logo.png`;
const TRANSPORTATION_ART = `${ASSET_BASE}/abt-transportation-support.webp`;
const LOCATION_ART = `${ASSET_BASE}/abt-location-support.webp`;
const CARE_ART = `${ASSET_BASE}/abt-care-support.webp`;

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700;800&display=swap";
const PAGE_TITLE = "ABT Appointment Reminder";

const PRACTICE_NAME = "Advantage Brain & Trauma";
const FALLBACK_PHONE = "877-487-8289";
const CLINIC_TIMEZONE = "America/Chicago";

/** sessionStorage keys (tab-scoped; never holds the raw token). */
const RESCHEDULED_KEY = "abt-rescheduled";
const REQUEST_LABEL_KEY = "abt-request-label";

type Choice = { id: string; label: string; icon: LucideIcon };

// Option ids/labels follow the "Help Request Options" sheet.
const TRANSPORTATION_OPTIONS: Choice[] = [
  { id: "ride", label: "I need help finding a ride", icon: CarFront },
  { id: "call", label: "Please call me about transportation", icon: Phone },
];

const LOCATION_OPTIONS: Choice[] = [
  { id: "parking", label: "Parking information", icon: CircleParking },
  { id: "entrance", label: "Which entrance to use", icon: DoorOpen },
  { id: "accessibility", label: "Accessibility information", icon: Accessibility },
  { id: "call", label: "Please call me about the location", icon: Phone },
];

const CONCERN_OPTIONS: Choice[] = [
  { id: "insurance", label: "Insurance or cost", icon: BadgeDollarSign },
  { id: "paperwork", label: "Paperwork questions", icon: ClipboardList },
  { id: "scheduling", label: "Another scheduling question", icon: CalendarClock },
  { id: "other", label: "Something else", icon: MessageCircleQuestion },
];

// ---------------------------------------------------------------------------
// Formatting (dates/times are clinic-local strings; never shifted by timezone)
// ---------------------------------------------------------------------------

function toUtcDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatLongDate(isoDate: string) {
  return toUtcDate(isoDate).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatShortDate(isoDate: string) {
  return toUtcDate(isoDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatTime(time: string) {
  const [hourText, minuteText = "00"] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minuteText.padStart(2, "0")} ${suffix}`;
}

function phoneHref(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `tel:+1${digits}` : `tel:+${digits}`;
}

function directionsHref(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** Non-reversible tag so stored state can be matched to a link without storing the token. */
function tokenTag(token: string) {
  let hash = 5381;
  for (let index = 0; index < token.length; index += 1) hash = (hash * 33) ^ token.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

function readSession(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode) — the screen falls back to API data.
  }
}

function readRescheduled(token: string): ReminderReschedule | null {
  const raw = readSession(RESCHEDULED_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as ReminderReschedule & { ref?: string };
    return stored.ref === tokenTag(token) ? stored : null;
  } catch {
    return null;
  }
}

function downloadCalendarFile(appointment: ReminderAppointment, date: string, time: string, endTime: string | null) {
  const compactDate = date.replace(/-/g, "");
  const toIcsTime = (value: string) => value.replace(/:/g, "").padEnd(6, "0").slice(0, 6);
  const start = `${compactDate}T${toIcsTime(time)}`;
  const end = endTime
    ? `${compactDate}T${toIcsTime(endTime)}`
    : start.replace(
        /(\d{2})(\d{2})(\d{2})$/,
        (_match, hour: string, minute: string, second: string) =>
          `${String(Math.min(Number(hour) + 1, 23)).padStart(2, "0")}${minute}${second}`,
      );
  const phone = appointment.facility_phone_no || FALLBACK_PHONE;
  const location = appointment.is_virtual
    ? "Virtual visit"
    : [appointment.address, appointment.location].filter(Boolean).join(", ") || PRACTICE_NAME;
  const summary = appointment.visit_type_name || "Appointment";
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Advantage Brain and Trauma//Appointment Reminder//EN",
    "BEGIN:VEVENT",
    `DTSTART;TZID=${CLINIC_TIMEZONE}:${start}`,
    `DTEND;TZID=${CLINIC_TIMEZONE}:${end}`,
    `SUMMARY:${summary} - ${PRACTICE_NAME}`,
    `LOCATION:${location}`,
    `DESCRIPTION:Please call ${phone} with questions.`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "abt-appointment.ics";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page context: token, appointment, navigation
// ---------------------------------------------------------------------------

interface ReminderContextValue {
  token: string;
  appointment: ReminderAppointment;
  phone: string;
  navigate: (to: string) => void;
  refreshAppointment: () => void;
  setAppointment: (appointment: ReminderAppointment) => void;
}

const ReminderContext = createContext<ReminderContextValue | null>(null);

function useReminder() {
  const context = useContext(ReminderContext);
  if (!context) throw new Error("useReminder must be used inside the reminder page");
  return context;
}

const appointmentQueryKey = (token: string) => ["abt-reminder", "appointment", token];

/** Sub-path inside /abt-reminder (e.g. "/help/time"), plus navigation that keeps `?token=`. */
function useReminderRoute() {
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token")?.trim() || "";
  const subPath = location.slice(ABT_REMINDER_BASE.length) || "/";
  const navigate = (to: string) => {
    const path = to === "/" ? ABT_REMINDER_BASE : `${ABT_REMINDER_BASE}${to}`;
    setLocation(token ? `${path}?token=${encodeURIComponent(token)}` : path);
  };
  return { location, subPath, token, navigate };
}

/** Async submit helper: loading flag + API error for inline display. */
function useSubmit() {
  const { refreshAppointment } = useReminder();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ReminderApiError | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      const apiError =
        caught instanceof ReminderApiError ? caught : new ReminderApiError("server", "Something went wrong. Please try again.");
      setError(apiError);
      // Re-check the appointment: 404/410 switch to the link screens, a
      // no-longer-scheduled appointment hides the actions.
      if (apiError.kind !== "network" && apiError.kind !== "rate_limited") refreshAppointment();
    } finally {
      setSubmitting(false);
    }
  };
  return { submitting, error, run };
}

// ---------------------------------------------------------------------------
// Building blocks (markup and classes match the original prototype)
// ---------------------------------------------------------------------------

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "brand-header brand-header--compact" : "brand-header"}>
      <img src={LOGO_SRC} alt="Advantage Brain and Trauma — Rise Above" />
    </header>
  );
}

function HelpLine({ prefix, phone }: { prefix: string; phone: string }) {
  return (
    <p className="help-line">
      {prefix} <a href={phoneHref(phone)}>{phone}</a>
    </p>
  );
}

function PageSheet({
  children,
  backTo,
  backLabel = "Back to appointment",
  onBack,
}: {
  children: ReactNode;
  backTo?: string;
  backLabel?: string;
  onBack?: (to: string) => void;
}) {
  return (
    <section className="page-sheet enter-screen" aria-live="polite">
      {backTo && onBack ? (
        <button className="back-link" onClick={() => onBack(backTo)} type="button">
          <ArrowLeft aria-hidden="true" />
          {backLabel}
        </button>
      ) : null}
      <BrandHeader compact={!!backTo} />
      {children}
    </section>
  );
}

function ReminderSheet(props: { children: ReactNode; backTo?: string; backLabel?: string }) {
  const { navigate } = useReminder();
  return <PageSheet {...props} onBack={navigate} />;
}

function PageIntro({ eyebrow, title, copy }: { eyebrow?: string; title: string; copy: string }) {
  return (
    <div className="page-intro">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1 id="page-title" tabIndex={-1}>
        {title}
      </h1>
      <p className="lede">{copy}</p>
    </div>
  );
}

function AppointmentCard({ date, time }: { date?: string; time?: string }) {
  const { appointment } = useReminder();
  const providerLine = [appointment.provider_name, appointment.visit_type_name].filter(Boolean).join(" · ");
  const practiceLine = appointment.location ? `${PRACTICE_NAME} · ${appointment.location}` : PRACTICE_NAME;
  const rows: { icon: LucideIcon; text: string }[] = [];
  if (providerLine) rows.push({ icon: UserRound, text: providerLine });
  if (appointment.is_virtual) {
    rows.push({ icon: Video, text: "Virtual visit" });
  } else {
    rows.push({ icon: MapPin, text: practiceLine });
    if (appointment.address) rows.push({ icon: Building2, text: appointment.address });
  }
  return (
    <article className="appointment-card" aria-label="Appointment details">
      <div className="appointment-card__date">
        <CalendarDays aria-hidden="true" />
        <div>
          <p>{formatLongDate(date ?? appointment.attend_date)}</p>
          <strong>{formatTime(time ?? appointment.time)}</strong>
        </div>
      </div>
      {rows.map((row, index) => (
        <DetailRow key={row.text} icon={row.icon} text={row.text} last={index === rows.length - 1} />
      ))}
    </article>
  );
}

function DetailRow({ icon: Icon, text, last = false }: { icon: LucideIcon; text: string; last?: boolean }) {
  return (
    <div className={`detail-row${last ? " detail-row--last" : ""}`}>
      <Icon aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

function AppointmentContext({ label = "Current appointment" }: { label?: string }) {
  const { appointment } = useReminder();
  return (
    <article className="appointment-context" aria-label={label}>
      <CalendarDays aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>
          {formatShortDate(appointment.attend_date)} <span aria-hidden="true">·</span> {formatTime(appointment.time)}
        </strong>
        {appointment.provider_name ? <span>{appointment.provider_name}</span> : null}
      </div>
    </article>
  );
}

function ActionButton({
  children,
  icon: Icon,
  onClick,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      className={`action-button action-button--${variant}`}
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Loader2 className="abt-spin" aria-hidden="true" /> : Icon ? <Icon aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

function CallButton({ phone, label, variant = "primary" }: { phone: string; label?: string; variant?: "primary" | "secondary" }) {
  return (
    <a className={`action-button action-button--${variant}`} href={phoneHref(phone)}>
      <Phone aria-hidden="true" />
      <span>{label ?? `Call ${phone}`}</span>
    </a>
  );
}

function DirectionsButton({ variant }: { variant: "primary" | "secondary" }) {
  const { appointment } = useReminder();
  if (appointment.is_virtual || !appointment.address) return null;
  return (
    <a className={`action-button action-button--${variant}`} href={directionsHref(appointment.address)} target="_blank" rel="noreferrer">
      <Navigation aria-hidden="true" />
      <span>Get directions</span>
    </a>
  );
}

function FormError({ error, id }: { error: ReminderApiError | null; id?: string }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert" id={id}>
      <CircleAlert aria-hidden="true" />
      <span>{error.message}</span>
    </p>
  );
}

function StatusNotice({ children }: { children: ReactNode }) {
  return (
    <p className="status-notice" role="status">
      <Info aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function ChoiceLink({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button className="choice-link" type="button" onClick={onClick}>
      <span className="choice-link__icon">
        <Icon aria-hidden="true" />
      </span>
      <span>{label}</span>
      <ChevronRight className="choice-link__chevron" aria-hidden="true" />
    </button>
  );
}

function RadioChoice({
  icon: Icon,
  label,
  selected,
  onClick,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onClick: () => void;
  detail?: string;
}) {
  return (
    <button
      className={`radio-choice${selected ? " radio-choice--selected" : ""}`}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="radio-choice__control" aria-hidden="true">
        {selected ? <span /> : null}
      </span>
      <span className="radio-choice__icon-wrap" aria-hidden="true">
        <Icon className="radio-choice__icon" />
      </span>
      <span className="radio-choice__copy">
        <span>{label}</span>
        {detail ? <strong>{detail}</strong> : null}
      </span>
    </button>
  );
}

function SupportIntro({ art, artAlt, title, copy }: { art: string; artAlt: string; title: string; copy: string }) {
  return (
    <div className="support-intro">
      <div className="support-intro__copy">
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        <p className="lede">{copy}</p>
      </div>
      <span className="support-intro__art">
        <img src={art} alt={artAlt} />
      </span>
    </div>
  );
}

function FormPanel({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="form-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

function ReminderScreen() {
  const { token, appointment, phone, navigate, setAppointment } = useReminder();
  const { submitting, error, run } = useSubmit();

  // After an online reschedule the link points at the replaced appointment.
  if (!appointment.can_respond && readRescheduled(token)) return <ConfirmedScreen rescheduled />;

  const status = appointment.response?.status;
  return (
    <ReminderSheet>
      <PageIntro
        eyebrow="Appointment reminder"
        title="Will you be able to make your appointment?"
        copy="Please confirm so we can plan for your visit."
      />
      <AppointmentCard />
      {appointment.can_respond ? (
        <>
          {status === "confirmed" ? <StatusNotice>You confirmed this appointment.</StatusNotice> : null}
          {status === "help_requested" ? (
            <StatusNotice>We received your help request. Our team will contact you.</StatusNotice>
          ) : null}
          <FormError error={error} />
          <div className="action-stack">
            <ActionButton
              icon={Check}
              loading={submitting}
              onClick={() =>
                run(async () => {
                  setAppointment(await ReminderApi.confirm(token));
                  navigate("/confirmed");
                })
              }
            >
              Confirm appointment
            </ActionButton>
            <ActionButton icon={Headphones} variant="secondary" disabled={submitting} onClick={() => navigate("/help")}>
              Need help attending?
            </ActionButton>
          </div>
          <HelpLine prefix="Need help? Call" phone={phone} />
        </>
      ) : (
        <NoLongerScheduledActions />
      )}
    </ReminderSheet>
  );
}

function NoLongerScheduledActions() {
  const { phone } = useReminder();
  return (
    <>
      <StatusNotice>This appointment is no longer scheduled. Please call us for help.</StatusNotice>
      <div className="action-stack">
        <CallButton phone={phone} />
      </div>
    </>
  );
}

/** Shown on the help screens once the appointment can no longer be changed online. */
function NoLongerScheduledScreen() {
  return (
    <ReminderSheet backTo="/">
      <PageIntro
        title="This appointment is no longer scheduled."
        copy="It can’t be changed online anymore. Please call us and our team will help."
      />
      <AppointmentContext />
      <NoLongerScheduledActions />
    </ReminderSheet>
  );
}

function HelpOptionsScreen() {
  const { phone, navigate } = useReminder();
  return (
    <ReminderSheet backTo="/">
      <PageIntro
        title="What would help you attend?"
        copy="Select the option that best describes what you need. Your appointment will remain unchanged while we help."
      />
      <AppointmentContext />
      <div className="choice-stack" aria-label="Attendance help options">
        <ChoiceLink icon={CalendarClock} label="I need a different time" onClick={() => navigate("/help/time")} />
        <ChoiceLink icon={CarFront} label="I need transportation help" onClick={() => navigate("/help/transportation")} />
        <ChoiceLink icon={MapPin} label="I have a question about the location" onClick={() => navigate("/help/location")} />
        <ChoiceLink icon={CircleHelp} label="I have another concern" onClick={() => navigate("/help/other")} />
      </div>
      <HelpLine prefix="Need help now? Call" phone={phone} />
    </ReminderSheet>
  );
}

function DifferentTimeScreen() {
  const { token, appointment, phone, navigate, refreshAppointment } = useReminder();
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const { submitting, error, run } = useSubmit();
  const slotsQuery = useQuery({
    queryKey: ["abt-reminder", "time-slots", token],
    queryFn: () => ReminderApi.getTimeSlots(token),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const slots = slotsQuery.data?.slots ?? [];
  const slotDate = slotsQuery.data?.attend_date ?? appointment.attend_date;
  const slotError = slotsQuery.error instanceof ReminderApiError ? slotsQuery.error : null;

  useEffect(() => {
    // A link that turned invalid/expired while open: let the page show it.
    if (slotError && (slotError.kind === "invalid_link" || slotError.kind === "expired" || slotError.status === 422)) {
      refreshAppointment();
    }
  }, [slotError]);

  const optionCount = slotsQuery.isSuccess ? `${slots.length} ${slots.length === 1 ? "option" : "options"}` : "";

  return (
    <ReminderSheet backTo="/help" backLabel="Back to help options">
      <PageIntro
        title="Choose a new appointment time"
        copy="Choose one of the available times later that day. Your current appointment will remain unchanged until you confirm."
      />
      <AppointmentContext />
      <div className="section-heading">
        <h2>Available that day</h2>
        <span>{optionCount}</span>
      </div>
      {slotsQuery.isLoading ? (
        <div className="radio-stack" aria-busy="true" aria-label="Loading available times">
          <div className="skeleton-block skeleton-block--choice" />
          <div className="skeleton-block skeleton-block--choice" />
          <div className="skeleton-block skeleton-block--choice" />
        </div>
      ) : slotError ? (
        <div className="empty-panel">
          <p>{slotError.message}</p>
          <button className="text-action" type="button" onClick={() => slotsQuery.refetch()}>
            Try again
          </button>
        </div>
      ) : slots.length === 0 ? (
        <div className="empty-panel">
          <p>There are no other times available that day. Please call us and we’ll help you find a new time.</p>
        </div>
      ) : (
        <div className="radio-stack" role="group" aria-label="Available appointment times">
          {slots.map((slot) => (
            <RadioChoice
              key={slot.time}
              icon={CalendarDays}
              label={formatLongDate(slotDate)}
              detail={slot.label}
              selected={selectedTime === slot.time}
              onClick={() => setSelectedTime(slot.time)}
            />
          ))}
        </div>
      )}
      <div className="action-stack time-actions">
        <FormError error={error} />
        {slots.length > 0 ? (
          <ActionButton
            disabled={!selectedTime}
            loading={submitting}
            onClick={() =>
              run(async () => {
                if (!selectedTime) return;
                try {
                  const result = await ReminderApi.reschedule(token, selectedTime);
                  writeSession(RESCHEDULED_KEY, JSON.stringify({ ...result, ref: tokenTag(token) }));
                  navigate("/rescheduled");
                } catch (caught) {
                  // e.g. "That time is no longer available" — reload the list.
                  setSelectedTime(null);
                  slotsQuery.refetch();
                  throw caught;
                }
              })
            }
          >
            Confirm new time
          </ActionButton>
        ) : null}
        <CallButton phone={phone} label="Call to reschedule" variant="secondary" />
      </div>
    </ReminderSheet>
  );
}

/** Shared state + submit for the three help-request forms. */
function useHelpRequest(category: HelpCategory, options: Choice[], noteRequired: boolean) {
  const { token, navigate, setAppointment } = useReminder();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { submitting, error, run } = useSubmit();
  const canSubmit = !!selectedId && (!noteRequired || !!note.trim());
  const submit = () =>
    run(async () => {
      if (!selectedId) return;
      const trimmed = note.trim();
      const result = await ReminderApi.helpRequest(token, {
        category,
        option: selectedId,
        ...(trimmed ? { note: trimmed } : {}),
      });
      const label = result.request || options.find((option) => option.id === selectedId)?.label || "";
      writeSession(REQUEST_LABEL_KEY, label);
      setAppointment(result);
      navigate("/help/requested");
    });
  return { selectedId, setSelectedId, note, setNote, submitting, error, canSubmit, submit };
}

function NoteField({
  id,
  label,
  optional,
  value,
  onChange,
  error,
}: {
  id: string;
  label: string;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const errorId = `${id}-error`;
  return (
    <>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? (
          <>
            {" "}
            <span>(optional)</span>
          </>
        ) : null}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Add a brief note"
        rows={3}
        maxLength={REMINDER_NOTE_MAX_LENGTH}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p className="form-error form-error--field" id={errorId}>
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
    </>
  );
}

function OptionList({
  options,
  selectedId,
  onSelect,
}: {
  options: Choice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="radio-stack radio-stack--compact">
      {options.map((option) => (
        <RadioChoice
          key={option.id}
          icon={option.icon}
          label={option.label}
          selected={selectedId === option.id}
          onClick={() => onSelect(option.id)}
        />
      ))}
    </div>
  );
}

/** Top-level error for a help form, unless it belongs to a single field shown inline. */
function formLevelError(error: ReminderApiError | null) {
  if (!error) return null;
  if (error.fieldError("note") && !error.fieldError("category") && !error.fieldError("option")) return null;
  return error;
}

function TransportationScreen() {
  const { phone } = useReminder();
  const form = useHelpRequest("transportation", TRANSPORTATION_OPTIONS, false);
  return (
    <ReminderSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={TRANSPORTATION_ART}
        artAlt="Gold and burgundy transportation illustration"
        title="Transportation help"
        copy="Tell us what would make it easier to get to your appointment. Your appointment will remain unchanged while we help."
      />
      <AppointmentContext />
      <FormPanel title="What do you need help with?">
        <OptionList options={TRANSPORTATION_OPTIONS} selectedId={form.selectedId} onSelect={form.setSelectedId} />
        <NoteField
          id="transportation-note"
          label="Anything else we should know?"
          optional
          value={form.note}
          onChange={form.setNote}
          error={form.error?.fieldError("note")}
        />
        <FormError error={formLevelError(form.error)} />
        <ActionButton disabled={!form.canSubmit} loading={form.submitting} onClick={form.submit}>
          Request transportation help
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Need help now? Call" phone={phone} />
    </ReminderSheet>
  );
}

function LocationScreen() {
  const { appointment, phone } = useReminder();
  const form = useHelpRequest("location", LOCATION_OPTIONS, false);
  return (
    <ReminderSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={LOCATION_ART}
        artAlt="Gold and burgundy clinic location illustration"
        title="Questions about the location"
        copy="Review your appointment location or tell us what information you need."
      />
      <article className="location-card">
        {appointment.is_virtual ? <Video aria-hidden="true" /> : <MapPin aria-hidden="true" />}
        <div>
          <p>Appointment location</p>
          <strong>{appointment.is_virtual ? "Virtual visit" : PRACTICE_NAME}</strong>
          {!appointment.is_virtual && appointment.location ? <span>{appointment.location}</span> : null}
          {!appointment.is_virtual && appointment.address ? <span>{appointment.address}</span> : null}
          <span>
            {formatShortDate(appointment.attend_date)} <span aria-hidden="true">·</span> {formatTime(appointment.time)}
          </span>
        </div>
        <DirectionsButton variant="primary" />
      </article>
      <FormPanel title="What would you like to know?">
        <OptionList options={LOCATION_OPTIONS} selectedId={form.selectedId} onSelect={form.setSelectedId} />
        <FormError error={form.error} />
        <ActionButton disabled={!form.canSubmit} loading={form.submitting} onClick={form.submit}>
          Send location question
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Need help now? Call" phone={phone} />
    </ReminderSheet>
  );
}

function OtherConcernScreen() {
  const { phone } = useReminder();
  const form = useHelpRequest("other", CONCERN_OPTIONS, true);
  return (
    <ReminderSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={CARE_ART}
        artAlt="Gold and burgundy helping hand and phone illustration"
        title="Tell us how we can help"
        copy="Share a brief note, and our team will follow up. Your appointment will remain unchanged."
      />
      <AppointmentContext />
      <FormPanel title="What is your concern about?">
        <OptionList options={CONCERN_OPTIONS} selectedId={form.selectedId} onSelect={form.setSelectedId} />
        <NoteField
          id="other-note"
          label="Briefly tell us what you need"
          value={form.note}
          onChange={form.setNote}
          error={form.error?.fieldError("note")}
        />
        <p className="privacy-note">
          <Info aria-hidden="true" /> Please do not include sensitive medical information.
        </p>
        <FormError error={formLevelError(form.error)} />
        <ActionButton disabled={!form.canSubmit} loading={form.submitting} onClick={form.submit}>
          Send help request
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Prefer to talk? Call" phone={phone} />
    </ReminderSheet>
  );
}

function ConfirmedScreen({ rescheduled = false }: { rescheduled?: boolean }) {
  const { token, appointment, phone, navigate } = useReminder();
  const newTime = rescheduled ? readRescheduled(token) : null;

  // Only reachable after a reply: otherwise show the reminder itself.
  if (rescheduled ? !newTime : appointment.response?.status !== "confirmed" || !appointment.can_respond) {
    return <ReminderScreen />;
  }

  const date = newTime?.attend_date ?? appointment.attend_date;
  const time = newTime?.time ?? appointment.time;
  const endTime = newTime ? newTime.end_time : appointment.end_time;
  const firstName = appointment.patient_first_name?.trim();
  return (
    <ReminderSheet>
      <div className="success-intro">
        <div className="success-mark">
          <Check aria-hidden="true" />
        </div>
        <p className="eyebrow">{rescheduled ? "New time confirmed" : "Confirmed"}</p>
        <h1 id="page-title" tabIndex={-1}>
          {rescheduled ? "Your new appointment time is set." : firstName ? `You’re all set, ${firstName}.` : "You’re all set."}
        </h1>
        <p className="lede">
          Your appointment is confirmed for {formatLongDate(date)} at {formatTime(time)}.
        </p>
      </div>
      <AppointmentCard date={date} time={time} />
      <div className="action-stack">
        <ActionButton icon={CalendarPlus} onClick={() => downloadCalendarFile(appointment, date, time, endTime)}>
          Add to calendar
        </ActionButton>
        <DirectionsButton variant="secondary" />
        {/* After a reschedule the reminder screen is this same summary, so there is nothing to return to. */}
        {rescheduled ? null : (
          <button className="text-action" type="button" onClick={() => navigate("/")}>
            Return to appointment details
          </button>
        )}
      </div>
      <HelpLine prefix="Need to make a change? Call" phone={phone} />
    </ReminderSheet>
  );
}

function RequestReceivedScreen() {
  const { appointment, phone, navigate } = useReminder();
  if (appointment.response?.status !== "help_requested") return <ReminderScreen />;

  const requestLabel =
    appointment.request || readSession(REQUEST_LABEL_KEY) || appointment.response.reason || "Appointment help";
  const detailLine = [appointment.provider_name, appointment.visit_type_name].filter(Boolean);
  return (
    <ReminderSheet>
      <div className="success-intro">
        <span className="success-art-frame">
          <img className="success-art" src={CARE_ART} alt="Gold and burgundy support illustration" />
        </span>
        <p className="eyebrow">Help request received</p>
        <h1 id="page-title" tabIndex={-1}>
          We’ll help with your appointment.
        </h1>
        <p className="lede">
          Your appointment is still scheduled for {formatLongDate(appointment.attend_date)} at{" "}
          {formatTime(appointment.time)}. Our team will contact you within one business day.
        </p>
      </div>
      <article className="request-card">
        <div className="request-card__row">
          <CalendarDays aria-hidden="true" />
          <div>
            <p>Current appointment</p>
            <strong>{formatLongDate(appointment.attend_date)}</strong>
            <span>{formatTime(appointment.time)}</span>
            {detailLine.length ? (
              <span>
                {detailLine.map((part, index) => (
                  <span key={part}>
                    {index > 0 ? (
                      <>
                        {" "}
                        <span aria-hidden="true">·</span>{" "}
                      </>
                    ) : null}
                    {part}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </div>
        <div className="request-card__row request-card__row--request">
          <Headphones aria-hidden="true" />
          <div>
            <p>Request</p>
            <strong>{requestLabel}</strong>
          </div>
        </div>
      </article>
      <div className="action-stack">
        <CallButton phone={phone} />
        <ActionButton icon={ArrowLeft} variant="secondary" onClick={() => navigate("/")}>
          Return to appointment details
        </ActionButton>
      </div>
      <p className="status-footnote">Your appointment remains unchanged until a new time is confirmed.</p>
    </ReminderSheet>
  );
}

// ---------------------------------------------------------------------------
// Loading / link-problem screens (no appointment data available)
// ---------------------------------------------------------------------------

function LoadingScreen() {
  return (
    <PageSheet>
      <div className="page-intro" aria-busy="true">
        <p className="sr-only" id="page-title" tabIndex={-1}>
          Loading your appointment
        </p>
        <div className="skeleton-block skeleton-block--eyebrow" />
        <div className="skeleton-block skeleton-block--title" />
        <div className="skeleton-block skeleton-block--title skeleton-block--short" />
        <div className="skeleton-block skeleton-block--line" />
      </div>
      <div className="skeleton-block skeleton-block--card" />
      <div className="action-stack">
        <div className="skeleton-block skeleton-block--button" />
        <div className="skeleton-block skeleton-block--button" />
      </div>
    </PageSheet>
  );
}

function LinkProblemScreen({
  icon: Icon,
  eyebrow,
  title,
  copy,
  onRetry,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  copy: string;
  onRetry?: () => void;
}) {
  return (
    <PageSheet>
      <div className="success-intro">
        <div className="success-mark">
          <Icon aria-hidden="true" />
        </div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-title" tabIndex={-1}>
          {title}
        </h1>
        <p className="lede">{copy}</p>
      </div>
      <div className="action-stack">
        {onRetry ? (
          <ActionButton icon={RotateCcw} onClick={onRetry}>
            Try again
          </ActionButton>
        ) : null}
        <CallButton phone={FALLBACK_PHONE} variant={onRetry ? "secondary" : "primary"} />
      </div>
    </PageSheet>
  );
}

function ErrorScreen({ error, onRetry }: { error: ReminderApiError | null; onRetry: () => void }) {
  if (!error || error.kind === "invalid_link") {
    return (
      <LinkProblemScreen
        icon={Link2Off}
        eyebrow="Appointment reminder"
        title="This link is not valid."
        copy="Please use the link from your most recent reminder text, or call us and we’ll help."
      />
    );
  }
  if (error.kind === "expired") {
    return (
      <LinkProblemScreen
        icon={CalendarX2}
        eyebrow="Appointment reminder"
        title="This appointment has already passed."
        copy="If you need to schedule another visit, please call us."
      />
    );
  }
  return (
    <LinkProblemScreen
      icon={CircleAlert}
      eyebrow="Appointment reminder"
      title="We couldn’t load your appointment."
      copy={error.message}
      onRetry={onRetry}
    />
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Screens that change the appointment; replaced once it is no longer scheduled. */
const ACTION_SCREENS: Record<string, ComponentType> = {
  "/help": HelpOptionsScreen,
  "/help/time": DifferentTimeScreen,
  "/help/transportation": TransportationScreen,
  "/help/location": LocationScreen,
  "/help/other": OtherConcernScreen,
};

const RESULT_SCREENS: Record<string, ComponentType> = {
  "/confirmed": ConfirmedScreen,
  "/rescheduled": () => <ConfirmedScreen rescheduled />,
  "/help/requested": RequestReceivedScreen,
};

export default function AbtReminder() {
  const { location, subPath, token, navigate } = useReminderRoute();
  const queryClient = useQueryClient();

  // Reloaded on every screen (API sheet: "Also reload on every screen").
  const appointmentQuery = useQuery({
    queryKey: appointmentQueryKey(token),
    queryFn: () => ReminderApi.getAppointment(token),
    enabled: !!token,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const isFirstScreen = useRef(true);
  useEffect(() => {
    // The initial load is the query's own fetch; refetch on each later screen.
    if (isFirstScreen.current) {
      isFirstScreen.current = false;
      return;
    }
    if (token) appointmentQuery.refetch();
  }, [location]);

  // Page-level title and the prototype's font, loaded only while this page is mounted.
  useEffect(() => {
    const previousTitle = document.title;
    document.title = PAGE_TITLE;
    let fontLink = document.querySelector<HTMLLinkElement>(`link[href="${FONT_HREF}"]`);
    const addedFont = !fontLink;
    if (!fontLink) {
      fontLink = document.createElement("link");
      fontLink.rel = "stylesheet";
      fontLink.href = FONT_HREF;
      document.head.appendChild(fontLink);
    }
    return () => {
      document.title = previousTitle;
      if (addedFont) fontLink?.remove();
    };
  }, []);

  const appointment = appointmentQuery.data;
  const isReady = !!appointment;

  // Each screen starts at the top with its heading focused for screen readers.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    window.requestAnimationFrame(() => document.getElementById("page-title")?.focus());
  }, [location, isReady]);

  const contextValue = useMemo<ReminderContextValue | null>(() => {
    if (!appointment) return null;
    return {
      token,
      appointment,
      phone: appointment.facility_phone_no?.trim() || FALLBACK_PHONE,
      navigate,
      refreshAppointment: () => {
        queryClient.invalidateQueries({ queryKey: appointmentQueryKey(token) });
      },
      setAppointment: (next) => queryClient.setQueryData(appointmentQueryKey(token), next),
    };
  }, [appointment, token, queryClient, location]);

  const loadError = appointmentQuery.error instanceof ReminderApiError ? appointmentQuery.error : null;

  let screen: ReactNode;
  if (!token) {
    screen = <ErrorScreen error={null} onRetry={() => undefined} />;
  } else if (loadError && (loadError.kind === "invalid_link" || loadError.kind === "expired" || !appointment)) {
    screen = <ErrorScreen error={loadError} onRetry={() => appointmentQuery.refetch()} />;
  } else if (!contextValue) {
    screen = <LoadingScreen />;
  } else {
    const ActionScreen = ACTION_SCREENS[subPath];
    const ResultScreen = RESULT_SCREENS[subPath];
    const Screen = ActionScreen
      ? contextValue.appointment.can_respond
        ? ActionScreen
        : readRescheduled(token)
          ? RESULT_SCREENS["/rescheduled"]
          : NoLongerScheduledScreen
      : ResultScreen ?? ReminderScreen;
    screen = (
      <ReminderContext.Provider value={contextValue}>
        <Screen />
      </ReminderContext.Provider>
    );
  }

  return (
    <div className="abt-reminder">
      <div className="prototype-root">
        <main className="prototype-stage" key={location}>
          {screen}
        </main>
      </div>
    </div>
  );
}
