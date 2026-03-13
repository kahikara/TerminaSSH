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
import "./index.css";

const SCREENSHOT_INTERVAL_MS = 3500;
const FEATURE_INTERVAL_MS = 4200;
const SWIPE_CONFIDENCE_THRESHOLD = 12000;
const SWIPE_OFFSET_THRESHOLD = 120;
const FEATURE_STAGE_MIN_HEIGHT = 468;
const SCREENSHOT_STAGE_CLASS = "showcase-stage";

function getBaseUrl() {
  try {
    if (import.meta?.env?.BASE_URL && typeof import.meta.env.BASE_URL === "string") {
      return import.meta.env.BASE_URL;
    }
  } catch {
  }

  if (typeof window !== "undefined" && window.location.pathname.startsWith("/TerminaSSH/")) {
    return "/TerminaSSH/";
  }

  return "/";
}

function withBase(path) {
  const cleanPath = path.replace(/^\/+/, "");
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

function InlineBrandGlyph({ className = "" }) {
  return (
    <div className={`brand-glyph ${className}`.trim()}>
      <svg viewBox="0 0 128 128" className="brand-glyph-svg" aria-hidden="true">
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

function IconButton({ href, children, variant = "outline" }) {
  const className = variant === "solid" ? "btn btn-solid" : "btn btn-outline";
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

function ScreenshotSlide({ slide }) {
  const [failed, setFailed] = useState(false);
  const Icon = slide.icon;

  if (failed) {
    return (
      <div className="screenshot-fallback">
        <div className="fallback-icon-wrap">
          <Icon size={24} />
        </div>
        <h3>{slide.title}</h3>
        <p>{slide.subtitle}</p>
        <p className="muted-small">
          Add <code>{slide.image}</code> to <code>homepage/public</code> to display this screenshot.
        </p>
      </div>
    );
  }

  return (
    <div className="screenshot-image-wrap">
      <img
        src={slide.image}
        alt={slide.title}
        className="screenshot-image"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

export default function App() {
  const screenshotSlides = useMemo(
    () => [
      {
        key: "main",
        title: "Main window",
        subtitle: "Connections, quick connect, and recent activity",
        icon: Layers3,
        image: withBase("screenshots/termina-main-blurred.png"),
      },
      {
        key: "editor",
        title: "Editor",
        subtitle: "Remote editing with search, replace, and save controls",
        icon: PencilLine,
        image: withBase("screenshots/termina-editor-blurred.png"),
      },
      {
        key: "sftp",
        title: "Terminal and SFTP",
        subtitle: "Terminal work and file browsing side by side",
        icon: FolderOpen,
        image: withBase("screenshots/termina-terminal-sftp-blurred.png"),
      },
      {
        key: "settings",
        title: "Settings",
        subtitle: "Theme, tools, and behavior in one clean settings panel",
        icon: Settings2,
        image: withBase("screenshots/termina-settings-blurred.png"),
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
    <div className="page-shell">
      <div className="page-glow" />
      <div className="page-container">
        <header className="topbar">
          <div className="brand">
            <InlineBrandGlyph className="brand-logo" />
            <div>
              <p className="brand-title">Termina SSH</p>
              <p className="brand-subtitle">Desktop SSH manager</p>
            </div>
          </div>

          <nav className="topnav">
            <a href="#features">Features</a>
            <a href="#download">Download</a>
            <a href="#faq">FAQ</a>
            <a href="#support" className="topnav-cta">Support</a>
          </nav>
        </header>

        <main>
          <section className="hero">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="hero-inner"
            >
              <div className="hero-copy">
                <h1>A modern desktop home for your SSH workflow</h1>
                <p>
                  Termina SSH brings tabs, split view, local terminals, SFTP, a built in editor, notes, snippets,
                  and tunnels into one focused desktop workflow.
                </p>
              </div>

              <div className="hero-actions">
                <IconButton href="https://github.com/kahikara/TerminaSSH/releases" variant="solid">
                  <Download size={16} />
                  <span>Download soon</span>
                </IconButton>
                <IconButton href="https://github.com/kahikara/TerminaSSH">
                  <Github size={16} />
                  <span>View on GitHub</span>
                </IconButton>
              </div>
            </motion.div>
          </section>

          <section className="showcase-section">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="showcase-shell"
            >
              <div className="section-heading">
                <h2>A closer look at the interface</h2>
                <p>
                  Take a closer look at the main window, editor, SFTP browser, and settings in the showcase section
                  below.
                </p>
              </div>

              <section
                className="panel showcase-panel"
                onMouseEnter={() => setIsPaused(true)}
                onMouseLeave={() => setIsPaused(false)}
              >
                <div className={SCREENSHOT_STAGE_CLASS}>
                  <AnimatePresence initial={false} custom={slideDirection} mode="wait">
                    <motion.div
                      key={screenshotSlides[currentSlide].key}
                      custom={slideDirection}
                      variants={slideVariants}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ x: { type: "spring", stiffness: 420, damping: 36, mass: 0.9 } }}
                      className="carousel-slide"
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

                  <button type="button" onClick={goPrev} className="arrow left" aria-label="Previous screenshot">
                    <ChevronLeft size={20} />
                  </button>

                  <button type="button" onClick={goNext} className="arrow right" aria-label="Next screenshot">
                    <ChevronRight size={20} />
                  </button>
                </div>

                <div className="panel-footer">
                  <div>
                    <p className="panel-footer-title">{screenshotSlides[currentSlide].title}</p>
                    <p className="panel-footer-subtitle">{screenshotSlides[currentSlide].subtitle}</p>
                  </div>

                  <div className="dots">
                    {screenshotSlides.map((slide, index) => (
                      <button
                        key={slide.key}
                        type="button"
                        onClick={() => goToSlide(index)}
                        className={`dot ${index === currentSlide ? "active" : ""}`}
                        aria-label={`Go to ${slide.title}`}
                      />
                    ))}
                  </div>
                </div>
              </section>
            </motion.div>
          </section>

          <section id="features" className="features-section">
            <div className="section-heading left">
              <p className="eyebrow">Features</p>
              <h2>Focused features that actually matter</h2>
            </div>

            <section
              className="panel panel-soft"
              onMouseEnter={() => setIsFeaturePaused(true)}
              onMouseLeave={() => setIsFeaturePaused(false)}
            >
              <div className="feature-stage" style={{ minHeight: FEATURE_STAGE_MIN_HEIGHT }}>
                <AnimatePresence initial={false} custom={featureDirection} mode="wait">
                  <motion.div
                    key={currentFeaturePage}
                    custom={featureDirection}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ x: { type: "spring", stiffness: 420, damping: 36, mass: 0.95 } }}
                    className="feature-grid"
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
                        <article key={feature.title} className="feature-card">
                          <div className="feature-icon">
                            <Icon size={20} />
                          </div>
                          <h3>{feature.title}</h3>
                          <p>{feature.text}</p>
                        </article>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
              </div>

              {featurePages.length > 1 && (
                <>
                  <button type="button" onClick={goPrevFeaturePage} className="arrow left" aria-label="Previous feature page">
                    <ChevronLeft size={20} />
                  </button>

                  <button type="button" onClick={goNextFeaturePage} className="arrow right" aria-label="Next feature page">
                    <ChevronRight size={20} />
                  </button>
                </>
              )}

              {featurePages.length > 1 && (
                <div className="feature-footer">
                  <div className="dots">
                    {featurePages.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => goToFeaturePage(index)}
                        className={`dot ${index === currentFeaturePage ? "active" : ""}`}
                        aria-label={`Go to feature page ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </section>
          </section>

          <section id="download" className="download-section">
            <section className="panel panel-gradient download-panel">
              <div>
                <p className="eyebrow">Download</p>
                <h2>Ready to keep your SSH setup in one place?</h2>
                <p>
                  Start with Linux and macOS builds, share compatible backups, and grow the project in public on GitHub.
                </p>
              </div>

              <div className="download-actions">
                <IconButton href="https://github.com/kahikara/TerminaSSH/releases" variant="solid">
                  <Download size={16} />
                  <span>Get builds</span>
                </IconButton>
                <IconButton href="https://github.com/kahikara/TerminaSSH">
                  <Github size={16} />
                  <span>Star the project</span>
                </IconButton>
              </div>
            </section>
          </section>

          <section id="faq" className="faq-section">
            <div className="section-heading left">
              <p className="eyebrow">FAQ</p>
              <h2>A few practical answers</h2>
            </div>

            <div className="faq-grid">
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
                <article key={item.q} className="faq-card">
                  <h3>{item.q}</h3>
                  <p>{item.a}</p>
                </article>
              ))}
            </div>
          </section>

          <section id="support" className="support-section">
            <section className="panel panel-soft support-panel">
              <div>
                <p className="eyebrow">Support</p>
                <h2>If you like my work, you can support the project on Ko fi.</h2>
                <p>Every coffee helps support development, polish, and future updates for Termina SSH.</p>
              </div>

              <a
                href="https://ko-fi.com/ming83"
                target="_blank"
                rel="noreferrer"
                className="btn btn-solid"
              >
                Buy me a coffee
              </a>
            </section>
          </section>
        </main>

        <footer className="footer">
          <div className="footer-brand">
            <InlineBrandGlyph className="brand-logo tiny" />
            <span>Termina SSH</span>
          </div>
          <div className="footer-copy">
            <span>Desktop SSH manager</span>
            <span className="footer-sep">•</span>
            <span>Made for focused terminal work</span>
            <span className="footer-sep">•</span>
            <span className="footer-inline-icon">
              <MonitorSmartphone size={14} />
              <span>Linux and macOS first</span>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
