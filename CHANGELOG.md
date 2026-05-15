# Changelog

Semua perubahan penting pada proyek Meridian akan didokumentasikan di file ini.

Format mengikuti [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), dan versi mengikuti [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] - 2026-05-15

### Added
- Dukungan resmi **SwiftRouter** sebagai LLM Provider
- Perintah CLI baru: `meridian models --provider swiftrouter`
- Flag `--tool-calling` pada perintah models (hanya menampilkan model yang bagus untuk tool calling)
- SwiftRouter ditambahkan ke Setup Wizard (`npm run setup`)

### Improved
- **Retry Logic** yang jauh lebih baik:
  - Menggunakan Exponential Backoff + Jitter
  - Lebih pintar membedakan error yang bisa dicoba ulang dan yang tidak
  - Otomatis fallback ke model cadangan jika gagal terus
- Penanganan response dari model reasoning (seperti MiniMax) yang mengembalikan `reasoning_content` dan tag `<think>`
- Stabilitas saat menggunakan provider LLM selain OpenRouter

### Changed
- Dokumentasi README.md disederhanakan agar lebih mudah dipahami pemula
- CLAUDE.md diperbarui dengan penjelasan teknis retry logic dan message normalization

### Technical
- Membuat file `utils/llm.js` sebagai wrapper retry yang reusable
- Menambahkan konfigurasi `llm.maxRetries` dan `llm.retryBaseDelayMs` di `config.js`

---

## [1.0.0] - Initial Release

- Rilis awal proyek Meridian (fork dari yunus-0x/meridian)
