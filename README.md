<p align="center">
  <img src="https://raw.githubusercontent.com/sujalmeena7/Tab-Hibernator-Pro/main/icons/icon128.png" width="80" alt="Tab Hibernator Pro Logo" />
</p>

<h1 align="center">Tab Hibernator Pro</h1>

<p align="center">
  <strong>Intelligent Tab Suspension & RAM Recovery Engine</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/JavaScript-ES6+-yellow?style=flat-square" alt="JavaScript" />
  <img src="https://img.shields.io/badge/Manifest-V3-orange?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome-Extension-blue?style=flat-square" alt="Chrome Extension" />
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" />
</p>

---

**Tab Hibernator Pro** is a high-performance, privacy-first browser extension that intelligently suspends inactive tabs to reclaim system memory. Built using a modern Manifest V3 architecture, it features a smart exclusion engine that detects audio, video, and active form inputs to ensure zero data loss while keeping your browser blazing fast.

---

## ✨ Features

- **🚀 Smart Inactivity Detection**: Uses a robust single-alarm background sweep (1-min intervals) to monitor tab idle time.
- **🛡️ Advanced Exclusions**: 
  - **Audio/Video**: Never suspends playing media (YouTube, Spotify, etc.).
  - **Form Input**: Detects active typing/focus in forms to prevent losing progress.
  - **System Pages**: Ignores pinned tabs and internal browser pages.
- **💾 Estimated Savings**: Displays real-time RAM recovery stats (~80MB per tab).
- **🔄 State Persistence**: Instantly restore tabs with original URL, title, and **scroll position**.
- **🌑 Modern UI**: Premium dark-mode dashboard and settings page with vanilla CSS glassmorphism.

---

## 🛠️ Installation

1. **Clone the repo**:
   ```bash
   git clone https://github.com/sujalmeena7/Tab-Hibernator-Pro.git
   ```
2. **Load in Chrome**:
   - Open `chrome://extensions/`
   - Enable **Developer Mode**
   - Click **Load unpacked** and select the project directory.

---

## ⚙️ Configuration

The extension offers a clean options page to customize your experience:
- **Timeout Slider**: Set inactivity limits from 5 minutes to 4 hours.
- **Whitelist**: Define specific domains to never hibernate.
- **Battery Saver**: (Optional) Only hibernate when your device is unplugged.
- **Badge Toggle**: Show/hide the hibernation count on the toolbar icon.

---

<p align="center">
  <a href="https://rzp.io/rzp/ihYPBim">
    <img src="https://img.shields.io/badge/Support-Buy%20me%20a%20coffee-FF6B35?style=for-the-badge&logo=buymeacoffee&logoColor=white" alt="Support the project" />
  </a>
</p>

<p align="center">
  Developed with ❤️ by <a href="https://github.com/sujalmeena7">sujalmeena7</a>
</p>
