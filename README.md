# 💤 Tab Hibernator Pro

[![Version](https://img.shields.io/badge/version-1.0.0-teal.svg?style=for-the-badge)](https://github.com/sujalmeena7/Tab-Hibernator-Pro)
[![Manifest](https://img.shields.io/badge/Manifest-V3-orange.svg?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)

**Tab Hibernator Pro** is a lightweight, high-performance Chrome extension designed to reclaim your system memory by intelligently suspending inactive tabs. Built with **Manifest V3** and zero external dependencies, it offers a privacy-first, trustworthy alternative to bloated tab managers.

---

## ✨ Key Features

- **🚀 Smart Auto-Suspension**: Automatically hibernates tabs after a user-defined period (5m - 4h) using the robust `chrome.alarms` API.
- **🛡️ Intelligent Exclusions**: 
  - Never suspends **pinned tabs**.
  - Detects **active audio/video** (YouTube, Spotify, etc.) and keeps them alive.
  - Detects **active form inputs** (Gmail, Reddit, etc.) to prevent data loss.
  - Whitelist your favorite domains.
- **💾 RAM Recovery**: Saves an estimated **~80MB per hibernated tab**.
- **🔄 Instant Restore**: Click "Wake this tab" to restore precisely where you left off, including **scroll position**.
- **🌑 Premium Dark Mode**: Beautiful, modern UI for both the popup and options page.
- **🔒 Privacy-First**: 100% local processing. No analytics, no tracking, and no external API calls.

---

## 🛠️ Installation (Developer Mode)

Until the extension is available on the Chrome Web Store, you can load it manually:

1.  **Clone the Repository**:
    ```bash
    git clone https://github.com/sujalmeena7/Tab-Hibernator-Pro.git
    ```
2.  **Open Chrome Extensions**: Navigate to `chrome://extensions/`.
3.  **Enable Developer Mode**: Toggle the switch in the top-right corner.
4.  **Load Unpacked**: Click "Load unpacked" and select the project folder.

---

## 📸 Preview

| Popup Dashboard | Settings Page |
| :---: | :---: |
| ![Popup Preview](https://raw.githubusercontent.com/sujalmeena7/Tab-Hibernator-Pro/main/preview_popup.png) | ![Options Preview](https://raw.githubusercontent.com/sujalmeena7/Tab-Hibernator-Pro/main/preview_options.png) |

*(Note: Add your own screenshots to the repo and update these links!)*

---

## 🧠 Technical Architecture

Tab Hibernator Pro uses a highly efficient **Single-Alarm Architecture** to solve common Manifest V3 service worker sleep issues:

- **Background Worker**: Manages a single repeating 1-minute alarm that sweeps all tabs, comparing `lastActivity` timestamps stored in `chrome.storage.local`.
- **Content Script**: Lightweight observer that reports user activity and form-focus state without impacting page performance.
- **Storage**: Uses `chrome.storage.local` to persist tab state across browser restarts.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/sujalmeena7">sujalmeena7</a>
</p>
