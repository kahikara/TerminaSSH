import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search,
  SplitSquareVertical,
  Download,
  Github,
  MonitorSmartphone,
  Layers3,
  ChevronLeft,
  ChevronRight,
  PencilLine,
  FolderOpen,
  Settings2,
  Terminal,
  Zap,
  StickyNote,
  Command,
  Cable,
} from "lucide-react";

function Card({ className = "", children, ...props }) {
  return (
    <div className={className} {...props}>
    {children}
    </div>
  );
}

function CardContent({ className = "", children, ...props }) {
  return (
    <div className={className} {...props}>
    {children}
    </div>
  );
}

function Button({ className = "", variant = "default", children, ...props }) {
  const baseClass =
  variant === "outline"
  ? "inline-flex items-center justify-center border"
  : "inline-flex items-center justify-center";

  return (
    <button className={`${baseClass} ${className}`.trim()} {...props}>
    {children}
    </button>
  );
}

const SCREENSHOT_INTERVAL_MS = 3500;
const FEATURE_INTERVAL_MS = 4200;
const SWIPE_CONFIDENCE_THRESHOLD = 12000;
const SWIPE_OFFSET_THRESHOLD = 120;
const FEATURE_STAGE_MIN_HEIGHT = 404;
const SCREENSHOT_STAGE_CLASS = "mx-auto w-full max-w-[1100px]";

function getBaseUrl() {
  try {
    const metaEnv = import.meta && import.meta.env ? import.meta.env : undefined;
    if (metaEnv && typeof metaEnv.BASE_URL === "string") {
      return metaEnv.BASE_URL;
    }
  } catch {
    // ignore
  }

  if (typeof window !== "undefined") {
    const pathname = window.location && window.location.pathname ? window.location.pathname : "/";
    if (pathname.startsWith("/TerminaSSH/")) {
      return "/TerminaSSH/";
    }
  }

  return "/";
}

function withBase(path) {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const base = getBaseUrl();
  return `${base.replace(/\/?$/, "/")}${cleanPath}`;
}

function swipePower(offset, velocity) {
  return Math.abs(offset) * velocity;
}

const slideVariants = {
  enter: (direction) => ({
    x: direction > 0 ? 110 : -110,
    opacity: 1,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction > 0 ? -110 : 110,
    opacity: 1,
  }),
};

const features = [
  {
    icon: Layers3,
    title: "Multiple SSH sessions with tabs",
    text: "Keep several SSH connections open at once and switch between them quickly with a clean tab based workflow.",
  },
{
  icon: Terminal,
  title: "Local terminal sessions",
  text: "Launch local terminals right inside the app when you want quick shell access without leaving your workspace.",
},
{
  icon: Zap,
  title: "Quick Connect",
  text: "Open temporary connections fast without saving every host first, perfect for one off access and rapid admin work.",
},
{
  icon: SplitSquareVertical,
  title: "Split view",
  text: "Work side by side in multiple terminals and keep related sessions visible together while you troubleshoot or deploy.",
},
{
  icon: FolderOpen,
  title: "Integrated SFTP browser",
  text: "Browse remote files in the same workflow and move between terminal work and file operations more naturally.",
},
{
  icon: PencilLine,
  title: "Built in remote editor",
  text: "Edit files remotely with search, replace, and unsaved change protection built right into the app.",
},
{
  icon: StickyNote,
  title: "Server specific notes",
  text: "Keep important reminders, credentials context, and setup details attached to the servers they belong to.",
},
{
  icon: Command,
  title: "Reusable command snippets",
  text: "Save common commands and reuse them quickly instead of typing the same admin tasks again and again.",
},
{
  icon: Cable,
  title: "SSH tunnel management",
  text: "Manage tunnels in a cleaner desktop workflow and keep complex connection setups easier to understand.",
},
{
  icon: Search,
  title: "Terminal search",
  text: "Find output inside your terminal sessions faster when you need to track logs, commands, or error messages.",
},
{
  icon: MonitorSmartphone,
  title: "Themed desktop style UI",
  text: "Enjoy a polished desktop experience with a themed interface that feels focused, modern, and built for daily use.",
},
];

const featurePages = [];
for (let i = 0; i < features.length; i += 4) {
  featurePages.push(features.slice(i, i + 4));
}

function InlineBrandGlyph({ className = "h-9 w-9 rounded-xl" }) {
  return (
    <div className={`${className} flex items-center justify-center overflow-hidden rounded-2xl bg-transparent`}>
    <svg viewBox="0 0 128 128" className="h-full w-full drop-shadow-[0_0_18px_rgba(34,211,238,0.18)]" aria-hidden="true">
    <defs>
    <linearGradient id="termina-ring-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
    <stop offset="0%" stopColor="#84cc16" />
    <stop offset="55%" stopColor="#22d3ee" />
    <stop offset="100%" stopColor="#67e8f9" />
    </linearGradient>
    </defs>
    <circle cx="64" cy="64" r="41" fill="rgba(10,10,10,0.92)" stroke="url(#termina-ring-gradient)" strokeWidth="4" />
    <circle cx="64" cy="64" r="49" fill="none" stroke="url(#termina-ring-gradient)" strokeWidth="3.5" strokeDasharray="44 10 18 12 30 14" strokeLinecap="round" />
    <circle cx="64" cy="64" r="56" fill="none" stroke="url(#termina-ring-gradient)" strokeWidth="2.5" strokeDasharray="18 12 34 16 14 10" strokeLinecap="round" opacity="0.95" />
    <path d="M49 48 L64 63 L49 78" fill="none" stroke="#f4fff7" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M70 78 H88" fill="none" stroke="#f4fff7" strokeWidth="8" strokeLinecap="round" />
    </svg>
    </div>
  );
}

function BrandIcon({ className = "h-9 w-9 rounded-xl" }) {
  return <InlineBrandGlyph className={className} />;
}

function ScreenshotSlide({ slide }) {
  const [failed, setFailed] = useState(false);
  const Icon = slide.icon;

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-950/70 p-6">
      <div className="flex max-w-md flex-col items-center text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10">
      <Icon className="h-6 w-6 text-white" />
      </div>
      <h3 className="text-xl font-semibold text-white">{slide.title}</h3>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{slide.subtitle}</p>
      <p className="mt-4 text-xs text-zinc-500">
      Add <span className="font-mono text-zinc-400">{slide.image}</span> to your public folder to display this screenshot.
      </p>
      </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.08),transparent_30%),radial-gradient(circle_at_bottom,rgba(132,204,22,0.06),transparent_28%)] px-1 py-1 sm:px-2 sm:py-2 lg:px-3 lg:py-3">
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[24px] border border-white/8 bg-black/10 p-0.5 sm:p-1 lg:p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
    <img
    src={slide.image}
    alt={slide.title}
    className={`block h-full w-full rounded-[18px] object-cover object-center shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${slide.imageClass || "scale-[1.08]"}`}
    onError={() => setFailed(true)}
    />
    </div>
    </div>
  );
}

export default function TerminaSSHHomepage() {
  const screenshotSlides = useMemo(
    () => [
      {
        key: "main",
        title: "Main window",
        subtitle: "Connections, quick connect, and recent activity",
        icon: Layers3,
        image: withBase("screenshots/termina-main-blurred.png"),
                                   imageClass: "scale-[1.14]",
      },
      {
        key: "editor",
        title: "Editor",
        subtitle: "Remote editing with search, replace, and save controls",
        icon: PencilLine,
        image: withBase("screenshots/termina-editor-blurred.png"),
                                   imageClass: "scale-[1.06]",
      },
      {
        key: "sftp",
        title: "Terminal and SFTP",
        subtitle: "Terminal work and file browsing side by side",
        icon: FolderOpen,
        image: withBase("screenshots/termina-terminal-sftp-blurred.png"),
                                   imageClass: "scale-[1.12]",
      },
      {
        key: "settings",
        title: "Settings",
        subtitle: "Theme, tools, and behavior in one clean settings panel",
        icon: Settings2,
        image: withBase("screenshots/termina-settings-blurred.png"),
                                   imageClass: "scale-[1.1]",
      },
    ],
    [],
  );

  const [currentSlide, setCurrentSlide] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [currentFeaturePage, setCurrentFeaturePage] = useState(0);
  const [featureDirection, setFeatureDirection] = useState(0);
  const [isFeaturePaused, setIsFeaturePaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setInterval(() => {
      setSlideDirection(1);
      setCurrentSlide((prev) => (prev + 1) % screenshotSlides.length);
    }, SCREENSHOT_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isPaused, screenshotSlides.length]);

  useEffect(() => {
    if (isFeaturePaused || featurePages.length <= 1) return;

    const timer = window.setInterval(() => {
      setFeatureDirection(1);
      setCurrentFeaturePage((prev) => (prev + 1) % featurePages.length);
    }, FEATURE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isFeaturePaused]);

  const goToSlide = (index) => {
    if (index === currentSlide) return;
    setSlideDirection(index > currentSlide ? 1 : -1);
    setCurrentSlide(index);
  };

  const goPrev = () => {
    setSlideDirection(-1);
    setCurrentSlide((prev) => (prev - 1 + screenshotSlides.length) % screenshotSlides.length);
  };

  const goNext = () => {
    setSlideDirection(1);
    setCurrentSlide((prev) => (prev + 1) % screenshotSlides.length);
  };

  const goToFeaturePage = (index) => {
    if (index === currentFeaturePage) return;
    setFeatureDirection(index > currentFeaturePage ? 1 : -1);
    setCurrentFeaturePage(index);
  };

  const goPrevFeaturePage = () => {
    setFeatureDirection(-1);
    setCurrentFeaturePage((prev) => (prev - 1 + featurePages.length) % featurePages.length);
  };

  const goNextFeaturePage = () => {
    setFeatureDirection(1);
    setCurrentFeaturePage((prev) => (prev + 1) % featurePages.length);
  };

  const handleScreenshotDragEnd = (_event, info) => {
    const swipe = swipePower(info.offset.x, info.velocity.x);

    if (swipe <= -SWIPE_CONFIDENCE_THRESHOLD || info.offset.x <= -SWIPE_OFFSET_THRESHOLD) {
      goNext();
      return;
    }

    if (swipe >= SWIPE_CONFIDENCE_THRESHOLD || info.offset.x >= SWIPE_OFFSET_THRESHOLD) {
      goPrev();
    }
  };

  const handleFeatureDragEnd = (_event, info) => {
    const swipe = swipePower(info.offset.x, info.velocity.x);

    if (swipe <= -SWIPE_CONFIDENCE_THRESHOLD || info.offset.x <= -SWIPE_OFFSET_THRESHOLD) {
      goNextFeaturePage();
      return;
    }

    if (swipe >= SWIPE_CONFIDENCE_THRESHOLD || info.offset.x >= SWIPE_OFFSET_THRESHOLD) {
      goPrevFeaturePage();
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(132,204,22,0.14),transparent_25%)]" />

    <div className="relative mx-auto max-w-6xl px-5 py-5 lg:px-6">
    <header className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 backdrop-blur">
    <div className="flex items-center gap-2.5">
    <BrandIcon />
    <div>
    <p className="text-[13px] font-medium tracking-wide text-zinc-300">Termina SSH</p>
    <p className="text-[11px] text-zinc-500">Desktop SSH manager</p>
    </div>
    </div>

    <nav className="hidden items-center gap-5 text-[13px] text-zinc-300 md:flex">
    <a href="#features" className="transition hover:text-white">Features</a>
    <a href="#download" className="transition hover:text-white">Download</a>
    <a href="#faq" className="transition hover:text-white">FAQ</a>
    <a
    href="#support"
    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-white transition hover:border-white/20 hover:bg-white/10"
    >
    Support
    </a>
    </nav>
    </header>

    <main>
    <section className="py-8 lg:py-10">
    <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5 }}
    className="mx-auto max-w-3xl space-y-4 text-center"
    >
    <div className="space-y-4">
    <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
    A modern desktop home for your SSH workflow
    </h1>
    <p className="mx-auto max-w-2xl text-sm leading-6 text-zinc-300 sm:text-base">
    Termina SSH brings tabs, split view, local terminals, SFTP, a built in editor, notes, snippets, and tunnels into one focused desktop workflow.
    </p>
    </div>

    <div className="flex flex-wrap items-center justify-center gap-2.5">
    <a
    href="https://github.com/kahikara/TerminaSSH/releases"
    target="_blank"
    rel="noreferrer"
    className="inline-flex"
    >
    <Button className="h-10 rounded-xl bg-white px-4 text-zinc-950 hover:bg-zinc-200">
    <Download className="mr-2 h-4 w-4" />
    Download soon
    </Button>
    </a>
    <a
    href="https://github.com/kahikara/TerminaSSH"
    target="_blank"
    rel="noreferrer"
    className="inline-flex"
    >
    <Button variant="outline" className="h-10 rounded-xl border-white/15 bg-white/5 px-4 text-white hover:bg-white/10">
    <Github className="mr-2 h-4 w-4" />
    View on GitHub
    </Button>
    </a>
    </div>
    </motion.div>
    </section>

    <section className="pb-6">
    <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.55, delay: 0.08 }}
    className="mx-auto max-w-[1080px]"
    >
    <div className="mb-3 flex flex-col gap-1 text-center">
    <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
    A closer look at the interface
    </h2>
    </div>

    <Card
    className="overflow-hidden rounded-[24px] border-white/10 bg-zinc-900/70 shadow-2xl shadow-black/40"
    onMouseEnter={() => setIsPaused(true)}
    onMouseLeave={() => setIsPaused(false)}
    >
    <CardContent className="p-0">
    <div className={`${SCREENSHOT_STAGE_CLASS} relative overflow-hidden touch-pan-y select-none aspect-[16/10] rounded-[28px]`}>
    <AnimatePresence initial={false} custom={slideDirection} mode="wait">
    <motion.div
    key={screenshotSlides[currentSlide].key}
    custom={slideDirection}
    variants={slideVariants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={{ x: { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } }}
    className="absolute inset-0 cursor-grab active:cursor-grabbing"
    drag="x"
    dragConstraints={{ left: 0, right: 0 }}
    dragElastic={0.16}
    dragMomentum
    onDragStart={() => setIsPaused(true)}
    onDragEnd={handleScreenshotDragEnd}
    >
    <ScreenshotSlide slide={screenshotSlides[currentSlide]} />
    </motion.div>
    </AnimatePresence>

    <button
    type="button"
    onClick={goPrev}
    className="absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
    aria-label="Previous screenshot"
    >
    <ChevronLeft className="h-4 w-4" />
    </button>

    <button
    type="button"
    onClick={goNext}
    className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
    aria-label="Next screenshot"
    >
    <ChevronRight className="h-4 w-4" />
    </button>
    </div>

    <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-zinc-950/70 px-4 py-3">
    <div>
    <p className="text-[13px] font-medium text-white">{screenshotSlides[currentSlide].title}</p>
    <p className="text-[11px] text-zinc-500">{screenshotSlides[currentSlide].subtitle}</p>
    </div>

    <div className="flex items-center gap-2">
    {screenshotSlides.map((slide, index) => (
      <button
      key={slide.key}
      type="button"
      onClick={() => goToSlide(index)}
      className={`h-2 rounded-full transition ${
        index === currentSlide ? "w-8 bg-white" : "w-2.5 bg-white/25 hover:bg-white/40"
      }`}
      aria-label={`Go to ${slide.title}`}
      />
    ))}
    </div>
    </div>
    </CardContent>
    </Card>
    </motion.div>
    </section>

    <section id="features" className="py-10">
    <div className="mb-6 max-w-xl">
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Features</p>
    <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
    Focused features that actually matter
    </h2>
    </div>

    <Card
    className="overflow-hidden rounded-[24px] border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20"
    onMouseEnter={() => setIsFeaturePaused(true)}
    onMouseLeave={() => setIsFeaturePaused(false)}
    >
    <CardContent className="p-0">
    <div className="relative p-3 sm:p-4 lg:p-5">
    <div className="relative overflow-hidden touch-pan-y select-none" style={{ minHeight: FEATURE_STAGE_MIN_HEIGHT }}>
    <AnimatePresence initial={false} custom={featureDirection} mode="wait">
    <motion.div
    key={currentFeaturePage}
    custom={featureDirection}
    variants={slideVariants}
    initial="enter"
    animate="center"
    exit="exit"
    transition={{ x: { type: "spring", stiffness: 420, damping: 36, mass: 0.95 } }}
    className="absolute inset-0 grid cursor-grab gap-4 md:grid-cols-2 active:cursor-grabbing"
    drag="x"
    dragConstraints={{ left: 0, right: 0 }}
    dragElastic={0.16}
    dragMomentum
    onDragStart={() => setIsFeaturePaused(true)}
    onDragEnd={handleFeatureDragEnd}
    >
    {featurePages[currentFeaturePage].map((feature) => {
      const Icon = feature.icon;
      return (
        <Card
        key={feature.title}
        className="min-h-[184px] rounded-[20px] border-white/10 bg-zinc-950/70 shadow-lg shadow-black/20"
        >
        <CardContent className="p-5">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
        <Icon className="h-4.5 w-4.5 text-white" />
        </div>
        <h3 className="mb-1.5 text-base font-semibold text-white">{feature.title}</h3>
        <p className="text-[13px] leading-5 text-zinc-400">{feature.text}</p>
        </CardContent>
        </Card>
      );
    })}
    </motion.div>
    </AnimatePresence>
    </div>

    {featurePages.length > 1 && (
      <>
      <button
      type="button"
      onClick={goPrevFeaturePage}
      className="absolute left-4 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
      aria-label="Previous feature page"
      >
      <ChevronLeft className="h-4 w-4" />
      </button>

      <button
      type="button"
      onClick={goNextFeaturePage}
      className="absolute right-4 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white backdrop-blur transition hover:bg-black/60"
      aria-label="Next feature page"
      >
      <ChevronRight className="h-4 w-4" />
      </button>
      </>
    )}
    </div>

    {featurePages.length > 1 && (
      <div className="flex items-center justify-center border-t border-white/10 bg-zinc-950/60 px-4 py-3">
      <div className="flex items-center gap-2">
      {featurePages.map((_, index) => (
        <button
        key={index}
        type="button"
        onClick={() => goToFeaturePage(index)}
        className={`h-2 rounded-full transition ${
          index === currentFeaturePage ? "w-8 bg-white" : "w-2.5 bg-white/25 hover:bg-white/40"
        }`}
        aria-label={`Go to feature page ${index + 1}`}
        />
      ))}
      </div>
      </div>
    )}
    </CardContent>
    </Card>
    </section>

    <section id="download" className="py-6">
    <Card className="overflow-hidden rounded-[24px] border-white/10 bg-gradient-to-br from-white/10 to-white/[0.04]">
    <CardContent className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center lg:p-6">
    <div>
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Download</p>
    <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
    Ready to keep your SSH setup in one place?
    </h2>
    <p className="mt-2 max-w-xl text-[13px] leading-5 text-zinc-300 sm:text-sm">
    Start with Linux and macOS builds, share compatible backups, and grow the project in public on GitHub.
    </p>
    </div>

    <div className="flex flex-wrap items-center justify-center gap-2.5 lg:justify-end">
    <a
    href="https://github.com/kahikara/TerminaSSH/releases"
    target="_blank"
    rel="noreferrer"
    className="inline-flex"
    >
    <Button className="h-10 rounded-xl bg-white px-4 text-zinc-950 hover:bg-zinc-200">
    <Download className="mr-2 h-4 w-4" />
    Get builds
    </Button>
    </a>
    <a
    href="https://github.com/kahikara/TerminaSSH"
    target="_blank"
    rel="noreferrer"
    className="inline-flex"
    >
    <Button variant="outline" className="h-10 rounded-xl border-white/15 bg-white/5 px-4 text-white hover:bg-white/10">
    <Github className="mr-2 h-4 w-4" />
    Star the project
    </Button>
    </a>
    </div>
    </CardContent>
    </Card>
    </section>

    <section id="faq" className="py-12">
    <div className="mb-6 max-w-xl">
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">FAQ</p>
    <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
    A few practical answers
    </h2>
    </div>

    <div className="grid gap-3 md:grid-cols-2">
    {[
      {
        q: "Is Termina SSH a web app?",
        a: "No. It is designed as a desktop first experience for people who want a dedicated SSH manager without browser overhead.",
      },
      {
        q: "Can I use existing key files?",
        a: "Yes. PEM key support is part of the workflow so existing environments are easier to adopt.",
      },
      {
        q: "Can backups move across systems?",
        a: "That is the goal. A clean shared backup format makes Linux and macOS portability realistic and keeps future expansion easier.",
      },
      {
        q: "Who is it for?",
        a: "Developers, homelab users, sysadmins, and anyone who juggles multiple SSH connections and wants a cleaner workflow.",
      },
    ].map((item) => (
      <Card key={item.q} className="rounded-[20px] border-white/10 bg-white/[0.04]">
      <CardContent className="p-5">
      <h3 className="mb-1.5 text-base font-semibold text-white">{item.q}</h3>
      <p className="text-[13px] leading-5 text-zinc-400">{item.a}</p>
      </CardContent>
      </Card>
    ))}
    </div>
    </section>

    <section id="support" className="py-6">
    <div className="mx-auto max-w-2xl">
    <Card className="rounded-[20px] border-white/10 bg-white/[0.04]">
    <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
    <div>
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Support</p>
    <h2 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
    If you like my work, you can support the project on Ko fi.
    </h2>
    <p className="mt-1.5 text-[13px] leading-5 text-zinc-300">
    Every coffee helps support development and future updates for Termina SSH.
    </p>
    </div>

    <div className="shrink-0">
    <a
    href="https://ko-fi.com/ming83"
    target="_blank"
    rel="noreferrer"
    className="inline-flex h-10 items-center justify-center rounded-xl bg-white px-4 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200"
    >
    Buy me a coffee
    </a>
    </div>
    </CardContent>
    </Card>
    </div>
    </section>
    </main>

    <footer className="flex flex-col gap-3 border-t border-white/10 py-6 text-xs text-zinc-500 md:flex-row md:items-center md:justify-between">
    <div className="flex items-center gap-2">
    <BrandIcon className="h-4.5 w-4.5 rounded-md" />
    <span>Termina SSH</span>
    </div>
    <div className="flex items-center gap-4">
    <span>Desktop SSH manager</span>
    <span className="hidden md:inline">•</span>
    <span>Made for focused terminal work</span>
    <span className="hidden md:inline">•</span>
    <span className="flex items-center gap-1">
    <MonitorSmartphone className="h-4 w-4" />
    <span>Linux and macOS first</span>
    </span>
    </div>
    </footer>
    </div>
    </div>
  );
}
