# 🚀 Termina SSH

A modern, fast, and practical SSH workspace for power users, sysadmins, and developers.  
Built with **Tauri**, **Rust**, and **React**.

<p align="center">
  <img src="homepage/screenshots/termina-main-blurred.png" width="850" alt="Termina SSH Main">
</p>

## ✨ Why Termina SSH

Termina SSH was built with a clear goal:  
make everyday SSH work feel fast, focused, and pleasant without turning the app into an overloaded enterprise monster.

It aims to stay lightweight, functional, and native feeling across platforms while still covering the features that matter in real workflows.

## 🔥 Highlights

* 🛡 **Local first and privacy focused**  
  Your connections, notes, and settings stay with you. Backups can be exported locally and encrypted before leaving your machine.

* 💾 **Cross platform backup and restore**  
  Import and export your configuration across systems. Notes are included in the backup bundle and restore cleanly across platforms.

* 🖥 **Multi platform desktop app**  
  Built for **Linux**, **macOS**, and **Windows** with native builds and installers.

* 💻 **Local and remote terminal workflow**  
  Use Termina SSH not only for remote servers, but also as a clean local terminal workspace.

* ↔️ **Split terminal workflow**  
  Work with multiple terminals side by side and switch between focused single pane and split based workflows.

* 📂 **Integrated SFTP browser and remote editor**  
  Browse remote files, upload content, edit remote files directly inside the app, and stay in one workflow.

* 🧠 **Session focused workflow**  
  Tabs, recent connections, quick access, split panes, and a layout built around actually getting work done.

* 🔑 **SSH key and auth friendly**  
  Works with common SSH authentication flows and is designed to stay practical instead of getting in your way.

* 🧩 **Built in snippets and tunnels**  
  Keep useful commands close and manage SSH tunnels directly from the UI.

* 🎨 **Clean UI with theme support**  
  Termina SSH includes multiple themes and customization options while keeping the interface compact and focused.

* ⚙ **Tray and background behavior**  
  Runs quietly in the background when needed without feeling heavy.

## 📸 Screenshots

<p align="center">
  <img src="homepage/screenshots/termina-settings-blurred.png" width="48%" title="Settings and Backup">
  &nbsp;
  <img src="homepage/screenshots/termina-terminal-sftp-blurred.png" width="48%" title="Terminal and SFTP">
</p>

<p align="center">
  <img src="homepage/screenshots/termina-editor-blurred.png" width="48%" title="Integrated Editor">
  <br>
  <em>Integrated editor, settings, backup, and SFTP workflow</em>
</p>

## ✅ Current feature set

* SSH connections with saved profiles
* Local terminal
* Tab based workflow
* Split terminal workflow
* Quick Connect
* SFTP browser
* Remote file editing
* Snippets
* SSH tunnels
* Encrypted backup export
* Backup restore across platforms
* Notes included in backups
* Import and export summary dialogs
* Copy path and open folder actions in export dialogs
* Theme support
* System tray support
* Cross platform release builds

## 🛠 Tech Stack

* **Frontend:** React, Vite, TypeScript, TailwindCSS
* **Backend:** Rust, Tauri v2
* **Terminal Engine:** xterm.js
* **Storage:** local app data plus exportable backup bundles
* **Security:** optional encrypted local backup export

## 📦 Installation

Prebuilt binaries are available in **[Releases](../../releases)**.

### Current release assets

* Linux: `.deb`, `.rpm`, `.AppImage`
* Windows: `setup.exe`
* macOS: `.dmg`

Release artifacts are built through GitHub Actions for more reproducible cross platform packaging.

## 💻 Development

Want to build Termina SSH from source or contribute?

### Prerequisites

1. [Node.js](https://nodejs.org/)
2. [Rust and Cargo](https://rustup.rs/)
3. Tauri system dependencies for your platform  
   See the official [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Clone and run

    git clone https://github.com/kahikara/TerminaSSH.git TerminaSSH
    cd TerminaSSH
    npm install
    npm run tauri dev

### Build

    npm run tauri build

The generated release artifacts will be located in:

    src-tauri/target/release/bundle/

## 🗺 Roadmap direction

Planned polish and future improvements include:

* improved connection UX
* richer theme customization
* smarter tunnel handling for heavier workloads
* continued SFTP and editor polish
* continued cross platform polish and packaging improvements

## ☕ Support the Project

If you enjoy using Termina SSH and want to support its continued development, a coffee is always appreciated.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/ming83)

---

Built with ❤ for people who live in terminals.
