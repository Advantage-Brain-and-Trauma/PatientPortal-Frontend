import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  Accessibility,
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarPlus,
  CarFront,
  Check,
  ChevronRight,
  CircleHelp,
  CircleParking,
  ClipboardList,
  DoorOpen,
  Headphones,
  Info,
  MapPin,
  MessageCircleQuestion,
  Navigation,
  Phone,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { ABT_REMINDER_BASE } from "@/lib/publicRoutes";
import "./abt-reminder.css";

/*
 * Public ABT appointment reminder (/abt-reminder/*).
 *
 * Exact port of the approved Manus prototype. This is a static prototype: the
 * appointment below is sample data and no screen calls the backend — "Confirm"
 * and the help requests only move between screens. Wire these to real
 * endpoints (with a signed per-patient link) before using it with patients.
 */

const ASSET_BASE = "/abt-reminder";
const LOGO_SRC = `${ASSET_BASE}/abt-logo.png`;
const TRANSPORTATION_ART = `${ASSET_BASE}/abt-transportation-support.webp`;
const LOCATION_ART = `${ASSET_BASE}/abt-location-support.webp`;
const CARE_ART = `${ASSET_BASE}/abt-care-support.webp`;

const FONT_HREF = "https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;500;600;700;800&display=swap";
const PAGE_TITLE = "ABT Appointment Reminder";

const PHONE_DISPLAY = "877-487-8289";
const PHONE_HREF = "tel:+18774878289";
const DIRECTIONS_HREF = "https://www.google.com/maps/search/?api=1&query=125%20Market%20Street%2C%20Suite%20300";

const APPOINTMENT = {
  patient: "Jamie",
  date: "Tuesday, September 22",
  shortDate: "Tue, Sep 22",
  time: "10:30 AM",
  provider: "Dr. Maya Patel",
  type: "Follow-up visit",
  practice: "Advantage Brain & Trauma",
  address: "125 Market Street, Suite 300",
};

const TIME_SLOTS = [
  { id: "one-pm", date: "Tuesday, September 22", time: "1:00 PM", ics: "20260922T130000" },
  { id: "two-pm", date: "Tuesday, September 22", time: "2:00 PM", ics: "20260922T140000" },
  { id: "three-thirty-pm", date: "Tuesday, September 22", time: "3:30 PM", ics: "20260922T153000" },
];

type Choice = { id: string; label: string; icon: LucideIcon };

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

function saveValue(key: string, value: string) {
  window.sessionStorage.setItem(key, value);
}

function readValue(key: string, fallback: string) {
  return window.sessionStorage.getItem(key) || fallback;
}

/** Sub-path inside /abt-reminder, e.g. "/help/time"; "/" for the landing screen. */
function useReminderNavigation() {
  const [location, setLocation] = useLocation();
  const subPath = location.slice(ABT_REMINDER_BASE.length) || "/";
  const navigate = (to: string) => setLocation(to === "/" ? ABT_REMINDER_BASE : `${ABT_REMINDER_BASE}${to}`);
  return { location, subPath, navigate };
}

function downloadCalendarFile(start = "20260922T103000", summary = "Appointment") {
  const end = start.replace(
    /(\d{2})(\d{2})(\d{2})$/,
    (_match, hour: string, minute: string, second: string) =>
      `${String(Math.min(Number(hour) + 1, 23)).padStart(2, "0")}${minute}${second}`,
  );
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Advantage Brain and Trauma//Appointment Prototype//EN",
    "BEGIN:VEVENT",
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${summary} - Advantage Brain & Trauma`,
    `LOCATION:${APPOINTMENT.address}`,
    "DESCRIPTION:Appointment reminder prototype. Please call 877-487-8289 with questions.",
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

function BrandHeader({ compact = false }: { compact?: boolean }) {
  return (
    <header className={compact ? "brand-header brand-header--compact" : "brand-header"}>
      <img src={LOGO_SRC} alt="Advantage Brain and Trauma — Rise Above" />
    </header>
  );
}

function HelpLine({ prefix }: { prefix: string }) {
  return (
    <p className="help-line">
      {prefix} <a href={PHONE_HREF}>{PHONE_DISPLAY}</a>
    </p>
  );
}

function PageSheet({
  children,
  backTo,
  backLabel = "Back to appointment",
}: {
  children: ReactNode;
  backTo?: string;
  backLabel?: string;
}) {
  const { navigate } = useReminderNavigation();
  return (
    <section className="page-sheet enter-screen" aria-live="polite">
      {backTo ? (
        <button className="back-link" onClick={() => navigate(backTo)} type="button">
          <ArrowLeft aria-hidden="true" />
          {backLabel}
        </button>
      ) : null}
      <BrandHeader compact={!!backTo} />
      {children}
    </section>
  );
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

function AppointmentCard({ date = APPOINTMENT.date, time = APPOINTMENT.time }: { date?: string; time?: string }) {
  return (
    <article className="appointment-card" aria-label="Appointment details">
      <div className="appointment-card__date">
        <CalendarDays aria-hidden="true" />
        <div>
          <p>{date}</p>
          <strong>{time}</strong>
        </div>
      </div>
      <DetailRow icon={UserRound} text={`${APPOINTMENT.provider} · ${APPOINTMENT.type}`} />
      <DetailRow icon={MapPin} text={APPOINTMENT.practice} />
      <DetailRow icon={Building2} text={APPOINTMENT.address} last />
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
  return (
    <article className="appointment-context" aria-label={label}>
      <CalendarDays aria-hidden="true" />
      <div>
        <p>{label}</p>
        <strong>
          {APPOINTMENT.shortDate} <span aria-hidden="true">·</span> {APPOINTMENT.time}
        </strong>
        <span>{APPOINTMENT.provider}</span>
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
}: {
  children: ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  return (
    <button className={`action-button action-button--${variant}`} type="button" onClick={onClick} disabled={disabled}>
      {Icon ? <Icon aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
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

function ReminderScreen() {
  const { navigate } = useReminderNavigation();
  return (
    <PageSheet>
      <PageIntro
        eyebrow="Appointment reminder"
        title="Will you be able to make your appointment?"
        copy="Please confirm so we can plan for your visit."
      />
      <AppointmentCard />
      <div className="action-stack">
        <ActionButton
          icon={Check}
          onClick={() => {
            saveValue("abt-status", "confirmed");
            navigate("/confirmed");
          }}
        >
          Confirm appointment
        </ActionButton>
        <ActionButton icon={Headphones} variant="secondary" onClick={() => navigate("/help")}>
          Need help attending?
        </ActionButton>
      </div>
      <HelpLine prefix="Need help? Call" />
    </PageSheet>
  );
}

function HelpOptionsScreen() {
  const { navigate } = useReminderNavigation();
  return (
    <PageSheet backTo="/">
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
      <HelpLine prefix="Need help now? Call" />
    </PageSheet>
  );
}

function DifferentTimeScreen() {
  const { navigate } = useReminderNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedSlot = TIME_SLOTS.find((slot) => slot.id === selectedId);
  return (
    <PageSheet backTo="/help" backLabel="Back to help options">
      <PageIntro
        title="Choose a new appointment time"
        copy="Choose one of the available times later that day. Your current appointment will remain unchanged until you confirm."
      />
      <AppointmentContext />
      <div className="section-heading">
        <h2>Available that day</h2>
        <span>3 options</span>
      </div>
      <div className="radio-stack" role="group" aria-label="Available appointment times">
        {TIME_SLOTS.map((slot) => (
          <RadioChoice
            key={slot.id}
            icon={CalendarDays}
            label={slot.date}
            detail={slot.time}
            selected={selectedId === slot.id}
            onClick={() => setSelectedId(slot.id)}
          />
        ))}
      </div>
      <div className="action-stack time-actions">
        <ActionButton
          disabled={!selectedSlot}
          onClick={() => {
            if (!selectedSlot) return;
            saveValue("abt-new-date", selectedSlot.date);
            saveValue("abt-new-time", selectedSlot.time);
            saveValue("abt-new-ics", selectedSlot.ics);
            navigate("/rescheduled");
          }}
        >
          Confirm new time
        </ActionButton>
        <a className="action-button action-button--secondary" href={PHONE_HREF}>
          <Phone aria-hidden="true" />
          <span>Call to reschedule</span>
        </a>
      </div>
    </PageSheet>
  );
}

function TransportationScreen() {
  const { navigate } = useReminderNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <PageSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={TRANSPORTATION_ART}
        artAlt="Gold and burgundy transportation illustration"
        title="Transportation help"
        copy="Tell us what would make it easier to get to your appointment. Your appointment will remain unchanged while we help."
      />
      <AppointmentContext />
      <FormPanel title="What do you need help with?">
        <div className="radio-stack radio-stack--compact">
          {TRANSPORTATION_OPTIONS.map((option) => (
            <RadioChoice
              key={option.id}
              icon={option.icon}
              label={option.label}
              selected={selectedId === option.id}
              onClick={() => setSelectedId(option.id)}
            />
          ))}
        </div>
        <label className="field-label" htmlFor="transportation-note">
          Anything else we should know? <span>(optional)</span>
        </label>
        <textarea
          id="transportation-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a brief note"
          rows={3}
        />
        <ActionButton
          disabled={!selectedId}
          onClick={() => {
            const option = TRANSPORTATION_OPTIONS.find((item) => item.id === selectedId);
            saveValue("abt-request-type", option?.label || "Transportation help");
            saveValue("abt-request-note", note);
            navigate("/help/requested");
          }}
        >
          Request transportation help
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Need help now? Call" />
    </PageSheet>
  );
}

function LocationScreen() {
  const { navigate } = useReminderNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <PageSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={LOCATION_ART}
        artAlt="Gold and burgundy clinic location illustration"
        title="Questions about the location"
        copy="Review your appointment location or tell us what information you need."
      />
      <article className="location-card">
        <MapPin aria-hidden="true" />
        <div>
          <p>Appointment location</p>
          <strong>{APPOINTMENT.practice}</strong>
          <span>{APPOINTMENT.address}</span>
          <span>
            {APPOINTMENT.shortDate} <span aria-hidden="true">·</span> {APPOINTMENT.time}
          </span>
        </div>
        <a className="action-button action-button--primary" href={DIRECTIONS_HREF} target="_blank" rel="noreferrer">
          <Navigation aria-hidden="true" />
          <span>Get directions</span>
        </a>
      </article>
      <FormPanel title="What would you like to know?">
        <div className="radio-stack radio-stack--compact">
          {LOCATION_OPTIONS.map((option) => (
            <RadioChoice
              key={option.id}
              icon={option.icon}
              label={option.label}
              selected={selectedId === option.id}
              onClick={() => setSelectedId(option.id)}
            />
          ))}
        </div>
        <ActionButton
          disabled={!selectedId}
          onClick={() => {
            const option = LOCATION_OPTIONS.find((item) => item.id === selectedId);
            saveValue("abt-request-type", option?.label || "Location question");
            navigate("/help/requested");
          }}
        >
          Send location question
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Need help now? Call" />
    </PageSheet>
  );
}

function OtherConcernScreen() {
  const { navigate } = useReminderNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <PageSheet backTo="/help" backLabel="Back to help options">
      <SupportIntro
        art={CARE_ART}
        artAlt="Gold and burgundy helping hand and phone illustration"
        title="Tell us how we can help"
        copy="Share a brief note, and our team will follow up. Your appointment will remain unchanged."
      />
      <AppointmentContext />
      <FormPanel title="What is your concern about?">
        <div className="radio-stack radio-stack--compact">
          {CONCERN_OPTIONS.map((option) => (
            <RadioChoice
              key={option.id}
              icon={option.icon}
              label={option.label}
              selected={selectedId === option.id}
              onClick={() => setSelectedId(option.id)}
            />
          ))}
        </div>
        <label className="field-label" htmlFor="other-note">
          Briefly tell us what you need
        </label>
        <textarea
          id="other-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a brief note"
          rows={3}
        />
        <p className="privacy-note">
          <Info aria-hidden="true" /> Please do not include sensitive medical information.
        </p>
        <ActionButton
          disabled={!selectedId || !note.trim()}
          onClick={() => {
            const option = CONCERN_OPTIONS.find((item) => item.id === selectedId);
            saveValue("abt-request-type", option?.label || "Another concern");
            saveValue("abt-request-note", note);
            navigate("/help/requested");
          }}
        >
          Send help request
        </ActionButton>
      </FormPanel>
      <HelpLine prefix="Prefer to talk? Call" />
    </PageSheet>
  );
}

function ConfirmedScreen({ rescheduled = false }: { rescheduled?: boolean }) {
  const { navigate } = useReminderNavigation();
  const date = rescheduled ? readValue("abt-new-date", TIME_SLOTS[0].date) : APPOINTMENT.date;
  const time = rescheduled ? readValue("abt-new-time", TIME_SLOTS[0].time) : APPOINTMENT.time;
  const icsStart = rescheduled ? readValue("abt-new-ics", TIME_SLOTS[0].ics) : "20260922T103000";
  return (
    <PageSheet>
      <div className="success-intro">
        <div className="success-mark">
          <Check aria-hidden="true" />
        </div>
        <p className="eyebrow">{rescheduled ? "New time confirmed" : "Confirmed"}</p>
        <h1 id="page-title" tabIndex={-1}>
          {rescheduled ? "Your new appointment time is set." : `You’re all set, ${APPOINTMENT.patient}.`}
        </h1>
        <p className="lede">
          Your appointment is confirmed for {date} at {time}.
        </p>
      </div>
      <AppointmentCard date={date} time={time} />
      <div className="action-stack">
        <ActionButton icon={CalendarPlus} onClick={() => downloadCalendarFile(icsStart, APPOINTMENT.type)}>
          Add to calendar
        </ActionButton>
        <a className="action-button action-button--secondary" href={DIRECTIONS_HREF} target="_blank" rel="noreferrer">
          <Navigation aria-hidden="true" />
          <span>Get directions</span>
        </a>
        <button className="text-action" type="button" onClick={() => navigate("/")}>
          Return to appointment details
        </button>
      </div>
      <HelpLine prefix="Need to make a change? Call" />
    </PageSheet>
  );
}

function RequestReceivedScreen() {
  const { navigate } = useReminderNavigation();
  const requestType = readValue("abt-request-type", "Appointment help");
  return (
    <PageSheet>
      <div className="success-intro">
        <span className="success-art-frame">
          <img className="success-art" src={CARE_ART} alt="Gold and burgundy support illustration" />
        </span>
        <p className="eyebrow">Help request received</p>
        <h1 id="page-title" tabIndex={-1}>
          We’ll help with your appointment.
        </h1>
        <p className="lede">
          Your appointment is still scheduled for {APPOINTMENT.date} at {APPOINTMENT.time}. Our team will contact you
          within one business day.
        </p>
      </div>
      <article className="request-card">
        <div className="request-card__row">
          <CalendarDays aria-hidden="true" />
          <div>
            <p>Current appointment</p>
            <strong>{APPOINTMENT.date}</strong>
            <span>{APPOINTMENT.time}</span>
            <span>
              {APPOINTMENT.provider} <span aria-hidden="true">·</span> {APPOINTMENT.type}
            </span>
          </div>
        </div>
        <div className="request-card__row request-card__row--request">
          <Headphones aria-hidden="true" />
          <div>
            <p>Request</p>
            <strong>{requestType}</strong>
          </div>
        </div>
      </article>
      <div className="action-stack">
        <a className="action-button action-button--primary" href={PHONE_HREF}>
          <Phone aria-hidden="true" />
          <span>Call {PHONE_DISPLAY}</span>
        </a>
        <ActionButton icon={ArrowLeft} variant="secondary" onClick={() => navigate("/")}>
          Return to appointment details
        </ActionButton>
      </div>
      <p className="status-footnote">Your appointment remains unchanged until a new time is confirmed.</p>
    </PageSheet>
  );
}

const SCREENS: Record<string, ComponentType> = {
  "/confirmed": ConfirmedScreen,
  "/rescheduled": () => <ConfirmedScreen rescheduled />,
  "/help": HelpOptionsScreen,
  "/help/time": DifferentTimeScreen,
  "/help/transportation": TransportationScreen,
  "/help/location": LocationScreen,
  "/help/other": OtherConcernScreen,
  "/help/requested": RequestReceivedScreen,
};

export default function AbtReminder() {
  const { location, subPath } = useReminderNavigation();

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

  // Each screen starts at the top with its heading focused for screen readers.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    window.requestAnimationFrame(() => document.getElementById("page-title")?.focus());
  }, [location]);

  const screen = useMemo(() => {
    const Screen = SCREENS[subPath] ?? ReminderScreen;
    return <Screen />;
  }, [subPath]);

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
