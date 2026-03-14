# 🚀 TerminaSSH

A modern, highly performant, and secure SSH client for power users, sysadmins, and developers. Built with the raw power of **Tauri**, **Rust**, and **React**.

<p align="center">
  <img src="homepage/screenshots/termina-main-blurred.png" width="850" alt="TerminaSSH Main">
</p>

## ✨ Features that make a difference

TerminaSSH isn't just another terminal. It was built from the ground up to make your daily workflow as smooth and native as possible.

* 🛡️ **Absolute Data Security:** Your server configs and passwords stay with you. Backups are encrypted locally via the Web Crypto API using true **AES-256-GCM**. Without your password, the backup is useless.
* 🧠 **"Unkillable" Tabs:** Custom terminal state management ensures your SSH sessions and PTY pipes keep running in the background down to the millisecond—even when you switch back to the dashboard.
* ⌨️ **Native Copy/Paste:** No annoying auto-copy. Termina behaves like a true native Linux terminal (Select + Right-click = Copy, Right-click on empty space or Middle-click = Paste).
* 📂 **Integrated SFTP & Remote Editor:** A fully-fledged file browser with drag-and-drop upload. Edit files directly on your server thanks to the integrated *Monaco Engine* (VS Code).
* 🪟 **Split-View & Tunnels:** Work in two terminals side-by-side simultaneously and manage SSH port forwarding (tunnels) directly from the UI.
* 📊 **Live Hardware Metrics:** Keep an eye on your server's CPU and RAM usage, as well as session time, directly in the live footer status bar.
* 🔑 **PEM & Key Manager:** Manage SSH keys directly within the app. Generate new `ed25519` keys with a single click or import existing `.pem` files.
* 🎨 **Customization & Themes:** Choose between true hacker themes like *Catppuccin*, *Nord*, or *Pitch Black*. Adjust font sizes, cursor styles, and more on the fly.
* 💻 **Local Terminal:** Not just for remote work! Termina comes with a fully functional local shell for your operating system.
* ⚙️ **System Tray:** Minimizes to the tray and runs silently in the background with a minimal resource footprint (thanks to Rust!).

## 📸 Screenshots

<p align="center">
  <img src="homepage/screenshots/termina-settings-blurred.png" width="48%" title="Settings & Backup">
  &nbsp;
  <img src="homepage/screenshots/termina-terminal-sftp-blurred.png" width="48%" title="SFTP Browser">
</p>

<p align="center">
  <img src="homepage/screenshots/termina-editor-blurred.png" width="48%" title="Integrated Code Editor">
  <br>
  <em>(Left: Integrated Monaco Editor | Right: Settings & SFTP)</em>
</p>

## 🛠️ Tech Stack

* **Frontend:** React 18, Vite, TypeScript, TailwindCSS
* **Backend:** Rust, Tauri v2
* **Terminal Engine:** xterm.js (incl. WebGL/Canvas Rendering)
* **Editor Engine:** Monaco Editor
* **Security:** Native Web Crypto API (AES-256)

## 📥 Installation

You can find the pre-compiled executables for Linux and macOS in the **[Releases](../../releases)**.

* 🐧 **Linux:** `.AppImage`, `.deb`, or `.rpm`
* 🍏 **macOS:** `.dmg`

## 💻 Development (Build from Source)

Want to compile TerminaSSH yourself or contribute? No problem!

### Prerequisites
1. [Node.js](https://nodejs.org/) (v18 or higher)
2. [Rust & Cargo](https://rustup.rs/)
3. Tauri system dependencies (see [Tauri Docs](https://v2.tauri.app/start/prerequisites/))

### Setup & Start
```bash
# 1. Clone the repository
git clone https://github.com/kahikara/terminassh.git
cd terminassh

# 2. Install Node dependencies
npm install

# 3. Start the development server (Hot-Reload)
npm run tauri dev
```

### Build (Release)
To generate a production-ready app for your operating system:
```bash
npm run tauri build
```
The compiled installation files will be located in the `src-tauri/target/release/bundle/` directory.

## ☕ Support the Project

If you enjoy using TerminaSSH and want to support its ongoing development, I'd highly appreciate a coffee! 

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/ming83)

---
*Built with ❤️ for power users.*
